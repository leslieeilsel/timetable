<?php

namespace App\Modules\TeachingAssignment\Http\Controllers;

use App\Enums\AssignmentStatus;
use App\Enums\ResourceStatus;
use App\Enums\RoomMode;
use App\Enums\WeekPattern;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Resources\Models\Course;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use App\Modules\SemesterClassSetting\Models\SemesterClassSetting;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\TeachingAssignment\Models\TeachingGroup;
use App\Modules\TeachingAssignment\Services\CapacityService;
use App\Modules\Timetable\Services\RoomResolver;
use App\Modules\Timetable\Services\TimetableConflictService;
use App\Modules\Timetable\Services\TimetableVersionService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\Normalizer;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TeachingAssignmentController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly CapacityService $capacity,
        private readonly RoomResolver $rooms,
        private readonly TimetableConflictService $conflicts,
        private readonly TimetableVersionService $versions,
    ) {}

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $filters = $request->validate([
            'school_class_id' => ['sometimes', 'integer'],
            'teaching_group_id' => ['sometimes', 'integer'],
            'grade_id' => ['sometimes', 'integer'],
            'teacher_id' => ['sometimes', 'integer'],
            'course_id' => ['sometimes', 'integer'],
            'room_id' => ['sometimes', 'integer'],
            'status' => ['sometimes', Rule::enum(AssignmentStatus::class)],
            'version_id' => ['sometimes', 'integer'],
            'search' => ['sometimes', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ]);
        $version = $this->versions->resolveForRead($semester, isset($filters['version_id']) ? (int) $filters['version_id'] : null);
        $versionId = $version === null ? 0 : $version->id;
        $query = $semester->teachingAssignments()->with([
            'schoolClass.grade:id,name', 'teachingGroup.schoolClasses.grade:id,name',
            'course:id,name,short_name,is_active', 'teacher:id,name,employee_no,is_active',
            'collaborators:id,name,employee_no,is_active', 'specifiedRoom:id,name,is_active',
        ])->withCount(['entries' => fn ($entryQuery) => $entryQuery->where('timetable_version_id', $versionId)])
            ->orderBy('school_class_id')->orderBy('course_id');
        foreach (['school_class_id', 'teaching_group_id', 'course_id', 'status'] as $filter) {
            if (isset($filters[$filter])) {
                $query->where($filter, $filters[$filter]);
            }
        }
        if (isset($filters['teacher_id'])) {
            $teacherId = (int) $filters['teacher_id'];
            $query->where(fn ($teacherQuery) => $teacherQuery->where('teacher_id', $teacherId)
                ->orWhereHas('collaborators', fn ($collaboratorQuery) => $collaboratorQuery->whereKey($teacherId)));
        }
        if (isset($filters['room_id'])) {
            $roomId = (int) $filters['room_id'];
            $classIds = SemesterClassSetting::query()->where('semester_id', $semester->id)
                ->where('fixed_room_id', $roomId)->pluck('school_class_id');
            $query->where(fn ($roomQuery) => $roomQuery->where('specified_room_id', $roomId)
                ->orWhere(fn ($defaultRoomQuery) => $defaultRoomQuery
                    ->where('room_mode', RoomMode::ClassDefault->value)
                    ->whereIn('school_class_id', $classIds)));
        }
        if (isset($filters['grade_id'])) {
            $gradeId = (int) $filters['grade_id'];
            $query->where(fn ($targetQuery) => $targetQuery
                ->whereHas('schoolClass', fn ($classQuery) => $classQuery->where('grade_id', $gradeId))
                ->orWhereHas('teachingGroup.schoolClasses', fn ($classQuery) => $classQuery->where('grade_id', $gradeId)));
        }
        if (isset($filters['search'])) {
            $search = '%'.Normalizer::text($filters['search']).'%';
            $query->where(fn ($searchQuery) => $searchQuery
                ->whereHas('schoolClass', fn ($classQuery) => $classQuery->where('name', 'like', $search))
                ->orWhereHas('teachingGroup', fn ($groupQuery) => $groupQuery->where('name', 'like', $search))
                ->orWhereHas('course', fn ($courseQuery) => $courseQuery->where('name', 'like', $search))
                ->orWhereHas('teacher', fn ($teacherQuery) => $teacherQuery->where('name', 'like', $search)));
        }
        $paginator = $query->paginate((int) ($filters['per_page'] ?? 20));
        $items = collect($paginator->items())->map(function (TeachingAssignment $assignment): array {
            $data = $assignment->toArray();
            $data['scheduled'] = $assignment->entries_count;
            $data['remaining'] = max(0, $assignment->weekly_items - $assignment->entries_count);
            $data['completed'] = $assignment->status === AssignmentStatus::Confirmed && $assignment->entries_count === $assignment->weekly_items;

            return $data;
        });

        return response()->json(['data' => $items, 'meta' => [
            ...$this->meta($semester, $settings),
            'pagination' => [
                'page' => $paginator->currentPage(), 'per_page' => $paginator->perPage(),
                'total' => $paginator->total(), 'last_page' => $paginator->lastPage(),
                'from' => $paginator->firstItem(), 'to' => $paginator->lastItem(),
            ],
        ]])
            ->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $data = $this->validateAssignment($request, $semester);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $collaboratorIds = array_map('intval', $data['collaborator_ids'] ?? []);
            unset($data['collaborator_ids']);
            $payload = array_merge([
                'items_per_session' => 1,
                'week_pattern' => WeekPattern::All->value,
                'active_weeks' => null,
                'allows_substitution' => true,
            ], $data);
            $this->assertAssignmentShape($lockedSemester, $payload, $collaboratorIds);
            $this->assertUniqueTarget($lockedSemester, $payload);
            $assignment = TeachingAssignment::query()->create(array_merge($payload, [
                'semester_id' => $lockedSemester->id,
                'academic_year_id' => $lockedSemester->academic_year_id,
                'status' => AssignmentStatus::Draft,
            ]));
            $assignment->collaborators()->sync($collaboratorIds);
            $this->bumpAssignmentRevision($lockedSemester);
            $after = $assignment->toArray();
            $after['collaborator_ids'] = $collaboratorIds;
            $this->audit->record($request, $actor, 'create', 'teaching_assignment', $assignment->id, null, $after);

            return response()->json(['data' => $this->load($assignment), 'meta' => $this->meta($lockedSemester, $settings)], 201)
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function update(Request $request, Semester $semester, TeachingAssignment $assignment): JsonResponse
    {
        $this->assertParent($semester, $assignment);
        $data = $this->validateAssignment($request, $semester, true);

        return DB::transaction(function () use ($request, $semester, $assignment, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = TeachingAssignment::query()->with('collaborators')->withCount('entries')->lockForUpdate()->findOrFail($assignment->id);
            $collaboratorIds = array_key_exists('collaborator_ids', $data)
                ? array_map('intval', $data['collaborator_ids'])
                : $locked->collaborators->pluck('id')->map(fn ($id) => (int) $id)->all();
            unset($data['collaborator_ids']);
            $immutableWithEntries = [
                'school_class_id', 'teaching_group_id', 'course_id', 'teacher_id', 'collaborator_ids',
                'items_per_session', 'week_pattern', 'active_weeks', 'room_mode', 'specified_room_id',
            ];
            if ($locked->entries_count > 0 && (collect($immutableWithEntries)->contains(fn ($field) => array_key_exists($field, $data))
                || $collaboratorIds !== $locked->collaborators->pluck('id')->map(fn ($id) => (int) $id)->all())) {
                throw new ApiProblemException('ASSIGNMENT_HAS_ENTRIES', '已有课程时不能修改授课对象、教师、周型、连排或教室规则', 409);
            }
            if (isset($data['weekly_items']) && $data['weekly_items'] < $locked->entries_count) {
                throw new ApiProblemException('WEEKLY_ITEMS_BELOW_SCHEDULED', '每周课时不能低于已排课时', 422);
            }
            $merged = array_merge($locked->only([
                'school_class_id', 'teaching_group_id', 'course_id', 'teacher_id', 'weekly_items',
                'items_per_session', 'week_pattern', 'active_weeks', 'room_mode', 'specified_room_id',
                'allows_substitution',
            ]), $data);
            $this->assertAssignmentShape($lockedSemester, $merged, $collaboratorIds);
            $this->assertUniqueTarget($lockedSemester, $merged, $locked->id);
            $before = $locked->toArray();
            $before['collaborator_ids'] = $locked->collaborators->pluck('id')->all();
            $locked->fill($data);
            $attributesChanged = $locked->isDirty();
            $collaboratorsChanged = $collaboratorIds !== $locked->collaborators->pluck('id')->map(fn ($id) => (int) $id)->all();
            if ($attributesChanged) {
                $locked->save();
            }
            if ($collaboratorsChanged) {
                $locked->collaborators()->sync($collaboratorIds);
            }
            if ($attributesChanged || $collaboratorsChanged) {
                if ($locked->status === AssignmentStatus::Confirmed) {
                    $this->assertResourcesActive($locked);
                    $this->capacity->assertCanConfirm($lockedSemester, collect([$locked]));
                }
                $this->bumpAssignmentRevision($lockedSemester);
                $after = $locked->toArray();
                $after['collaborator_ids'] = $collaboratorIds;
                $this->audit->record($request, $actor, 'update', 'teaching_assignment', $locked->id, $before, $after);
            }

            return response()->json(['data' => $this->load($locked), 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function bulkUpsert(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'operations' => ['required', 'array', 'min:1', 'max:500'],
            'operations.*.assignment_id' => ['sometimes', 'nullable', 'integer', 'distinct', 'exists:teaching_assignments,id'],
            'operations.*.school_class_id' => ['required', 'integer', Rule::exists('school_classes', 'id')->where('academic_year_id', $semester->academic_year_id)],
            'operations.*.course_id' => ['required', 'integer', 'exists:courses,id'],
            'operations.*.teacher_id' => ['required', 'integer', 'exists:teachers,id'],
            'operations.*.collaborator_ids' => ['sometimes', 'array'],
            'operations.*.collaborator_ids.*' => ['integer', 'distinct', 'exists:teachers,id'],
            'operations.*.weekly_items' => ['required', 'integer', 'min:1', 'max:100'],
            'operations.*.items_per_session' => ['sometimes', 'integer', 'min:1', 'max:10'],
            'operations.*.week_pattern' => ['sometimes', Rule::enum(WeekPattern::class)],
            'operations.*.active_weeks' => ['sometimes', 'nullable', 'array', 'min:1'],
            'operations.*.active_weeks.*' => ['integer', 'distinct', 'min:1', 'max:60'],
            'operations.*.room_mode' => ['required', Rule::enum(RoomMode::class)],
            'operations.*.specified_room_id' => ['sometimes', 'nullable', 'integer', 'exists:rooms,id'],
            'operations.*.allows_substitution' => ['sometimes', 'boolean'],
        ]);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $existingIds = [];
            foreach ($data['operations'] as $operation) {
                if (isset($operation['assignment_id'])) {
                    $existingIds[] = (int) $operation['assignment_id'];
                }
            }
            $existing = TeachingAssignment::query()->where('semester_id', $lockedSemester->id)
                ->whereIn('id', $existingIds)->with(['collaborators'])->withCount('entries')
                ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            if ($existing->count() !== count($existingIds)) {
                throw new ApiProblemException('ASSIGNMENT_BULK_SELECTION_INVALID', '批量操作包含不属于本学期的任课关系', 422);
            }

            $changed = collect();
            foreach ($data['operations'] as $index => $operation) {
                $collaboratorIds = array_map('intval', $operation['collaborator_ids'] ?? []);
                unset($operation['assignment_id'], $operation['collaborator_ids']);
                $payload = array_merge([
                    'teaching_group_id' => null,
                    'items_per_session' => 1,
                    'week_pattern' => WeekPattern::All->value,
                    'active_weeks' => null,
                    'allows_substitution' => true,
                ], $operation);
                $this->assertAssignmentShape($lockedSemester, $payload, $collaboratorIds);

                $assignmentId = isset($data['operations'][$index]['assignment_id'])
                    ? (int) $data['operations'][$index]['assignment_id']
                    : null;
                $assignment = $assignmentId === null ? null : $existing->get($assignmentId);
                $this->assertUniqueTarget($lockedSemester, $payload, $assignmentId);
                if ($assignment === null) {
                    $assignment = TeachingAssignment::query()->create([
                        ...$payload,
                        'semester_id' => $lockedSemester->id,
                        'academic_year_id' => $lockedSemester->academic_year_id,
                        'status' => AssignmentStatus::Draft,
                    ]);
                    $assignment->collaborators()->sync($collaboratorIds);
                    $changed->push($assignment);

                    continue;
                }

                $beforeCollaborators = $assignment->collaborators->pluck('id')->map(fn ($id) => (int) $id)->all();
                $assignment->fill($payload);
                $immutableWithEntries = [
                    'school_class_id', 'teaching_group_id', 'course_id', 'teacher_id',
                    'items_per_session', 'week_pattern', 'active_weeks', 'room_mode', 'specified_room_id',
                ];
                if ($assignment->entries_count > 0 && ($assignment->isDirty($immutableWithEntries) || $beforeCollaborators !== $collaboratorIds)) {
                    throw new ApiProblemException('ASSIGNMENT_HAS_ENTRIES', '批量操作中有任课关系已排课，不能修改授课对象、教师、周型、连排或教室规则', 409, [
                        'assignment_id' => $assignment->id,
                    ]);
                }
                if ($assignment->weekly_items < $assignment->entries_count) {
                    throw new ApiProblemException('WEEKLY_ITEMS_BELOW_SCHEDULED', '每周课时不能低于已排课时', 422, [
                        'assignment_id' => $assignment->id,
                    ]);
                }
                $attributesChanged = $assignment->isDirty();
                if ($attributesChanged) {
                    $assignment->save();
                }
                if ($beforeCollaborators !== $collaboratorIds) {
                    $assignment->collaborators()->sync($collaboratorIds);
                }
                if ($attributesChanged || $beforeCollaborators !== $collaboratorIds) {
                    $changed->push($assignment);
                }
            }
            foreach ($changed->where('status', AssignmentStatus::Confirmed) as $confirmed) {
                $this->assertResourcesActive($confirmed);
            }
            if ($changed->where('status', AssignmentStatus::Confirmed)->isNotEmpty()) {
                $this->capacity->assertCanConfirm($lockedSemester, $changed->where('status', AssignmentStatus::Confirmed));
            }
            if ($changed->isNotEmpty()) {
                $this->bumpAssignmentRevision($lockedSemester);
                $this->audit->record($request, $actor, 'bulk_upsert', 'teaching_assignment', $lockedSemester->id, null, [
                    'assignment_ids' => $changed->pluck('id')->all(),
                    'operation_count' => count($data['operations']),
                ]);
            }

            return response()->json(['data' => $changed->map(fn (TeachingAssignment $assignment) => $this->load($assignment))->values(), 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function confirm(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate(['assignment_ids' => ['required', 'array', 'min:1'], 'assignment_ids.*' => ['integer', 'distinct']]);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $assignments = TeachingAssignment::query()->where('semester_id', $lockedSemester->id)->whereIn('id', $data['assignment_ids'])->orderBy('id')->lockForUpdate()->get();
            if ($assignments->count() !== count($data['assignment_ids']) || $assignments->contains(fn (TeachingAssignment $assignment) => $assignment->status !== AssignmentStatus::Draft)) {
                throw new ApiProblemException('ASSIGNMENT_CONFIRM_SELECTION_INVALID', '只能批量确认本学期的草稿任课关系', 409);
            }
            foreach ($assignments as $assignment) {
                $this->assertResourcesActive($assignment);
                $this->rooms->resolve($assignment);
            }
            $this->capacity->assertCanConfirm($lockedSemester, $assignments);
            TeachingAssignment::query()->whereIn('id', $assignments->pluck('id'))->update(['status' => AssignmentStatus::Confirmed->value, 'updated_at' => now()]);
            $this->bumpAssignmentRevision($lockedSemester);
            $this->audit->record($request, $actor, 'confirm', 'teaching_assignment', $lockedSemester->id, null, ['assignment_ids' => $assignments->pluck('id')->all()]);

            return response()->json(['data' => ['confirmed_ids' => $assignments->pluck('id')->all()], 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function unconfirm(Request $request, Semester $semester, TeachingAssignment $assignment): JsonResponse
    {
        return $this->transition($request, $semester, $assignment, AssignmentStatus::Draft, [AssignmentStatus::Confirmed]);
    }

    public function deactivate(Request $request, Semester $semester, TeachingAssignment $assignment): JsonResponse
    {
        return $this->transition($request, $semester, $assignment, AssignmentStatus::Inactive, [AssignmentStatus::Draft, AssignmentStatus::Confirmed]);
    }

    public function restore(Request $request, Semester $semester, TeachingAssignment $assignment): JsonResponse
    {
        return $this->transition($request, $semester, $assignment, AssignmentStatus::Draft, [AssignmentStatus::Inactive]);
    }

    /** @param list<AssignmentStatus> $allowed */
    private function transition(Request $request, Semester $semester, TeachingAssignment $assignment, AssignmentStatus $target, array $allowed): JsonResponse
    {
        $this->assertParent($semester, $assignment);

        return DB::transaction(function () use ($request, $semester, $assignment, $target, $allowed): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $locked = TeachingAssignment::query()->withCount('entries')->lockForUpdate()->findOrFail($assignment->id);
            if (! in_array($locked->status, $allowed, true)) {
                throw new ApiProblemException('ASSIGNMENT_STATUS_TRANSITION_INVALID', '任课关系状态迁移无效', 409);
            }
            if ($locked->entries_count > 0 && $locked->status === AssignmentStatus::Confirmed) {
                throw new ApiProblemException('ASSIGNMENT_HAS_ENTRIES', '已有课程时不能退回草稿或停用', 409);
            }
            $before = $locked->toArray();
            $locked->status = $target;
            $locked->save();
            $this->bumpAssignmentRevision($lockedSemester);
            $this->audit->record($request, $actor, $target->value, 'teaching_assignment', $locked->id, $before, $locked->toArray());

            return response()->json(['data' => $locked, 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function destroy(Request $request, Semester $semester, TeachingAssignment $assignment): JsonResponse
    {
        $this->assertParent($semester, $assignment);

        return DB::transaction(function () use ($request, $semester, $assignment): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = TeachingAssignment::query()->withCount('entries')->lockForUpdate()->findOrFail($assignment->id);
            if ($locked->entries_count > 0) {
                throw new ApiProblemException('ASSIGNMENT_HAS_ENTRIES', '已有课程的任课关系不能删除', 409);
            }
            $before = $locked->toArray();
            $locked->delete();
            $this->bumpAssignmentRevision($lockedSemester);
            $this->audit->record($request, $actor, 'delete', 'teaching_assignment', $assignment->id, $before, null);

            return response()->json(['data' => ['deleted_id' => $assignment->id], 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function copy(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'source_semester_id' => ['required', 'integer', 'exists:semesters,id'],
            'assignment_ids' => ['required', 'array', 'min:1'],
            'assignment_ids.*' => ['integer', 'distinct'],
        ]);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $target] = $this->guard->semester($request, $semester);
            $source = Semester::query()->lockForUpdate()->findOrFail($data['source_semester_id']);
            if ($source->academic_year_id !== $target->academic_year_id || $source->sequence >= $target->sequence) {
                throw new ApiProblemException('COPY_SOURCE_INVALID', '只能从同一学年较早学期复制', 422);
            }
            $assignments = TeachingAssignment::query()->with(['collaborators', 'teachingGroup.schoolClasses'])
                ->where('semester_id', $source->id)->where('status', AssignmentStatus::Confirmed->value)
                ->whereIn('id', $data['assignment_ids'])->orderBy('id')->lockForUpdate()->get();
            if ($assignments->count() !== count($data['assignment_ids'])) {
                throw new ApiProblemException('COPY_ASSIGNMENT_SELECTION_INVALID', '只能复制来源学期已确认任课关系', 422);
            }
            $targetClassIds = $target->classSettings()->pluck('school_class_id');
            $sourceClassIds = $assignments->flatMap(fn (TeachingAssignment $assignment) => $assignment->school_class_id !== null
                ? [$assignment->school_class_id]
                : $assignment->teachingGroup?->schoolClasses->pluck('id')->all() ?? [])->unique();
            if ($sourceClassIds->contains(fn ($classId) => ! $targetClassIds->contains($classId))) {
                throw new ApiProblemException('TARGET_CLASS_SETTING_MISSING', '目标学期缺少对应班级配置', 409);
            }
            $classAssignments = $assignments->whereNotNull('school_class_id');
            $conflicts = $classAssignments->isEmpty()
                ? collect()
                : $target->teachingAssignments()->where(function ($query) use ($classAssignments): void {
                    foreach ($classAssignments as $assignment) {
                        $query->orWhere(fn ($q) => $q->where('school_class_id', $assignment->school_class_id)->where('course_id', $assignment->course_id));
                    }
                })->get(['school_class_id', 'course_id']);
            if ($conflicts->isNotEmpty()) {
                throw new ApiProblemException('COPY_TARGET_CONFLICT', '目标学期已存在同班同科任课关系', 409, ['conflicts' => $conflicts]);
            }
            $created = [];
            foreach ($assignments as $sourceAssignment) {
                $teachingGroupId = null;
                if ($sourceAssignment->teachingGroup !== null) {
                    $targetGroup = TeachingGroup::query()->firstOrCreate([
                        'semester_id' => $target->id,
                        'name' => $sourceAssignment->teachingGroup->name,
                    ], [
                        'mode' => $sourceAssignment->teachingGroup->mode,
                        'status' => ResourceStatus::Active,
                    ]);
                    $targetGroup->schoolClasses()->syncWithoutDetaching($sourceAssignment->teachingGroup->schoolClasses->pluck('id'));
                    $teachingGroupId = $targetGroup->id;
                }
                $payload = array_merge($sourceAssignment->only([
                    'school_class_id', 'course_id', 'teacher_id', 'weekly_items', 'items_per_session',
                    'week_pattern', 'active_weeks', 'room_mode', 'specified_room_id', 'allows_substitution',
                ]), [
                    'teaching_group_id' => $teachingGroupId,
                ]);
                $this->assertUniqueTarget($target, $payload);
                $createdAssignment = TeachingAssignment::query()->create(array_merge($payload, [
                    'semester_id' => $target->id,
                    'academic_year_id' => $target->academic_year_id,
                    'status' => AssignmentStatus::Draft,
                ]));
                $createdAssignment->collaborators()->sync($sourceAssignment->collaborators->pluck('id'));
                $created[] = $createdAssignment;
            }
            $this->bumpAssignmentRevision($target);
            $this->audit->record($request, $actor, 'copy', 'teaching_assignment', $target->id, null, ['source_semester_id' => $source->id, 'assignment_ids' => collect($created)->pluck('id')->all()]);

            return response()->json(['data' => $created, 'meta' => $this->meta($target, $settings)], 201)
                ->header('ETag', $this->etags->semester($target, $settings));
        }, 3);
    }

    public function migrateRoom(Request $request, Semester $semester, TeachingAssignment $assignment): JsonResponse
    {
        $this->assertParent($semester, $assignment);
        $data = $request->validate([
            'target_room_id' => ['required', 'integer', Rule::exists('rooms', 'id')->where('is_active', true)],
            'version_id' => ['sometimes', 'integer'],
        ]);

        return DB::transaction(function () use ($request, $semester, $assignment, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $version = $this->versions->ensureWorkingDraft(
                $lockedSemester,
                $actor,
                isset($data['version_id']) ? (int) $data['version_id'] : null,
            );
            $locked = TeachingAssignment::query()->lockForUpdate()->findOrFail($assignment->id);
            $entries = $locked->entries()->where('timetable_version_id', $version->id)->orderBy('id')->lockForUpdate()->get();
            if ($entries->contains('is_locked', true)) {
                throw new ApiProblemException('LOCKED_ENTRY_MIGRATION_FORBIDDEN', '包含已锁定课程，不能迁移任课关系教室', 409);
            }
            $targetRoomId = (int) $data['target_room_id'];
            foreach ($entries as $entry) {
                $this->conflicts->assertAvailable(
                    $lockedSemester->id,
                    $version->id,
                    $entry->schoolClasses()->pluck('school_classes.id')->map(fn ($id) => (int) $id)->all(),
                    $entry->teachers()->pluck('teachers.id')->map(fn ($id) => (int) $id)->all(),
                    $targetRoomId,
                    $entry->weekday,
                    $entry->item_id,
                    $entry->week_pattern,
                    $entry->id,
                    $entry->active_weeks,
                );
            }
            $before = [
                'room_mode' => $locked->room_mode->value,
                'specified_room_id' => $locked->specified_room_id,
                'entry_ids' => $entries->pluck('id')->all(),
            ];
            $changed = $locked->room_mode !== RoomMode::Specified || $locked->specified_room_id !== $targetRoomId;
            if ($changed) {
                $locked->room_mode = RoomMode::Specified;
                $locked->specified_room_id = $targetRoomId;
                $locked->save();
                $locked->entries()->where('timetable_version_id', $version->id)
                    ->update(['actual_room_id' => $targetRoomId, 'updated_at' => now()]);
                if ($locked->status === AssignmentStatus::Confirmed) {
                    $this->capacity->assertCanConfirm($lockedSemester, collect([$locked]));
                }
                $this->bumpAssignmentRevision($lockedSemester);
                $version->input_revision = (int) $lockedSemester->getRawOriginal('input_revision');
                $version->save();
                $this->audit->record($request, $actor, 'migrate_room', 'teaching_assignment', $locked->id, $before, [
                    'room_mode' => RoomMode::Specified->value,
                    'specified_room_id' => $targetRoomId,
                    'entry_ids' => $entries->pluck('id')->all(),
                ]);
            }

            return response()->json(['data' => [
                'assignment_id' => $locked->id,
                'target_room_id' => $targetRoomId,
                'migrated_entries' => $entries->count(),
                'changed' => $changed,
            ], 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    /** @return array<string, mixed> */
    private function validateAssignment(Request $request, Semester $semester, bool $partial = false): array
    {
        $data = $request->validate([
            'school_class_id' => [$partial ? 'sometimes' : 'nullable', 'nullable', 'integer', Rule::exists('school_classes', 'id')->where('academic_year_id', $semester->academic_year_id)],
            'teaching_group_id' => [$partial ? 'sometimes' : 'nullable', 'nullable', 'integer', Rule::exists('teaching_groups', 'id')->where('semester_id', $semester->id)],
            'course_id' => [$partial ? 'sometimes' : 'required', 'integer', 'exists:courses,id'],
            'teacher_id' => [$partial ? 'sometimes' : 'required', 'integer', 'exists:teachers,id'],
            'collaborator_ids' => ['sometimes', 'array'],
            'collaborator_ids.*' => ['integer', 'distinct', 'exists:teachers,id'],
            'weekly_items' => [$partial ? 'sometimes' : 'required', 'integer', 'min:1', 'max:100'],
            'items_per_session' => ['sometimes', 'integer', 'min:1', 'max:10'],
            'week_pattern' => ['sometimes', Rule::enum(WeekPattern::class)],
            'active_weeks' => ['sometimes', 'nullable', 'array', 'min:1'],
            'active_weeks.*' => ['integer', 'distinct', 'min:1', 'max:60'],
            'room_mode' => [$partial ? 'sometimes' : 'required', Rule::enum(RoomMode::class)],
            'specified_room_id' => ['sometimes', 'nullable', 'integer', 'exists:rooms,id'],
            'allows_substitution' => ['sometimes', 'boolean'],
        ]);

        return $data;
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<int>  $collaboratorIds
     */
    private function assertAssignmentShape(Semester $semester, array &$data, array $collaboratorIds): void
    {
        $classId = isset($data['school_class_id']) ? (int) $data['school_class_id'] : null;
        $groupId = isset($data['teaching_group_id']) ? (int) $data['teaching_group_id'] : null;
        if (($classId === null) === ($groupId === null)) {
            throw new ApiProblemException('ASSIGNMENT_TARGET_INVALID', '任课关系必须且只能选择一个班级或教学组', 422);
        }
        if ((int) $data['items_per_session'] > (int) $data['weekly_items']) {
            throw new ApiProblemException('ASSIGNMENT_SESSION_ITEMS_INVALID', '每次连排课时不能超过每周课时', 422);
        }
        $weekPattern = $data['week_pattern'] instanceof WeekPattern ? $data['week_pattern']->value : $data['week_pattern'];
        if ($weekPattern === WeekPattern::Specified->value && empty($data['active_weeks'])) {
            throw new ApiProblemException('ASSIGNMENT_ACTIVE_WEEKS_REQUIRED', '指定周上课时必须选择至少一个教学周', 422);
        }
        if ($weekPattern !== WeekPattern::Specified->value) {
            $data['active_weeks'] = null;
        }
        if (in_array((int) $data['teacher_id'], $collaboratorIds, true)) {
            throw new ApiProblemException('ASSIGNMENT_COLLABORATOR_INVALID', '主讲教师不能同时作为协同教师', 422);
        }
        $this->assertRoomMode($data);
        if ($groupId !== null && ($data['room_mode'] instanceof RoomMode ? $data['room_mode'] : RoomMode::from($data['room_mode'])) !== RoomMode::Specified) {
            throw new ApiProblemException('TEACHING_GROUP_ROOM_REQUIRED', '教学组任课关系必须指定共用教室', 422);
        }
        $this->assertTargetConfigured($semester, $classId, $groupId);
    }

    /** @param array<string, mixed> $data */
    private function assertRoomMode(array $data): void
    {
        $mode = $data['room_mode'] instanceof RoomMode ? $data['room_mode']->value : $data['room_mode'];
        $roomId = $data['specified_room_id'] ?? null;
        if (($mode === RoomMode::Specified->value) !== ($roomId !== null)) {
            throw new ApiProblemException('ASSIGNMENT_ROOM_MODE_INVALID', '指定教室模式必须选择教室，固定教室模式不能指定教室', 422);
        }
    }

    /** @param array<string, mixed> $data */
    private function assertUniqueTarget(Semester $semester, array $data, ?int $exceptId = null): void
    {
        $weekPattern = $data['week_pattern'] instanceof WeekPattern ? $data['week_pattern']->value : $data['week_pattern'];
        $query = $semester->teachingAssignments()
            ->where('course_id', $data['course_id'])
            ->where('week_pattern', $weekPattern);
        if (($data['school_class_id'] ?? null) !== null) {
            $query->where('school_class_id', $data['school_class_id']);
        } else {
            $query->where('teaching_group_id', $data['teaching_group_id']);
        }
        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }
        if ($query->exists()) {
            throw new ApiProblemException('ASSIGNMENT_DUPLICATE', '同一授课对象、课程和周型只能有一条任课关系', 409);
        }
    }

    private function assertTargetConfigured(Semester $semester, ?int $classId, ?int $groupId): void
    {
        if ($classId !== null && ! SemesterClassSetting::query()->where('semester_id', $semester->id)
            ->where('school_class_id', $classId)->where('status', ResourceStatus::Active->value)->exists()) {
            throw new ApiProblemException('CLASS_SETTING_REQUIRED', '创建任课关系前必须先配置本学期班级', 409);
        }
        if ($groupId === null) {
            return;
        }
        $group = TeachingGroup::query()->with('schoolClasses')->where('semester_id', $semester->id)->findOrFail($groupId);
        $classIds = $group->schoolClasses->pluck('id');
        $configured = SemesterClassSetting::query()->where('semester_id', $semester->id)
            ->where('status', ResourceStatus::Active->value)->whereIn('school_class_id', $classIds)->count();
        if ($group->status !== ResourceStatus::Active || $classIds->isEmpty() || $configured !== $classIds->count()) {
            throw new ApiProblemException('TEACHING_GROUP_INVALID', '教学组必须启用且所有班级已在本学期启用', 409);
        }
    }

    private function assertResourcesActive(TeachingAssignment $assignment): void
    {
        $assignment->loadMissing(['schoolClass.grade', 'teachingGroup.schoolClasses.grade', 'teacher', 'collaborators', 'course']);
        $classes = $assignment->schoolClass !== null
            ? collect([$assignment->schoolClass])
            : ($assignment->teachingGroup === null ? collect() : $assignment->teachingGroup->schoolClasses);
        $teachers = collect([$assignment->teacher])->concat($assignment->collaborators);
        $course = Course::query()->findOrFail($assignment->course_id);
        $roomId = $this->rooms->resolve($assignment);
        $room = Room::query()->findOrFail($roomId);
        $activeSettingCount = SemesterClassSetting::query()->where('semester_id', $assignment->semester_id)
            ->where('status', ResourceStatus::Active->value)->whereIn('school_class_id', $classes->pluck('id'))->count();
        $qualifiedTeacherCount = DB::table('teacher_course')->where('course_id', $assignment->course_id)
            ->whereIn('teacher_id', $teachers->pluck('id'))->count();
        if ($classes->isEmpty()
            || $classes->contains(fn (SchoolClass $class) => $class->status !== ResourceStatus::Active || ! $class->grade->is_active)
            || $activeSettingCount !== $classes->count()
            || $assignment->teachingGroup?->status === ResourceStatus::Inactive
            || $teachers->contains(fn (Teacher $teacher) => ! $teacher->is_active)
            || $qualifiedTeacherCount !== $teachers->count()
            || ! $course->is_active || ! $room->is_active) {
            throw new ApiProblemException('ASSIGNMENT_RESOURCE_INACTIVE', '班级、年级、教师、课程、班级配置或教室已停用', 409, ['assignment_id' => $assignment->id]);
        }
    }

    private function load(TeachingAssignment $assignment): TeachingAssignment
    {
        return $assignment->load([
            'schoolClass.grade:id,name', 'teachingGroup.schoolClasses.grade:id,name',
            'course:id,name,short_name,is_active', 'teacher:id,name,employee_no,is_active',
            'collaborators:id,name,employee_no,is_active', 'specifiedRoom:id,name,is_active',
        ]);
    }

    private function assertParent(Semester $semester, TeachingAssignment $assignment): void
    {
        if ($assignment->semester_id !== $semester->id) {
            throw new ApiProblemException('ASSIGNMENT_SEMESTER_MISMATCH', '任课关系不属于该学期', 404);
        }
    }

    private function bumpAssignmentRevision(Semester $semester): void
    {
        $semester->increment('assignment_revision');
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
            'assignment_revision' => (string) $semester->getRawOriginal('assignment_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
