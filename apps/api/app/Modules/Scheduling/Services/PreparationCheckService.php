<?php

namespace App\Modules\Scheduling\Services;

use App\Enums\AssignmentStatus;
use App\Enums\ConstraintKind;
use App\Enums\ConstraintStatus;
use App\Enums\ResourceStatus;
use App\Enums\RoomMode;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\SemesterClassSetting\Models\SemesterClassSetting;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class PreparationCheckService
{
    public function __construct(
        private readonly WeekPatternService $weekPatterns,
    ) {}

    /**
     * @return array{
     *     ready: bool,
     *     status: string,
     *     input_revision: int,
     *     summary: array<string, int>,
     *     checks: list<array<string, mixed>>
     * }
     */
    public function inspect(Semester $semester): array
    {
        $semester->loadMissing(['scheduleTemplate.days', 'scheduleTemplate.items']);
        $checks = [];

        $template = $semester->scheduleTemplate;
        $activeDays = $template?->days->where('is_enabled', true)->count() ?? 0;
        $courseItems = $template?->items
            ->where('is_active', true)
            ->where('allows_course', true)
            ->where('counts_as_course', true)
            ->count() ?? 0;
        $capacity = $activeDays * $courseItems;
        $checks[] = $this->check(
            'schedule_template',
            '学期作息完整',
            $template !== null && $activeDays > 0 && $courseItems > 0 ? 'passed' : 'blocking',
            $template === null ? 1 : (int) ($activeDays === 0) + (int) ($courseItems === 0),
            $template === null
                ? '尚未配置作息模板。'
                : "已启用 {$activeDays} 天、每天 {$courseItems} 个可排课程课节。",
            '/semester/setup?section=schedule-template',
        );

        $classSettings = $semester->classSettings()
            ->get(['school_class_id', 'fixed_room_id', 'status']);
        $classSettingsByClass = $classSettings->keyBy('school_class_id');
        $activeClassSettingsByClass = $classSettings
            ->filter(fn (SemesterClassSetting $setting): bool => $setting->status === ResourceStatus::Active)
            ->keyBy('school_class_id');
        $activeClassSettings = $activeClassSettingsByClass->count();
        $checks[] = $this->check(
            'class_settings',
            '本学期班级已配置',
            $activeClassSettings > 0 ? 'passed' : 'blocking',
            $activeClassSettings > 0 ? 0 : 1,
            $activeClassSettings > 0 ? "已启用 {$activeClassSettings} 个班级。" : '尚未启用任何本学期班级。',
            '/semester/setup?section=classes',
        );

        $draftCount = $semester->teachingAssignments()->where('status', AssignmentStatus::Draft->value)->count();
        $confirmedCount = $semester->teachingAssignments()->where('status', AssignmentStatus::Confirmed->value)->count();
        $checks[] = $this->check(
            'confirmed_assignments',
            '任课关系已确认',
            $confirmedCount === 0 || $draftCount > 0 ? 'blocking' : 'passed',
            $confirmedCount === 0 ? 1 : $draftCount,
            $confirmedCount === 0
                ? '没有可参与自动排课的已确认任课关系。'
                : "已确认 {$confirmedCount} 条，另有 {$draftCount} 条待确认。",
            '/scheduling/assignments?view=table&status=draft',
        );

        $assignments = $semester->teachingAssignments()
            ->where('status', AssignmentStatus::Confirmed->value)
            ->with(['schoolClass.grade', 'teachingGroup.schoolClasses.grade', 'teacher', 'collaborators', 'course'])
            ->get();
        $qualifiedTeacherCourses = $this->qualifiedTeacherCourses($assignments);
        $activeRoomIds = $this->activeRoomIds($assignments, $classSettings);
        $resourceIssues = $this->resourceIssues(
            $assignments,
            $classSettingsByClass,
            $activeClassSettingsByClass,
            $qualifiedTeacherCourses,
            $activeRoomIds,
        );
        $checks[] = $this->check(
            'assignment_resources',
            '任课资源与授课资格有效',
            $resourceIssues === [] ? 'passed' : 'blocking',
            count($resourceIssues),
            $resourceIssues === [] ? '教师、课程、班级、教室和授课资格均可用。' : '存在资源停用、教室无法解析或教师不具备课程资格。',
            '/scheduling/assignments?filter=issues',
            $resourceIssues,
        );

        $capacityIssues = $capacity > 0
            ? $this->capacityIssues($semester, $assignments, $capacity, $classSettingsByClass)
            : [];
        $checks[] = $this->check(
            'theoretical_capacity',
            '理论容量足够',
            $capacityIssues === [] && $capacity > 0 ? 'passed' : 'blocking',
            $capacity > 0 ? count($capacityIssues) : 1,
            $capacity <= 0
                ? '没有可排槽位，无法计算容量。'
                : ($capacityIssues === [] ? "每个资源每周最多可使用 {$capacity} 个槽位，未发现显然超载。" : '至少一个班级、教师或教室的总课时超过可用槽位。'),
            '/scheduling/assignments?filter=capacity',
            $capacityIssues,
        );

        $fixedIssues = $this->fixedPlacementIssues($semester, $classSettingsByClass);
        $fixedCount = $semester->fixedPlacements()->where('status', ResourceStatus::Active->value)->count();
        $checks[] = $this->check(
            'fixed_placements',
            '固定安排无冲突',
            $fixedIssues === [] ? 'passed' : 'blocking',
            count($fixedIssues),
            $fixedIssues === [] ? "已校验 {$fixedCount} 条固定安排。" : '固定安排之间存在班级、教师或教室冲突。',
            '/scheduling/constraints?section=fixed',
            $fixedIssues,
        );

        $hardCount = $semester->schedulingConstraints()
            ->where('kind', ConstraintKind::Hard->value)
            ->where('status', ConstraintStatus::Active->value)->count();
        $softCount = $semester->schedulingConstraints()
            ->where('kind', ConstraintKind::Soft->value)
            ->where('status', ConstraintStatus::Active->value)->count();
        $checks[] = $this->check(
            'active_constraints',
            '规则与约束已配置',
            $softCount > 0 ? 'passed' : 'warning',
            $softCount > 0 ? 0 : 1,
            "系统始终执行必要硬约束；当前另有 {$hardCount} 条启用硬约束和 {$softCount} 条启用软规则。",
            '/scheduling/constraints',
        );

        $checks[] = $this->check(
            'current_version',
            '当前课表可作为调整基线',
            $semester->current_timetable_version_id === null ? 'warning' : 'passed',
            $semester->current_timetable_version_id === null ? 1 : 0,
            $semester->current_timetable_version_id === null
                ? '尚无当前课表，本次将从空白方案开始。'
                : '已找到当前课表，可选择保留锁定课程或现有安排。',
            '/scheduling/timetable',
        );

        $blocking = collect($checks)->where('status', 'blocking')->count();
        $warnings = collect($checks)->where('status', 'warning')->count();

        return [
            'ready' => $blocking === 0,
            'status' => $blocking > 0 ? 'blocking' : ($warnings > 0 ? 'warning' : 'passed'),
            'input_revision' => (int) $semester->getRawOriginal('input_revision'),
            'summary' => [
                'blocking' => $blocking,
                'warnings' => $warnings,
                'passed' => count($checks) - $blocking - $warnings,
                'confirmed_assignments' => $confirmedCount,
                'required_entries' => (int) $assignments->sum('weekly_items'),
                'available_slots_per_resource' => $capacity,
                'fixed_placements' => $fixedCount,
                'active_hard_constraints' => $hardCount,
                'active_soft_constraints' => $softCount,
            ],
            'checks' => $checks,
        ];
    }

    /**
     * @param  Collection<int, TeachingAssignment>  $assignments
     * @param  Collection<int, SemesterClassSetting>  $classSettingsByClass
     * @param  Collection<int, SemesterClassSetting>  $activeClassSettingsByClass
     * @param  Collection<string, bool>  $qualifiedTeacherCourses
     * @param  Collection<int, bool>  $activeRoomIds
     * @return list<array<string, mixed>>
     */
    private function resourceIssues(
        Collection $assignments,
        Collection $classSettingsByClass,
        Collection $activeClassSettingsByClass,
        Collection $qualifiedTeacherCourses,
        Collection $activeRoomIds,
    ): array {
        $issues = [];
        foreach ($assignments as $assignment) {
            $classTargetMissing = $assignment->school_class_id === null && $assignment->teaching_group_id === null;
            $groupWithoutClasses = $assignment->teachingGroup !== null && $assignment->teachingGroup->schoolClasses->isEmpty();
            $groupDefaultRoom = $assignment->teaching_group_id !== null && $assignment->specified_room_id === null;
            $classes = $assignment->schoolClass !== null
                ? collect([$assignment->schoolClass])
                : ($assignment->teachingGroup === null ? collect() : $assignment->teachingGroup->schoolClasses);
            $classInactive = $classes->contains(fn ($class) => $class->status !== ResourceStatus::Active || ! $class->grade->is_active);
            $classSettingMissing = $classes->contains(
                fn ($class): bool => ! $activeClassSettingsByClass->has((int) $class->id),
            );
            $groupInactive = $assignment->teachingGroup?->status === ResourceStatus::Inactive;
            $teachers = collect([$assignment->teacher])->concat($assignment->collaborators);
            $inactiveTeacher = $teachers->contains(fn ($teacher) => ! $teacher->is_active);
            $unqualifiedTeacherIds = $teachers->pluck('id')
                ->filter(fn ($teacherId): bool => ! $qualifiedTeacherCourses->has($teacherId.':'.$assignment->course_id))
                ->values();
            $roomId = $this->resolvedRoomId($assignment, $classSettingsByClass);
            $roomIssue = $roomId === null || ! $activeRoomIds->has($roomId);
            if ($classTargetMissing || $groupWithoutClasses || $groupDefaultRoom || $groupInactive || $classInactive || $classSettingMissing
                || $inactiveTeacher || ! $assignment->course->is_active || $unqualifiedTeacherIds->isNotEmpty() || $roomIssue) {
                $classOrGroup = $assignment->schoolClass !== null
                    ? $assignment->schoolClass->name
                    : ($assignment->teachingGroup === null ? null : $assignment->teachingGroup->name);
                $issues[] = [
                    'assignment_id' => $assignment->id,
                    'class_or_group' => $classOrGroup,
                    'course' => $assignment->course->name,
                    'teacher' => $assignment->teacher->name,
                    'reasons' => array_values(array_filter([
                        $classTargetMissing ? '缺少班级或教学组' : null,
                        $groupWithoutClasses ? '教学组没有班级' : null,
                        $groupDefaultRoom ? '教学组必须指定共用教室' : null,
                        $groupInactive ? '教学组已停用' : null,
                        $classInactive ? '班级或年级已停用' : null,
                        $classSettingMissing ? '缺少本学期班级配置' : null,
                        $inactiveTeacher ? '主讲或协同教师已停用' : null,
                        ! $assignment->course->is_active ? '课程已停用' : null,
                        $unqualifiedTeacherIds->isNotEmpty() ? '主讲或协同教师不具备课程资格' : null,
                        $roomIssue ? '教室无法解析或已停用' : null,
                    ])),
                ];
            }
        }

        return array_slice($issues, 0, 50);
    }

    /**
     * @param  Collection<int, TeachingAssignment>  $assignments
     * @param  Collection<int, SemesterClassSetting>  $classSettingsByClass
     * @return list<array<string, mixed>>
     */
    private function capacityIssues(
        Semester $semester,
        Collection $assignments,
        int $capacity,
        Collection $classSettingsByClass,
    ): array {
        $totals = [];
        foreach ($assignments as $assignment) {
            $weekMask = $this->weekPatterns->mask($semester, $assignment->week_pattern, $assignment->active_weeks);
            $activeWeekIndexes = [];
            for ($weekIndex = 0; $weekIndex < $this->weekPatterns->weekCount($semester); $weekIndex++) {
                if (($weekMask & (1 << $weekIndex)) !== 0) {
                    $activeWeekIndexes[] = $weekIndex;
                }
            }
            $classIds = $assignment->school_class_id !== null
                ? [$assignment->school_class_id]
                : $assignment->teachingGroup?->schoolClasses->pluck('id')->all() ?? [];
            foreach ($classIds as $classId) {
                foreach ($activeWeekIndexes as $weekIndex) {
                    $totals['school_class'][$classId][$weekIndex] =
                        ($totals['school_class'][$classId][$weekIndex] ?? 0) + $assignment->weekly_items;
                }
            }
            foreach ([$assignment->teacher_id, ...$assignment->collaborators->pluck('id')->all()] as $teacherId) {
                foreach ($activeWeekIndexes as $weekIndex) {
                    $totals['teacher'][$teacherId][$weekIndex] =
                        ($totals['teacher'][$teacherId][$weekIndex] ?? 0) + $assignment->weekly_items;
                }
            }
            $roomId = $this->resolvedRoomId($assignment, $classSettingsByClass);
            if ($roomId === null) {
                continue;
            }
            foreach ($activeWeekIndexes as $weekIndex) {
                $totals['room'][$roomId][$weekIndex] =
                    ($totals['room'][$roomId][$weekIndex] ?? 0) + $assignment->weekly_items;
            }
        }

        $issues = [];
        foreach ($totals as $resourceType => $resourceTotals) {
            foreach ($resourceTotals as $resourceId => $weeklyTotals) {
                $required = max($weeklyTotals);
                if ($required > $capacity) {
                    $weekIndex = array_search($required, $weeklyTotals, true);
                    $issues[] = [
                        'resource_type' => $resourceType,
                        'resource_id' => $resourceId,
                        'teaching_week' => $weekIndex === false ? null : $weekIndex + 1,
                        'required' => $required,
                        'capacity' => $capacity,
                        'shortage' => $required - $capacity,
                    ];
                }
            }
        }

        return array_slice($issues, 0, 50);
    }

    /**
     * @param  Collection<int, SemesterClassSetting>  $classSettingsByClass
     * @return list<array<string, mixed>>
     */
    private function fixedPlacementIssues(Semester $semester, Collection $classSettingsByClass): array
    {
        $fixed = $semester->fixedPlacements()
            ->where('status', ResourceStatus::Active->value)
            ->with(['teachingAssignment.semester', 'teachingAssignment.teachingGroup.schoolClasses', 'teachingAssignment.collaborators'])
            ->get();
        $seen = [];
        $issues = [];
        foreach ($fixed as $placement) {
            $assignment = $placement->teachingAssignment;
            $classIds = $assignment->school_class_id !== null
                ? [$assignment->school_class_id]
                : $assignment->teachingGroup?->schoolClasses->pluck('id')->all() ?? [];
            $roomId = $placement->room_id ?? $this->resolvedRoomId($assignment, $classSettingsByClass) ?? 0;
            $resources = ["teacher:{$assignment->teacher_id}", "room:{$roomId}"];
            foreach ($assignment->collaborators as $collaborator) {
                $resources[] = "teacher:{$collaborator->id}";
            }
            foreach ($classIds as $classId) {
                $resources[] = "school_class:{$classId}";
            }
            foreach ($resources as $resource) {
                $key = implode(':', [$placement->weekday, $placement->item_id, $resource]);
                foreach ($seen[$key] ?? [] as $existing) {
                    if ($this->weekPatterns->overlaps(
                        $semester,
                        $placement->week_pattern,
                        $placement->active_weeks,
                        $existing['week_pattern'],
                        $existing['active_weeks'],
                    )) {
                        $issues[] = [
                            'placement_id' => $placement->id,
                            'conflicts_with_id' => $existing['id'],
                            'resource' => $resource,
                            'weekday' => $placement->weekday,
                            'item_id' => $placement->item_id,
                        ];
                    }
                }
                $seen[$key][] = [
                    'id' => $placement->id,
                    'week_pattern' => $placement->week_pattern,
                    'active_weeks' => $placement->active_weeks,
                ];
            }
        }

        return array_slice($issues, 0, 50);
    }

    /**
     * @param  Collection<int, TeachingAssignment>  $assignments
     * @return Collection<string, bool>
     */
    private function qualifiedTeacherCourses(Collection $assignments): Collection
    {
        $teacherIds = $assignments
            ->flatMap(fn (TeachingAssignment $assignment): Collection => collect([$assignment->teacher_id])
                ->concat($assignment->collaborators->pluck('id')))
            ->unique()
            ->values();
        $courseIds = $assignments->pluck('course_id')->unique()->values();

        if ($teacherIds->isEmpty() || $courseIds->isEmpty()) {
            return collect();
        }

        return DB::table('teacher_course')
            ->whereIn('teacher_id', $teacherIds)
            ->whereIn('course_id', $courseIds)
            ->get(['teacher_id', 'course_id'])
            ->mapWithKeys(fn (object $qualification): array => [
                $qualification->teacher_id.':'.$qualification->course_id => true,
            ]);
    }

    /**
     * @param  Collection<int, TeachingAssignment>  $assignments
     * @param  Collection<int, SemesterClassSetting>  $classSettings
     * @return Collection<int, bool>
     */
    private function activeRoomIds(Collection $assignments, Collection $classSettings): Collection
    {
        $roomIds = $assignments->pluck('specified_room_id')
            ->concat($classSettings->pluck('fixed_room_id'))
            ->filter()
            ->unique()
            ->values();

        if ($roomIds->isEmpty()) {
            return collect();
        }

        return DB::table('rooms')
            ->whereIn('id', $roomIds)
            ->where('is_active', true)
            ->pluck('id')
            ->mapWithKeys(fn ($roomId): array => [(int) $roomId => true]);
    }

    /** @param Collection<int, SemesterClassSetting> $classSettingsByClass */
    private function resolvedRoomId(
        TeachingAssignment $assignment,
        Collection $classSettingsByClass,
    ): ?int {
        if ($assignment->room_mode === RoomMode::Specified) {
            return $assignment->specified_room_id;
        }

        $roomId = $classSettingsByClass->get($assignment->school_class_id)?->fixed_room_id;

        return $roomId === null ? null : (int) $roomId;
    }

    /**
     * @param  list<array<string, mixed>>  $items
     * @return array<string, mixed>
     */
    private function check(
        string $key,
        string $label,
        string $status,
        int $issueCount,
        string $message,
        string $fixPath,
        array $items = [],
    ): array {
        return [
            'key' => $key,
            'label' => $label,
            'status' => $status,
            'issue_count' => $issueCount,
            'message' => $message,
            'fix_path' => $fixPath,
            'items' => $items,
        ];
    }
}
