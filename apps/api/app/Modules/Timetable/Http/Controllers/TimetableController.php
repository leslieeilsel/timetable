<?php

namespace App\Modules\Timetable\Http\Controllers;

use App\Enums\AssignmentStatus;
use App\Enums\ResourceStatus;
use App\Enums\WeekPattern;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use App\Modules\ScheduleTemplate\Models\Item;
use App\Modules\ScheduleTemplate\Models\ScheduleTemplateDay;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Models\TimetableVersion;
use App\Modules\Timetable\Services\RoomResolver;
use App\Modules\Timetable\Services\TimetableConflictService;
use App\Modules\Timetable\Services\TimetableDiagnosticService;
use App\Modules\Timetable\Services\TimetableSynchronizationService;
use App\Modules\Timetable\Services\TimetableVersionService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\SimpleXlsxWriter;
use App\Support\WriteGuard;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TimetableController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly RoomResolver $rooms,
        private readonly TimetableConflictService $conflicts,
        private readonly TimetableDiagnosticService $diagnostics,
        private readonly TimetableSynchronizationService $synchronization,
        private readonly TimetableVersionService $versions,
        private readonly SimpleXlsxWriter $xlsx,
    ) {}

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $filters = $request->validate([
            'view' => ['sometimes', Rule::in(['class', 'teacher', 'room'])],
            'resource_id' => ['nullable', 'integer'],
            'mode' => ['sometimes', Rule::in(['official', 'full'])],
            'version_id' => ['sometimes', 'integer'],
        ]);
        $view = $filters['view'] ?? 'class';
        $mode = $filters['mode'] ?? 'official';
        $resourceId = $filters['resource_id'] ?? null;
        $version = $this->versions->resolveForRead(
            $semester,
            isset($filters['version_id']) ? (int) $filters['version_id'] : null,
            $request->user()->role->canEdit(),
        );
        $versionId = $version === null ? 0 : $version->id;
        $settings = AppSetting::query()->findOrFail(1);
        $template = $semester->scheduleTemplate()->with(['days', 'items'])->first();
        $items = $template?->items->filter(fn (Item $item) => $item->is_active && ($mode === 'full' ? $item->show_in_full : $item->show_in_official))->values() ?? collect();
        $query = TimetableEntry::query()->where('semester_id', $semester->id)
            ->where('timetable_version_id', $versionId)->with([
                'teachingAssignment:id,weekly_items', 'schoolClass:id,name', 'teachingGroup:id,name', 'schoolClasses:id,name',
                'teacher:id,name', 'teachers:id,name', 'course:id,name,short_name',
                'actualRoom:id,name', 'item:id,name,start_time,end_time,sort_order',
            ])->orderBy('weekday')->orderBy('item_id');
        if ($resourceId !== null) {
            $this->scopeResource($query, $view, (int) $resourceId);
        }

        return response()->json(['data' => [
            'view' => $view,
            'resource_id' => $resourceId,
            'mode' => $mode,
            'days' => $template?->days->where('is_enabled', true)->values() ?? [],
            'items' => $items,
            'entries' => $query->get(),
            'version' => $version,
        ], 'meta' => $this->meta($semester, $settings, $version)])
            ->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function diagnose(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'entry_id' => ['nullable', 'integer', 'required_without:teaching_assignment_id', 'prohibits:teaching_assignment_id'],
            'teaching_assignment_id' => ['nullable', 'integer', 'required_without:entry_id', 'prohibits:entry_id'],
            'weekday' => ['required', 'integer', 'between:1,7'],
            'item_id' => ['required', 'integer'],
            'version_id' => ['nullable', 'integer'],
        ]);
        $settings = AppSetting::query()->findOrFail(1);
        $allowDrafts = $request->user()->role->canEdit();
        $version = isset($data['version_id'])
            ? $this->versions->findReadableForSemester($semester, (int) $data['version_id'], $allowDrafts)
            : $this->versions->resolveForRead($semester, null, $allowDrafts);
        if ($version !== null) {
            $this->synchronization->assertVersionAligned($semester, $version);
        }
        $movingEntry = null;
        if (isset($data['entry_id'])) {
            $movingEntry = TimetableEntry::query()->with('teachingAssignment')->findOrFail((int) $data['entry_id']);
            $this->assertParent($semester, $movingEntry);
            if ($version === null || $movingEntry->timetable_version_id !== $version->id) {
                throw new ApiProblemException('ENTRY_VERSION_MISMATCH', '课表条目不属于当前查看的版本', 404);
            }
            $assignment = $movingEntry->teachingAssignment;
        } else {
            $assignment = TeachingAssignment::query()
                ->where('semester_id', $semester->id)
                ->findOrFail((int) $data['teaching_assignment_id']);
        }
        $assignmentIds = $this->synchronization->assignmentIds($semester, $assignment->id);
        $versionId = $version === null ? 0 : $version->id;
        $assignments = $this->synchronizedAssignments($semester, $assignmentIds, $versionId);
        $movingEntries = $movingEntry === null
            ? new EloquentCollection
            : $this->synchronizedEntries($semester, $movingEntry, $assignmentIds);
        foreach ($assignments as $groupAssignment) {
            $this->assertPlaceable($groupAssignment, (int) $data['weekday'], (int) $data['item_id']);
        }

        $diagnosis = $this->diagnostics->diagnoseGroup(
            $semester,
            $version,
            $this->primaryAssignmentFirst($assignments, $assignment->id)->all(),
            (int) $data['weekday'],
            (int) $data['item_id'],
            $movingEntries->all(),
        );
        if ($movingEntry === null) {
            $fullAssignments = $assignments->filter(
                fn (TeachingAssignment $groupAssignment): bool => $groupAssignment->entries_count >= $groupAssignment->weekly_items,
            );
            if ($fullAssignments->isNotEmpty()) {
                $limitConflicts = $fullAssignments->map(fn (TeachingAssignment $groupAssignment): array => [
                    'assignment_id' => $groupAssignment->id,
                    'type' => 'weekly_load',
                    'message' => '该任课关系已达到每周课时上限。',
                ])->values()->all();
                $diagnosis['allowed'] = false;
                $diagnosis['summary'] = count($assignments) > 1
                    ? '同步组不能整体安排：至少一个成员已达到每周课时上限。'
                    : '不能移动：该任课关系已达到每周课时上限。';
                $diagnosis['hard_conflicts'] = [...$diagnosis['hard_conflicts'], ...$limitConflicts];
                $diagnosis['estimated_quality_delta'] = 0.0;
            }
        }

        return response()->json([
            'data' => $diagnosis,
            'meta' => $this->meta($semester, $settings, $version),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function diagnoseSwap(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'entry_id' => ['required', 'integer', 'different:target_entry_id'],
            'target_entry_id' => ['required', 'integer', 'different:entry_id'],
            'version_id' => ['required', 'integer'],
        ]);
        $settings = AppSetting::query()->findOrFail(1);
        $version = $this->versions->findReadableForSemester(
            $semester,
            (int) $data['version_id'],
            $request->user()->role->canEdit(),
        );
        [$entry, $target] = $this->swapPair(
            $semester,
            $version,
            (int) $data['entry_id'],
            (int) $data['target_entry_id'],
        );

        return response()->json([
            'data' => $this->swapDiagnostics($semester, $version, $entry, $target),
            'meta' => $this->meta($semester, $settings, $version),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function swap(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'entry_id' => ['required', 'integer', 'different:target_entry_id'],
            'target_entry_id' => ['required', 'integer', 'different:entry_id'],
            'version_id' => ['required', 'integer'],
        ]);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $version = $this->versions->findForSemester($lockedSemester, (int) $data['version_id']);
            $this->versions->assertDraft($version);
            [$entry, $target] = $this->swapPair(
                $lockedSemester,
                $version,
                (int) $data['entry_id'],
                (int) $data['target_entry_id'],
                true,
            );
            $preview = $this->swapDiagnostics($lockedSemester, $version, $entry, $target);
            if (! $preview['allowed']) {
                throw new ApiProblemException('TIMETABLE_SWAP_NOT_ALLOWED', '两节课程不能安全交换', 409, [
                    'diagnostics' => $preview,
                ]);
            }
            $before = [
                'entry' => $entry->toArray(),
                'target' => $target->toArray(),
            ];
            $entryPosition = ['weekday' => $entry->weekday, 'item_id' => $entry->item_id];
            $targetPosition = ['weekday' => $target->weekday, 'item_id' => $target->item_id];
            $entry->forceFill($targetPosition)->save();
            $this->updateEffectiveResourceSlots($entry);
            $target->forceFill($entryPosition)->save();
            $this->updateEffectiveResourceSlots($target);

            $exact = [
                'entry' => $this->diagnostics->diagnose(
                    $lockedSemester,
                    $version,
                    $entry->teachingAssignment,
                    $entry->weekday,
                    $entry->item_id,
                    $entry,
                ),
                'target' => $this->diagnostics->diagnose(
                    $lockedSemester,
                    $version,
                    $target->teachingAssignment,
                    $target->weekday,
                    $target->item_id,
                    $target,
                ),
            ];
            if (! $exact['entry']['allowed'] || ! $exact['target']['allowed']) {
                throw new ApiProblemException('TIMETABLE_SWAP_NOT_ALLOWED', '交换后会产生硬冲突，未保存任何修改', 409, [
                    'diagnostics' => $exact,
                ]);
            }
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'swap', 'timetable_entry', $entry->id, $before, [
                'entry' => $entry->fresh()->toArray(),
                'target' => $target->fresh()->toArray(),
            ]);

            return response()->json([
                'data' => [
                    'entries' => [
                        $entry->fresh()->load(['schoolClass', 'teachingGroup', 'schoolClasses', 'teacher', 'teachers', 'course', 'actualRoom', 'item']),
                        $target->fresh()->load(['schoolClass', 'teachingGroup', 'schoolClasses', 'teacher', 'teachers', 'course', 'actualRoom', 'item']),
                    ],
                    'diagnostics' => $exact,
                ],
                'meta' => $this->meta($lockedSemester, $settings, $version),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'teaching_assignment_id' => ['required', 'integer'],
            'weekday' => ['required', 'integer', 'between:1,7'],
            'item_id' => ['required', 'integer'],
            'version_id' => ['sometimes', 'integer'],
            'week_pattern' => ['sometimes', Rule::enum(WeekPattern::class)],
        ]);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $version = $this->versions->ensureWorkingDraft(
                $lockedSemester,
                $actor,
                isset($data['version_id']) ? (int) $data['version_id'] : null,
            );
            $this->synchronization->assertVersionAligned($lockedSemester, $version);
            $primaryAssignmentId = (int) $data['teaching_assignment_id'];
            $assignmentIds = $this->synchronization->assignmentIds($lockedSemester, $primaryAssignmentId);
            $assignments = $this->synchronizedAssignments($lockedSemester, $assignmentIds, $version->id, true);
            $this->assertSynchronizedShapes($assignments);
            foreach ($assignments as $assignment) {
                $this->assertPlaceable($assignment, (int) $data['weekday'], (int) $data['item_id']);
                if ($assignment->entries_count >= $assignment->weekly_items) {
                    throw new ApiProblemException(
                        'ASSIGNMENT_WEEKLY_LIMIT_REACHED',
                        '同步组中至少一条任课关系已达到每周课时上限',
                        409,
                        ['assignment_id' => $assignment->id],
                    );
                }
                if (isset($data['week_pattern']) && WeekPattern::from($data['week_pattern']) !== $assignment->week_pattern) {
                    throw new ApiProblemException('ENTRY_WEEK_PATTERN_MISMATCH', '课表条目的周型必须与任课关系一致', 422);
                }
            }
            $diagnosis = $this->diagnostics->diagnoseGroup(
                $lockedSemester,
                $version,
                $this->primaryAssignmentFirst($assignments, $primaryAssignmentId)->all(),
                (int) $data['weekday'],
                (int) $data['item_id'],
            );
            if (! $diagnosis['allowed']) {
                throw new ApiProblemException('TIMETABLE_PLACEMENT_NOT_ALLOWED', '该课程或其同步组不能安排在目标位置', 409, [
                    'diagnostics' => $diagnosis,
                ]);
            }
            $createdEntries = new EloquentCollection;
            foreach ($assignments as $assignment) {
                $roomId = $this->rooms->resolve($assignment);
                $room = Room::query()->findOrFail($roomId);
                if (! $room->is_active) {
                    throw new ApiProblemException(
                        'ROOM_INACTIVE',
                        '同步组中至少一个教室已停用，不能新增课程',
                        409,
                        ['assignment_id' => $assignment->id, 'room_id' => $roomId],
                    );
                }
                $weekPattern = $assignment->week_pattern;
                $activeWeeks = $weekPattern === WeekPattern::Specified ? $assignment->active_weeks : null;
                $classIds = $this->classIds($assignment);
                $teacherIds = $this->teacherIds($assignment);
                $this->conflicts->assertAvailable(
                    $lockedSemester->id,
                    $version->id,
                    $classIds,
                    $teacherIds,
                    $roomId,
                    (int) $data['weekday'],
                    (int) $data['item_id'],
                    $weekPattern,
                    null,
                    $activeWeeks,
                );
                try {
                    $entry = TimetableEntry::query()->create([
                        'semester_id' => $lockedSemester->id,
                        'timetable_version_id' => $version->id,
                        'teaching_assignment_id' => $assignment->id,
                        'school_class_id' => $assignment->school_class_id,
                        'teaching_group_id' => $assignment->teaching_group_id,
                        'teacher_id' => $assignment->teacher_id,
                        'course_id' => $assignment->course_id,
                        'actual_room_id' => $roomId,
                        'week_pattern' => $weekPattern,
                        'active_weeks' => $activeWeeks,
                        'weekday' => $data['weekday'],
                        'item_id' => $data['item_id'],
                        'source' => 'manual',
                        'is_locked' => false,
                    ]);
                    $this->syncEffectiveResources($entry, $classIds, $teacherIds);
                    $createdEntries->push($entry);
                } catch (QueryException $exception) {
                    throw $this->mapConstraint($exception);
                }
            }
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            foreach ($createdEntries as $createdEntry) {
                $this->audit->record($request, $actor, 'create', 'timetable_entry', $createdEntry->id, null, $createdEntry->toArray());
            }
            $entry = $this->entryResponse($createdEntries, $primaryAssignmentId);

            return response()->json(['data' => $entry, 'meta' => $this->meta($lockedSemester, $settings, $version)], 201)
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function update(Request $request, Semester $semester, TimetableEntry $entry): JsonResponse
    {
        $this->assertParent($semester, $entry);
        $data = $request->validate([
            'weekday' => ['required', 'integer', 'between:1,7'],
            'item_id' => ['required', 'integer'],
            'week_pattern' => ['sometimes', Rule::enum(WeekPattern::class)],
        ]);

        return DB::transaction(function () use ($request, $semester, $entry, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $locked = TimetableEntry::query()->with(['teachingAssignment.semester', 'timetableVersion'])->lockForUpdate()->findOrFail($entry->id);
            $this->versions->assertDraft($locked->timetableVersion);
            $assignmentIds = $this->synchronization->assignmentIds($lockedSemester, $locked->teaching_assignment_id);
            $groupEntries = $this->synchronizedEntries($lockedSemester, $locked, $assignmentIds, true);
            $assignments = new EloquentCollection($groupEntries->map(fn (TimetableEntry $groupEntry): TeachingAssignment => $groupEntry->teachingAssignment)->all());
            $this->assertSynchronizedShapes($assignments);
            $lockedIds = $groupEntries->where('is_locked', true)->pluck('id')->map(fn ($id): int => (int) $id)->values()->all();
            if ($lockedIds !== []) {
                throw new ApiProblemException(
                    'TIMETABLE_ENTRY_LOCKED',
                    '同步组中存在已锁定课程，请先解锁整个组',
                    409,
                    ['entry_ids' => $lockedIds],
                );
            }
            foreach ($assignments as $assignment) {
                $this->assertPlaceable($assignment, (int) $data['weekday'], (int) $data['item_id']);
                if (isset($data['week_pattern']) && WeekPattern::from($data['week_pattern']) !== $assignment->week_pattern) {
                    throw new ApiProblemException('ENTRY_WEEK_PATTERN_MISMATCH', '课表条目的周型必须与任课关系一致', 422);
                }
            }
            $diagnosis = $this->diagnostics->diagnoseGroup(
                $lockedSemester,
                $locked->timetableVersion,
                $this->primaryAssignmentFirst($assignments, $locked->teaching_assignment_id)->all(),
                (int) $data['weekday'],
                (int) $data['item_id'],
                $groupEntries->all(),
            );
            if (! $diagnosis['allowed']) {
                throw new ApiProblemException('TIMETABLE_PLACEMENT_NOT_ALLOWED', '该课程或其同步组不能移动到目标位置', 409, [
                    'diagnostics' => $diagnosis,
                ]);
            }
            $before = [];
            $changedEntries = [];
            foreach ($groupEntries as $groupEntry) {
                $assignment = $groupEntry->teachingAssignment;
                $weekPattern = $assignment->week_pattern;
                $activeWeeks = $weekPattern === WeekPattern::Specified ? $assignment->active_weeks : null;
                $this->conflicts->assertAvailable(
                    $lockedSemester->id,
                    $groupEntry->timetable_version_id,
                    $groupEntry->schoolClasses->pluck('id')->map(fn ($id): int => (int) $id)->all(),
                    $groupEntry->teachers->pluck('id')->map(fn ($id): int => (int) $id)->all(),
                    $groupEntry->actual_room_id,
                    (int) $data['weekday'],
                    (int) $data['item_id'],
                    $weekPattern,
                    $groupEntry->id,
                    $activeWeeks,
                );
                $before[$groupEntry->id] = $groupEntry->toArray();
                $groupEntry->fill([
                    'weekday' => $data['weekday'],
                    'item_id' => $data['item_id'],
                    'week_pattern' => $weekPattern,
                    'active_weeks' => $activeWeeks,
                ]);
                if (! $groupEntry->isDirty()) {
                    continue;
                }
                try {
                    $groupEntry->save();
                    $this->updateEffectiveResourceSlots($groupEntry);
                    $changedEntries[] = $groupEntry;
                } catch (QueryException $exception) {
                    throw $this->mapConstraint($exception);
                }
            }
            if ($changedEntries !== []) {
                $lockedSemester->increment('timetable_revision');
                $lockedSemester->refresh();
                foreach ($changedEntries as $changedEntry) {
                    $this->audit->record(
                        $request,
                        $actor,
                        'move',
                        'timetable_entry',
                        $changedEntry->id,
                        $before[$changedEntry->id],
                        $changedEntry->toArray(),
                    );
                }
            }
            $responseEntry = $this->entryResponse($groupEntries, $locked->teaching_assignment_id);

            return response()->json(['data' => $responseEntry, 'meta' => $this->meta($lockedSemester, $settings, $locked->timetableVersion)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function destroy(Request $request, Semester $semester, TimetableEntry $entry): JsonResponse
    {
        $this->assertParent($semester, $entry);

        return DB::transaction(function () use ($request, $semester, $entry): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $locked = TimetableEntry::query()->with(['timetableVersion', 'teachingAssignment'])->lockForUpdate()->findOrFail($entry->id);
            $this->versions->assertDraft($locked->timetableVersion);
            $assignmentIds = $this->synchronization->assignmentIds($lockedSemester, $locked->teaching_assignment_id);
            $groupEntries = $this->synchronizedEntries($lockedSemester, $locked, $assignmentIds, true);
            $lockedIds = $groupEntries->where('is_locked', true)->pluck('id')->map(fn ($id): int => (int) $id)->values()->all();
            if ($lockedIds !== []) {
                throw new ApiProblemException(
                    'TIMETABLE_ENTRY_LOCKED',
                    '同步组中存在已锁定课程，请先解锁整个组',
                    409,
                    ['entry_ids' => $lockedIds],
                );
            }
            $deletedIds = [];
            foreach ($groupEntries as $groupEntry) {
                $before = $groupEntry->toArray();
                $groupEntry->delete();
                $deletedIds[] = $groupEntry->id;
                $this->audit->record($request, $actor, 'delete', 'timetable_entry', $groupEntry->id, $before, null);
            }
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();

            return response()->json(['data' => [
                'deleted_id' => $entry->id,
                'deleted_ids' => $deletedIds,
            ], 'meta' => $this->meta($lockedSemester, $settings, $locked->timetableVersion)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function lock(Request $request, Semester $semester, TimetableEntry $entry): JsonResponse
    {
        return $this->setLocked($request, $semester, $entry, true);
    }

    public function unlock(Request $request, Semester $semester, TimetableEntry $entry): JsonResponse
    {
        return $this->setLocked($request, $semester, $entry, false);
    }

    private function setLocked(Request $request, Semester $semester, TimetableEntry $entry, bool $value): JsonResponse
    {
        $this->assertParent($semester, $entry);

        return DB::transaction(function () use ($request, $semester, $entry, $value): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $locked = TimetableEntry::query()->with(['timetableVersion', 'teachingAssignment'])->lockForUpdate()->findOrFail($entry->id);
            $this->versions->assertDraft($locked->timetableVersion);
            $assignmentIds = $this->synchronization->assignmentIds($lockedSemester, $locked->teaching_assignment_id);
            $groupEntries = $this->synchronizedEntries($lockedSemester, $locked, $assignmentIds, true);
            $changed = false;
            foreach ($groupEntries as $groupEntry) {
                $before = $groupEntry->toArray();
                $groupEntry->is_locked = $value;
                if (! $groupEntry->isDirty()) {
                    continue;
                }
                $groupEntry->save();
                $changed = true;
                $this->audit->record(
                    $request,
                    $actor,
                    $value ? 'lock' : 'unlock',
                    'timetable_entry',
                    $groupEntry->id,
                    $before,
                    $groupEntry->toArray(),
                );
            }
            if ($changed) {
                $lockedSemester->increment('timetable_revision');
                $lockedSemester->refresh();
            }
            $responseEntry = $this->entryResponse($groupEntries, $locked->teaching_assignment_id);

            return response()->json(['data' => $responseEntry, 'meta' => $this->meta($lockedSemester, $settings, $locked->timetableVersion)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function completeness(Request $request, Semester $semester): JsonResponse
    {
        $filters = $request->validate(['version_id' => ['sometimes', 'integer']]);
        $settings = AppSetting::query()->findOrFail(1);
        $version = $this->versions->resolveForRead(
            $semester,
            isset($filters['version_id']) ? (int) $filters['version_id'] : null,
            $request->user()->role->canEdit(),
        );
        $versionId = $version === null ? 0 : $version->id;
        $items = $semester->teachingAssignments()->where('status', AssignmentStatus::Confirmed->value)
            ->withCount(['entries' => fn ($query) => $query->where('timetable_version_id', $versionId)])
            ->get()->map(fn (TeachingAssignment $assignment) => [
                'teaching_assignment_id' => $assignment->id,
                'required' => $assignment->weekly_items,
                'scheduled' => $assignment->entries_count,
                'remaining' => max(0, $assignment->weekly_items - $assignment->entries_count),
                'completed' => $assignment->entries_count === $assignment->weekly_items,
            ]);

        return response()->json(['data' => $items, 'meta' => $this->meta($semester, $settings, $version)])
            ->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function validation(Request $request, Semester $semester): JsonResponse
    {
        $filters = $request->validate(['version_id' => ['sometimes', 'integer']]);
        $settings = AppSetting::query()->findOrFail(1);
        $version = $this->versions->resolveForRead(
            $semester,
            isset($filters['version_id']) ? (int) $filters['version_id'] : null,
            $request->user()->role->canEdit(),
        );
        $versionId = $version === null ? 0 : $version->id;
        $draftCount = $semester->teachingAssignments()->where('status', AssignmentStatus::Draft->value)->count();
        $synchronizationIssues = $version === null
            ? []
            : $this->synchronization->versionAlignmentIssues($semester, $version);
        $incomplete = $semester->teachingAssignments()->where('status', AssignmentStatus::Confirmed->value)
            ->withCount(['entries' => fn ($query) => $query->where('timetable_version_id', $versionId)])->get()
            ->filter(fn (TeachingAssignment $assignment) => $assignment->entries_count !== $assignment->weekly_items)->values();

        return response()->json(['data' => [
            'valid' => $draftCount === 0 && $incomplete->isEmpty() && $synchronizationIssues === [],
            'draft_assignment_count' => $draftCount,
            'incomplete_assignments' => $incomplete->map(fn (TeachingAssignment $assignment) => [
                'id' => $assignment->id, 'required' => $assignment->weekly_items, 'scheduled' => $assignment->entries_count,
            ]),
            'synchronization_issues' => $synchronizationIssues,
        ], 'meta' => $this->meta($semester, $settings, $version)])
            ->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function export(Request $request, Semester $semester): StreamedResponse
    {
        $payload = $this->exportPayload($request, $semester);
        $filename = $payload['filename_base'].'.csv';

        return response()->streamDownload(function () use ($payload): void {
            $output = fopen('php://output', 'w');
            fwrite($output, "\xEF\xBB\xBF");
            foreach ($payload['metadata'] as $row) {
                fputcsv($output, array_map([$this, 'csvSafe'], $row));
            }
            fputcsv($output, []);
            fputcsv($output, array_map([$this, 'csvSafe'], $payload['headers']));
            foreach ($payload['rows'] as $row) {
                fputcsv($output, array_map([$this, 'csvSafe'], $row));
            }
            fclose($output);
        }, $filename, ['Content-Type' => 'text/csv; charset=utf-8', 'Cache-Control' => 'private, no-store']);
    }

    public function exportXlsx(Request $request, Semester $semester): BinaryFileResponse
    {
        $payload = $this->exportPayload($request, $semester);
        $rows = [...$payload['metadata'], [], $payload['headers'], ...$payload['rows']];
        $headerRow = count($payload['metadata']) + 2;
        $path = $this->xlsx->write($rows, '课表', $headerRow);

        return response()->download($path, $payload['filename_base'].'.xlsx', [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Cache-Control' => 'private, no-store',
        ])->deleteFileAfterSend(true);
    }

    /**
     * @return array{filename_base: string, metadata: list<list<string>>, headers: list<string>, rows: list<list<string>>}
     */
    private function exportPayload(Request $request, Semester $semester): array
    {
        $data = $request->validate([
            'view' => ['required', Rule::in(['class', 'teacher', 'room'])],
            'resource_id' => ['required', 'integer'],
            'mode' => ['sometimes', Rule::in(['official', 'full'])],
            'version_id' => ['sometimes', 'integer'],
        ]);
        $resource = match ($data['view']) {
            'class' => SchoolClass::query()->where('academic_year_id', $semester->academic_year_id)->whereKey($data['resource_id'])->first(),
            'teacher' => Teacher::query()->whereKey($data['resource_id'])->first(),
            'room' => Room::query()->whereKey($data['resource_id'])->first(),
            default => throw new \LogicException('Validated timetable view is invalid.'),
        };
        if ($resource === null) {
            throw new ApiProblemException('TIMETABLE_RESOURCE_NOT_FOUND', '导出资源不存在或不属于该学期', 422);
        }
        $mode = (string) ($data['mode'] ?? 'official');
        $version = $this->versions->resolveForRead(
            $semester,
            isset($data['version_id']) ? (int) $data['version_id'] : null,
            $request->user()->role->canEdit(),
        );
        $versionId = $version === null ? 0 : $version->id;
        $versionNo = $version === null ? 0 : $version->version_no;
        $versionName = $version === null ? '未创建' : $version->name;
        $entries = $this->scopeResource(
            TimetableEntry::query()->where('semester_id', $semester->id)->where('timetable_version_id', $versionId),
            $data['view'],
            (int) $data['resource_id'],
        )->with([
            'schoolClass:id,name', 'teachingGroup:id,name', 'schoolClasses:id,name', 'teacher:id,name',
            'teachers:id,name', 'course:id,name', 'actualRoom:id,name', 'item:id,name,start_time,end_time,sort_order',
        ])->orderBy('weekday')->orderBy('item_id')->get();
        $semester->loadMissing('academicYear');
        $viewLabel = ['class' => '班级', 'teacher' => '教师', 'room' => '教室'][$data['view']];
        $modeLabel = $mode === 'full' ? '完整作息' : '正式课程';
        $weekdayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
        $rows = $entries->map(function (TimetableEntry $entry) use ($weekdayNames): array {
            $targetName = $entry->schoolClass !== null
                ? $entry->schoolClass->name
                : ($entry->teachingGroup === null ? '' : $entry->teachingGroup->name);

            return [
                $weekdayNames[$entry->weekday],
                $entry->item->name,
                substr($entry->item->start_time, 0, 5).'-'.substr($entry->item->end_time, 0, 5),
                $targetName,
                $entry->course->name,
                $entry->teachers->pluck('name')->join('、') ?: $entry->teacher->name,
                $entry->actualRoom->name,
            ];
        })->values()->all();

        return [
            'filename_base' => sprintf('timetable-semester-%d-v%d-%s-%d', $semester->id, $versionNo, $data['view'], $data['resource_id']),
            'metadata' => [
                ['学年', $semester->academicYear->name],
                ['学期', $semester->name],
                ['课表版本', $versionName],
                ['视角', $viewLabel],
                ['筛选对象', $resource->name],
                ['显示模式', $modeLabel],
                ['周型', '按任课关系周型'],
                ['生成时间', now()->toDateTimeString()],
            ],
            'headers' => ['星期', '课节', '时间', '班级/教学组', '课程', '教师', '教室'],
            'rows' => $rows,
        ];
    }

    private function assertPlaceable(TeachingAssignment $assignment, int $weekday, int $itemId): void
    {
        if ($assignment->status !== AssignmentStatus::Confirmed) {
            throw new ApiProblemException('ASSIGNMENT_NOT_CONFIRMED', '只能安排已确认任课关系', 409);
        }
        $day = ScheduleTemplateDay::query()->where('semester_id', $assignment->semester_id)->where('weekday', $weekday)->first();
        $item = Item::query()->where('semester_id', $assignment->semester_id)->find($itemId);
        if ($day === null || ! $day->is_enabled || $item === null || ! $item->is_active || ! $item->allows_course || ! $item->counts_as_course) {
            throw new ApiProblemException('ITEM_NOT_AVAILABLE', '该星期或课节不可安排普通课程', 409);
        }
        $classIds = $this->classIds($assignment);
        $activeClasses = SchoolClass::query()->with('grade')->whereIn('id', $classIds)->get()
            ->filter(fn (SchoolClass $schoolClass) => $schoolClass->status === ResourceStatus::Active && $schoolClass->grade->is_active);
        $activeSettings = $assignment->semester->classSettings()
            ->whereIn('school_class_id', $classIds)
            ->where('status', ResourceStatus::Active->value)
            ->count();
        if ($activeClasses->count() !== count($classIds) || $activeSettings !== count($classIds)
            || ! $assignment->teacher->is_active || ! $assignment->course->is_active) {
            throw new ApiProblemException('ASSIGNMENT_RESOURCE_INACTIVE', '班级、年级、教师、课程或本学期班级配置已停用', 409);
        }
    }

    /**
     * @param  list<int>  $assignmentIds
     * @return EloquentCollection<int, TeachingAssignment>
     */
    private function synchronizedAssignments(
        Semester $semester,
        array $assignmentIds,
        ?int $versionId = null,
        bool $lock = false,
    ): EloquentCollection {
        $query = TeachingAssignment::query()
            ->where('semester_id', $semester->id)
            ->whereIn('id', $assignmentIds)
            ->with([
                'semester', 'schoolClass.grade', 'teachingGroup.schoolClasses.grade', 'teacher', 'collaborators',
                'course', 'specifiedRoom',
            ])
            ->orderBy('id');
        if ($versionId !== null) {
            $query->withCount(['entries' => fn ($entryQuery) => $entryQuery->where('timetable_version_id', $versionId)]);
        }
        if ($lock) {
            $query->lockForUpdate();
        }
        $assignments = $query->get();
        $missingIds = array_values(array_diff($assignmentIds, $assignments->pluck('id')->map(fn ($id): int => (int) $id)->all()));
        if ($missingIds !== []) {
            throw new ApiProblemException(
                'TIMETABLE_SYNCHRONIZATION_INVALID',
                '同步组包含已失效或不属于当前学期的任课关系',
                409,
                ['assignment_ids' => $missingIds],
            );
        }

        return $assignments;
    }

    /**
     * @param  list<int>  $assignmentIds
     * @return EloquentCollection<int, TimetableEntry>
     */
    private function synchronizedEntries(
        Semester $semester,
        TimetableEntry $source,
        array $assignmentIds,
        bool $lock = false,
    ): EloquentCollection {
        $query = TimetableEntry::query()
            ->where('semester_id', $semester->id)
            ->where('timetable_version_id', $source->timetable_version_id)
            ->whereIn('teaching_assignment_id', $assignmentIds)
            ->where('weekday', $source->weekday)
            ->where('item_id', $source->item_id)
            ->where('week_pattern', $source->week_pattern->value)
            ->with([
                'timetableVersion', 'schoolClasses', 'teachers',
                'teachingAssignment.semester', 'teachingAssignment.schoolClass.grade',
                'teachingAssignment.teachingGroup.schoolClasses.grade', 'teachingAssignment.teacher',
                'teachingAssignment.collaborators', 'teachingAssignment.course', 'teachingAssignment.specifiedRoom',
            ])
            ->orderBy('id');
        if ($lock) {
            $query->lockForUpdate();
        }
        $sourceWeeks = $this->normalizedWeeks($source->active_weeks);
        $entries = $query->get()->filter(
            fn (TimetableEntry $candidate): bool => $this->normalizedWeeks($candidate->active_weeks) === $sourceWeeks,
        )->values();
        $foundAssignmentIds = $entries->pluck('teaching_assignment_id')->map(fn ($id): int => (int) $id)->all();
        $missingIds = array_values(array_diff($assignmentIds, $foundAssignmentIds));
        if ($missingIds !== [] || $entries->count() !== count($assignmentIds)) {
            throw new ApiProblemException(
                'TIMETABLE_SYNCHRONIZATION_INCOMPLETE',
                '当前课表中的同步组不完整或周型不一致，未执行任何修改',
                409,
                ['assignment_ids' => $assignmentIds, 'missing_assignment_ids' => $missingIds],
            );
        }

        return $entries;
    }

    /** @param EloquentCollection<int, TeachingAssignment> $assignments */
    private function assertSynchronizedShapes(EloquentCollection $assignments): void
    {
        $signatures = $assignments->map(fn (TeachingAssignment $assignment): string => implode(':', [
            $assignment->weekly_items,
            $assignment->items_per_session,
            $assignment->week_pattern->value,
            json_encode($this->normalizedWeeks($assignment->active_weeks)),
        ]))->unique();
        if ($signatures->count() > 1) {
            throw new ApiProblemException(
                'TIMETABLE_SYNCHRONIZATION_SHAPE_INVALID',
                '同步组的周课时、连排节数或周型不一致，无法进行原子排课',
                409,
                ['assignment_ids' => $assignments->pluck('id')->all()],
            );
        }
    }

    /**
     * @param  EloquentCollection<int, TeachingAssignment>  $assignments
     * @return EloquentCollection<int, TeachingAssignment>
     */
    private function primaryAssignmentFirst(EloquentCollection $assignments, int $assignmentId): EloquentCollection
    {
        return $assignments->sortByDesc(fn (TeachingAssignment $assignment): bool => $assignment->id === $assignmentId)->values();
    }

    /**
     * @param  EloquentCollection<int, TimetableEntry>  $entries
     */
    private function entryResponse(EloquentCollection $entries, int $primaryAssignmentId): TimetableEntry
    {
        $freshEntries = TimetableEntry::query()->whereIn('id', $entries->pluck('id'))
            ->with(['schoolClass', 'teachingGroup', 'schoolClasses', 'teacher', 'teachers', 'course', 'actualRoom', 'item'])
            ->orderBy('id')
            ->get();
        $primary = $freshEntries->firstWhere('teaching_assignment_id', $primaryAssignmentId);
        if (! $primary instanceof TimetableEntry) {
            throw new \LogicException('The primary synchronized timetable entry was not persisted.');
        }
        $serialized = $freshEntries->map(fn (TimetableEntry $entry): array => $entry->toArray())->values()->all();
        $primary->setAttribute('synchronized_entries', $serialized);

        return $primary;
    }

    /**
     * @param  list<int>|null  $weeks
     * @return list<int>
     */
    private function normalizedWeeks(?array $weeks): array
    {
        $normalized = array_map('intval', $weeks ?? []);
        sort($normalized);

        return array_values(array_unique($normalized));
    }

    /**
     * @return array{TimetableEntry, TimetableEntry}
     */
    private function swapPair(
        Semester $semester,
        TimetableVersion $version,
        int $entryId,
        int $targetEntryId,
        bool $lock = false,
    ): array {
        $query = TimetableEntry::query()
            ->where('semester_id', $semester->id)
            ->where('timetable_version_id', $version->id)
            ->whereIn('id', [$entryId, $targetEntryId])
            ->with([
                'teachingAssignment.semester',
                'teachingAssignment.schoolClass.grade',
                'teachingAssignment.teachingGroup.schoolClasses.grade',
                'teachingAssignment.teacher',
                'teachingAssignment.collaborators',
                'teachingAssignment.course',
                'timetableVersion',
            ])
            ->orderBy('id');
        if ($lock) {
            $query->lockForUpdate();
        }
        $entries = $query->get();
        $entry = $entries->firstWhere('id', $entryId);
        $target = $entries->firstWhere('id', $targetEntryId);
        if ($entry === null || $target === null) {
            throw new ApiProblemException('TIMETABLE_SWAP_ENTRY_NOT_FOUND', '要交换的课程不属于当前课表版本', 404);
        }
        $entryGroupIds = $this->synchronization->assignmentIds($semester, $entry->teaching_assignment_id);
        $targetGroupIds = $this->synchronization->assignmentIds($semester, $target->teaching_assignment_id);
        if (count($entryGroupIds) > 1 || count($targetGroupIds) > 1) {
            throw new ApiProblemException(
                'TIMETABLE_SWAP_SYNCHRONIZATION_UNSUPPORTED',
                '同步组课程不能通过单条交换操作调整，请移动整个同步组',
                409,
                [
                    'entry_ids' => [$entry->id, $target->id],
                    'assignment_ids' => array_values(array_unique([...$entryGroupIds, ...$targetGroupIds])),
                ],
            );
        }
        if ($entry->teaching_assignment_id === $target->teaching_assignment_id) {
            throw new ApiProblemException('TIMETABLE_SWAP_SAME_ASSIGNMENT', '同一任课关系的两个课节无需交换', 422);
        }
        if ($entry->weekday === $target->weekday && $entry->item_id === $target->item_id) {
            throw new ApiProblemException('TIMETABLE_SWAP_SAME_SLOT', '请选择不同位置的两节课程', 422);
        }
        $this->assertPlaceable($entry->teachingAssignment, $target->weekday, $target->item_id);
        $this->assertPlaceable($target->teachingAssignment, $entry->weekday, $entry->item_id);

        return [$entry, $target];
    }

    /**
     * @return array{allowed: bool, summary: string, entry: array<string, mixed>, target: array<string, mixed>}
     */
    private function swapDiagnostics(
        Semester $semester,
        TimetableVersion $version,
        TimetableEntry $entry,
        TimetableEntry $target,
    ): array {
        $entryDiagnosis = $this->diagnostics->diagnose(
            $semester,
            $version,
            $entry->teachingAssignment,
            $target->weekday,
            $target->item_id,
            $entry,
            [$target->id],
        );
        $targetDiagnosis = $this->diagnostics->diagnose(
            $semester,
            $version,
            $target->teachingAssignment,
            $entry->weekday,
            $entry->item_id,
            $target,
            [$entry->id],
        );
        $allowed = $entryDiagnosis['allowed'] && $targetDiagnosis['allowed'];

        return [
            'allowed' => $allowed,
            'summary' => $allowed
                ? '可以交换：两节课程互换后没有硬冲突。'
                : '不能交换：至少一节课程在目标位置存在硬冲突。',
            'entry' => $entryDiagnosis,
            'target' => $targetDiagnosis,
        ];
    }

    private function mapConstraint(QueryException $exception): ApiProblemException
    {
        $message = $exception->getMessage();
        $type = str_contains($message, 'uq_timetable_teacher_slot') ? 'teacher'
            : (str_contains($message, 'uq_timetable_room_slot') ? 'room'
                : (str_contains($message, 'uq_timetable_class_slot') ? 'class' : 'assignment'));

        return new ApiProblemException('TIMETABLE_RESOURCE_CONFLICT', '该课节存在资源冲突', 409, ['resource_type' => $type]);
    }

    private function assertParent(Semester $semester, TimetableEntry $entry): void
    {
        if ($entry->semester_id !== $semester->id) {
            throw new ApiProblemException('ENTRY_SEMESTER_MISMATCH', '课表条目不属于该学期', 404);
        }
    }

    private function csvSafe(mixed $value): string
    {
        $text = (string) $value;
        $detected = ltrim($text, ' ');

        return preg_match('/^[=+\-@\t\r\n]/u', $detected) ? "'".$text : $text;
    }

    /** @return list<int> */
    private function classIds(TeachingAssignment $assignment): array
    {
        if ($assignment->school_class_id !== null) {
            return [$assignment->school_class_id];
        }
        if ($assignment->teachingGroup === null || $assignment->teachingGroup->schoolClasses->isEmpty()) {
            throw new ApiProblemException('ASSIGNMENT_TARGET_INVALID', '任课关系缺少有效班级或教学组', 409);
        }

        return $assignment->teachingGroup->schoolClasses->pluck('id')->map(fn ($id) => (int) $id)->all();
    }

    /** @return list<int> */
    private function teacherIds(TeachingAssignment $assignment): array
    {
        return array_values(array_unique([
            $assignment->teacher_id,
            ...$assignment->collaborators->pluck('id')->map(fn ($id) => (int) $id)->all(),
        ]));
    }

    /**
     * @param  list<int>  $classIds
     * @param  list<int>  $teacherIds
     */
    private function syncEffectiveResources(TimetableEntry $entry, array $classIds, array $teacherIds): void
    {
        $pivot = [
            'timetable_version_id' => $entry->timetable_version_id,
            'week_pattern' => $entry->week_pattern->value,
            'weekday' => $entry->weekday,
            'item_id' => $entry->item_id,
        ];
        $entry->schoolClasses()->attach($classIds, $pivot);
        $entry->teachers()->attach($teacherIds, $pivot);
    }

    private function updateEffectiveResourceSlots(TimetableEntry $entry): void
    {
        $slot = [
            'week_pattern' => $entry->week_pattern->value,
            'weekday' => $entry->weekday,
            'item_id' => $entry->item_id,
        ];
        DB::table('timetable_entry_classes')->where('timetable_entry_id', $entry->id)->update($slot);
        DB::table('timetable_entry_teachers')->where('timetable_entry_id', $entry->id)->update($slot);
    }

    /**
     * @param  Builder<TimetableEntry>  $query
     * @return Builder<TimetableEntry>
     */
    private function scopeResource(Builder $query, mixed $view, int $resourceId): Builder
    {
        return match ($view) {
            'class' => $query->whereHas('schoolClasses', fn ($relation) => $relation->whereKey($resourceId)),
            'teacher' => $query->whereHas('teachers', fn ($relation) => $relation->whereKey($resourceId)),
            'room' => $query->where('actual_room_id', $resourceId),
            default => throw new \LogicException('Validated timetable view is invalid.'),
        };
    }

    /** @return array<string, int|string|null> */
    private function meta(Semester $semester, AppSetting $settings, ?TimetableVersion $version = null): array
    {
        return [
            'semester_id' => $semester->id,
            'version_id' => $version?->id,
            'version_no' => $version?->version_no,
            'version_status' => $version?->status->value,
            'current_timetable_version_id' => $semester->current_timetable_version_id,
            'timetable_revision' => (string) $semester->getRawOriginal('timetable_revision'),
            'input_revision' => (string) $semester->getRawOriginal('input_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
