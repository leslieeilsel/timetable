<?php

namespace App\Modules\Scheduling\Services;

use App\Enums\AssignmentStatus;
use App\Enums\ConstraintKind;
use App\Enums\ConstraintStatus;
use App\Enums\ConstraintTargetType;
use App\Enums\ResourceStatus;
use App\Enums\ScheduleRunStatus;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Scheduling\Exceptions\SchedulingFailureException;
use App\Modules\Scheduling\Models\ScheduleCandidate;
use App\Modules\Scheduling\Models\ScheduleCandidateEntry;
use App\Modules\Scheduling\Models\ScheduleRun;
use App\Modules\Scheduling\Models\SchedulingConstraint;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Services\RoomResolver;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class AutoScheduler
{
    private const MAX_ATTEMPTS_PER_CANDIDATE = 24;

    public function __construct(
        private readonly PreparationCheckService $preparation,
        private readonly RoomResolver $rooms,
        private readonly WeekPatternService $weekPatterns,
    ) {}

    public function generate(ScheduleRun $run): void
    {
        try {
            $run = ScheduleRun::query()->with('semester')->findOrFail($run->id);
            if ($run->status === ScheduleRunStatus::Cancelled) {
                return;
            }
            $this->updateStage($run, ScheduleRunStatus::Checking, 'checking_input', 5);
            $semester = $run->semester;
            if ($run->input_revision !== (int) $semester->getRawOriginal('input_revision')) {
                throw new SchedulingFailureException('RUN_INPUT_STALE', '排课输入已变化，请重新创建生成任务。', [
                    'run_input_revision' => $run->input_revision,
                    'current_input_revision' => (int) $semester->getRawOriginal('input_revision'),
                ]);
            }
            $preparation = $this->preparation->inspect($semester);
            if (! $preparation['ready']) {
                throw new SchedulingFailureException('PREPARATION_BLOCKED', '准备检查存在阻塞项，无法开始自动排课。', [
                    'checks' => collect($preparation['checks'])->where('status', 'blocking')->values()->all(),
                ]);
            }
            $this->assertNotCancelled($run);
            $this->updateStage($run, ScheduleRunStatus::Solving, 'building_problem', 15);
            $problem = $this->buildProblem($run, $semester);

            $this->updateStage($run, ScheduleRunStatus::Solving, 'searching_feasible_solution', 25);
            $solutions = [];
            $solutionHashes = [];
            for ($rank = 1; $rank <= $run->candidate_count; $rank++) {
                $this->assertNotCancelled($run);
                $solution = null;
                $lastFailure = null;
                for ($attempt = 0; $attempt < self::MAX_ATTEMPTS_PER_CANDIDATE; $attempt++) {
                    $attemptSeed = $run->random_seed + $rank * 1009 + $attempt * 7919;
                    $result = $this->solve($problem, $attemptSeed);
                    if ($result['solution'] === null) {
                        $lastFailure = $result['failure'];

                        continue;
                    }
                    $hash = $this->solutionHash($result['solution']);
                    if (isset($solutionHashes[$hash]) && $attempt < self::MAX_ATTEMPTS_PER_CANDIDATE - 1) {
                        continue;
                    }
                    $solutionHashes[$hash] = true;
                    $solution = $result['solution'];
                    break;
                }
                if ($solution === null) {
                    throw new SchedulingFailureException('NO_FEASIBLE_SOLUTION', '在当前硬约束下未找到完整可行课表。', [
                        'failed_candidate_rank' => $rank,
                        'attempts' => self::MAX_ATTEMPTS_PER_CANDIDATE,
                        'bottleneck' => $lastFailure,
                        'suggestions' => [
                            '检查教师、班级和教室的禁排时间是否过多。',
                            '检查固定安排是否占用了关键稀缺课节。',
                            '减少超载任课关系课时，或增加可排课节。',
                        ],
                    ]);
                }
                $solutions[] = $solution;
                $progress = 25 + (int) floor(($rank / $run->candidate_count) * 55);
                $this->updateStage($run, ScheduleRunStatus::Optimizing, 'optimizing_candidate_'.$rank, $progress);
            }

            $this->assertNotCancelled($run);
            $this->updateStage($run, ScheduleRunStatus::BuildingCandidates, 'building_candidates', 85);
            $rankedSolutions = array_map(fn (array $solution): array => [
                'solution' => $solution,
                'metrics' => $this->score($problem, $solution, $run->strategy),
            ], $solutions);
            usort($rankedSolutions, fn (array $left, array $right): int => $right['metrics']['quality_score'] <=> $left['metrics']['quality_score']
                ?: $this->solutionHash($left['solution']) <=> $this->solutionHash($right['solution']));
            DB::transaction(function () use ($run, $problem, $rankedSolutions): void {
                ScheduleCandidate::query()->where('schedule_run_id', $run->id)->delete();
                foreach ($rankedSolutions as $index => $ranked) {
                    $solution = $ranked['solution'];
                    $metrics = $ranked['metrics'];
                    $candidate = ScheduleCandidate::query()->create([
                        'schedule_run_id' => $run->id,
                        'semester_id' => $run->semester_id,
                        'rank' => $index + 1,
                        'name' => $this->candidateName($index + 1, $run->strategy),
                        'quality_score' => $metrics['quality_score'],
                        'score_breakdown' => $metrics['score_breakdown'],
                        'hard_conflict_count' => 0,
                        'soft_warning_count' => $metrics['soft_warning_count'],
                        'unscheduled_count' => 0,
                        'created_at' => now(),
                    ]);
                    $this->persistCandidateEntries($candidate, $problem, $solution);
                }
            }, 3);
            $run->forceFill([
                'status' => ScheduleRunStatus::Completed,
                'progress_stage' => 'completed',
                'progress_percent' => 100,
                'completed_at' => now(),
                'diagnostics' => [
                    'candidate_count' => count($solutions),
                    'assignment_count' => count($problem['assignments']),
                    'entry_count' => count($problem['units']),
                    'slot_count' => count($problem['slots']),
                ],
            ])->save();
        } catch (SchedulingFailureException $exception) {
            $this->fail($run, $exception->failureCode, $exception->getMessage(), $exception->diagnostics);
        } catch (Throwable $exception) {
            Log::error('Automatic scheduling failed unexpectedly.', [
                'schedule_run_id' => $run->id,
                'exception' => $exception,
            ]);
            $this->fail($run, 'SCHEDULER_INTERNAL_ERROR', '自动排课发生内部错误，请保留任务编号后重试。', [
                'run_id' => $run->id,
            ]);
        }
    }

    /** @return array<string, mixed> */
    private function buildProblem(ScheduleRun $run, Semester $semester): array
    {
        $template = $semester->scheduleTemplate()->with(['days', 'items'])->firstOrFail();
        $enabledWeekdays = $template->days->where('is_enabled', true)->pluck('weekday')->map(fn ($day) => (int) $day)->all();
        $items = $template->items
            ->where('is_active', true)->where('allows_course', true)->where('counts_as_course', true)
            ->sortBy('sort_order')->values();
        $slots = [];
        $slotIndexes = [];
        $slotIndexesByWeekdayAndOrder = [];
        foreach ($enabledWeekdays as $weekday) {
            foreach ($items as $item) {
                $index = count($slots);
                $slots[$index] = [
                    'index' => $index,
                    'weekday' => $weekday,
                    'item_id' => $item->id,
                    'item_sort_order' => $item->sort_order,
                ];
                $slotIndexes[$weekday.':'.$item->id] = $index;
                $slotIndexesByWeekdayAndOrder[$weekday.':'.$item->sort_order] = $index;
            }
        }
        $weekCount = $this->weekPatterns->weekCount($semester);

        $assignments = $semester->teachingAssignments()
            ->where('status', AssignmentStatus::Confirmed->value)
            ->with([
                'semester', 'schoolClass.grade', 'teachingGroup.schoolClasses.grade', 'teacher',
                'collaborators', 'course', 'specifiedRoom',
            ])->orderBy('id')->get();
        $selectedIds = $this->selectedAssignmentIds($run->scope, $assignments);
        $constraints = $semester->schedulingConstraints()
            ->where('status', ConstraintStatus::Active->value)
            ->get();
        $baseVersionId = isset($run->preservation['base_version_id'])
            ? (int) $run->preservation['base_version_id']
            : $semester->current_timetable_version_id;
        $currentEntries = $baseVersionId === null
            ? collect()
            : TimetableEntry::query()
                ->where('timetable_version_id', $baseVersionId)
                ->with(['schoolClasses:id', 'teachers:id'])
                ->get();
        if (($run->scope['type'] ?? 'all') !== 'all' && $currentEntries->isEmpty()) {
            throw new SchedulingFailureException('SCOPE_BASELINE_REQUIRED', '局部生成需要先有当前课表作为保留基线。');
        }

        $units = [];
        $fixedSignatures = [];
        $fixedCounts = [];
        $keepCurrent = (bool) ($run->preservation['keep_current'] ?? false);
        $keepLocked = (bool) ($run->preservation['keep_locked'] ?? true);
        foreach ($currentEntries as $entry) {
            $selected = isset($selectedIds[$entry->teaching_assignment_id]);
            if ($selected && ! $keepCurrent && ! ($keepLocked && $entry->is_locked)) {
                continue;
            }
            $slotIndex = $slotIndexes[$entry->weekday.':'.$entry->item_id] ?? null;
            if ($slotIndex === null) {
                throw new SchedulingFailureException('PRESERVED_ENTRY_SLOT_INVALID', '要保留的课程位于当前作息不允许的课节。', [
                    'entry_id' => $entry->id,
                ]);
            }
            $assignment = $assignments->firstWhere('id', $entry->teaching_assignment_id);
            if (! $assignment instanceof TeachingAssignment) {
                throw new SchedulingFailureException('PRESERVED_ASSIGNMENT_INVALID', '要保留的课程对应任课关系已失效。', [
                    'entry_id' => $entry->id,
                ]);
            }
            $unit = $this->unit($assignment, $entry->actual_room_id, $weekCount);
            $unit['slot_index'] = $slotIndex;
            $unit['fixed_source'] = $entry->is_locked ? 'locked_entry' : 'preserved_entry';
            $signature = $this->unitSignature($unit, $slotIndex);
            $fixedSignatures[$signature] = true;
            $units[] = $unit;
            $fixedCounts[$assignment->id] = ($fixedCounts[$assignment->id] ?? 0) + 1;
        }

        $fixedPlacements = $semester->fixedPlacements()
            ->where('status', ResourceStatus::Active->value)
            ->with(['teachingAssignment.semester', 'teachingAssignment.schoolClass.grade', 'teachingAssignment.teachingGroup.schoolClasses.grade', 'teachingAssignment.teacher', 'teachingAssignment.collaborators', 'teachingAssignment.course'])
            ->orderBy('id')->get();
        foreach ($fixedPlacements as $placement) {
            $slotIndex = $slotIndexes[$placement->weekday.':'.$placement->item_id] ?? null;
            if ($slotIndex === null) {
                throw new SchedulingFailureException('FIXED_SLOT_INVALID', '固定安排位于当前作息不允许的课节。', [
                    'placement_id' => $placement->id,
                ]);
            }
            $unit = $this->unit(
                $placement->teachingAssignment,
                $placement->room_id ?? $this->rooms->resolve($placement->teachingAssignment),
                $weekCount,
            );
            $unit['week_pattern'] = $placement->week_pattern->value;
            $unit['active_weeks'] = $placement->week_pattern->value === 'specified'
                ? $placement->teachingAssignment->active_weeks
                : null;
            $unit['week_mask'] = $this->weekPatterns->maskForWeekCount(
                $placement->week_pattern,
                $placement->teachingAssignment->active_weeks,
                $weekCount,
            );
            $unit['slot_index'] = $slotIndex;
            $unit['fixed_source'] = 'fixed_placement';
            $signature = $this->unitSignature($unit, $slotIndex);
            if (isset($fixedSignatures[$signature])) {
                continue;
            }
            $fixedSignatures[$signature] = true;
            $units[] = $unit;
            $fixedCounts[$placement->teaching_assignment_id] = ($fixedCounts[$placement->teaching_assignment_id] ?? 0) + 1;
        }

        foreach ($assignments as $assignment) {
            $fixedCount = $fixedCounts[$assignment->id] ?? 0;
            if ($fixedCount > $assignment->weekly_items) {
                throw new SchedulingFailureException('TOO_MANY_FIXED_ENTRIES', '固定或保留课程数量超过任课关系每周课时。', [
                    'assignment_id' => $assignment->id,
                    'fixed_count' => $fixedCount,
                    'weekly_items' => $assignment->weekly_items,
                ]);
            }
            $remaining = $assignment->weekly_items - $fixedCount;
            if (! isset($selectedIds[$assignment->id]) && $remaining > 0) {
                throw new SchedulingFailureException('SCOPE_BASELINE_INCOMPLETE', '局部生成范围外的当前课表未排满，无法保持范围外课程不变。', [
                    'assignment_id' => $assignment->id,
                    'remaining' => $remaining,
                ]);
            }
            for ($occurrence = 0; $occurrence < $remaining; $occurrence++) {
                $unit = $this->unit($assignment, $this->rooms->resolve($assignment), $weekCount);
                $unit['occurrence'] = $occurrence + 1;
                $unit['slot_index'] = null;
                $unit['fixed_source'] = null;
                $units[] = $unit;
            }
        }

        $resourceWeeklyLoads = [];
        foreach ($units as $unit) {
            foreach ($unit['resource_keys'] as $resource) {
                foreach ($this->weekIndexes($unit['week_mask'], $weekCount) as $weekIndex) {
                    $resourceWeeklyLoads[$resource][$weekIndex] = ($resourceWeeklyLoads[$resource][$weekIndex] ?? 0) + 1;
                }
            }
        }
        $resourceLoads = array_map(fn (array $loads): int => max($loads), $resourceWeeklyLoads);

        $constraintContext = ['constraints' => $constraints];
        foreach ($units as $unitIndex => $unit) {
            $allowedSlotIndexes = [];
            foreach ($slots as $slotIndex => $slot) {
                if ($this->hardAllowed($constraintContext, $unit, $slot)) {
                    $allowedSlotIndexes[] = $slotIndex;
                }
            }
            $units[$unitIndex]['allowed_slot_indexes'] = $allowedSlotIndexes;
        }
        $blocks = $this->buildBlocks($units, $slots, $slotIndexesByWeekdayAndOrder);
        $this->assertStaticHardLimits($constraints, $units, $resourceLoads);

        return [
            'semester_id' => $semester->id,
            'week_count' => $weekCount,
            'slots' => $slots,
            'slot_indexes' => $slotIndexes,
            'slot_indexes_by_weekday_and_order' => $slotIndexesByWeekdayAndOrder,
            'assignments' => $assignments->keyBy('id')->all(),
            'units' => $units,
            'blocks' => $blocks,
            'constraints' => $constraints,
            'resource_loads' => $resourceLoads,
            'current_entries' => $currentEntries,
        ];
    }

    /**
     * @param  array<string, mixed>  $scope
     * @param  Collection<int, TeachingAssignment>  $assignments
     * @return array<int, true>
     */
    private function selectedAssignmentIds(array $scope, Collection $assignments): array
    {
        $type = $scope['type'] ?? 'all';
        $ids = array_map('intval', $scope['ids'] ?? []);
        $selected = [];
        foreach ($assignments as $assignment) {
            $matches = match ($type) {
                'all' => true,
                'assignment' => in_array($assignment->id, $ids, true),
                'class' => $assignment->school_class_id !== null
                    ? in_array($assignment->school_class_id, $ids, true)
                    : $assignment->teachingGroup?->schoolClasses->pluck('id')->intersect($ids)->isNotEmpty() ?? false,
                'grade' => $assignment->schoolClass !== null
                    ? in_array($assignment->schoolClass->grade_id, $ids, true)
                    : $assignment->teachingGroup?->schoolClasses->pluck('grade_id')->intersect($ids)->isNotEmpty() ?? false,
                default => false,
            };
            if ($matches) {
                $selected[$assignment->id] = true;
            }
        }
        if ($selected === []) {
            throw new SchedulingFailureException('SCOPE_EMPTY', '所选范围没有可参与生成的已确认任课关系。');
        }

        return $selected;
    }

    /** @return array<string, mixed> */
    private function unit(TeachingAssignment $assignment, int $roomId, int $weekCount): array
    {
        $classIds = $assignment->school_class_id !== null
            ? [$assignment->school_class_id]
            : $assignment->teachingGroup?->schoolClasses->pluck('id')->map(fn ($id) => (int) $id)->all() ?? [];
        $gradeIds = $assignment->schoolClass !== null
            ? [$assignment->schoolClass->grade_id]
            : $assignment->teachingGroup?->schoolClasses->pluck('grade_id')->map(fn ($id) => (int) $id)->unique()->values()->all() ?? [];
        $teacherIds = array_values(array_unique([
            $assignment->teacher_id,
            ...$assignment->collaborators->pluck('id')->map(fn ($id) => (int) $id)->all(),
        ]));
        $resources = ["room:{$roomId}"];
        foreach ($classIds as $classId) {
            $resources[] = "school_class:{$classId}";
        }
        foreach ($teacherIds as $teacherId) {
            $resources[] = "teacher:{$teacherId}";
        }
        $weekMask = $this->weekPatterns->maskForWeekCount(
            $assignment->week_pattern,
            $assignment->active_weeks,
            $weekCount,
        );
        if ($weekMask === 0) {
            throw new SchedulingFailureException('WEEK_PATTERN_EMPTY', '任课关系在本学期没有任何生效周。', [
                'assignment_id' => $assignment->id,
            ]);
        }

        return [
            'assignment_id' => $assignment->id,
            'school_class_id' => $assignment->school_class_id,
            'teaching_group_id' => $assignment->teaching_group_id,
            'class_ids' => $classIds,
            'grade_ids' => $gradeIds,
            'teacher_id' => $assignment->teacher_id,
            'teacher_ids' => $teacherIds,
            'course_id' => $assignment->course_id,
            'course_name' => $assignment->course->name,
            'room_id' => $roomId,
            'items_per_session' => $assignment->items_per_session,
            'week_pattern' => $assignment->week_pattern->value,
            'active_weeks' => $assignment->active_weeks,
            'week_mask' => $weekMask,
            'resource_keys' => array_values(array_unique($resources)),
        ];
    }

    /**
     * Build atomic teaching sessions. A two-item session is searched and placed as one block,
     * so the solver can never satisfy a consecutive requirement with two unrelated positions.
     *
     * @param  array<int, array<string, mixed>>  $units
     *
     * @param-out  array<int, array<string, mixed>>  $units
     *
     * @param  array<int, array<string, mixed>>  $slots
     * @param  array<string, int>  $slotIndexesByWeekdayAndOrder
     * @return array<int, array<string, mixed>>
     */
    private function buildBlocks(array &$units, array $slots, array $slotIndexesByWeekdayAndOrder): array
    {
        $blocks = [];
        $fixedGroups = [];
        $unassignedGroups = [];
        foreach ($units as $unitIndex => $unit) {
            if ($unit['slot_index'] === null) {
                $unassignedGroups[$unit['assignment_id']][] = $unitIndex;

                continue;
            }
            $slot = $slots[$unit['slot_index']];
            $key = implode(':', [$unit['assignment_id'], $unit['week_mask'], $slot['weekday']]);
            $fixedGroups[$key][] = $unitIndex;
        }

        foreach ($fixedGroups as $unitIndexes) {
            usort($unitIndexes, fn (int $left, int $right): int => $slots[$units[$left]['slot_index']]['item_sort_order'] <=> $slots[$units[$right]['slot_index']]['item_sort_order']);
            $chunk = [];
            $previousOrder = null;
            foreach ($unitIndexes as $unitIndex) {
                $order = $slots[$units[$unitIndex]['slot_index']]['item_sort_order'];
                $preferredSize = max(1, (int) $units[$unitIndex]['items_per_session']);
                if ($chunk !== [] && ($order !== $previousOrder + 1 || count($chunk) >= $preferredSize)) {
                    $this->appendBlock($blocks, $units, $slots, $slotIndexesByWeekdayAndOrder, $chunk, true);
                    $chunk = [];
                }
                $chunk[] = $unitIndex;
                $previousOrder = $order;
            }
            $this->appendBlock($blocks, $units, $slots, $slotIndexesByWeekdayAndOrder, $chunk, true);
        }

        foreach ($unassignedGroups as $unitIndexes) {
            $preferredSize = max(1, (int) $units[$unitIndexes[0]]['items_per_session']);
            foreach (array_chunk($unitIndexes, $preferredSize) as $chunk) {
                $this->appendBlock($blocks, $units, $slots, $slotIndexesByWeekdayAndOrder, $chunk, false);
            }
        }

        return $blocks;
    }

    /**
     * @param  array<int, array<string, mixed>>  $blocks
     *
     * @param-out  array<int, array<string, mixed>>  $blocks
     *
     * @param  array<int, array<string, mixed>>  $units
     *
     * @param-out  array<int, array<string, mixed>>  $units
     *
     * @param  array<int, array<string, mixed>>  $slots
     * @param  array<string, int>  $slotIndexesByWeekdayAndOrder
     * @param  list<int>  $unitIndexes
     */
    private function appendBlock(
        array &$blocks,
        array &$units,
        array $slots,
        array $slotIndexesByWeekdayAndOrder,
        array $unitIndexes,
        bool $fixed,
    ): void {
        $blockIndex = count($blocks);
        $candidateSlotIndexes = [];
        if ($fixed) {
            $candidateSlotIndexes[] = array_map(fn (int $unitIndex): int => (int) $units[$unitIndex]['slot_index'], $unitIndexes);
        } else {
            $firstUnit = $units[$unitIndexes[0]];
            foreach ($firstUnit['allowed_slot_indexes'] as $startSlotIndex) {
                $start = $slots[$startSlotIndex];
                $placement = [];
                foreach ($unitIndexes as $position => $unitIndex) {
                    $slotIndex = $slotIndexesByWeekdayAndOrder[$start['weekday'].':'.($start['item_sort_order'] + $position)] ?? null;
                    if ($slotIndex === null || ! in_array($slotIndex, $units[$unitIndex]['allowed_slot_indexes'], true)) {
                        $placement = [];
                        break;
                    }
                    $placement[] = $slotIndex;
                }
                if ($placement !== []) {
                    $candidateSlotIndexes[] = $placement;
                }
            }
        }
        if ($candidateSlotIndexes === []) {
            $unit = $units[$unitIndexes[0]];
            throw new SchedulingFailureException('CONSECUTIVE_CAPACITY_INSUFFICIENT', '连排课程没有可用的连续课节。', [
                'assignment_id' => $unit['assignment_id'],
                'course' => $unit['course_name'],
                'required_consecutive_items' => count($unitIndexes),
            ]);
        }
        foreach ($unitIndexes as $position => $unitIndex) {
            $units[$unitIndex]['block_id'] = $blockIndex;
            $units[$unitIndex]['block_position'] = $position;
            $units[$unitIndex]['block_size'] = count($unitIndexes);
        }
        $blocks[] = [
            'id' => $blockIndex,
            'assignment_id' => $units[$unitIndexes[0]]['assignment_id'],
            'unit_indexes' => $unitIndexes,
            'size' => count($unitIndexes),
            'fixed' => $fixed,
            'candidate_slot_indexes' => $candidateSlotIndexes,
        ];
    }

    /**
     * @param  Collection<int, SchedulingConstraint>  $constraints
     * @param  array<int, array<string, mixed>>  $units
     * @param  array<string, int>  $resourceLoads
     */
    private function assertStaticHardLimits(Collection $constraints, array $units, array $resourceLoads): void
    {
        foreach ($constraints as $constraint) {
            if ($constraint->kind !== ConstraintKind::Hard || $constraint->category->value !== 'weekly_load') {
                continue;
            }
            $limit = $this->integerRequirement($constraint->requirement, ['max_items_per_week', 'max_per_week']);
            if ($limit === null) {
                continue;
            }
            $sample = collect($units)->first(fn (array $unit): bool => $this->constraintTargetsUnit($constraint, $unit));
            if (! is_array($sample)) {
                continue;
            }
            foreach ($this->constraintResourceKeys($constraint, $sample) as $resource) {
                if (($resourceLoads[$resource] ?? 0) > $limit) {
                    throw new SchedulingFailureException('WEEKLY_LOAD_LIMIT_EXCEEDED', '周课时硬上限低于已确认任课关系的实际课时。', [
                        'constraint_id' => $constraint->id,
                        'constraint_name' => $constraint->name,
                        'resource' => $resource,
                        'required_items' => $resourceLoads[$resource],
                        'maximum_items' => $limit,
                    ]);
                }
            }
        }
    }

    /**
     * @param  array<string, mixed>  $problem
     * @return array{solution: array<int, int>|null, failure: array<string, mixed>|null}
     */
    private function solve(array $problem, int $seed): array
    {
        $occupancy = [];
        $dailyLoads = [];
        $assignmentSessions = [];
        $assignmentOccupancy = [];
        $assignmentBlockPlacements = [];
        $solution = [];
        $unassignedBlocks = [];
        foreach ($problem['blocks'] as $blockIndex => $block) {
            if (! $block['fixed']) {
                $unassignedBlocks[$blockIndex] = true;

                continue;
            }
            $slotIndexes = $block['candidate_slot_indexes'][0] ?? [];
            $violation = $this->blockHardViolation(
                $problem,
                $block,
                $slotIndexes,
                $occupancy,
                $dailyLoads,
                $assignmentSessions,
                $assignmentOccupancy,
                $assignmentBlockPlacements,
            );
            if ($violation !== null) {
                $unit = $problem['units'][$block['unit_indexes'][0]];

                return ['solution' => null, 'failure' => [
                    'assignment_id' => $unit['assignment_id'],
                    'fixed_source' => $unit['fixed_source'],
                    ...$violation,
                ]];
            }
            $this->placeBlock(
                $problem,
                $block,
                $slotIndexes,
                $solution,
                $occupancy,
                $dailyLoads,
                $assignmentSessions,
                $assignmentOccupancy,
                $assignmentBlockPlacements,
            );
        }

        $priorities = [];
        foreach (array_keys($unassignedBlocks) as $blockIndex) {
            $block = $problem['blocks'][$blockIndex];
            $unit = $problem['units'][$block['unit_indexes'][0]];
            $resourceLoads = array_map(fn ($resource) => $problem['resource_loads'][$resource] ?? 0, $unit['resource_keys']);
            $priorities[$blockIndex] = [
                'allowed_count' => count($block['candidate_slot_indexes']),
                'block_size' => $block['size'],
                'maximum_resource_load' => max($resourceLoads),
                'total_resource_load' => array_sum($resourceLoads),
                'noise' => $this->stableNoise($seed, $blockIndex),
            ];
        }
        $orderedBlockIndexes = array_keys($unassignedBlocks);
        usort($orderedBlockIndexes, function (int $left, int $right) use ($priorities): int {
            $leftPriority = $priorities[$left];
            $rightPriority = $priorities[$right];

            return $leftPriority['allowed_count'] <=> $rightPriority['allowed_count']
                ?: $rightPriority['block_size'] <=> $leftPriority['block_size']
                ?: $rightPriority['maximum_resource_load'] <=> $leftPriority['maximum_resource_load']
                ?: $rightPriority['total_resource_load'] <=> $leftPriority['total_resource_load']
                ?: $leftPriority['noise'] <=> $rightPriority['noise'];
        });
        $orderedBlockIndexes = $this->orderSynchronizedBlocks($problem, $orderedBlockIndexes);

        foreach ($orderedBlockIndexes as $iteration => $blockIndex) {
            $block = $problem['blocks'][$blockIndex];
            $unit = $problem['units'][$block['unit_indexes'][0]];
            $feasible = [];
            $violationCounts = [];
            foreach ($block['candidate_slot_indexes'] as $slotIndexes) {
                $violation = $this->blockHardViolation(
                    $problem,
                    $block,
                    $slotIndexes,
                    $occupancy,
                    $dailyLoads,
                    $assignmentSessions,
                    $assignmentOccupancy,
                    $assignmentBlockPlacements,
                );
                if ($violation === null) {
                    $feasible[] = $slotIndexes;

                    continue;
                }
                $reason = (string) ($violation['reason'] ?? '硬约束不允许');
                $violationCounts[$reason] = ($violationCounts[$reason] ?? 0) + 1;
            }
            if ($feasible === []) {
                arsort($violationCounts);

                return ['solution' => null, 'failure' => [
                    'assignment_id' => $unit['assignment_id'],
                    'course' => $unit['course_name'],
                    'resources' => $unit['resource_keys'],
                    'session_items' => $block['size'],
                    'candidate_position_count' => count($block['candidate_slot_indexes']),
                    'blocked_reason_counts' => $violationCounts,
                    'reason' => array_key_first($violationCounts) ?? '没有满足全部硬约束的连续课节',
                ]];
            }
            usort($feasible, function (array $left, array $right) use ($problem, $block, $dailyLoads, $assignmentSessions, $occupancy, $seed, $blockIndex, $iteration): int {
                $leftScore = $this->blockSoftPenalty($problem, $block, $left, $dailyLoads, $assignmentSessions, $occupancy)
                    + ($this->stableNoise($seed, $blockIndex, $left[0], $iteration) % 1000) / 10000;
                $rightScore = $this->blockSoftPenalty($problem, $block, $right, $dailyLoads, $assignmentSessions, $occupancy)
                    + ($this->stableNoise($seed, $blockIndex, $right[0], $iteration) % 1000) / 10000;

                return $leftScore <=> $rightScore;
            });
            $choicePool = min(3, count($feasible));
            $choice = $this->stableNoise($seed, $blockIndex, $iteration, 97) % $choicePool;
            $slotIndexes = $feasible[$choice];
            $this->placeBlock(
                $problem,
                $block,
                $slotIndexes,
                $solution,
                $occupancy,
                $dailyLoads,
                $assignmentSessions,
                $assignmentOccupancy,
                $assignmentBlockPlacements,
            );
        }
        $relationalViolation = $this->relationalHardViolation($problem, $assignmentBlockPlacements);
        if ($relationalViolation !== null) {
            return ['solution' => null, 'failure' => $relationalViolation];
        }
        ksort($solution);

        return ['solution' => $solution, 'failure' => null];
    }

    /**
     * @param  array<string, mixed>  $problem
     * @param  array<string, mixed>  $unit
     * @param  array<string, mixed>  $slot
     */
    private function hardAllowed(array $problem, array $unit, array $slot): bool
    {
        foreach ($problem['constraints'] as $constraint) {
            if (! $constraint instanceof SchedulingConstraint || $constraint->kind !== ConstraintKind::Hard
                || ! $this->constraintTargetsUnit($constraint, $unit)) {
                continue;
            }
            $scope = $constraint->scope;
            $requirement = $constraint->requirement;
            $slotMatches = $this->slotMatches($scope, $slot) && $this->slotMatches($constraint->condition ?? [], $slot);
            if (in_array($constraint->category->value, ['availability', 'forbidden_slot'], true)) {
                if (($requirement['available'] ?? null) === false && $slotMatches) {
                    return false;
                }
                if (($requirement['allowed_only'] ?? false) === true && ! $slotMatches) {
                    return false;
                }
            }
        }

        return true;
    }

    /** @param array<string, mixed> $unit */
    private function constraintTargetsUnit(SchedulingConstraint $constraint, array $unit): bool
    {
        if ($constraint->target_type === null || $constraint->target_id === null) {
            return true;
        }

        return match ($constraint->target_type) {
            ConstraintTargetType::Semester => true,
            ConstraintTargetType::Grade => in_array($constraint->target_id, $unit['grade_ids'], true),
            ConstraintTargetType::SchoolClass => in_array($constraint->target_id, $unit['class_ids'], true),
            ConstraintTargetType::Teacher => in_array($constraint->target_id, $unit['teacher_ids'], true),
            ConstraintTargetType::Course => $constraint->target_id === $unit['course_id'],
            ConstraintTargetType::Room => $constraint->target_id === $unit['room_id'],
            ConstraintTargetType::TeachingAssignment => $constraint->target_id === $unit['assignment_id'],
            ConstraintTargetType::TeachingGroup => $constraint->target_id === $unit['teaching_group_id'],
        };
    }

    /**
     * @param  array<string, mixed>  $selector
     * @param  array<string, mixed>  $slot
     */
    private function slotMatches(array $selector, array $slot): bool
    {
        if (isset($selector['weekdays']) && ! in_array($slot['weekday'], array_map('intval', $selector['weekdays']), true)) {
            return false;
        }
        if (isset($selector['item_ids']) && ! in_array($slot['item_id'], array_map('intval', $selector['item_ids']), true)) {
            return false;
        }
        if (isset($selector['item_sort_orders']) && ! in_array($slot['item_sort_order'], array_map('intval', $selector['item_sort_orders']), true)) {
            return false;
        }
        if (isset($selector['slots'])) {
            foreach ($selector['slots'] as $selectedSlot) {
                if ((int) ($selectedSlot['weekday'] ?? 0) === $slot['weekday']
                    && (int) ($selectedSlot['item_id'] ?? 0) === $slot['item_id']) {
                    return true;
                }
            }

            return false;
        }

        return true;
    }

    /**
     * @param  array<string, array<int, int>>  $occupancy
     * @param  list<string>  $resources
     */
    private function resourcesOccupied(array $occupancy, array $resources, int $slotIndex, int $weekMask): bool
    {
        foreach ($resources as $resource) {
            if ((($occupancy[$resource][$slotIndex] ?? 0) & $weekMask) !== 0) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $problem
     * @param  array<string, mixed>  $block
     * @param  list<int>  $slotIndexes
     * @param  array<string, array<int, int>>  $occupancy
     * @param  array<string, array<int, array<int, int>>>  $dailyLoads
     * @param  array<int, array<int, array<int, int>>>  $assignmentSessions
     * @param  array<int, array<int, int>>  $assignmentOccupancy
     * @param  array<int, list<array{slot_indexes: list<int>, week_mask: int}>>  $assignmentBlockPlacements
     * @return array<string, mixed>|null
     */
    private function blockHardViolation(
        array $problem,
        array $block,
        array $slotIndexes,
        array $occupancy,
        array $dailyLoads,
        array $assignmentSessions,
        array $assignmentOccupancy,
        array $assignmentBlockPlacements,
    ): ?array {
        if (count($slotIndexes) !== count($block['unit_indexes'])) {
            return ['reason' => '连排课程的课节数量不完整'];
        }
        $unit = $problem['units'][$block['unit_indexes'][0]];
        $weekday = $problem['slots'][$slotIndexes[0]]['weekday'];
        foreach ($block['unit_indexes'] as $position => $unitIndex) {
            $member = $problem['units'][$unitIndex];
            $slotIndex = $slotIndexes[$position];
            if ($problem['slots'][$slotIndex]['weekday'] !== $weekday
                || ! in_array($slotIndex, $member['allowed_slot_indexes'], true)) {
                return ['reason' => '连排课程跨越了不可排课节'];
            }
            if ($this->resourcesOccupied($occupancy, $member['resource_keys'], $slotIndex, $member['week_mask'])) {
                return ['reason' => '班级、教师或教室在候选课节已被占用'];
            }
        }

        foreach ($problem['constraints'] as $constraint) {
            if (! $constraint instanceof SchedulingConstraint || $constraint->kind !== ConstraintKind::Hard
                || ! $this->constraintTargetsUnit($constraint, $unit)) {
                continue;
            }
            $requirement = $constraint->requirement;
            $category = $constraint->category->value;
            if (in_array($category, ['daily_load', 'workload_balance'], true)) {
                $limit = $this->integerRequirement($requirement, ['max_items_per_day', 'max_per_day']);
                if ($limit !== null) {
                    foreach ($this->constraintResourceKeys($constraint, $unit) as $resource) {
                        foreach ($this->weekIndexes($unit['week_mask'], $problem['week_count']) as $weekIndex) {
                            $current = $dailyLoads[$resource][$weekday][$weekIndex] ?? 0;
                            if ($current + count($slotIndexes) > $limit) {
                                return [
                                    'constraint_id' => $constraint->id,
                                    'constraint_name' => $constraint->name,
                                    'resource' => $resource,
                                    'weekday' => $weekday,
                                    'maximum_items' => $limit,
                                    'reason' => "{$constraint->name}：单日最多 {$limit} 节",
                                ];
                            }
                        }
                    }
                }
            }
            if ($category === 'consecutive_items') {
                $limit = $this->integerRequirement($requirement, ['max_consecutive_items', 'maximum']);
                if ($limit !== null) {
                    foreach ($this->constraintResourceKeys($constraint, $unit) as $resource) {
                        $streak = $this->projectedMaximumConsecutive(
                            $problem,
                            $occupancy,
                            $resource,
                            $weekday,
                            $unit['week_mask'],
                            $slotIndexes,
                        );
                        if ($streak > $limit) {
                            return [
                                'constraint_id' => $constraint->id,
                                'constraint_name' => $constraint->name,
                                'resource' => $resource,
                                'maximum_consecutive_items' => $limit,
                                'projected_consecutive_items' => $streak,
                                'reason' => "{$constraint->name}：连续授课将达到 {$streak} 节",
                            ];
                        }
                    }
                }
            }
            if (in_array($category, ['course_distribution', 'spacing'], true)) {
                $maxPerDay = $this->integerRequirement($requirement, ['max_same_course_per_day', 'max_per_day']);
                $minGap = $this->integerRequirement($requirement, ['min_gap_days', 'minimum_gap_days']);
                foreach ($this->weekIndexes($unit['week_mask'], $problem['week_count']) as $weekIndex) {
                    $current = $assignmentSessions[$unit['assignment_id']][$weekday][$weekIndex] ?? 0;
                    if ($maxPerDay !== null && $current + 1 > $maxPerDay) {
                        return [
                            'constraint_id' => $constraint->id,
                            'constraint_name' => $constraint->name,
                            'weekday' => $weekday,
                            'maximum_sessions' => $maxPerDay,
                            'reason' => "{$constraint->name}：同一课程当天最多安排 {$maxPerDay} 次",
                        ];
                    }
                    if ($minGap !== null) {
                        foreach ($assignmentSessions[$unit['assignment_id']] ?? [] as $scheduledWeekday => $weekLoads) {
                            if (($weekLoads[$weekIndex] ?? 0) > 0 && abs($scheduledWeekday - $weekday) < $minGap) {
                                return [
                                    'constraint_id' => $constraint->id,
                                    'constraint_name' => $constraint->name,
                                    'minimum_gap_days' => $minGap,
                                    'reason' => "{$constraint->name}：与已有课程至少间隔 {$minGap} 天",
                                ];
                            }
                        }
                    }
                }
            }
            if ($category === 'mutual_exclusion') {
                $mode = (string) ($requirement['mode'] ?? 'same_slot');
                foreach ($this->relatedAssignmentIds($constraint, $unit) as $relatedId) {
                    if ($mode === 'same_day') {
                        foreach ($this->weekIndexes($unit['week_mask'], $problem['week_count']) as $weekIndex) {
                            if (($assignmentSessions[$relatedId][$weekday][$weekIndex] ?? 0) > 0) {
                                return [
                                    'constraint_id' => $constraint->id,
                                    'constraint_name' => $constraint->name,
                                    'related_assignment_id' => $relatedId,
                                    'reason' => "{$constraint->name}：互斥课程不能安排在同一天",
                                ];
                            }
                        }
                    } else {
                        foreach ($slotIndexes as $slotIndex) {
                            if ((($assignmentOccupancy[$relatedId][$slotIndex] ?? 0) & $unit['week_mask']) !== 0) {
                                return [
                                    'constraint_id' => $constraint->id,
                                    'constraint_name' => $constraint->name,
                                    'related_assignment_id' => $relatedId,
                                    'reason' => "{$constraint->name}：互斥课程不能安排在同一课节",
                                ];
                            }
                        }
                    }
                }
            }
            if ($category === 'synchronization') {
                foreach ($this->relatedAssignmentIds($constraint, $unit) as $relatedId) {
                    $relatedPlacements = $assignmentBlockPlacements[$relatedId] ?? [];
                    if ($relatedPlacements !== [] && ! collect($relatedPlacements)->contains(
                        fn (array $placement): bool => $placement['slot_indexes'] === $slotIndexes,
                    )) {
                        return [
                            'constraint_id' => $constraint->id,
                            'constraint_name' => $constraint->name,
                            'related_assignment_id' => $relatedId,
                            'reason' => "{$constraint->name}：同步课程必须占用相同课节",
                        ];
                    }
                }
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $problem
     * @param  array<string, mixed>  $block
     * @param  list<int>  $slotIndexes
     * @param  array<string, array<int, array<int, int>>>  $dailyLoads
     * @param  array<int, array<int, array<int, int>>>  $assignmentSessions
     * @param  array<string, array<int, int>>  $occupancy
     */
    private function blockSoftPenalty(
        array $problem,
        array $block,
        array $slotIndexes,
        array $dailyLoads,
        array $assignmentSessions,
        array $occupancy,
    ): float {
        $unit = $problem['units'][$block['unit_indexes'][0]];
        $weekday = $problem['slots'][$slotIndexes[0]]['weekday'];
        $weekIndexes = $this->weekIndexes($unit['week_mask'], $problem['week_count']);
        $existingSessions = 0;
        foreach ($weekIndexes as $weekIndex) {
            $existingSessions = max($existingSessions, $assignmentSessions[$unit['assignment_id']][$weekday][$weekIndex] ?? 0);
        }
        $penalty = $existingSessions * 35.0;
        foreach ($unit['class_ids'] as $classId) {
            $load = $this->maximumDailyLoad($dailyLoads, "school_class:{$classId}", $weekday, $weekIndexes);
            $penalty += ($load + count($slotIndexes)) ** 2 * 1.4;
        }
        foreach ($unit['teacher_ids'] as $teacherId) {
            $load = $this->maximumDailyLoad($dailyLoads, "teacher:{$teacherId}", $weekday, $weekIndexes);
            $penalty += ($load + count($slotIndexes)) ** 2 * 0.8;
        }
        if (in_array($unit['course_name'], ['语文', '数学', '英语'], true)) {
            foreach ($slotIndexes as $slotIndex) {
                $penalty += max(0, $problem['slots'][$slotIndex]['item_sort_order'] - 4) * 2.5;
            }
        }
        foreach ($problem['constraints'] as $constraint) {
            if (! $constraint instanceof SchedulingConstraint || $constraint->kind !== ConstraintKind::Soft
                || ! $this->constraintTargetsUnit($constraint, $unit)) {
                continue;
            }
            $weight = ($constraint->weight ?? 50) / 10;
            $requirement = $constraint->requirement;
            $category = $constraint->category->value;
            $preference = $requirement['preference'] ?? null;
            if ($preference !== null) {
                foreach ($slotIndexes as $slotIndex) {
                    $slot = $problem['slots'][$slotIndex];
                    $matches = $this->slotMatches($constraint->scope, $slot)
                        && $this->slotMatches($constraint->condition ?? [], $slot);
                    if (($preference === 'avoid' && $matches) || ($preference === 'prefer' && ! $matches)) {
                        $penalty += $weight;
                    }
                }
            }
            if (in_array($category, ['course_distribution', 'spacing'], true)) {
                $maxPerDay = $this->integerRequirement($requirement, ['max_same_course_per_day', 'max_per_day', 'max_per_day']);
                $projected = $existingSessions + 1;
                $penalty += $existingSessions * $weight;
                if ($maxPerDay !== null && $projected > $maxPerDay) {
                    $penalty += ($projected - $maxPerDay) * $weight * 3;
                }
                $minGap = $this->integerRequirement($requirement, ['min_gap_days', 'minimum_gap_days']);
                if ($minGap !== null) {
                    foreach ($assignmentSessions[$unit['assignment_id']] ?? [] as $scheduledWeekday => $loads) {
                        if (abs($scheduledWeekday - $weekday) < $minGap && array_sum($loads) > 0) {
                            $penalty += $weight * 2;
                        }
                    }
                }
            }
            if (in_array($category, ['daily_load', 'workload_balance'], true)) {
                $limit = $this->integerRequirement($requirement, ['max_items_per_day', 'max_per_day']);
                foreach ($this->constraintResourceKeys($constraint, $unit) as $resource) {
                    $projected = $this->maximumDailyLoad($dailyLoads, $resource, $weekday, $weekIndexes) + count($slotIndexes);
                    if ($limit !== null && $projected > $limit) {
                        $penalty += ($projected - $limit) * $weight * 3;
                    } else {
                        $penalty += $projected * $projected * $weight / 20;
                    }
                }
            }
            if ($category === 'consecutive_items') {
                $limit = $this->integerRequirement($requirement, ['max_consecutive_items', 'maximum']) ?? 3;
                foreach ($this->constraintResourceKeys($constraint, $unit) as $resource) {
                    $streak = $this->projectedMaximumConsecutive(
                        $problem,
                        $occupancy,
                        $resource,
                        $weekday,
                        $unit['week_mask'],
                        $slotIndexes,
                    );
                    $penalty += max(0, $streak - $limit) * $weight * 2;
                }
            }
            if ($category === 'teacher_gaps') {
                foreach ($unit['teacher_ids'] as $teacherId) {
                    $penalty += $this->projectedGap(
                        $problem,
                        $occupancy,
                        "teacher:{$teacherId}",
                        $weekday,
                        $unit['week_mask'],
                        $slotIndexes,
                    ) * $weight;
                }
            }
        }

        return $penalty;
    }

    /**
     * @param  array<string, mixed>  $problem
     * @param  array<string, mixed>  $block
     * @param  list<int>  $slotIndexes
     * @param  array<int, int>  $solution
     * @param  array<string, array<int, int>>  $occupancy
     * @param  array<string, array<int, array<int, int>>>  $dailyLoads
     * @param  array<int, array<int, array<int, int>>>  $assignmentSessions
     * @param  array<int, array<int, int>>  $assignmentOccupancy
     * @param  array<int, list<array{slot_indexes: list<int>, week_mask: int}>>  $assignmentBlockPlacements
     */
    private function placeBlock(
        array $problem,
        array $block,
        array $slotIndexes,
        array &$solution,
        array &$occupancy,
        array &$dailyLoads,
        array &$assignmentSessions,
        array &$assignmentOccupancy,
        array &$assignmentBlockPlacements,
    ): void {
        $firstUnit = $problem['units'][$block['unit_indexes'][0]];
        $firstAssignmentId = (int) $firstUnit['assignment_id'];
        $firstWeekMask = (int) $firstUnit['week_mask'];
        $weekday = (int) $problem['slots'][$slotIndexes[0]]['weekday'];
        foreach ($block['unit_indexes'] as $position => $rawUnitIndex) {
            $unitIndex = (int) $rawUnitIndex;
            $unit = $problem['units'][$unitIndex];
            $assignmentId = (int) $unit['assignment_id'];
            $weekMask = (int) $unit['week_mask'];
            $slotIndex = (int) $slotIndexes[$position];
            $solution[$unitIndex] = $slotIndex;
            foreach ($unit['resource_keys'] as $rawResource) {
                $resource = (string) $rawResource;
                $occupancy[$resource][$slotIndex] = ($occupancy[$resource][$slotIndex] ?? 0) | $weekMask;
                foreach ($this->weekIndexes($weekMask, (int) $problem['week_count']) as $weekIndex) {
                    $dailyLoads[$resource][$weekday][$weekIndex] = ($dailyLoads[$resource][$weekday][$weekIndex] ?? 0) + 1;
                }
            }
            $assignmentOccupancy[$assignmentId][$slotIndex] =
                ($assignmentOccupancy[$assignmentId][$slotIndex] ?? 0) | $weekMask;
        }
        foreach ($this->weekIndexes($firstWeekMask, (int) $problem['week_count']) as $weekIndex) {
            $assignmentSessions[$firstAssignmentId][$weekday][$weekIndex] =
                ($assignmentSessions[$firstAssignmentId][$weekday][$weekIndex] ?? 0) + 1;
        }
        $assignmentBlockPlacements[$firstAssignmentId][] = [
            'slot_indexes' => $slotIndexes,
            'week_mask' => $firstWeekMask,
        ];
    }

    /**
     * @param  array<string, mixed>  $problem
     * @param  array<int, list<array{slot_indexes: list<int>, week_mask: int}>>  $assignmentBlockPlacements
     * @return array<string, mixed>|null
     */
    private function relationalHardViolation(array $problem, array $assignmentBlockPlacements): ?array
    {
        foreach ($problem['constraints'] as $constraint) {
            if (! $constraint instanceof SchedulingConstraint || $constraint->kind !== ConstraintKind::Hard
                || $constraint->category->value !== 'synchronization') {
                continue;
            }
            $ids = $this->constraintAssignmentIds($constraint);
            if (count($ids) < 2) {
                continue;
            }
            $baseline = null;
            foreach ($ids as $assignmentId) {
                $signatures = array_map(
                    fn (array $placement): string => implode(',', $placement['slot_indexes']).':'.$placement['week_mask'],
                    $assignmentBlockPlacements[$assignmentId] ?? [],
                );
                sort($signatures);
                if ($baseline === null) {
                    $baseline = $signatures;
                } elseif ($baseline !== $signatures) {
                    return [
                        'constraint_id' => $constraint->id,
                        'constraint_name' => $constraint->name,
                        'assignment_ids' => $ids,
                        'reason' => "{$constraint->name}：同步任课关系的课时数、周型或位置不一致",
                    ];
                }
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $unit
     * @return list<string>
     */
    private function constraintResourceKeys(SchedulingConstraint $constraint, array $unit): array
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
            return array_map(fn (int $classId): string => "school_class:{$classId}", $unit['class_ids']);
        }

        $requestedTypes = $constraint->requirement['resource_types'] ?? null;
        if (! is_array($requestedTypes)) {
            $singleType = $constraint->requirement['resource_type'] ?? null;
            $requestedTypes = is_string($singleType)
                ? [$singleType]
                : ($constraint->category->value === 'consecutive_items' ? ['teacher'] : ['teacher', 'school_class']);
        }
        $keys = [];
        foreach ($requestedTypes as $type) {
            if ($type === 'teacher') {
                foreach ($unit['teacher_ids'] as $teacherId) {
                    $keys[] = "teacher:{$teacherId}";
                }
            } elseif (in_array($type, ['class', 'school_class'], true)) {
                foreach ($unit['class_ids'] as $classId) {
                    $keys[] = "school_class:{$classId}";
                }
            } elseif ($type === 'room') {
                $keys[] = "room:{$unit['room_id']}";
            }
        }

        return array_values(array_unique($keys));
    }

    /**
     * @param  array<string, mixed>  $requirement
     * @param  list<string>  $keys
     */
    private function integerRequirement(array $requirement, array $keys): ?int
    {
        foreach ($keys as $key) {
            if (isset($requirement[$key]) && is_numeric($requirement[$key])) {
                return max(0, (int) $requirement[$key]);
            }
        }

        return null;
    }

    /** @return list<int> */
    private function weekIndexes(int $weekMask, int $weekCount): array
    {
        $indexes = [];
        for ($weekIndex = 0; $weekIndex < $weekCount; $weekIndex++) {
            if (($weekMask & (1 << $weekIndex)) !== 0) {
                $indexes[] = $weekIndex;
            }
        }

        return $indexes;
    }

    /**
     * @param  array<string, array<int, array<int, int>>>  $dailyLoads
     * @param  list<int>  $weekIndexes
     */
    private function maximumDailyLoad(array $dailyLoads, string $resource, int $weekday, array $weekIndexes): int
    {
        $maximum = 0;
        foreach ($weekIndexes as $weekIndex) {
            $maximum = max($maximum, $dailyLoads[$resource][$weekday][$weekIndex] ?? 0);
        }

        return $maximum;
    }

    /**
     * @param  array<string, mixed>  $problem
     * @param  array<string, array<int, int>>  $occupancy
     * @param  list<int>  $candidateSlotIndexes
     */
    private function projectedMaximumConsecutive(
        array $problem,
        array $occupancy,
        string $resource,
        int $weekday,
        int $weekMask,
        array $candidateSlotIndexes,
    ): int {
        $maximum = 0;
        foreach ($this->weekIndexes($weekMask, $problem['week_count']) as $weekIndex) {
            $weekBit = 1 << $weekIndex;
            $orders = [];
            foreach ($occupancy[$resource] ?? [] as $slotIndex => $occupiedMask) {
                $slot = $problem['slots'][$slotIndex];
                if ($slot['weekday'] === $weekday && ($occupiedMask & $weekBit) !== 0) {
                    $orders[] = $slot['item_sort_order'];
                }
            }
            foreach ($candidateSlotIndexes as $slotIndex) {
                $orders[] = $problem['slots'][$slotIndex]['item_sort_order'];
            }
            $orders = array_values(array_unique($orders));
            sort($orders);
            $streak = 0;
            $previous = null;
            foreach ($orders as $order) {
                $streak = $previous !== null && $order === $previous + 1 ? $streak + 1 : 1;
                $maximum = max($maximum, $streak);
                $previous = $order;
            }
        }

        return $maximum;
    }

    /**
     * @param  array<string, mixed>  $problem
     * @param  array<string, array<int, int>>  $occupancy
     * @param  list<int>  $candidateSlotIndexes
     */
    private function projectedGap(
        array $problem,
        array $occupancy,
        string $resource,
        int $weekday,
        int $weekMask,
        array $candidateSlotIndexes,
    ): int {
        $maximumGap = 0;
        foreach ($this->weekIndexes($weekMask, $problem['week_count']) as $weekIndex) {
            $weekBit = 1 << $weekIndex;
            $orders = [];
            foreach ($occupancy[$resource] ?? [] as $slotIndex => $occupiedMask) {
                $slot = $problem['slots'][$slotIndex];
                if ($slot['weekday'] === $weekday && ($occupiedMask & $weekBit) !== 0) {
                    $orders[] = $slot['item_sort_order'];
                }
            }
            foreach ($candidateSlotIndexes as $slotIndex) {
                $orders[] = $problem['slots'][$slotIndex]['item_sort_order'];
            }
            $orders = array_values(array_unique($orders));
            sort($orders);
            if ($orders !== []) {
                $maximumGap = max($maximumGap, max($orders) - min($orders) + 1 - count($orders));
            }
        }

        return $maximumGap;
    }

    /**
     * @param  array<string, mixed>  $unit
     * @return list<int>
     */
    private function relatedAssignmentIds(SchedulingConstraint $constraint, array $unit): array
    {
        $ids = $this->constraintAssignmentIds($constraint);
        $currentId = (int) $unit['assignment_id'];
        if (! in_array($currentId, $ids, true)) {
            return [];
        }

        return array_values(array_filter($ids, fn (int $id): bool => $id !== $currentId));
    }

    /** @return list<int> */
    private function constraintAssignmentIds(SchedulingConstraint $constraint): array
    {
        $ids = $constraint->requirement['with_assignment_ids']
            ?? $constraint->requirement['assignment_ids']
            ?? $constraint->scope['assignment_ids']
            ?? [];
        $ids = is_array($ids) ? array_map('intval', $ids) : [];
        if ($constraint->target_type === ConstraintTargetType::TeachingAssignment && $constraint->target_id !== null) {
            $ids[] = $constraint->target_id;
        }

        return array_values(array_unique($ids));
    }

    /**
     * Keep every synchronized assignment contiguous. The first assignment becomes the baseline;
     * linked assignments are then constrained to exactly the same session positions.
     *
     * @param  array<string, mixed>  $problem
     * @param  list<int>  $orderedBlockIndexes
     * @return list<int>
     */
    private function orderSynchronizedBlocks(array $problem, array $orderedBlockIndexes): array
    {
        $links = [];
        foreach ($problem['constraints'] as $constraint) {
            if (! $constraint instanceof SchedulingConstraint || $constraint->kind !== ConstraintKind::Hard
                || $constraint->category->value !== 'synchronization') {
                continue;
            }
            $ids = $this->constraintAssignmentIds($constraint);
            foreach ($ids as $id) {
                foreach ($ids as $relatedId) {
                    if ($id !== $relatedId) {
                        $links[$id][$relatedId] = true;
                    }
                }
            }
        }
        if ($links === []) {
            return $orderedBlockIndexes;
        }
        $blocksByAssignment = [];
        foreach ($orderedBlockIndexes as $blockIndex) {
            $assignmentId = (int) $problem['blocks'][$blockIndex]['assignment_id'];
            $blocksByAssignment[$assignmentId][] = $blockIndex;
        }
        $result = [];
        $emittedBlocks = [];
        foreach ($orderedBlockIndexes as $blockIndex) {
            if (isset($emittedBlocks[$blockIndex])) {
                continue;
            }
            $assignmentId = (int) $problem['blocks'][$blockIndex]['assignment_id'];
            if (! isset($links[$assignmentId])) {
                $result[] = $blockIndex;
                $emittedBlocks[$blockIndex] = true;

                continue;
            }
            $component = [];
            $pending = [$assignmentId];
            while ($pending !== []) {
                $currentId = array_pop($pending);
                if (isset($component[$currentId])) {
                    continue;
                }
                $component[$currentId] = true;
                foreach (array_keys($links[$currentId] ?? []) as $relatedId) {
                    $pending[] = (int) $relatedId;
                }
            }
            $componentOrder = array_keys($component);
            usort($componentOrder, function (int $left, int $right) use ($blocksByAssignment, $orderedBlockIndexes): int {
                $leftFirst = array_search($blocksByAssignment[$left][0] ?? -1, $orderedBlockIndexes, true);
                $rightFirst = array_search($blocksByAssignment[$right][0] ?? -1, $orderedBlockIndexes, true);

                return ($leftFirst === false ? PHP_INT_MAX : $leftFirst) <=> ($rightFirst === false ? PHP_INT_MAX : $rightFirst);
            });
            foreach ($componentOrder as $componentAssignmentId) {
                foreach ($blocksByAssignment[$componentAssignmentId] ?? [] as $linkedBlockIndex) {
                    $result[] = $linkedBlockIndex;
                    $emittedBlocks[$linkedBlockIndex] = true;
                }
            }
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $problem
     * @param  array<int, int>  $solution
     * @param  array<string, mixed>  $strategy
     * @return array{quality_score: float, soft_warning_count: int, score_breakdown: array<string, mixed>}
     */
    private function score(array $problem, array $solution, array $strategy): array
    {
        $assignmentDays = [];
        $teacherSlots = [];
        $resourceDailyLoads = [];
        $resourceSlotOrders = [];
        $assignmentRooms = [];
        $coreTotal = 0;
        $corePreferred = 0;
        $changes = 0;
        $countedSessions = [];
        $currentSignatures = [];
        foreach ($problem['current_entries'] as $entry) {
            $currentSignatures[$entry->teaching_assignment_id.':'.$entry->weekday.':'.$entry->item_id] = true;
        }
        foreach ($solution as $unitIndex => $slotIndex) {
            $unit = $problem['units'][$unitIndex];
            $slot = $problem['slots'][$slotIndex];
            if (! isset($countedSessions[$unit['block_id']])) {
                $assignmentDays[$unit['assignment_id']][$slot['weekday']] = ($assignmentDays[$unit['assignment_id']][$slot['weekday']] ?? 0) + 1;
                $countedSessions[$unit['block_id']] = true;
            }
            foreach ($unit['teacher_ids'] as $teacherId) {
                $teacherSlots[$teacherId][$slot['weekday']][] = $slot['item_sort_order'];
            }
            foreach ($unit['resource_keys'] as $resource) {
                $resourceDailyLoads[$resource][$slot['weekday']] = ($resourceDailyLoads[$resource][$slot['weekday']] ?? 0) + 1;
                $resourceSlotOrders[$resource][$slot['weekday']][] = $slot['item_sort_order'];
            }
            $assignmentRooms[$unit['assignment_id']][$unit['room_id']] = true;
            if (in_array($unit['course_name'], ['语文', '数学', '英语'], true)) {
                $coreTotal++;
                if ($slot['item_sort_order'] <= 4) {
                    $corePreferred++;
                }
            }
            if (! isset($currentSignatures[$unit['assignment_id'].':'.$slot['weekday'].':'.$slot['item_id']])) {
                $changes++;
            }
        }
        $sameDayRepeats = 0;
        foreach ($assignmentDays as $days) {
            foreach ($days as $count) {
                $sameDayRepeats += max(0, $count - 1);
            }
        }
        $teacherGaps = 0;
        $consecutiveWarnings = 0;
        foreach ($teacherSlots as $days) {
            foreach ($days as $sortOrders) {
                sort($sortOrders);
                $teacherGaps += max(0, max($sortOrders) - min($sortOrders) + 1 - count($sortOrders));
                $streak = 1;
                for ($index = 1; $index < count($sortOrders); $index++) {
                    $streak = $sortOrders[$index] === $sortOrders[$index - 1] + 1 ? $streak + 1 : 1;
                    if ($streak > 3) {
                        $consecutiveWarnings++;
                    }
                }
            }
        }
        $total = max(1, count($solution));
        $sessionCount = max(1, count($countedSessions));
        $distributionScore = max(0.0, 100.0 - $sameDayRepeats * 100 / $total);
        $teacherScore = max(0.0, 100.0 - ($teacherGaps + $consecutiveWarnings * 2) * 100 / $total);
        $coreScore = $coreTotal === 0 ? 100.0 : $corePreferred * 100 / $coreTotal;
        $stabilityScore = max(0.0, 100.0 - $changes * 100 / $total);

        $classImbalance = 0;
        $weekdays = array_values(array_unique(array_column($problem['slots'], 'weekday')));
        foreach ($resourceDailyLoads as $resource => $dailyLoads) {
            if (! str_starts_with($resource, 'school_class:')) {
                continue;
            }
            $loads = array_map(fn (int $weekday): int => $dailyLoads[$weekday] ?? 0, $weekdays);
            $classImbalance += max($loads) - min($loads);
        }
        $classLoadScore = max(0.0, 100.0 - $classImbalance * 100 / $total);

        $roomChanges = 0;
        foreach ($assignmentRooms as $rooms) {
            $roomChanges += max(0, count($rooms) - 1);
        }
        $roomStabilityScore = max(0.0, 100.0 - $roomChanges * 100 / $sessionCount);

        $ruleResults = [];
        $weightedRuleViolations = 0.0;
        $softWarningCount = 0;
        $spacingRuleViolations = 0;
        foreach ($problem['constraints'] as $constraint) {
            if (! $constraint instanceof SchedulingConstraint || $constraint->kind !== ConstraintKind::Soft) {
                continue;
            }
            $matchingUnitIndexes = array_values(array_filter(
                array_keys($problem['units']),
                fn (int $unitIndex): bool => $this->constraintTargetsUnit($constraint, $problem['units'][$unitIndex]),
            ));
            if ($matchingUnitIndexes === []) {
                continue;
            }
            $violations = 0;
            $category = $constraint->category->value;
            $requirement = $constraint->requirement;
            if (in_array($category, ['preferred_slot', 'course_priority'], true)) {
                foreach ($matchingUnitIndexes as $unitIndex) {
                    $slot = $problem['slots'][$solution[$unitIndex]];
                    $unit = $problem['units'][$unitIndex];
                    $courseNames = $requirement['prefer_earlier_items'] ?? null;
                    if (is_array($courseNames) && ! in_array($unit['course_name'], $courseNames, true)) {
                        continue;
                    }
                    $matches = $this->slotMatches($constraint->scope, $slot)
                        && $this->slotMatches($constraint->condition ?? [], $slot);
                    $preference = $requirement['preference'] ?? null;
                    if (($preference === 'avoid' && $matches) || ($preference === 'prefer' && ! $matches)
                        || ($courseNames !== null && $slot['item_sort_order'] > 4)) {
                        $violations++;
                    }
                }
            } elseif (in_array($category, ['course_distribution', 'spacing'], true)) {
                $assignmentIds = array_values(array_unique(array_map(
                    fn (int $unitIndex): int => (int) $problem['units'][$unitIndex]['assignment_id'],
                    $matchingUnitIndexes,
                )));
                $maxPerDay = $this->integerRequirement($requirement, ['max_same_course_per_day', 'max_per_day']);
                if ($maxPerDay === null && ($requirement['spread_across_weekdays'] ?? false)) {
                    $maxPerDay = 1;
                }
                $minGap = $this->integerRequirement($requirement, ['min_gap_days', 'minimum_gap_days']);
                foreach ($assignmentIds as $assignmentId) {
                    $days = $assignmentDays[$assignmentId] ?? [];
                    foreach ($days as $count) {
                        if ($maxPerDay !== null) {
                            $violations += max(0, $count - $maxPerDay);
                        }
                    }
                    if ($minGap !== null) {
                        $scheduledDays = array_keys($days);
                        sort($scheduledDays);
                        for ($index = 1; $index < count($scheduledDays); $index++) {
                            if ($minGap > $scheduledDays[$index] - $scheduledDays[$index - 1]) {
                                $violations++;
                            }
                        }
                    }
                }
                if ($category === 'spacing') {
                    $spacingRuleViolations += $violations;
                }
            } else {
                $resources = [];
                foreach ($matchingUnitIndexes as $unitIndex) {
                    foreach ($this->constraintResourceKeys($constraint, $problem['units'][$unitIndex]) as $resource) {
                        $resources[$resource] = true;
                    }
                }
                if ($category === 'consecutive_items') {
                    $limit = $this->integerRequirement($requirement, ['max_consecutive_items', 'maximum']) ?? 3;
                    foreach (array_keys($resources) as $resource) {
                        foreach ($resourceSlotOrders[$resource] ?? [] as $sortOrders) {
                            sort($sortOrders);
                            $streak = 1;
                            for ($index = 1; $index < count($sortOrders); $index++) {
                                $streak = $sortOrders[$index] === $sortOrders[$index - 1] + 1 ? $streak + 1 : 1;
                                $violations += (int) ($streak > $limit);
                            }
                        }
                    }
                } elseif ($category === 'daily_load') {
                    $limit = $this->integerRequirement($requirement, ['max_items_per_day', 'max_per_day']);
                    if ($limit !== null) {
                        foreach (array_keys($resources) as $resource) {
                            foreach ($resourceDailyLoads[$resource] ?? [] as $load) {
                                $violations += max(0, $load - $limit);
                            }
                        }
                    }
                } elseif ($category === 'teacher_gaps') {
                    foreach (array_keys($resources) as $resource) {
                        foreach ($resourceSlotOrders[$resource] ?? [] as $sortOrders) {
                            sort($sortOrders);
                            $violations += max(0, max($sortOrders) - min($sortOrders) + 1 - count($sortOrders));
                        }
                    }
                } elseif ($category === 'workload_balance') {
                    foreach (array_keys($resources) as $resource) {
                        $loads = array_values($resourceDailyLoads[$resource] ?? []);
                        if ($loads !== []) {
                            $violations += max($loads) - min($loads);
                        }
                    }
                }
            }
            $weight = $constraint->weight ?? 50;
            $weightedRuleViolations += $violations * $weight / 100;
            $softWarningCount += $violations;
            $ruleResults[] = [
                'constraint_id' => $constraint->id,
                'name' => $constraint->name,
                'category' => $category,
                'weight' => $weight,
                'violations' => $violations,
                'satisfied' => $violations === 0,
            ];
        }
        $sessionSpacingScore = max(0.0, 100.0 - ($sameDayRepeats + $spacingRuleViolations) * 100 / $sessionCount);
        $customRuleScore = max(0.0, 100.0 - $weightedRuleViolations * 100 / $sessionCount);

        $profile = $strategy['profile'] ?? 'balanced';
        $weights = match ($profile) {
            'class_distribution' => [
                'course_distribution' => 0.30, 'teacher_experience' => 0.12, 'class_load' => 0.22,
                'session_spacing' => 0.18, 'room_stability' => 0.05, 'custom_rules' => 0.08, 'stability' => 0.05,
            ],
            'teacher_experience' => [
                'course_distribution' => 0.12, 'teacher_experience' => 0.35, 'class_load' => 0.12,
                'session_spacing' => 0.10, 'room_stability' => 0.05, 'custom_rules' => 0.16, 'stability' => 0.10,
            ],
            'room_utilization' => [
                'course_distribution' => 0.12, 'teacher_experience' => 0.15, 'class_load' => 0.12,
                'session_spacing' => 0.10, 'room_stability' => 0.28, 'custom_rules' => 0.13, 'stability' => 0.10,
            ],
            default => [
                'course_distribution' => 0.20, 'teacher_experience' => 0.20, 'class_load' => 0.15,
                'session_spacing' => 0.15, 'room_stability' => 0.08, 'custom_rules' => 0.12, 'stability' => 0.10,
            ],
        };
        if ($profile === 'custom' && isset($strategy['weights'])) {
            $custom = $strategy['weights'];
            $customValues = [
                'course_distribution' => $custom['course_distribution'] ?? 20,
                'teacher_experience' => $custom['teacher_experience'] ?? 20,
                'class_load' => $custom['class_load'] ?? 15,
                'session_spacing' => $custom['session_spacing'] ?? 15,
                'room_stability' => $custom['room_stability'] ?? 10,
                'custom_rules' => $custom['custom_rules'] ?? 10,
                'stability' => $custom['stability'] ?? 10,
            ];
            $sum = max(1, array_sum($customValues));
            $weights = array_map(fn (int $value): float => $value / $sum, $customValues);
        }
        $quality = round(
            $distributionScore * $weights['course_distribution']
            + $teacherScore * $weights['teacher_experience']
            + $classLoadScore * $weights['class_load']
            + $sessionSpacingScore * $weights['session_spacing']
            + $roomStabilityScore * $weights['room_stability']
            + $customRuleScore * $weights['custom_rules']
            + $stabilityScore * $weights['stability'],
            2,
        );

        return [
            'quality_score' => $quality,
            'soft_warning_count' => $softWarningCount,
            'score_breakdown' => [
                'course_distribution' => round($distributionScore, 2),
                'teacher_experience' => round($teacherScore, 2),
                'class_load' => round($classLoadScore, 2),
                'session_spacing' => round($sessionSpacingScore, 2),
                'room_stability' => round($roomStabilityScore, 2),
                'custom_rules' => round($customRuleScore, 2),
                'core_course_priority' => round($coreScore, 2),
                'stability' => round($stabilityScore, 2),
                'same_course_same_day_repeats' => $sameDayRepeats,
                'teacher_gaps' => $teacherGaps,
                'consecutive_over_preference' => $consecutiveWarnings,
                'core_preferred_ratio' => round($coreScore / 100, 4),
                'changes_from_current' => $changes,
                'class_daily_imbalance' => $classImbalance,
                'room_changes' => $roomChanges,
                'rule_results' => $ruleResults,
                'weights' => $weights,
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $problem
     * @param  array<int, int>  $solution
     */
    private function persistCandidateEntries(ScheduleCandidate $candidate, array $problem, array $solution): void
    {
        $rows = [];
        foreach ($solution as $unitIndex => $slotIndex) {
            $unit = $problem['units'][$unitIndex];
            $slot = $problem['slots'][$slotIndex];
            $rows[] = [
                'schedule_candidate_id' => $candidate->id,
                'teaching_assignment_id' => $unit['assignment_id'],
                'week_pattern' => $unit['week_pattern'],
                'active_weeks' => $unit['active_weeks'] === null
                    ? null
                    : json_encode($unit['active_weeks'], JSON_THROW_ON_ERROR),
                'weekday' => $slot['weekday'],
                'item_id' => $slot['item_id'],
                'actual_room_id' => $unit['room_id'],
                'is_locked' => $unit['fixed_source'] !== null,
            ];
        }
        foreach (array_chunk($rows, 300) as $chunk) {
            ScheduleCandidateEntry::query()->insert($chunk);
        }
    }

    /** @param array<string, mixed> $strategy */
    private function candidateName(int $rank, array $strategy): string
    {
        $profile = match ($strategy['profile'] ?? 'balanced') {
            'class_distribution' => '班级分布优先',
            'teacher_experience' => '教师体验优先',
            'room_utilization' => '教室利用优先',
            'custom' => '自定义策略',
            default => '均衡',
        };

        return "{$profile}方案 ".chr(64 + $rank);
    }

    /** @param array<int, int> $solution */
    private function solutionHash(array $solution): string
    {
        ksort($solution);

        return hash('sha256', json_encode($solution, JSON_THROW_ON_ERROR));
    }

    /** @param array<string, mixed> $unit */
    private function unitSignature(array $unit, int $slotIndex): string
    {
        return implode(':', [$unit['assignment_id'], $unit['week_pattern'], $slotIndex]);
    }

    private function stableNoise(int ...$values): int
    {
        return (int) sprintf('%u', crc32(implode(':', $values)));
    }

    private function updateStage(ScheduleRun $run, ScheduleRunStatus $status, string $stage, int $progress): void
    {
        $run->forceFill([
            'status' => $status,
            'progress_stage' => $stage,
            'progress_percent' => $progress,
            'started_at' => $run->started_at ?? now(),
        ])->save();
    }

    private function assertNotCancelled(ScheduleRun $run): void
    {
        $status = ScheduleRun::query()->whereKey($run->id)->value('status');
        if ($status === ScheduleRunStatus::Cancelled->value) {
            throw new SchedulingFailureException('RUN_CANCELLED', '自动排课任务已取消。');
        }
    }

    /** @param array<string, mixed> $diagnostics */
    private function fail(ScheduleRun $run, string $code, string $message, array $diagnostics): void
    {
        $current = ScheduleRun::query()->find($run->id);
        if ($current === null || $current->status === ScheduleRunStatus::Cancelled || $code === 'RUN_CANCELLED') {
            return;
        }
        DB::transaction(function () use ($current, $code, $message, $diagnostics): void {
            $current->candidates()->delete();
            $current->forceFill([
                'status' => ScheduleRunStatus::Failed,
                'progress_stage' => 'failed',
                'error_code' => $code,
                'error_message' => $message,
                'diagnostics' => $diagnostics,
                'completed_at' => now(),
            ])->save();
        }, 3);
    }
}
