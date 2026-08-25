<?php

namespace App\Modules\Resources\Services;

use Illuminate\Support\Facades\DB;

class HistoricalReferenceService
{
    public function hasClosedReference(string $type, int $id): bool
    {
        return match ($type) {
            'grade' => DB::table('school_classes')
                ->join('semesters', 'semesters.academic_year_id', '=', 'school_classes.academic_year_id')
                ->where('school_classes.grade_id', $id)
                ->where('semesters.status', 'closed')
                ->exists(),
            'school_class' => DB::table('school_classes')
                ->join('semesters', 'semesters.academic_year_id', '=', 'school_classes.academic_year_id')
                ->where('school_classes.id', $id)
                ->where('semesters.status', 'closed')
                ->exists(),
            'teacher' => $this->closedSemesterReference('teaching_tasks', 'teacher_id', $id)
                || $this->closedSemesterReference('semester_class_settings', 'homeroom_teacher_id', $id),
            'course' => $this->closedSemesterReference('teaching_tasks', 'course_id', $id),
            'room' => $this->closedSemesterReference('semester_class_settings', 'fixed_room_id', $id)
                || $this->closedSemesterReference('teaching_tasks', 'specified_room_id', $id)
                || $this->closedSemesterReference('timetable_entries', 'actual_room_id', $id),
            default => false,
        };
    }

    private function closedSemesterReference(string $table, string $column, int $id): bool
    {
        return DB::table($table)
            ->join('semesters', 'semesters.id', '=', $table.'.semester_id')
            ->where($table.'.'.$column, $id)
            ->where('semesters.status', 'closed')
            ->exists();
    }
}
