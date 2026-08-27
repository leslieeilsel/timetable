<?php

namespace App\Modules\Scheduling\Http\Controllers;

use App\Enums\ConstraintCategory;
use App\Enums\ConstraintKind;
use App\Enums\ConstraintStatus;
use App\Enums\ConstraintTargetType;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Scheduling\Models\SchedulingConstraint;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\Normalizer;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SchedulingConstraintController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
    ) {}

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $filters = $request->validate([
            'kind' => ['sometimes', Rule::enum(ConstraintKind::class)],
            'status' => ['sometimes', Rule::enum(ConstraintStatus::class)],
            'category' => ['sometimes', Rule::enum(ConstraintCategory::class)],
            'target_type' => ['sometimes', Rule::enum(ConstraintTargetType::class)],
            'target_id' => ['sometimes', 'integer'],
            'search' => ['sometimes', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ]);
        $paginator = $semester->schedulingConstraints()
            ->when(isset($filters['kind']), fn ($query) => $query->where('kind', $filters['kind']))
            ->when(isset($filters['status']), fn ($query) => $query->where('status', $filters['status']))
            ->when(isset($filters['category']), fn ($query) => $query->where('category', $filters['category']))
            ->when(isset($filters['target_type']), fn ($query) => $query->where('target_type', $filters['target_type']))
            ->when(isset($filters['target_id']), fn ($query) => $query->where('target_id', $filters['target_id']))
            ->when(isset($filters['search']), fn ($query) => $query->where('name', 'like', '%'.Normalizer::text($filters['search']).'%'))
            ->orderByRaw("case status when 'active' then 0 when 'draft' then 1 else 2 end")
            ->orderBy('kind')
            ->orderBy('name')
            ->paginate((int) ($filters['per_page'] ?? 20));
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json([
            'data' => $paginator->items(),
            'meta' => array_merge($this->meta($semester, $settings), [
                'pagination' => [
                    'page' => $paginator->currentPage(),
                    'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(),
                    'last_page' => $paginator->lastPage(),
                    'from' => $paginator->firstItem(),
                    'to' => $paginator->lastItem(),
                ],
            ]),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $data = $this->validatedPayload($request);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $this->assertPayload($lockedSemester, $data);
            $constraint = SchedulingConstraint::query()->create([
                ...$data,
                'semester_id' => $lockedSemester->id,
                'name' => Normalizer::text($data['name']),
                'source' => 'user',
                'status' => ConstraintStatus::Draft,
            ]);
            $this->bumpRevision($lockedSemester);
            $this->audit->record($request, $actor, 'create', 'scheduling_constraint', $constraint->id, null, $constraint->toArray());

            return response()->json([
                'data' => $constraint,
                'meta' => $this->meta($lockedSemester, $settings),
            ], 201)->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function update(Request $request, Semester $semester, SchedulingConstraint $constraint): JsonResponse
    {
        $this->assertParent($semester, $constraint);
        $data = $this->validatedPayload($request, true);

        return DB::transaction(function () use ($request, $semester, $constraint, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = SchedulingConstraint::query()->lockForUpdate()->findOrFail($constraint->id);
            $this->assertUserEditable($locked);
            $merged = [...$locked->only([
                'name', 'kind', 'category', 'target_type', 'target_id', 'scope', 'condition',
                'requirement', 'weight', 'explanation',
            ]), ...$data];
            $this->assertPayload($lockedSemester, $merged);
            $before = $locked->toArray();
            $locked->fill($data);
            if (isset($data['name'])) {
                $locked->name = Normalizer::text($data['name']);
            }
            if ($locked->isDirty()) {
                $locked->save();
                $this->bumpRevision($lockedSemester);
                $this->audit->record($request, $actor, 'update', 'scheduling_constraint', $locked->id, $before, $locked->toArray());
            }

            return response()->json([
                'data' => $locked,
                'meta' => $this->meta($lockedSemester, $settings),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function activate(Request $request, Semester $semester, SchedulingConstraint $constraint): JsonResponse
    {
        return $this->transition($request, $semester, $constraint, ConstraintStatus::Active);
    }

    public function deactivate(Request $request, Semester $semester, SchedulingConstraint $constraint): JsonResponse
    {
        return $this->transition($request, $semester, $constraint, ConstraintStatus::Inactive);
    }

    public function destroy(Request $request, Semester $semester, SchedulingConstraint $constraint): JsonResponse
    {
        $this->assertParent($semester, $constraint);

        return DB::transaction(function () use ($request, $semester, $constraint): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = SchedulingConstraint::query()->lockForUpdate()->findOrFail($constraint->id);
            $this->assertUserEditable($locked);
            if ($locked->status === ConstraintStatus::Active) {
                throw new ApiProblemException('CONSTRAINT_ACTIVE_DELETE_FORBIDDEN', '启用中的规则需先停用再删除', 409);
            }
            $before = $locked->toArray();
            $locked->delete();
            $this->bumpRevision($lockedSemester);
            $this->audit->record($request, $actor, 'delete', 'scheduling_constraint', $constraint->id, $before, null);

            return response()->json([
                'data' => ['deleted_id' => $constraint->id],
                'meta' => $this->meta($lockedSemester, $settings),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    private function transition(
        Request $request,
        Semester $semester,
        SchedulingConstraint $constraint,
        ConstraintStatus $target,
    ): JsonResponse {
        $this->assertParent($semester, $constraint);

        return DB::transaction(function () use ($request, $semester, $constraint, $target): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = SchedulingConstraint::query()->lockForUpdate()->findOrFail($constraint->id);
            if ($target === ConstraintStatus::Active) {
                $this->assertPayload($lockedSemester, $locked->only([
                    'name', 'kind', 'category', 'target_type', 'target_id', 'scope', 'condition',
                    'requirement', 'weight', 'explanation',
                ]));
            } elseif ($locked->source === 'system') {
                throw new ApiProblemException('SYSTEM_CONSTRAINT_IMMUTABLE', '系统必要硬约束不能停用', 409);
            }
            $before = $locked->toArray();
            $locked->status = $target;
            if ($locked->isDirty()) {
                $locked->save();
                $this->bumpRevision($lockedSemester);
                $this->audit->record($request, $actor, $target->value, 'scheduling_constraint', $locked->id, $before, $locked->toArray());
            }

            return response()->json([
                'data' => $locked,
                'meta' => $this->meta($lockedSemester, $settings),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    /** @return array<string, mixed> */
    private function validatedPayload(Request $request, bool $partial = false): array
    {
        $presence = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$presence, 'string', 'max:120'],
            'kind' => [$presence, Rule::enum(ConstraintKind::class)],
            'category' => [$presence, Rule::enum(ConstraintCategory::class)],
            'target_type' => [$partial ? 'sometimes' : 'nullable', 'nullable', Rule::enum(ConstraintTargetType::class)],
            'target_id' => [$partial ? 'sometimes' : 'nullable', 'nullable', 'integer'],
            'scope' => [$partial ? 'sometimes' : 'present', 'array'],
            'condition' => ['sometimes', 'nullable', 'array'],
            'requirement' => [$presence, 'array', 'min:1'],
            'weight' => ['sometimes', 'nullable', 'integer', 'between:1,100'],
            'explanation' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);
    }

    /** @param array<string, mixed> $data */
    private function assertPayload(Semester $semester, array $data): void
    {
        $kind = $data['kind'] instanceof ConstraintKind ? $data['kind'] : ConstraintKind::from($data['kind']);
        $weight = $data['weight'] ?? null;
        if (($kind === ConstraintKind::Hard && $weight !== null) || ($kind === ConstraintKind::Soft && $weight === null)) {
            throw new ApiProblemException('CONSTRAINT_WEIGHT_INVALID', '硬约束不设置权重，软规则必须设置 1 至 100 的权重', 422);
        }

        $targetType = $data['target_type'] ?? null;
        $targetId = $data['target_id'] ?? null;
        if (($targetType === null) !== ($targetId === null)) {
            throw new ApiProblemException('CONSTRAINT_TARGET_INVALID', '作用对象类型和对象必须同时选择', 422);
        }
        if ($targetType !== null) {
            $type = $targetType instanceof ConstraintTargetType ? $targetType : ConstraintTargetType::from($targetType);
            if (! $this->targetExists($semester, $type, (int) $targetId)) {
                throw new ApiProblemException('CONSTRAINT_TARGET_NOT_FOUND', '规则作用对象不存在或不属于该学期', 422);
            }
        }
        $category = $data['category'] instanceof ConstraintCategory
            ? $data['category']
            : ConstraintCategory::from($data['category']);
        $this->assertRequirement(
            $semester,
            $category,
            $data['requirement'],
            $targetType instanceof ConstraintTargetType ? $targetType : ($targetType === null ? null : ConstraintTargetType::from($targetType)),
            $targetId === null ? null : (int) $targetId,
        );
    }

    /**
     * @param  array<string, mixed>  $requirement
     */
    private function assertRequirement(
        Semester $semester,
        ConstraintCategory $category,
        array $requirement,
        ?ConstraintTargetType $targetType,
        ?int $targetId,
    ): void {
        $valid = match ($category) {
            ConstraintCategory::Availability, ConstraintCategory::ForbiddenSlot => $this->hasBoolean($requirement, ['available', 'allowed_only', 'resource_no_overlap', 'item_allows_course', 'teacher_course_qualification', 'preserve_locked_entries']),
            ConstraintCategory::DailyLoad => $this->hasInteger($requirement, ['max_items_per_day', 'max_per_day'], 1, 20),
            ConstraintCategory::WeeklyLoad => isset($requirement['assignment_completeness'])
                || $this->hasInteger($requirement, ['max_items_per_week', 'max_per_week'], 1, 100),
            ConstraintCategory::ConsecutiveItems => $this->hasInteger($requirement, ['max_consecutive_items', 'maximum'], 1, 10),
            ConstraintCategory::CourseDistribution => isset($requirement['spread_across_weekdays'])
                || $this->hasInteger($requirement, ['max_same_course_per_day', 'max_per_day'], 1, 10),
            ConstraintCategory::PreferredSlot => in_array($requirement['preference'] ?? null, ['prefer', 'avoid'], true),
            ConstraintCategory::RoomRequirement => isset($requirement['assignment_room_mode']),
            ConstraintCategory::Spacing => $this->hasInteger($requirement, ['max_same_course_per_day'], 1, 10)
                || $this->hasInteger($requirement, ['min_gap_days', 'minimum_gap_days'], 1, 7),
            ConstraintCategory::Synchronization, ConstraintCategory::MutualExclusion => true,
            ConstraintCategory::WorkloadBalance => isset($requirement['balance_teacher_daily_load'])
                || $this->hasInteger($requirement, ['max_items_per_day'], 1, 20),
            ConstraintCategory::TeacherGaps => isset($requirement['minimize_teacher_gaps']) || isset($requirement['minimize']),
            ConstraintCategory::CoursePriority => isset($requirement['prefer_earlier_items'])
                || in_array($requirement['preference'] ?? null, ['prefer', 'avoid'], true),
        };
        if (! $valid) {
            throw new ApiProblemException(
                'CONSTRAINT_REQUIREMENT_INVALID',
                '规则要求缺少该规则类型所需的数量、偏好或开关，请重新填写',
                422,
                ['category' => $category->value],
            );
        }

        if (in_array($category, [ConstraintCategory::Synchronization, ConstraintCategory::MutualExclusion], true)) {
            $ids = $requirement['with_assignment_ids'] ?? $requirement['assignment_ids'] ?? [];
            $ids = is_array($ids) ? array_values(array_unique(array_map('intval', $ids))) : [];
            if ($targetType === ConstraintTargetType::TeachingAssignment && $targetId !== null) {
                $ids[] = $targetId;
                $ids = array_values(array_unique($ids));
            }
            if (count($ids) < 2) {
                throw new ApiProblemException(
                    'CONSTRAINT_RELATION_TARGETS_INSUFFICIENT',
                    '同步或互斥规则至少需要选择两条任课关系',
                    422,
                );
            }
            $existing = DB::table('teaching_assignments')
                ->where('semester_id', $semester->id)->whereIn('id', $ids)->count();
            if ($existing !== count($ids)) {
                throw new ApiProblemException('CONSTRAINT_RELATION_TARGET_INVALID', '同步或互斥规则包含无效任课关系', 422);
            }
            if ($category === ConstraintCategory::MutualExclusion
                && ! in_array($requirement['mode'] ?? 'same_slot', ['same_slot', 'same_day'], true)) {
                throw new ApiProblemException('CONSTRAINT_EXCLUSION_MODE_INVALID', '互斥方式只能选择不同课节或不同日期', 422);
            }
        }
    }

    /**
     * @param  array<string, mixed>  $requirement
     * @param  list<string>  $keys
     */
    private function hasBoolean(array $requirement, array $keys): bool
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $requirement) && (is_bool($requirement[$key]) || is_string($requirement[$key]))) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $requirement
     * @param  list<string>  $keys
     */
    private function hasInteger(array $requirement, array $keys, int $minimum, int $maximum): bool
    {
        foreach ($keys as $key) {
            if (isset($requirement[$key]) && filter_var($requirement[$key], FILTER_VALIDATE_INT) !== false) {
                $value = (int) $requirement[$key];

                return $value >= $minimum && $value <= $maximum;
            }
        }

        return false;
    }

    private function targetExists(Semester $semester, ConstraintTargetType $type, int $targetId): bool
    {
        return match ($type) {
            ConstraintTargetType::Semester => $targetId === $semester->id,
            ConstraintTargetType::Grade => DB::table('grades')->where('id', $targetId)->exists(),
            ConstraintTargetType::SchoolClass => DB::table('school_classes')
                ->where('id', $targetId)->where('academic_year_id', $semester->academic_year_id)->exists(),
            ConstraintTargetType::Teacher => DB::table('teachers')->where('id', $targetId)->exists(),
            ConstraintTargetType::Course => DB::table('courses')->where('id', $targetId)->exists(),
            ConstraintTargetType::Room => DB::table('rooms')->where('id', $targetId)->exists(),
            ConstraintTargetType::TeachingAssignment => DB::table('teaching_assignments')
                ->where('id', $targetId)->where('semester_id', $semester->id)->exists(),
            ConstraintTargetType::TeachingGroup => DB::table('teaching_groups')
                ->where('id', $targetId)->where('semester_id', $semester->id)->exists(),
        };
    }

    private function assertUserEditable(SchedulingConstraint $constraint): void
    {
        if ($constraint->source === 'system') {
            throw new ApiProblemException('SYSTEM_CONSTRAINT_IMMUTABLE', '系统必要硬约束不能修改或删除', 409);
        }
    }

    private function assertParent(Semester $semester, SchedulingConstraint $constraint): void
    {
        if ($constraint->semester_id !== $semester->id) {
            throw new ApiProblemException('CONSTRAINT_SEMESTER_MISMATCH', '规则不属于该学期', 404);
        }
    }

    private function bumpRevision(Semester $semester): void
    {
        $semester->increment('constraint_revision');
        $semester->increment('input_revision');
        $semester->increment('timetable_revision');
        $semester->refresh();
    }

    /** @return array<string, int|string> */
    private function meta(Semester $semester, AppSetting $settings): array
    {
        return [
            'semester_id' => $semester->id,
            'timetable_revision' => (string) $semester->getRawOriginal('timetable_revision'),
            'input_revision' => (string) $semester->getRawOriginal('input_revision'),
            'constraint_revision' => (string) $semester->getRawOriginal('constraint_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
