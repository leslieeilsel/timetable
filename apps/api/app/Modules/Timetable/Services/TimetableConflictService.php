<?php

namespace App\Modules\Timetable\Services;

use App\Enums\WeekPattern;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use App\Modules\Scheduling\Services\WeekPatternService;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Support\ApiProblemException;
use Illuminate\Support\Facades\DB;

class TimetableConflictService
{
    public function __construct(private readonly WeekPatternService $weekPatterns) {}

    /**
     * @param  list<int>  $classIds
     * @param  list<int>  $teacherIds
     * @param  array<int, int>|null  $activeWeeks
     */
    public function assertAvailable(
        int $semesterId,
        int $timetableVersionId,
        array $classIds,
        array $teacherIds,
        int $roomId,
        int $weekday,
        int $itemId,
        WeekPattern $weekPattern = WeekPattern::All,
        ?int $exceptEntryId = null,
        ?array $activeWeeks = null,
    ): void {
        $semester = Semester::query()->findOrFail($semesterId);
        $conflicts = [];
        foreach (array_values(array_unique($classIds)) as $classId) {
            $entryIds = DB::table('timetable_entry_classes')
                ->where('timetable_version_id', $timetableVersionId)
                ->where('school_class_id', $classId)
                ->where('weekday', $weekday)
                ->where('item_id', $itemId)
                ->when($exceptEntryId !== null, fn ($query) => $query->where('timetable_entry_id', '!=', $exceptEntryId))
                ->pluck('timetable_entry_id');
            $entry = $this->firstOverlappingEntry($semester, $entryIds->all(), $weekPattern, $activeWeeks);
            if ($entry !== null) {
                $conflicts[] = [
                    'resource_type' => 'class',
                    'resource_id' => $classId,
                    'resource_name' => SchoolClass::query()->whereKey($classId)->value('name'),
                    'existing_entry_id' => $entry->id,
                    'weekday' => $weekday,
                    'item_id' => $itemId,
                    'week_pattern' => $entry->week_pattern->value,
                    'active_weeks' => $entry->active_weeks,
                ];
            }
        }
        foreach (array_values(array_unique($teacherIds)) as $teacherId) {
            $entryIds = DB::table('timetable_entry_teachers')
                ->where('timetable_version_id', $timetableVersionId)
                ->where('teacher_id', $teacherId)
                ->where('weekday', $weekday)
                ->where('item_id', $itemId)
                ->when($exceptEntryId !== null, fn ($query) => $query->where('timetable_entry_id', '!=', $exceptEntryId))
                ->pluck('timetable_entry_id');
            $entry = $this->firstOverlappingEntry($semester, $entryIds->all(), $weekPattern, $activeWeeks);
            if ($entry !== null) {
                $conflicts[] = [
                    'resource_type' => 'teacher',
                    'resource_id' => $teacherId,
                    'resource_name' => Teacher::query()->whereKey($teacherId)->value('name'),
                    'existing_entry_id' => $entry->id,
                    'weekday' => $weekday,
                    'item_id' => $itemId,
                    'week_pattern' => $entry->week_pattern->value,
                    'active_weeks' => $entry->active_weeks,
                ];
            }
        }
        $roomConflicts = TimetableEntry::query()
            ->where('semester_id', $semesterId)
            ->where('timetable_version_id', $timetableVersionId)
            ->where('actual_room_id', $roomId)
            ->where('weekday', $weekday)
            ->where('item_id', $itemId)
            ->when($exceptEntryId !== null, fn ($query) => $query->whereKeyNot($exceptEntryId))
            ->with('actualRoom')
            ->get();
        $roomConflict = $roomConflicts->first(fn (TimetableEntry $entry): bool => $this->weekPatterns->overlaps(
            $semester,
            $weekPattern,
            $activeWeeks,
            $entry->week_pattern,
            $entry->active_weeks,
        ));
        if ($roomConflict !== null) {
            $conflicts[] = [
                'resource_type' => 'room',
                'resource_id' => $roomId,
                'resource_name' => $roomConflict->actualRoom->name,
                'existing_entry_id' => $roomConflict->id,
                'weekday' => $weekday,
                'item_id' => $itemId,
                'week_pattern' => $roomConflict->week_pattern->value,
                'active_weeks' => $roomConflict->active_weeks,
            ];
        }
        if ($conflicts !== []) {
            throw new ApiProblemException('TIMETABLE_RESOURCE_CONFLICT', '该课节存在资源冲突', 409, ['conflicts' => $conflicts]);
        }
    }

    /**
     * @param  array<int, int>  $entryIds
     * @param  array<int, int>|null  $activeWeeks
     */
    private function firstOverlappingEntry(
        Semester $semester,
        array $entryIds,
        WeekPattern $weekPattern,
        ?array $activeWeeks,
    ): ?TimetableEntry {
        if ($entryIds === []) {
            return null;
        }

        return TimetableEntry::query()->whereIn('id', $entryIds)->get()
            ->first(fn (TimetableEntry $entry): bool => $this->weekPatterns->overlaps(
                $semester,
                $weekPattern,
                $activeWeeks,
                $entry->week_pattern,
                $entry->active_weeks,
            ));
    }
}
