<?php

namespace App\Modules\TeachingAssignment\Services;

use App\Enums\AssignmentStatus;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\Timetable\Services\RoomResolver;
use App\Support\ApiProblemException;
use Illuminate\Support\Collection;

class CapacityService
{
    public function __construct(private readonly RoomResolver $rooms) {}

    /** @param Collection<int, TeachingAssignment> $additional */
    public function assertCanConfirm(Semester $semester, Collection $additional): void
    {
        $template = $semester->scheduleTemplate()->with(['days', 'items'])->first();
        $capacity = ($template?->days->where('is_enabled', true)->count() ?? 0)
            * ($template?->items->where('is_active', true)->where('allows_course', true)->count() ?? 0);
        if ($capacity <= 0) {
            throw new ApiProblemException('NO_SCHEDULE_CAPACITY', '当前学期没有可排课课节', 409);
        }

        $confirmed = $semester->teachingAssignments()->where('status', AssignmentStatus::Confirmed->value)
            ->with(['teachingGroup.schoolClasses', 'collaborators'])->get();
        $assignments = $confirmed->concat($additional)->unique('id')->values();
        $assignments->each->loadMissing(['teachingGroup.schoolClasses', 'collaborators']);
        $totals = ['class' => [], 'teacher' => [], 'room' => []];
        foreach ($assignments as $assignment) {
            if ($assignment->weekly_items > $capacity) {
                throw new ApiProblemException('ASSIGNMENT_CAPACITY_EXCEEDED', '单条任课关系课时超过每周可排槽位', 409, [
                    'assignment_id' => $assignment->id,
                    'required' => $assignment->weekly_items,
                    'capacity' => $capacity,
                ]);
            }
            $classIds = $assignment->school_class_id !== null
                ? [$assignment->school_class_id]
                : $assignment->teachingGroup?->schoolClasses->pluck('id')->all() ?? [];
            foreach ($classIds as $classId) {
                $totals['class'][$classId] = ($totals['class'][$classId] ?? 0) + $assignment->weekly_items;
            }
            $teacherIds = [$assignment->teacher_id, ...$assignment->collaborators->pluck('id')->all()];
            foreach ($teacherIds as $teacherId) {
                $totals['teacher'][$teacherId] = ($totals['teacher'][$teacherId] ?? 0) + $assignment->weekly_items;
            }
            $roomId = $this->rooms->resolve($assignment);
            $totals['room'][$roomId] = ($totals['room'][$roomId] ?? 0) + $assignment->weekly_items;
        }
        foreach ($totals as $type => $resourceTotals) {
            foreach ($resourceTotals as $resourceId => $required) {
                if ($required > $capacity) {
                    throw new ApiProblemException('RESOURCE_CAPACITY_EXCEEDED', '资源总课时超过每周可排槽位', 409, [
                        'resource_type' => $type, 'resource_id' => (int) $resourceId,
                        'required' => $required, 'capacity' => $capacity,
                    ]);
                }
            }
        }
    }
}
