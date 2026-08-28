<?php

namespace App\Modules\Timetable\Services;

use App\Enums\ConstraintKind;
use App\Enums\ConstraintStatus;
use App\Enums\ConstraintTargetType;
use App\Enums\TimetableVersionStatus;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\Room;
use App\Modules\Scheduling\Models\SchedulingConstraint;
use App\Modules\Scheduling\Services\WeekPatternService;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Models\TimetableVersion;
use App\Support\ApiProblemException;
use Illuminate\Support\Collection;

class TimetableDiagnosticService
{
    public function __construct(
        private readonly RoomResolver $rooms,
        private readonly WeekPatternService $weekPatterns,
    ) {}

    /**
     * @param  list<int>  $additionalExceptEntryIds
     * @return array<string, mixed>
     */
    public function diagnose(
        Semester $semester,
        ?TimetableVersion $version,
        TeachingAssignment $assignment,
        int $weekday,
        int $itemId,
        ?TimetableEntry $movingEntry = null,
        array $additionalExceptEntryIds = [],
    ): array {
        return $this->diagnoseGroup(
            $semester,
            $version,
            [$assignment],
            $weekday,
            $itemId,
            $movingEntry === null ? [] : [$movingEntry],
            $additionalExceptEntryIds,
        );
    }

    /**
     * Diagnose an atomic synchronized placement against one shared snapshot. Synthetic
     * entries make group members visible to one another before any database row exists.
     *
     * @param  list<TeachingAssignment>  $assignments
     * @param  list<TimetableEntry>  $movingEntries
     * @param  list<int>  $additionalExceptEntryIds
     * @return array<string, mixed>
     */
    public function diagnoseGroup(
        Semester $semester,
        ?TimetableVersion $version,
        array $assignments,
        int $weekday,
        int $itemId,
        array $movingEntries = [],
        array $additionalExceptEntryIds = [],
    ): array {
        if ($assignments === []) {
            throw new \InvalidArgumentException('A diagnostic group must contain at least one assignment.');
        }
        $template = $semester->scheduleTemplate()->with(['days', 'items'])->firstOrFail();
        $days = $template->days->where('is_enabled', true)->pluck('weekday')->map(fn ($day): int => (int) $day)->all();
        $items = $template->items->where('is_active', true)->where('allows_course', true)
            ->where('counts_as_course', true)->sortBy('sort_order')->values();
        $targetItem = $items->firstWhere('id', $itemId);
        if (! in_array($weekday, $days, true) || $targetItem === null) {
            throw new ApiProblemException('DIAGNOSTIC_SLOT_INVALID', '目标位置不是允许排课的课节', 422);
        }
        $versionId = $version === null ? 0 : $version->id;
        $entries = TimetableEntry::query()->where('semester_id', $semester->id)
            ->where('timetable_version_id', $versionId)
            ->with(['schoolClasses:id,name', 'teachers:id,name', 'actualRoom:id,name', 'item:id,name,sort_order'])
            ->get();
        $constraints = $semester->schedulingConstraints()->where('status', ConstraintStatus::Active->value)->get();
        $candidates = [];
        foreach ($assignments as $assignment) {
            $candidates[$assignment->id] = $this->candidate($semester, $assignment);
        }
        $movingByAssignment = collect($movingEntries)->keyBy('teaching_assignment_id');
        $exceptEntryIds = array_values(array_unique([
            ...$additionalExceptEntryIds,
            ...array_map(fn (TimetableEntry $entry): int => $entry->id, $movingEntries),
        ]));
        $existing = $this->existingEntries($semester, $entries, $exceptEntryIds);
        $evaluation = $this->evaluateGroup(
            $semester,
            $candidates,
            $constraints,
            $existing,
            $weekday,
            $itemId,
            (int) $targetItem->sort_order,
            $movingByAssignment,
            $version,
        );

        $alternatives = [];
        foreach ($days as $candidateWeekday) {
            foreach ($items as $item) {
                if ($candidateWeekday === $weekday && $item->id === $itemId) {
                    continue;
                }
                $alternative = $this->evaluateGroup(
                    $semester,
                    $candidates,
                    $constraints,
                    $existing,
                    $candidateWeekday,
                    $item->id,
                    $item->sort_order,
                    $movingByAssignment,
                    $version,
                );
                if (! $alternative['allowed']) {
                    continue;
                }
                $alternatives[] = [
                    'weekday' => $candidateWeekday,
                    'item_id' => $item->id,
                    'item_name' => $item->name,
                    'soft_penalty' => $alternative['soft_penalty'],
                    'explanations' => array_slice($alternative['soft_warnings'], 0, 2),
                ];
            }
        }
        usort($alternatives, fn (array $left, array $right): int => $left['soft_penalty'] <=> $right['soft_penalty']
            ?: $left['weekday'] <=> $right['weekday']
            ?: $left['item_id'] <=> $right['item_id']);

        $assignmentSummaries = array_map(function (TeachingAssignment $assignment) use ($candidates): array {
            $targetName = $assignment->school_class_id !== null
                ? $assignment->schoolClass->name
                : $assignment->teachingGroup->name;
            $candidate = $candidates[$assignment->id];

            return [
                'id' => $assignment->id,
                'target' => $targetName,
                'course' => $assignment->course->name,
                'teachers' => $assignment->teacher->name.($assignment->collaborators->isEmpty()
                    ? ''
                    : '、'.$assignment->collaborators->pluck('name')->join('、')),
                'room' => $candidate['room_name'],
            ];
        }, $assignments);

        return [
            ...$evaluation,
            'assignment' => $assignmentSummaries[0],
            'synchronized_assignments' => $assignmentSummaries,
            'target' => [
                'weekday' => $weekday,
                'item_id' => $itemId,
                'item_name' => $targetItem->name,
            ],
            'alternatives' => array_slice($alternatives, 0, 8),
        ];
    }

    /**
     * @param  array<int, array<string, mixed>>  $candidates
     * @param  Collection<int, SchedulingConstraint>  $constraints
     * @param  list<array<string, mixed>>  $existing
     * @param  Collection<int, TimetableEntry>  $movingByAssignment
     * @return array<string, mixed>
     */
    private function evaluateGroup(
        Semester $semester,
        array $candidates,
        Collection $constraints,
        array $existing,
        int $weekday,
        int $itemId,
        int $itemSortOrder,
        Collection $movingByAssignment,
        ?TimetableVersion $version,
    ): array {
        $memberDiagnostics = [];
        $hardConflicts = [];
        $softWarnings = [];
        $softPenalty = 0.0;
        foreach ($candidates as $assignmentId => $candidate) {
            $memberExisting = $existing;
            foreach ($candidates as $relatedAssignmentId => $relatedCandidate) {
                if ($relatedAssignmentId === $assignmentId) {
                    continue;
                }
                $memberExisting[] = $this->syntheticEntry(
                    $relatedCandidate,
                    $weekday,
                    $itemId,
                    $itemSortOrder,
                );
            }
            $member = $this->evaluate(
                $semester,
                $candidate,
                $constraints,
                $memberExisting,
                $weekday,
                $itemId,
                $itemSortOrder,
                $movingByAssignment->get($assignmentId),
                $version,
            );
            $memberDiagnostics[] = ['assignment_id' => $assignmentId, ...$member];
            foreach ($member['hard_conflicts'] as $conflict) {
                $hardConflicts[] = ['assignment_id' => $assignmentId, ...$conflict];
            }
            $softWarnings = [...$softWarnings, ...$member['soft_warnings']];
            $softPenalty += $member['soft_penalty'];
        }
        $hardConflicts = collect($hardConflicts)->unique(fn (array $item): string => implode(':', [
            $item['assignment_id'],
            $item['type'],
            $item['constraint_id'] ?? '',
            $item['resource'] ?? '',
            $item['message'],
        ]))->values()->all();
        $allowed = $hardConflicts === [];
        $grouped = count($candidates) > 1;

        return [
            'allowed' => $allowed,
            'summary' => $allowed
                ? ($softWarnings === []
                    ? ($grouped ? '同步组可以整体安排：全部成员均无硬冲突。' : '可以移动：班级、教师、教室和启用规则均允许。')
                    : ($grouped ? '同步组可以整体安排，但会降低部分软规则质量。' : '可以移动，但会降低部分软规则质量。'))
                : ($grouped ? '同步组不能整体安排：至少一个成员存在硬冲突。' : '不能移动：存在必须先处理的硬冲突。'),
            'hard_conflicts' => $hardConflicts,
            'soft_warnings' => array_values(array_unique($softWarnings)),
            'soft_penalty' => round($softPenalty, 2),
            'estimated_quality_delta' => $allowed ? round(-$softPenalty, 2) : 0.0,
            'member_diagnostics' => $memberDiagnostics,
        ];
    }

    /**
     * @param  array<string, mixed>  $candidate
     * @return array<string, mixed>
     */
    private function syntheticEntry(
        array $candidate,
        int $weekday,
        int $itemId,
        int $itemSortOrder,
    ): array {
        return [
            'id' => -$candidate['assignment_id'],
            'assignment_id' => $candidate['assignment_id'],
            'weekday' => $weekday,
            'item_id' => $itemId,
            'item_sort_order' => $itemSortOrder,
            'week_pattern' => $candidate['week_pattern'],
            'active_weeks' => $candidate['active_weeks'],
            'week_mask' => $candidate['week_mask'],
            'resources' => $candidate['resources'],
        ];
    }

    /**
     * @return array{
     *   assignment_id: int, class_ids: list<int>, grade_ids: list<int>, teaching_group_id: int|null,
     *   teacher_ids: list<int>, course_id: int, course_name: string,
     *   room_id: int, room_name: string, week_pattern: string, active_weeks: list<int>|null,
     *   week_mask: int, resources: list<string>, resource_names: array<string, string>
     * }
     */
    private function candidate(Semester $semester, TeachingAssignment $assignment): array
    {
        $assignment->loadMissing([
            'semester', 'schoolClass.grade', 'teachingGroup.schoolClasses.grade', 'teacher', 'collaborators',
            'course', 'specifiedRoom',
        ]);
        $classIds = $assignment->school_class_id !== null
            ? [$assignment->school_class_id]
            : $assignment->teachingGroup?->schoolClasses->pluck('id')->map(fn ($id): int => (int) $id)->all() ?? [];
        $teacherIds = array_values(array_unique([
            $assignment->teacher_id,
            ...$assignment->collaborators->pluck('id')->map(fn ($id): int => (int) $id)->all(),
        ]));
        $gradeIds = $assignment->school_class_id !== null
            ? [$assignment->schoolClass->grade_id]
            : $assignment->teachingGroup?->schoolClasses->pluck('grade_id')->map(fn ($id): int => (int) $id)->unique()->values()->all() ?? [];
        $roomId = $this->rooms->resolve($assignment);
        $roomName = $assignment->specified_room_id !== null
            ? $assignment->specifiedRoom->name
            : (Room::query()->whereKey($roomId)->value('name') ?? "教室 #{$roomId}");
        $resources = ["room:{$roomId}"];
        $resourceNames = ["room:{$roomId}" => $roomName];
        foreach ($classIds as $classId) {
            $resources[] = "school_class:{$classId}";
            $className = $assignment->school_class_id !== null
                ? $assignment->schoolClass->name
                : $assignment->teachingGroup->schoolClasses->firstWhere('id', $classId)->name;
            $resourceNames["school_class:{$classId}"] = $className;
        }
        foreach ($teacherIds as $teacherId) {
            $resources[] = "teacher:{$teacherId}";
            $teacherName = $teacherId === $assignment->teacher_id
                ? $assignment->teacher->name
                : $assignment->collaborators->firstWhere('id', $teacherId)->name;
            $resourceNames["teacher:{$teacherId}"] = $teacherName;
        }

        return [
            'assignment_id' => $assignment->id,
            'class_ids' => $classIds,
            'grade_ids' => $gradeIds,
            'teaching_group_id' => $assignment->teaching_group_id,
            'teacher_ids' => $teacherIds,
            'course_id' => $assignment->course_id,
            'course_name' => $assignment->course->name,
            'room_id' => $roomId,
            'room_name' => $roomName,
            'week_pattern' => $assignment->week_pattern->value,
            'active_weeks' => $assignment->week_pattern->value === 'specified' ? $assignment->active_weeks : null,
            'week_mask' => $this->weekPatterns->mask($semester, $assignment->week_pattern, $assignment->active_weeks),
            'resources' => array_values(array_unique($resources)),
            'resource_names' => $resourceNames,
        ];
    }

    /**
     * @param  Collection<int, TimetableEntry>  $entries
     * @param  list<int>  $exceptEntryIds
     * @return list<array{id: int, assignment_id: int, weekday: int, item_id: int, item_sort_order: int, week_pattern: string, active_weeks: list<int>|null, week_mask: int, resources: list<string>}>
     */
    private function existingEntries(Semester $semester, Collection $entries, array $exceptEntryIds): array
    {
        $result = [];
        foreach ($entries as $entry) {
            if (in_array($entry->id, $exceptEntryIds, true)) {
                continue;
            }
            $resources = ["room:{$entry->actual_room_id}"];
            foreach ($entry->schoolClasses as $schoolClass) {
                $resources[] = "school_class:{$schoolClass->id}";
            }
            foreach ($entry->teachers as $teacher) {
                $resources[] = "teacher:{$teacher->id}";
            }
            $result[] = [
                'id' => $entry->id,
                'assignment_id' => $entry->teaching_assignment_id,
                'weekday' => $entry->weekday,
                'item_id' => $entry->item_id,
                'item_sort_order' => $entry->item->sort_order,
                'week_pattern' => $entry->week_pattern->value,
                'active_weeks' => $entry->active_weeks,
                'week_mask' => $this->weekPatterns->mask($semester, $entry->week_pattern, $entry->active_weeks),
                'resources' => array_values(array_unique($resources)),
            ];
        }

        return $result;
    }

    /**
     * @param  array{
     *   assignment_id: int, class_ids: list<int>, grade_ids: list<int>, teaching_group_id: int|null,
     *   teacher_ids: list<int>, course_id: int, course_name: string,
     *   room_id: int, room_name: string, week_pattern: string, active_weeks: list<int>|null,
     *   week_mask: int, resources: list<string>, resource_names: array<string, string>
     * }  $candidate
     * @param  Collection<int, SchedulingConstraint>  $constraints
     * @param  list<array{id: int, assignment_id: int, weekday: int, item_id: int, item_sort_order: int, week_pattern: string, active_weeks: list<int>|null, week_mask: int, resources: list<string>}>  $existing
     * @return array{allowed: bool, summary: string, hard_conflicts: list<array<string, mixed>>, soft_warnings: list<string>, soft_penalty: float, estimated_quality_delta: float}
     */
    private function evaluate(
        Semester $semester,
        array $candidate,
        Collection $constraints,
        array $existing,
        int $weekday,
        int $itemId,
        int $itemSortOrder,
        ?TimetableEntry $movingEntry,
        ?TimetableVersion $version,
    ): array {
        $hardConflicts = [];
        if ($version !== null && $version->status !== TimetableVersionStatus::Draft) {
            $hardConflicts[] = ['type' => 'version', 'message' => '当前版本只读，请先创建编辑草稿。'];
        }
        if ($movingEntry?->is_locked) {
            $hardConflicts[] = ['type' => 'locked', 'message' => '该课程已锁定，需先解锁才能移动。'];
        }
        foreach ($candidate['resources'] as $resource) {
            foreach ($existing as $entry) {
                if ($entry['weekday'] === $weekday && $entry['item_id'] === $itemId
                    && ($entry['week_mask'] & $candidate['week_mask']) !== 0
                    && in_array($resource, $entry['resources'], true)) {
                    $hardConflicts[] = [
                        'type' => str_starts_with($resource, 'teacher:') ? 'teacher'
                            : (str_starts_with($resource, 'school_class:') ? 'class' : 'room'),
                        'resource' => $resource,
                        'resource_name' => $candidate['resource_names'][$resource] ?? $resource,
                        'existing_entry_id' => $entry['id'],
                        'week_pattern' => $entry['week_pattern'],
                        'active_weeks' => $entry['active_weeks'],
                        'message' => ($candidate['resource_names'][$resource] ?? $resource).'在该课节已被占用。',
                    ];
                }
            }
        }

        foreach ($constraints as $constraint) {
            if ($constraint->kind !== ConstraintKind::Hard || ! $this->targetsCandidate($constraint, $candidate)) {
                continue;
            }
            $category = $constraint->category->value;
            $requirement = $constraint->requirement;
            $matches = $this->slotMatches($constraint->scope, $weekday, $itemId, $itemSortOrder)
                && $this->slotMatches($constraint->condition ?? [], $weekday, $itemId, $itemSortOrder);
            if (in_array($category, ['availability', 'forbidden_slot'], true)
                && ((($requirement['available'] ?? null) === false && $matches)
                    || (($requirement['allowed_only'] ?? false) === true && ! $matches))) {
                $hardConflicts[] = [
                    'type' => 'rule', 'constraint_id' => $constraint->id,
                    'message' => $constraint->name.'不允许安排在这里。',
                ];
            }
            if (in_array($category, ['daily_load', 'workload_balance'], true)) {
                $limit = $this->integerRequirement($requirement, ['max_items_per_day', 'max_per_day']);
                if ($limit !== null) {
                    foreach ($this->constraintResources($constraint, $candidate) as $resource) {
                        $load = $this->dailyLoad($existing, $resource, $weekday, $candidate['week_mask']) + 1;
                        if ($load > $limit) {
                            $hardConflicts[] = [
                                'type' => 'rule', 'constraint_id' => $constraint->id,
                                'message' => "{$constraint->name}：当天将达到 {$load} 节，超过上限 {$limit} 节。",
                            ];
                        }
                    }
                }
            }
            if ($category === 'weekly_load') {
                $limit = $this->integerRequirement($requirement, ['max_items_per_week', 'max_per_week']);
                if ($limit !== null) {
                    foreach ($this->constraintResources($constraint, $candidate) as $resource) {
                        $load = $this->weeklyLoad($existing, $resource, $candidate['week_mask']) + 1;
                        if ($load > $limit) {
                            $hardConflicts[] = [
                                'type' => 'rule', 'constraint_id' => $constraint->id,
                                'message' => "{$constraint->name}：每周将达到 {$load} 节，超过上限 {$limit} 节。",
                            ];
                        }
                    }
                }
            }
            if ($category === 'consecutive_items') {
                $limit = $this->integerRequirement($requirement, ['max_consecutive_items', 'maximum']);
                if ($limit !== null) {
                    foreach ($this->constraintResources($constraint, $candidate) as $resource) {
                        $streak = $this->consecutiveLoad($existing, $resource, $weekday, $candidate['week_mask'], $itemSortOrder);
                        if ($streak > $limit) {
                            $hardConflicts[] = [
                                'type' => 'rule', 'constraint_id' => $constraint->id,
                                'message' => "{$constraint->name}：将形成 {$streak} 节连续授课。",
                            ];
                        }
                    }
                }
            }
            if (in_array($category, ['course_distribution', 'spacing'], true)) {
                $sameDay = $this->assignmentDayCount($existing, $candidate['assignment_id'], $weekday, $candidate['week_mask']);
                $limit = $this->integerRequirement($requirement, ['max_same_course_per_day', 'max_per_day']);
                if ($limit !== null && $sameDay + 1 > $limit) {
                    $hardConflicts[] = [
                        'type' => 'rule', 'constraint_id' => $constraint->id,
                        'message' => "{$constraint->name}：同一课程当天最多安排 {$limit} 次。",
                    ];
                }
                $minimumGap = $this->integerRequirement($requirement, ['min_gap_days', 'minimum_gap_days']);
                if ($minimumGap !== null) {
                    foreach ($existing as $entry) {
                        if ($entry['assignment_id'] === $candidate['assignment_id']
                            && ($entry['week_mask'] & $candidate['week_mask']) !== 0
                            && abs($entry['weekday'] - $weekday) < $minimumGap) {
                            $hardConflicts[] = [
                                'type' => 'rule', 'constraint_id' => $constraint->id,
                                'message' => "{$constraint->name}：与已有课程至少间隔 {$minimumGap} 天。",
                            ];
                        }
                    }
                }
            }
            if (in_array($category, ['mutual_exclusion', 'synchronization'], true)) {
                $relatedIds = $this->relatedAssignmentIds($constraint, $candidate['assignment_id']);
                if ($category === 'mutual_exclusion') {
                    $mode = $requirement['mode'] ?? 'same_slot';
                    foreach ($existing as $entry) {
                        if (in_array($entry['assignment_id'], $relatedIds, true)
                            && ($entry['week_mask'] & $candidate['week_mask']) !== 0
                            && $entry['weekday'] === $weekday
                            && ($mode === 'same_day' || $entry['item_id'] === $itemId)) {
                            $hardConflicts[] = [
                                'type' => 'rule', 'constraint_id' => $constraint->id,
                                'message' => $constraint->name.'要求关联课程错峰安排。',
                            ];
                        }
                    }
                } else {
                    foreach ($relatedIds as $relatedId) {
                        $aligned = collect($existing)->contains(fn (array $entry): bool => $entry['assignment_id'] === $relatedId && $entry['weekday'] === $weekday
                            && $entry['item_id'] === $itemId && $entry['week_mask'] === $candidate['week_mask']);
                        if (! $aligned) {
                            $hardConflicts[] = [
                                'type' => 'rule', 'constraint_id' => $constraint->id,
                                'message' => $constraint->name.'要求关联任课关系占用相同课节。',
                            ];
                        }
                    }
                }
            }
        }

        $softWarnings = [];
        $softPenalty = 0.0;
        $sameDaySessions = $this->assignmentDayCount(
            $existing,
            $candidate['assignment_id'],
            $weekday,
            $candidate['week_mask'],
        );
        if ($sameDaySessions > 0) {
            $softWarnings[] = '该课程在当天已有安排，周内分布会更集中。';
            $softPenalty += 3.5;
        }
        foreach ($constraints as $constraint) {
            if ($constraint->kind !== ConstraintKind::Soft || ! $this->targetsCandidate($constraint, $candidate)) {
                continue;
            }
            $weight = ($constraint->weight ?? 50) / 10;
            $requirement = $constraint->requirement;
            $matches = $this->slotMatches($constraint->scope, $weekday, $itemId, $itemSortOrder)
                && $this->slotMatches($constraint->condition ?? [], $weekday, $itemId, $itemSortOrder);
            $violated = (($requirement['preference'] ?? null) === 'avoid' && $matches)
                || (($requirement['preference'] ?? null) === 'prefer' && ! $matches);
            $category = $constraint->category->value;
            if ($category === 'course_priority') {
                $courseNames = $requirement['prefer_earlier_items'] ?? [];
                $violated = is_array($courseNames)
                    && in_array($candidate['course_name'], $courseNames, true)
                    && $itemSortOrder > 4;
            }
            if ($category === 'consecutive_items') {
                $limit = $this->integerRequirement($requirement, ['max_consecutive_items', 'maximum']) ?? 3;
                foreach ($this->constraintResources($constraint, $candidate) as $resource) {
                    $violated = $violated || $this->consecutiveLoad(
                        $existing,
                        $resource,
                        $weekday,
                        $candidate['week_mask'],
                        $itemSortOrder,
                    ) > $limit;
                }
            }
            if (in_array($category, ['course_distribution', 'spacing'], true)) {
                $limit = $this->integerRequirement($requirement, ['max_same_course_per_day', 'max_per_day']) ?? 1;
                $violated = $violated || $sameDaySessions + 1 > $limit;
                $minimumGap = $this->integerRequirement($requirement, ['min_gap_days', 'minimum_gap_days']);
                if ($minimumGap !== null) {
                    foreach ($existing as $entry) {
                        $violated = $violated || (
                            $entry['assignment_id'] === $candidate['assignment_id']
                            && ($entry['week_mask'] & $candidate['week_mask']) !== 0
                            && abs($entry['weekday'] - $weekday) < $minimumGap
                        );
                    }
                }
            }
            if (in_array($category, ['daily_load', 'workload_balance'], true)) {
                $limit = $this->integerRequirement($requirement, ['max_items_per_day', 'max_per_day']);
                if ($limit !== null) {
                    foreach ($this->constraintResources($constraint, $candidate) as $resource) {
                        $violated = $violated
                            || $this->dailyLoad($existing, $resource, $weekday, $candidate['week_mask']) + 1 > $limit;
                    }
                }
                if ($category === 'workload_balance' && ($requirement['balance_teacher_daily_load'] ?? null) === true) {
                    foreach ($this->constraintResources($constraint, $candidate) as $resource) {
                        $violated = $violated || $this->projectedDailyImbalance(
                            $existing,
                            $resource,
                            $weekday,
                            $candidate['week_mask'],
                        ) > 0;
                    }
                }
            }
            if ($category === 'weekly_load') {
                $limit = $this->integerRequirement($requirement, ['max_items_per_week', 'max_per_week']);
                if ($limit !== null) {
                    foreach ($this->constraintResources($constraint, $candidate) as $resource) {
                        $violated = $violated
                            || $this->weeklyLoad($existing, $resource, $candidate['week_mask']) + 1 > $limit;
                    }
                }
            }
            if ($category === 'teacher_gaps') {
                foreach ($candidate['teacher_ids'] as $teacherId) {
                    $violated = $violated || $this->projectedGap(
                        $existing,
                        "teacher:{$teacherId}",
                        $weekday,
                        $candidate['week_mask'],
                        $itemSortOrder,
                    ) > 0;
                }
            }
            if ($violated) {
                $softWarnings[] = $constraint->name.'将受到影响。';
                $softPenalty += $weight;
            }
        }
        $hardConflicts = collect($hardConflicts)->unique(fn (array $item): string => $item['type'].':'.($item['constraint_id'] ?? '').':'.($item['resource'] ?? '').':'.$item['message'])->values()->all();
        $allowed = $hardConflicts === [];

        return [
            'allowed' => $allowed,
            'summary' => $allowed
                ? ($softWarnings === [] ? '可以移动：班级、教师、教室和启用规则均允许。' : '可以移动，但会降低部分软规则质量。')
                : '不能移动：存在必须先处理的硬冲突。',
            'hard_conflicts' => $hardConflicts,
            'soft_warnings' => array_values(array_unique($softWarnings)),
            'soft_penalty' => round($softPenalty, 2),
            'estimated_quality_delta' => $allowed ? round(-$softPenalty, 2) : 0.0,
        ];
    }

    /**
     * @param  array{assignment_id: int, class_ids: list<int>, grade_ids: list<int>, teaching_group_id: int|null, teacher_ids: list<int>, course_id: int, course_name: string, room_id: int, room_name: string, week_pattern: string, active_weeks: list<int>|null, week_mask: int, resources: list<string>, resource_names: array<string, string>}  $candidate
     */
    private function targetsCandidate(SchedulingConstraint $constraint, array $candidate): bool
    {
        if ($constraint->target_type === null || $constraint->target_id === null) {
            return true;
        }

        return match ($constraint->target_type) {
            ConstraintTargetType::Semester => true,
            ConstraintTargetType::Grade => in_array($constraint->target_id, $candidate['grade_ids'], true),
            ConstraintTargetType::SchoolClass => in_array($constraint->target_id, $candidate['class_ids'], true),
            ConstraintTargetType::Teacher => in_array($constraint->target_id, $candidate['teacher_ids'], true),
            ConstraintTargetType::Course => $constraint->target_id === $candidate['course_id'],
            ConstraintTargetType::Room => $constraint->target_id === $candidate['room_id'],
            ConstraintTargetType::TeachingAssignment => $constraint->target_id === $candidate['assignment_id'],
            ConstraintTargetType::TeachingGroup => $constraint->target_id === $candidate['teaching_group_id'],
        };
    }

    /**
     * @param  array<string, mixed>  $selector
     */
    private function slotMatches(array $selector, int $weekday, int $itemId, int $itemSortOrder): bool
    {
        if (isset($selector['weekdays']) && ! in_array($weekday, array_map('intval', $selector['weekdays']), true)) {
            return false;
        }
        if (isset($selector['item_ids']) && ! in_array($itemId, array_map('intval', $selector['item_ids']), true)) {
            return false;
        }
        if (isset($selector['item_sort_orders']) && ! in_array($itemSortOrder, array_map('intval', $selector['item_sort_orders']), true)) {
            return false;
        }
        if (isset($selector['slots']) && is_array($selector['slots'])) {
            foreach ($selector['slots'] as $slot) {
                if (is_array($slot) && (int) ($slot['weekday'] ?? 0) === $weekday && (int) ($slot['item_id'] ?? 0) === $itemId) {
                    return true;
                }
            }

            return false;
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $requirement
     * @param  list<string>  $keys
     */
    private function integerRequirement(array $requirement, array $keys): ?int
    {
        foreach ($keys as $key) {
            if (isset($requirement[$key]) && is_numeric($requirement[$key])) {
                return (int) $requirement[$key];
            }
        }

        return null;
    }

    /**
     * @param  array{assignment_id: int, class_ids: list<int>, grade_ids: list<int>, teaching_group_id: int|null, teacher_ids: list<int>, course_id: int, course_name: string, room_id: int, room_name: string, week_pattern: string, active_weeks: list<int>|null, week_mask: int, resources: list<string>, resource_names: array<string, string>}  $candidate
     * @return list<string>
     */
    private function constraintResources(SchedulingConstraint $constraint, array $candidate): array
    {
        if ($constraint->target_type === ConstraintTargetType::Teacher && $constraint->target_id !== null) {
            return ["teacher:{$constraint->target_id}"];
        }
        if ($constraint->target_type === ConstraintTargetType::SchoolClass && $constraint->target_id !== null) {
            return ["school_class:{$constraint->target_id}"];
        }
        if ($constraint->target_type === ConstraintTargetType::Room && $constraint->target_id !== null) {
            return ["room:{$constraint->target_id}"];
        }
        if (in_array($constraint->target_type, [ConstraintTargetType::Grade, ConstraintTargetType::TeachingGroup], true)) {
            return array_map(fn (int $classId): string => "school_class:{$classId}", $candidate['class_ids']);
        }

        $requestedTypes = $constraint->requirement['resource_types'] ?? null;
        if (! is_array($requestedTypes)) {
            $singleType = $constraint->requirement['resource_type'] ?? null;
            $requestedTypes = is_string($singleType)
                ? [$singleType]
                : ($constraint->category->value === 'consecutive_items' ? ['teacher'] : ['teacher', 'school_class']);
        }
        $resources = [];
        foreach ($requestedTypes as $type) {
            if ($type === 'teacher') {
                foreach ($candidate['teacher_ids'] as $teacherId) {
                    $resources[] = "teacher:{$teacherId}";
                }
            } elseif ($type === 'school_class') {
                foreach ($candidate['class_ids'] as $classId) {
                    $resources[] = "school_class:{$classId}";
                }
            } elseif ($type === 'room') {
                $resources[] = "room:{$candidate['room_id']}";
            }
        }

        return array_values(array_unique($resources));
    }

    /**
     * @param  list<array{id: int, assignment_id: int, weekday: int, item_id: int, item_sort_order: int, week_pattern: string, active_weeks: list<int>|null, week_mask: int, resources: list<string>}>  $existing
     */
    private function dailyLoad(array $existing, string $resource, int $weekday, int $weekMask): int
    {
        $maximum = 0;
        foreach ($this->weekBits($weekMask) as $weekBit) {
            $maximum = max($maximum, count(array_filter($existing, fn (array $entry): bool => $entry['weekday'] === $weekday && ($entry['week_mask'] & $weekBit) !== 0
                && in_array($resource, $entry['resources'], true))));
        }

        return $maximum;
    }

    /**
     * @param  list<array{id: int, assignment_id: int, weekday: int, item_id: int, item_sort_order: int, week_pattern: string, active_weeks: list<int>|null, week_mask: int, resources: list<string>}>  $existing
     */
    private function weeklyLoad(array $existing, string $resource, int $weekMask): int
    {
        $maximum = 0;
        foreach ($this->weekBits($weekMask) as $weekBit) {
            $maximum = max($maximum, count(array_filter($existing, fn (array $entry): bool => ($entry['week_mask'] & $weekBit) !== 0
                && in_array($resource, $entry['resources'], true))));
        }

        return $maximum;
    }

    /**
     * @param  list<array{id: int, assignment_id: int, weekday: int, item_id: int, item_sort_order: int, week_pattern: string, active_weeks: list<int>|null, week_mask: int, resources: list<string>}>  $existing
     */
    private function consecutiveLoad(
        array $existing,
        string $resource,
        int $weekday,
        int $weekMask,
        int $candidateOrder,
    ): int {
        $maximum = 1;
        foreach ($this->weekBits($weekMask) as $weekBit) {
            $orders = [$candidateOrder];
            foreach ($existing as $entry) {
                if ($entry['weekday'] === $weekday && ($entry['week_mask'] & $weekBit) !== 0
                    && in_array($resource, $entry['resources'], true)) {
                    $orders[] = $entry['item_sort_order'];
                }
            }
            $orders = array_values(array_unique($orders));
            sort($orders);
            $streak = 1;
            for ($index = 1; $index < count($orders); $index++) {
                $streak = $orders[$index] === $orders[$index - 1] + 1 ? $streak + 1 : 1;
                $maximum = max($maximum, $streak);
            }
        }

        return $maximum;
    }

    /**
     * @param  list<array{id: int, assignment_id: int, weekday: int, item_id: int, item_sort_order: int, week_pattern: string, active_weeks: list<int>|null, week_mask: int, resources: list<string>}>  $existing
     */
    private function assignmentDayCount(array $existing, int $assignmentId, int $weekday, int $weekMask): int
    {
        $maximum = 0;
        foreach ($this->weekBits($weekMask) as $weekBit) {
            $maximum = max($maximum, count(array_filter($existing, fn (array $entry): bool => $entry['assignment_id'] === $assignmentId && $entry['weekday'] === $weekday
                && ($entry['week_mask'] & $weekBit) !== 0)));
        }

        return $maximum;
    }

    /**
     * @param  list<array{id: int, assignment_id: int, weekday: int, item_id: int, item_sort_order: int, week_pattern: string, active_weeks: list<int>|null, week_mask: int, resources: list<string>}>  $existing
     */
    private function projectedGap(
        array $existing,
        string $resource,
        int $weekday,
        int $weekMask,
        int $candidateOrder,
    ): int {
        $maximum = 0;
        foreach ($this->weekBits($weekMask) as $weekBit) {
            $orders = [$candidateOrder];
            foreach ($existing as $entry) {
                if ($entry['weekday'] === $weekday && ($entry['week_mask'] & $weekBit) !== 0
                    && in_array($resource, $entry['resources'], true)) {
                    $orders[] = $entry['item_sort_order'];
                }
            }
            $orders = array_values(array_unique($orders));
            sort($orders);
            $maximum = max($maximum, max($orders) - min($orders) + 1 - count($orders));
        }

        return $maximum;
    }

    /**
     * @param  list<array{id: int, assignment_id: int, weekday: int, item_id: int, item_sort_order: int, week_pattern: string, active_weeks: list<int>|null, week_mask: int, resources: list<string>}>  $existing
     */
    private function projectedDailyImbalance(
        array $existing,
        string $resource,
        int $weekday,
        int $weekMask,
    ): int {
        $maximum = 0;
        foreach ($this->weekBits($weekMask) as $weekBit) {
            $dailyLoads = [$weekday => 1];
            foreach ($existing as $entry) {
                if (($entry['week_mask'] & $weekBit) !== 0 && in_array($resource, $entry['resources'], true)) {
                    $dailyLoads[$entry['weekday']] = ($dailyLoads[$entry['weekday']] ?? 0) + 1;
                }
            }
            $loads = array_values($dailyLoads);
            $maximum = max($maximum, max($loads) - min($loads));
        }

        return $maximum;
    }

    /** @return list<int> */
    private function weekBits(int $weekMask): array
    {
        $bits = [];
        for ($weekIndex = 0; $weekIndex < 60; $weekIndex++) {
            $bit = 1 << $weekIndex;
            if (($weekMask & $bit) !== 0) {
                $bits[] = $bit;
            }
        }

        return $bits;
    }

    /** @return list<int> */
    private function relatedAssignmentIds(SchedulingConstraint $constraint, int $assignmentId): array
    {
        $ids = $constraint->requirement['with_assignment_ids'] ?? $constraint->requirement['assignment_ids'] ?? [];
        $ids = is_array($ids) ? array_map('intval', $ids) : [];
        if ($constraint->target_type === ConstraintTargetType::TeachingAssignment && $constraint->target_id !== null) {
            $ids[] = $constraint->target_id;
        }
        $ids = array_values(array_unique($ids));
        if (! in_array($assignmentId, $ids, true)) {
            return [];
        }

        return array_values(array_filter($ids, fn (int $id): bool => $id !== $assignmentId));
    }
}
