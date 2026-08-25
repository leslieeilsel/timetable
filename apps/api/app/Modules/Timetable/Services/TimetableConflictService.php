<?php

namespace App\Modules\Timetable\Services;

use App\Modules\Timetable\Models\TimetableEntry;
use App\Support\ApiProblemException;

class TimetableConflictService
{
    public function assertAvailable(
        int $semesterId,
        int $classId,
        int $teacherId,
        int $roomId,
        int $weekday,
        int $itemId,
        ?int $exceptEntryId = null,
    ): void {
        $checks = [
            'class' => ['school_class_id', $classId, 'schoolClass'],
            'teacher' => ['teacher_id', $teacherId, 'teacher'],
            'room' => ['actual_room_id', $roomId, 'actualRoom'],
        ];
        $conflicts = [];
        foreach ($checks as $type => [$column, $resourceId, $relation]) {
            $entry = TimetableEntry::query()->with($relation)
                ->where('semester_id', $semesterId)
                ->where('weekday', $weekday)
                ->where('item_id', $itemId)
                ->where($column, $resourceId)
                ->when($exceptEntryId, fn ($query) => $query->whereKeyNot($exceptEntryId))
                ->first();
            if ($entry !== null) {
                $resource = $entry->{$relation};
                $conflicts[] = [
                    'resource_type' => $type,
                    'resource_id' => $resourceId,
                    'resource_name' => $resource->name,
                    'existing_entry_id' => $entry->id,
                    'weekday' => $weekday,
                    'item_id' => $itemId,
                ];
            }
        }
        if ($conflicts !== []) {
            throw new ApiProblemException('TIMETABLE_RESOURCE_CONFLICT', '该课节存在资源冲突', 409, ['conflicts' => $conflicts]);
        }
    }
}
