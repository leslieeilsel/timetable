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
use App\Modules\Scheduling\Services\ConstraintPayloadValidator;
use App\Modules\Timetable\Services\TimetableSynchronizationService;
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
        private readonly ConstraintPayloadValidator $payloads,
        private readonly TimetableSynchronizationService $synchronization,
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
            $this->payloads->assertValid($lockedSemester, $data);
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
            $this->payloads->assertValid($lockedSemester, $merged);
            if ($locked->status === ConstraintStatus::Active) {
                $this->assertSynchronizedVersionsAligned($lockedSemester, $merged, $locked->id);
            }
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
                $payload = $locked->only([
                    'name', 'kind', 'category', 'target_type', 'target_id', 'scope', 'condition',
                    'requirement', 'weight', 'explanation',
                ]);
                $this->payloads->assertValid($lockedSemester, $payload, $locked->source);
                $this->assertSynchronizedVersionsAligned($lockedSemester, $payload, $locked->id);
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

    private function assertUserEditable(SchedulingConstraint $constraint): void
    {
        if ($constraint->source === 'system') {
            throw new ApiProblemException('SYSTEM_CONSTRAINT_IMMUTABLE', '系统必要硬约束不能修改或删除', 409);
        }
    }

    /** @param array<string, mixed> $payload */
    private function assertSynchronizedVersionsAligned(Semester $semester, array $payload, int $constraintId): void
    {
        $kind = $payload['kind'] instanceof ConstraintKind
            ? $payload['kind']
            : ConstraintKind::from($payload['kind']);
        $category = $payload['category'] instanceof ConstraintCategory
            ? $payload['category']
            : ConstraintCategory::from($payload['category']);
        if ($kind !== ConstraintKind::Hard || $category !== ConstraintCategory::Synchronization) {
            return;
        }
        $targetId = $payload['target_id'] ?? null;
        $relatedIds = $payload['requirement']['with_assignment_ids'] ?? [];
        if (! is_int($targetId) || ! is_array($relatedIds)) {
            return;
        }
        $assignmentIds = array_values(array_unique([$targetId, ...array_map('intval', $relatedIds)]));
        $this->synchronization->assertCurrentVersionsAligned($semester, $assignmentIds, $constraintId);
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
