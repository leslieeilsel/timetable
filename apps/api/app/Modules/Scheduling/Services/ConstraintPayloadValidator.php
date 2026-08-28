<?php

namespace App\Modules\Scheduling\Services;

use App\Enums\AssignmentStatus;
use App\Enums\ConstraintCategory;
use App\Enums\ConstraintKind;
use App\Enums\ConstraintTargetType;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Scheduling\Models\SchedulingConstraint;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Support\ApiProblemException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class ConstraintPayloadValidator
{
    /**
     * The public rule editor may only activate combinations that both the solver and
     * the manual timetable diagnostics execute with the same meaning.
     *
     * @param  array<string, mixed>  $data
     */
    public function assertValid(Semester $semester, array $data, string $source = 'user'): void
    {
        $kind = $data['kind'] instanceof ConstraintKind ? $data['kind'] : ConstraintKind::from($data['kind']);
        $category = $data['category'] instanceof ConstraintCategory
            ? $data['category']
            : ConstraintCategory::from($data['category']);
        $weight = $data['weight'] ?? null;
        if (($kind === ConstraintKind::Hard && $weight !== null)
            || ($kind === ConstraintKind::Soft && (! is_int($weight) || $weight < 1 || $weight > 100))) {
            throw new ApiProblemException(
                'CONSTRAINT_WEIGHT_INVALID',
                '硬约束不设置权重，软规则必须设置 1 至 100 的权重',
                422,
            );
        }

        $targetType = $this->targetType($data['target_type'] ?? null);
        $targetId = $data['target_id'] ?? null;
        if (($targetType === null) !== ($targetId === null) || ($targetId !== null && (! is_int($targetId) || $targetId < 1))) {
            throw new ApiProblemException('CONSTRAINT_TARGET_INVALID', '作用对象类型和对象必须同时选择', 422);
        }
        if ($targetType !== null && ! $this->targetExists($semester, $targetType, $targetId)) {
            throw new ApiProblemException('CONSTRAINT_TARGET_NOT_FOUND', '规则作用对象不存在或不属于该学期', 422);
        }

        $scope = $data['scope'] ?? [];
        $condition = $data['condition'] ?? [];
        $requirement = $data['requirement'] ?? null;
        if (! is_array($scope) || ! is_array($condition) || ! is_array($requirement)) {
            throw new ApiProblemException('CONSTRAINT_PAYLOAD_INVALID', '规则范围、条件和要求必须使用 JSON 对象', 422);
        }

        if ($source === 'system' && $this->isSupportedSystemInvariant($semester, $kind, $category, $scope, $condition, $requirement)) {
            return;
        }

        // Seeded template rules are already scoped by their semester_id column. Older
        // templates duplicated that boundary inside scope even for non-slot rules.
        if ($source === 'template' && $scope === ['semester_id' => $semester->id]) {
            $scope = [];
        }

        if (! $this->supports($kind, $category)) {
            throw new ApiProblemException(
                'CONSTRAINT_KIND_CATEGORY_UNSUPPORTED',
                '当前排课求解器和手工诊断不支持启用该强度与规则类型的组合',
                422,
                ['kind' => $kind->value, 'category' => $category->value],
            );
        }

        $slotBased = in_array($category, [
            ConstraintCategory::Availability,
            ConstraintCategory::ForbiddenSlot,
            ConstraintCategory::PreferredSlot,
        ], true);
        $this->assertSelector($semester, $scope, 'scope', $slotBased);
        $this->assertSelector($semester, $condition, 'condition', false);
        if (! $slotBased && ($scope !== [] || $condition !== [])) {
            throw new ApiProblemException(
                'CONSTRAINT_SCOPE_INVALID',
                '该规则类型不会读取课节范围或条件，请保持 scope 和 condition 为空',
                422,
                ['category' => $category->value],
            );
        }
        if ($slotBased && $scope === [] && $condition === []) {
            throw new ApiProblemException('CONSTRAINT_SCOPE_INVALID', '课节类规则至少需要一个有效范围或条件', 422);
        }

        $this->assertRequirement($semester, $kind, $category, $requirement, $targetType, $targetId);
    }

    /**
     * @param  Collection<int, SchedulingConstraint>  $constraints
     * @return list<array<string, mixed>>
     */
    public function activeIssues(Semester $semester, Collection $constraints): array
    {
        $issues = [];
        foreach ($constraints as $constraint) {
            try {
                $this->assertValid($semester, $constraint->only([
                    'kind', 'category', 'target_type', 'target_id', 'scope', 'condition', 'requirement', 'weight',
                ]), $constraint->source);
            } catch (ApiProblemException $exception) {
                $issues[] = [
                    'constraint_id' => $constraint->id,
                    'name' => $constraint->name,
                    'kind' => $constraint->kind->value,
                    'category' => $constraint->category->value,
                    'code' => $exception->problemCode,
                    'reason' => $exception->getMessage(),
                    ...$exception->details,
                ];
            }
        }

        return $issues;
    }

    private function supports(ConstraintKind $kind, ConstraintCategory $category): bool
    {
        $hard = [
            ConstraintCategory::Availability,
            ConstraintCategory::ForbiddenSlot,
            ConstraintCategory::DailyLoad,
            ConstraintCategory::WeeklyLoad,
            ConstraintCategory::ConsecutiveItems,
            ConstraintCategory::Synchronization,
            ConstraintCategory::WorkloadBalance,
        ];
        $soft = [
            ConstraintCategory::PreferredSlot,
        ];

        return in_array($category, $kind === ConstraintKind::Hard ? $hard : $soft, true);
    }

    /**
     * @param  array<string, mixed>  $requirement
     */
    private function assertRequirement(
        Semester $semester,
        ConstraintKind $kind,
        ConstraintCategory $category,
        array $requirement,
        ?ConstraintTargetType $targetType,
        ?int $targetId,
    ): void {
        match ($category) {
            ConstraintCategory::Availability => $this->assertAvailability($requirement, false),
            ConstraintCategory::ForbiddenSlot => $this->assertAvailability($requirement, true),
            ConstraintCategory::DailyLoad => $this->assertLimitRequirement($requirement, 'max_items_per_day', 1, 20, $targetType),
            ConstraintCategory::WeeklyLoad => $this->assertWeeklyLoad($requirement, $targetType),
            ConstraintCategory::ConsecutiveItems => $this->assertLimitRequirement($requirement, 'max_consecutive_items', 1, 10, $targetType),
            ConstraintCategory::CourseDistribution => $this->assertCourseDistribution($kind, $requirement),
            ConstraintCategory::PreferredSlot => $this->assertPreference($requirement),
            ConstraintCategory::Spacing => $this->assertSpacing($requirement),
            ConstraintCategory::Synchronization => $this->assertRelation(
                $semester,
                $requirement,
                $targetType,
                $targetId,
                true,
            ),
            ConstraintCategory::MutualExclusion => $this->assertRelation(
                $semester,
                $requirement,
                $targetType,
                $targetId,
                false,
            ),
            ConstraintCategory::WorkloadBalance => $this->assertWorkloadBalance($kind, $requirement, $targetType),
            ConstraintCategory::TeacherGaps => $this->assertTrueSwitch($requirement, 'minimize_teacher_gaps'),
            ConstraintCategory::CoursePriority => $this->assertCoursePriority($requirement),
            ConstraintCategory::RoomRequirement => throw new ApiProblemException(
                'CONSTRAINT_KIND_CATEGORY_UNSUPPORTED',
                '教室分配是系统内建不变量，不能作为用户自定义规则启用',
                422,
            ),
        };
    }

    /** @param array<string, mixed> $requirement */
    private function assertAvailability(array $requirement, bool $forbidden): void
    {
        $this->assertOnlyKeys($requirement, $forbidden ? ['available'] : ['available', 'allowed_only']);
        $available = array_key_exists('available', $requirement);
        $allowedOnly = array_key_exists('allowed_only', $requirement);
        if (($available === $allowedOnly)
            || ($available && $requirement['available'] !== false)
            || ($allowedOnly && $requirement['allowed_only'] !== true)) {
            $this->invalidRequirement('可用性规则必须且只能使用 available=false 或 allowed_only=true');
        }
    }

    /** @param array<string, mixed> $requirement */
    private function assertLimitRequirement(
        array $requirement,
        string $key,
        int $minimum,
        int $maximum,
        ?ConstraintTargetType $targetType,
    ): void {
        $this->assertOnlyKeys($requirement, [$key, 'resource_type', 'resource_types']);
        $this->assertInteger($requirement[$key] ?? null, $minimum, $maximum, $key);
        $this->assertResourceTypes($requirement);
        $this->assertResourceSelectionIsRead($targetType, $requirement);
        $this->assertResourceLimitTargetIsSafe($targetType);
    }

    /** @param array<string, mixed> $requirement */
    private function assertWeeklyLoad(array $requirement, ?ConstraintTargetType $targetType): void
    {
        $this->assertOnlyKeys($requirement, ['max_items_per_week']);
        $this->assertInteger($requirement['max_items_per_week'] ?? null, 1, 100, 'max_items_per_week');
        if (! in_array($targetType, [
            ConstraintTargetType::Teacher,
            ConstraintTargetType::SchoolClass,
            ConstraintTargetType::Room,
        ], true)) {
            throw new ApiProblemException(
                'CONSTRAINT_TARGET_UNSUPPORTED',
                '每周负荷硬约束必须直接作用于教师、班级或教室',
                422,
            );
        }
    }

    /** @param array<string, mixed> $requirement */
    private function assertCourseDistribution(ConstraintKind $kind, array $requirement): void
    {
        $this->assertOnlyKeys($requirement, ['max_same_course_per_day', 'spread_across_weekdays']);
        $hasMaximum = array_key_exists('max_same_course_per_day', $requirement);
        $hasSpread = array_key_exists('spread_across_weekdays', $requirement);
        if (! $hasMaximum && ! $hasSpread) {
            $this->invalidRequirement('课程分布规则至少需要每日次数上限或均匀分布开关');
        }
        if ($hasMaximum) {
            $this->assertInteger($requirement['max_same_course_per_day'], 1, 10, 'max_same_course_per_day');
        }
        if ($hasSpread && $requirement['spread_across_weekdays'] !== true) {
            $this->invalidRequirement('spread_across_weekdays 只能是 true 布尔值');
        }
        if ($kind === ConstraintKind::Hard && ! $hasMaximum) {
            $this->invalidRequirement('硬课程分布约束必须设置 max_same_course_per_day');
        }
    }

    /** @param array<string, mixed> $requirement */
    private function assertPreference(array $requirement): void
    {
        $this->assertOnlyKeys($requirement, ['preference']);
        if (! in_array($requirement['preference'] ?? null, ['prefer', 'avoid'], true)) {
            $this->invalidRequirement('preference 只能是 prefer 或 avoid');
        }
    }

    /** @param array<string, mixed> $requirement */
    private function assertSpacing(array $requirement): void
    {
        $this->assertOnlyKeys($requirement, ['max_same_course_per_day', 'min_gap_days']);
        $hasMaximum = array_key_exists('max_same_course_per_day', $requirement);
        $hasGap = array_key_exists('min_gap_days', $requirement);
        if (! $hasMaximum && ! $hasGap) {
            $this->invalidRequirement('间隔规则至少需要每日次数上限或最小间隔天数');
        }
        if ($hasMaximum) {
            $this->assertInteger($requirement['max_same_course_per_day'], 1, 10, 'max_same_course_per_day');
        }
        if ($hasGap) {
            $this->assertInteger($requirement['min_gap_days'], 1, 7, 'min_gap_days');
        }
    }

    /**
     * @param  array<string, mixed>  $requirement
     */
    private function assertRelation(
        Semester $semester,
        array $requirement,
        ?ConstraintTargetType $targetType,
        ?int $targetId,
        bool $synchronization,
    ): void {
        $this->assertOnlyKeys($requirement, $synchronization ? ['with_assignment_ids'] : ['with_assignment_ids', 'mode']);
        if ($targetType !== ConstraintTargetType::TeachingAssignment || $targetId === null) {
            throw new ApiProblemException(
                'CONSTRAINT_RELATION_TARGET_INVALID',
                '同步或互斥规则必须选择一条主任课关系作为作用对象',
                422,
            );
        }
        $relatedIds = $requirement['with_assignment_ids'] ?? null;
        if (! is_array($relatedIds) || ! array_is_list($relatedIds) || $relatedIds === []
            || collect($relatedIds)->contains(fn (mixed $id): bool => ! is_int($id) || $id < 1)
            || count(array_unique($relatedIds, SORT_REGULAR)) !== count($relatedIds)
            || in_array($targetId, $relatedIds, true)) {
            throw new ApiProblemException(
                'CONSTRAINT_RELATION_TARGETS_INSUFFICIENT',
                '同步或互斥规则必须包含至少一条不重复的关联任课关系',
                422,
            );
        }
        if (! $synchronization && ! in_array($requirement['mode'] ?? null, ['same_slot', 'same_day'], true)) {
            throw new ApiProblemException('CONSTRAINT_EXCLUSION_MODE_INVALID', '互斥方式只能选择不同课节或不同日期', 422);
        }

        $ids = [$targetId, ...$relatedIds];
        $assignments = TeachingAssignment::query()
            ->where('semester_id', $semester->id)
            ->whereIn('id', $ids)
            ->get(['id', 'status', 'weekly_items', 'items_per_session', 'week_pattern', 'active_weeks']);
        if ($assignments->count() !== count($ids)) {
            throw new ApiProblemException('CONSTRAINT_RELATION_TARGET_INVALID', '同步或互斥规则包含无效任课关系', 422);
        }
        if (! $synchronization) {
            return;
        }
        if ($assignments->contains(fn (TeachingAssignment $assignment): bool => $assignment->status !== AssignmentStatus::Confirmed)) {
            throw new ApiProblemException('CONSTRAINT_SYNCHRONIZATION_SHAPE_INVALID', '同步规则只能关联已确认任课关系', 422);
        }
        $signatures = $assignments->map(fn (TeachingAssignment $assignment): string => implode(':', [
            $assignment->weekly_items,
            $assignment->items_per_session,
            $assignment->week_pattern->value,
            json_encode($assignment->active_weeks),
        ]))->unique();
        if ($signatures->count() !== 1) {
            throw new ApiProblemException(
                'CONSTRAINT_SYNCHRONIZATION_SHAPE_INVALID',
                '同步任课关系必须具有相同的周课时、连排节数和周型',
                422,
                ['assignment_ids' => $ids],
            );
        }
    }

    /** @param array<string, mixed> $requirement */
    private function assertWorkloadBalance(
        ConstraintKind $kind,
        array $requirement,
        ?ConstraintTargetType $targetType,
    ): void {
        if ($kind === ConstraintKind::Hard) {
            $this->assertOnlyKeys($requirement, ['max_items_per_day', 'resource_type', 'resource_types']);
            if (! array_key_exists('max_items_per_day', $requirement)) {
                $this->invalidRequirement('硬工作量规则必须设置 max_items_per_day');
            }
            $this->assertInteger($requirement['max_items_per_day'], 1, 20, 'max_items_per_day');
        } else {
            $this->assertOnlyKeys($requirement, ['balance_teacher_daily_load', 'resource_type', 'resource_types']);
            if (($requirement['balance_teacher_daily_load'] ?? null) !== true) {
                $this->invalidRequirement('软工作量平衡规则必须将 balance_teacher_daily_load 设置为 true 布尔值');
            }
        }
        $this->assertResourceTypes($requirement);
        $this->assertResourceSelectionIsRead($targetType, $requirement);
        $this->assertResourceLimitTargetIsSafe($targetType);
    }

    /** @param array<string, mixed> $requirement */
    private function assertResourceSelectionIsRead(?ConstraintTargetType $targetType, array $requirement): void
    {
        if (! array_key_exists('resource_type', $requirement) && ! array_key_exists('resource_types', $requirement)) {
            return;
        }
        if (in_array($targetType, [
            ConstraintTargetType::Teacher,
            ConstraintTargetType::SchoolClass,
            ConstraintTargetType::Room,
            ConstraintTargetType::Grade,
            ConstraintTargetType::TeachingGroup,
        ], true)) {
            $this->invalidRequirement('当前作用对象已决定资源类型，不能再设置 resource_type 或 resource_types');
        }
    }

    private function assertResourceLimitTargetIsSafe(?ConstraintTargetType $targetType): void
    {
        if (in_array($targetType, [ConstraintTargetType::Course, ConstraintTargetType::TeachingAssignment], true)) {
            throw new ApiProblemException(
                'CONSTRAINT_TARGET_UNSUPPORTED',
                '资源负荷规则不能作用于课程或单条任课关系，请选择具体资源或更广范围',
                422,
            );
        }
    }

    /** @param array<string, mixed> $requirement */
    private function assertTrueSwitch(array $requirement, string $key): void
    {
        $this->assertOnlyKeys($requirement, [$key]);
        if (($requirement[$key] ?? null) !== true) {
            $this->invalidRequirement("{$key} 只能是 true 布尔值");
        }
    }

    /** @param array<string, mixed> $requirement */
    private function assertCoursePriority(array $requirement): void
    {
        $this->assertOnlyKeys($requirement, ['prefer_earlier_items']);
        $courses = $requirement['prefer_earlier_items'] ?? null;
        if (! is_array($courses) || ! array_is_list($courses) || $courses === []
            || collect($courses)->contains(fn (mixed $course): bool => ! is_string($course) || trim($course) === '' || mb_strlen($course) > 100)
            || count(array_unique($courses, SORT_REGULAR)) !== count($courses)) {
            $this->invalidRequirement('prefer_earlier_items 必须是不重复的非空课程名称数组');
        }
    }

    /**
     * @param  array<string, mixed>  $selector
     */
    private function assertSelector(Semester $semester, array $selector, string $field, bool $requireNonEmpty): void
    {
        $this->assertOnlyKeys($selector, ['weekdays', 'item_ids', 'item_sort_orders', 'slots'], $field);
        if ($selector === []) {
            if ($requireNonEmpty) {
                return;
            }

            return;
        }
        $template = $semester->scheduleTemplate()->with(['days', 'items'])->first();
        $weekdays = $template === null
            ? range(1, 7)
            : $template->days->where('is_enabled', true)->pluck('weekday')->map(fn ($day): int => (int) $day)->all();
        $items = $template?->items->where('is_active', true)->where('allows_course', true)
            ->where('counts_as_course', true) ?? collect();
        $itemIds = $items->pluck('id')->map(fn ($id): int => (int) $id)->all();
        $itemOrders = $items->pluck('sort_order')->map(fn ($order): int => (int) $order)->all();

        foreach (['weekdays' => $weekdays, 'item_ids' => $itemIds, 'item_sort_orders' => $itemOrders] as $key => $allowed) {
            if (! array_key_exists($key, $selector)) {
                continue;
            }
            $values = $selector[$key];
            if (! is_array($values) || ! array_is_list($values) || $values === []
                || collect($values)->contains(fn (mixed $value): bool => ! is_int($value) || $value < 1
                    || ($template !== null && ! in_array($value, $allowed, true)))
                || count(array_unique($values, SORT_REGULAR)) !== count($values)) {
                throw new ApiProblemException(
                    'CONSTRAINT_'.strtoupper($field).'_INVALID',
                    "{$field}.{$key} 必须是不重复且属于当前学期可排课范围的整数数组",
                    422,
                );
            }
        }

        if (array_key_exists('slots', $selector)) {
            $slots = $selector['slots'];
            if (! is_array($slots) || ! array_is_list($slots) || $slots === []) {
                throw new ApiProblemException('CONSTRAINT_'.strtoupper($field).'_INVALID', "{$field}.slots 必须是非空课节数组", 422);
            }
            $signatures = [];
            foreach ($slots as $slot) {
                if (! is_array($slot) || ! $this->sameKeys($slot, ['weekday', 'item_id'])
                    || ! is_int($slot['weekday']) || ! is_int($slot['item_id'])
                    || ! in_array($slot['weekday'], $weekdays, true) || $slot['item_id'] < 1
                    || ($template !== null && ! in_array($slot['item_id'], $itemIds, true))) {
                    throw new ApiProblemException(
                        'CONSTRAINT_'.strtoupper($field).'_INVALID',
                        "{$field}.slots 中的每项只能包含有效的 weekday 和 item_id 整数",
                        422,
                    );
                }
                $signatures[] = $slot['weekday'].':'.$slot['item_id'];
            }
            if (count(array_unique($signatures)) !== count($signatures)) {
                throw new ApiProblemException('CONSTRAINT_'.strtoupper($field).'_INVALID', "{$field}.slots 不能包含重复课节", 422);
            }
        }
    }

    /** @param array<string, mixed> $requirement */
    private function assertResourceTypes(array $requirement): void
    {
        $single = $requirement['resource_type'] ?? null;
        $multiple = $requirement['resource_types'] ?? null;
        if ($single !== null && $multiple !== null) {
            $this->invalidRequirement('resource_type 和 resource_types 不能同时设置');
        }
        $allowed = ['teacher', 'school_class', 'room'];
        if ($single !== null && (! is_string($single) || ! in_array($single, $allowed, true))) {
            $this->invalidRequirement('resource_type 只能是 teacher、school_class 或 room');
        }
        if ($multiple !== null && (! is_array($multiple) || ! array_is_list($multiple) || $multiple === []
            || collect($multiple)->contains(fn (mixed $type): bool => ! is_string($type) || ! in_array($type, $allowed, true))
            || count(array_unique($multiple, SORT_REGULAR)) !== count($multiple))) {
            $this->invalidRequirement('resource_types 必须是不重复的资源类型数组');
        }
    }

    private function assertInteger(mixed $value, int $minimum, int $maximum, string $key): void
    {
        if (! is_int($value) || $value < $minimum || $value > $maximum) {
            $this->invalidRequirement("{$key} 必须是 {$minimum} 至 {$maximum} 的整数");
        }
    }

    /**
     * @param  array<string, mixed>  $value
     * @param  list<string>  $allowed
     */
    private function assertOnlyKeys(array $value, array $allowed, string $field = 'requirement'): void
    {
        $unknown = array_values(array_diff(array_keys($value), $allowed));
        if ($unknown !== []) {
            $code = $field === 'requirement' ? 'CONSTRAINT_REQUIREMENT_INVALID' : 'CONSTRAINT_'.strtoupper($field).'_INVALID';
            throw new ApiProblemException($code, "{$field} 包含当前规则不会执行的字段", 422, ['unknown_fields' => $unknown]);
        }
    }

    /**
     * @param  array<string, mixed>  $value
     * @param  list<string>  $expected
     */
    private function sameKeys(array $value, array $expected): bool
    {
        $keys = array_keys($value);
        sort($keys);
        sort($expected);

        return $keys === $expected;
    }

    private function invalidRequirement(string $message): never
    {
        throw new ApiProblemException('CONSTRAINT_REQUIREMENT_INVALID', $message, 422);
    }

    private function targetType(mixed $value): ?ConstraintTargetType
    {
        if ($value === null) {
            return null;
        }

        return $value instanceof ConstraintTargetType ? $value : ConstraintTargetType::from($value);
    }

    private function targetExists(Semester $semester, ConstraintTargetType $type, ?int $targetId): bool
    {
        if ($targetId === null) {
            return false;
        }

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

    /**
     * @param  array<string, mixed>  $scope
     * @param  array<string, mixed>  $condition
     * @param  array<string, mixed>  $requirement
     */
    private function isSupportedSystemInvariant(
        Semester $semester,
        ConstraintKind $kind,
        ConstraintCategory $category,
        array $scope,
        array $condition,
        array $requirement,
    ): bool {
        if ($kind !== ConstraintKind::Hard || $condition !== []
            || ! ($scope === [] || $scope === ['semester_id' => $semester->id])) {
            return false;
        }
        if ($category === ConstraintCategory::Availability && count($requirement) === 1) {
            if (isset($requirement['resource_no_overlap'])) {
                return in_array($requirement['resource_no_overlap'], ['teacher', 'school_class', 'room'], true);
            }

            return ($requirement['item_allows_course'] ?? null) === true
                || ($requirement['teacher_course_qualification'] ?? null) === true
                || ($requirement['preserve_locked_entries'] ?? null) === true;
        }

        return ($category === ConstraintCategory::WeeklyLoad && $requirement === ['assignment_completeness' => true])
            || ($category === ConstraintCategory::RoomRequirement && $requirement === ['assignment_room_mode' => true]);
    }
}
