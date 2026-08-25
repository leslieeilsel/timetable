<?php

namespace App\Modules\TeachingTask\Services;

use App\Enums\TaskStatus;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\TeachingTask\Models\TeachingTask;
use App\Modules\Timetable\Services\RoomResolver;
use App\Support\ApiProblemException;
use Illuminate\Support\Collection;

class CapacityService
{
    public function __construct(private readonly RoomResolver $rooms) {}

    /** @param Collection<int, TeachingTask> $additional */
    public function assertCanConfirm(Semester $semester, Collection $additional): void
    {
        $template = $semester->scheduleTemplate()->with(['days', 'items'])->first();
        $capacity = ($template?->days->where('is_enabled', true)->count() ?? 0)
            * ($template?->items->where('is_active', true)->where('allows_course', true)->count() ?? 0);
        if ($capacity <= 0) {
            throw new ApiProblemException('NO_SCHEDULE_CAPACITY', '当前学期没有可排课课节', 409);
        }

        $confirmed = $semester->teachingTasks()->where('status', TaskStatus::Confirmed->value)->get();
        $tasks = $confirmed->concat($additional)->unique('id')->values();
        $this->assertGrouped($tasks, 'school_class_id', 'class', $capacity);
        $this->assertGrouped($tasks, 'teacher_id', 'teacher', $capacity);

        $roomTotals = [];
        foreach ($tasks as $task) {
            if ($task->weekly_items > $capacity) {
                throw new ApiProblemException('TASK_CAPACITY_EXCEEDED', '单条教学任务课时超过每周可排槽位', 409, [
                    'task_id' => $task->id,
                    'required' => $task->weekly_items,
                    'capacity' => $capacity,
                ]);
            }
            $roomId = $this->rooms->resolve($task);
            $roomTotals[$roomId] = ($roomTotals[$roomId] ?? 0) + $task->weekly_items;
        }
        foreach ($roomTotals as $roomId => $required) {
            if ($required > $capacity) {
                throw new ApiProblemException('RESOURCE_CAPACITY_EXCEEDED', '教室总课时超过每周可排槽位', 409, [
                    'resource_type' => 'room', 'resource_id' => $roomId, 'required' => $required, 'capacity' => $capacity,
                ]);
            }
        }
    }

    /** @param Collection<int, TeachingTask> $tasks */
    private function assertGrouped(Collection $tasks, string $field, string $type, int $capacity): void
    {
        foreach ($tasks->groupBy($field) as $resourceId => $resourceTasks) {
            $required = (int) $resourceTasks->sum('weekly_items');
            if ($required > $capacity) {
                throw new ApiProblemException('RESOURCE_CAPACITY_EXCEEDED', '资源总课时超过每周可排槽位', 409, [
                    'resource_type' => $type, 'resource_id' => (int) $resourceId, 'required' => $required, 'capacity' => $capacity,
                ]);
            }
        }
    }
}
