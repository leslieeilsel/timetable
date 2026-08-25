<?php

namespace App\Modules\Timetable\Services;

use App\Enums\RoomMode;
use App\Modules\TeachingTask\Models\TeachingTask;
use App\Support\ApiProblemException;

class RoomResolver
{
    public function resolve(TeachingTask $task): int
    {
        if ($task->room_mode === RoomMode::Specified) {
            if ($task->specified_room_id === null) {
                throw new ApiProblemException('ROOM_NOT_RESOLVED', '指定教室不能为空', 409);
            }

            return $task->specified_room_id;
        }

        $roomId = $task->semester->classSettings()
            ->where('school_class_id', $task->school_class_id)
            ->value('fixed_room_id');
        if ($roomId === null) {
            throw new ApiProblemException('ROOM_NOT_RESOLVED', '班级未设置本学期固定教室', 409);
        }

        return (int) $roomId;
    }
}
