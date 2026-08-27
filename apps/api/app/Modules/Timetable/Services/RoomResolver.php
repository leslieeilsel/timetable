<?php

namespace App\Modules\Timetable\Services;

use App\Enums\RoomMode;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Support\ApiProblemException;

class RoomResolver
{
    public function resolve(TeachingAssignment $assignment): int
    {
        if ($assignment->room_mode === RoomMode::Specified) {
            if ($assignment->specified_room_id === null) {
                throw new ApiProblemException('ROOM_NOT_RESOLVED', '指定教室不能为空', 409);
            }

            return $assignment->specified_room_id;
        }

        $roomId = $assignment->semester->classSettings()
            ->where('school_class_id', $assignment->school_class_id)
            ->value('fixed_room_id');
        if ($roomId === null) {
            throw new ApiProblemException('ROOM_NOT_RESOLVED', '班级未设置本学期固定教室', 409);
        }

        return (int) $roomId;
    }
}
