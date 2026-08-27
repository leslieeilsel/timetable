<?php

namespace App\Modules\Scheduling\Services;

use App\Enums\AssignmentStatus;
use App\Enums\ResourceStatus;
use App\Enums\WeekPattern;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\Room;
use App\Modules\ScheduleTemplate\Models\Item;
use App\Modules\ScheduleTemplate\Models\ScheduleTemplateDay;
use App\Modules\Scheduling\Models\FixedPlacement;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\Timetable\Services\RoomResolver;
use App\Support\ApiProblemException;

class FixedPlacementService
{
    public function __construct(
        private readonly RoomResolver $rooms,
        private readonly WeekPatternService $weekPatterns,
    ) {}

    /**
     * @param  array<string, mixed>  $data
     * @return array{room_id: int, active_weeks: array<int, int>|null}
     */
    public function assertValid(Semester $semester, array $data, ?int $exceptId = null): array
    {
        $assignment = TeachingAssignment::query()
            ->with(['semester', 'teachingGroup.schoolClasses', 'collaborators'])
            ->where('semester_id', $semester->id)
            ->find($data['teaching_assignment_id']);
        if ($assignment === null || $assignment->status !== AssignmentStatus::Confirmed) {
            throw new ApiProblemException('FIXED_ASSIGNMENT_INVALID', '固定安排只能选择本学期已确认任课关系', 422);
        }
        $day = ScheduleTemplateDay::query()
            ->where('semester_id', $semester->id)
            ->where('weekday', $data['weekday'])->first();
        $item = Item::query()->where('semester_id', $semester->id)->find($data['item_id']);
        if ($day === null || ! $day->is_enabled || $item === null || ! $item->is_active || ! $item->allows_course || ! $item->counts_as_course) {
            throw new ApiProblemException('FIXED_SLOT_INVALID', '固定安排必须选择允许排课的工作日和课节', 422);
        }

        $roomId = isset($data['room_id']) ? (int) $data['room_id'] : $this->rooms->resolve($assignment);
        if (! Room::query()->whereKey($roomId)->where('is_active', true)->exists()) {
            throw new ApiProblemException('FIXED_ROOM_INVALID', '固定安排教室不存在或已停用', 422);
        }
        $weekPattern = $data['week_pattern'] instanceof WeekPattern
            ? $data['week_pattern']
            : WeekPattern::from($data['week_pattern']);
        if ($weekPattern !== $assignment->week_pattern) {
            throw new ApiProblemException('FIXED_WEEK_PATTERN_MISMATCH', '固定安排的周型必须与任课关系一致', 422, [
                'assignment_week_pattern' => $assignment->week_pattern->value,
                'placement_week_pattern' => $weekPattern->value,
            ]);
        }
        $activeWeeks = $weekPattern === WeekPattern::Specified ? $assignment->active_weeks : null;
        $fixedCount = FixedPlacement::query()
            ->where('semester_id', $semester->id)
            ->where('teaching_assignment_id', $assignment->id)
            ->where('status', ResourceStatus::Active->value)
            ->when($exceptId !== null, fn ($query) => $query->whereKeyNot($exceptId))
            ->count();
        if ($fixedCount >= $assignment->weekly_items) {
            throw new ApiProblemException('FIXED_ASSIGNMENT_LIMIT_REACHED', '固定安排数量不能超过任课关系每周课时', 409, [
                'assignment_id' => $assignment->id,
                'weekly_items' => $assignment->weekly_items,
            ]);
        }

        $candidateResources = $this->resourceKeys($assignment, $roomId);
        $conflicts = FixedPlacement::query()
            ->where('semester_id', $semester->id)
            ->where('status', ResourceStatus::Active->value)
            ->where('weekday', $data['weekday'])
            ->where('item_id', $data['item_id'])
            ->when($exceptId !== null, fn ($query) => $query->whereKeyNot($exceptId))
            ->with(['teachingAssignment.semester', 'teachingAssignment.teachingGroup.schoolClasses', 'teachingAssignment.collaborators'])
            ->get();
        foreach ($conflicts as $conflict) {
            if (! $this->weekPatterns->overlaps(
                $semester,
                $weekPattern,
                $activeWeeks,
                $conflict->week_pattern,
                $conflict->active_weeks,
            )) {
                continue;
            }
            $conflictRoomId = $conflict->room_id ?? $this->rooms->resolve($conflict->teachingAssignment);
            $shared = array_values(array_intersect($candidateResources, $this->resourceKeys($conflict->teachingAssignment, $conflictRoomId)));
            if ($shared !== []) {
                throw new ApiProblemException('FIXED_PLACEMENT_CONFLICT', '该固定安排与已有固定安排发生资源冲突', 409, [
                    'conflicting_placement_id' => $conflict->id,
                    'shared_resources' => $shared,
                ]);
            }
        }

        return ['room_id' => $roomId, 'active_weeks' => $activeWeeks];
    }

    /** @return list<string> */
    public function resourceKeys(TeachingAssignment $assignment, int $roomId): array
    {
        $keys = ["teacher:{$assignment->teacher_id}", "room:{$roomId}"];
        foreach ($assignment->collaborators as $collaborator) {
            $keys[] = "teacher:{$collaborator->id}";
        }
        if ($assignment->school_class_id !== null) {
            $keys[] = "school_class:{$assignment->school_class_id}";
        } elseif ($assignment->teachingGroup !== null) {
            foreach ($assignment->teachingGroup->schoolClasses as $schoolClass) {
                $keys[] = "school_class:{$schoolClass->id}";
            }
        }

        return array_values(array_unique($keys));
    }
}
