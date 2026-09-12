<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * @return array{
 *   semester_id: int,
 *   version_id: int,
 *   entry_id: int,
 *   class_id: int,
 *   teacher_id: int,
 *   substitute_teacher_id: int,
 *   item_ids: list<int>
 * }
 */
function dailyOperationsFixture(int $userId, bool $withTargetConflict = false): array
{
    $now = now();
    $yearId = DB::table('academic_years')->insertGetId([
        'name' => '2026-2027 学年', 'start_date' => '2026-09-01', 'end_date' => '2027-07-15',
        'status' => 'open', 'created_at' => $now, 'updated_at' => $now,
    ]);
    $semesterId = DB::table('semesters')->insertGetId([
        'academic_year_id' => $yearId, 'name' => '上学期', 'sequence' => 1,
        'start_date' => '2026-09-01', 'end_date' => '2027-01-20', 'status' => 'open',
        'input_revision' => 1, 'assignment_revision' => 1,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $gradeId = DB::table('grades')->insertGetId([
        'name' => '七年级', 'sort_order' => 7, 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $teacherId = DB::table('teachers')->insertGetId([
        'employee_no' => 'T001', 'name' => '胡静', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $substituteTeacherId = DB::table('teachers')->insertGetId([
        'employee_no' => 'T002', 'name' => '陈敏', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $courseId = DB::table('courses')->insertGetId([
        'name' => '数学', 'short_name' => '数', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    DB::table('teacher_course')->insert([
        ['teacher_id' => $teacherId, 'course_id' => $courseId],
        ['teacher_id' => $substituteTeacherId, 'course_id' => $courseId],
    ]);
    $roomId = DB::table('rooms')->insertGetId([
        'name' => '七年级 1 班教室', 'type' => 'classroom', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $classId = DB::table('school_classes')->insertGetId([
        'academic_year_id' => $yearId, 'grade_id' => $gradeId, 'name' => '七年级 1 班',
        'code' => 'G7C1', 'status' => 'active', 'created_at' => $now, 'updated_at' => $now,
    ]);
    DB::table('semester_class_settings')->insert([
        'semester_id' => $semesterId, 'academic_year_id' => $yearId, 'school_class_id' => $classId,
        'fixed_room_id' => $roomId, 'status' => 'active', 'created_at' => $now, 'updated_at' => $now,
    ]);
    $templateId = DB::table('schedule_templates')->insertGetId([
        'semester_id' => $semesterId, 'name' => '标准作息', 'created_at' => $now, 'updated_at' => $now,
    ]);
    foreach (range(1, 7) as $weekday) {
        DB::table('schedule_template_days')->insert([
            'schedule_template_id' => $templateId, 'semester_id' => $semesterId,
            'weekday' => $weekday, 'is_enabled' => $weekday <= 5,
        ]);
    }
    $itemIds = [];
    foreach ([['第 1 节', '08:00', '08:45'], ['第 2 节', '08:55', '09:40']] as $index => [$name, $start, $end]) {
        $itemIds[] = DB::table('items')->insertGetId([
            'schedule_template_id' => $templateId, 'semester_id' => $semesterId, 'name' => $name,
            'type' => 'course', 'start_time' => $start, 'end_time' => $end, 'sort_order' => $index + 1,
            'allows_course' => true, 'allows_teacher' => true, 'counts_as_course' => true,
            'show_in_official' => true, 'show_in_full' => true, 'is_active' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
    }
    $assignmentId = DB::table('teaching_assignments')->insertGetId([
        'semester_id' => $semesterId, 'academic_year_id' => $yearId, 'school_class_id' => $classId,
        'course_id' => $courseId, 'teacher_id' => $teacherId, 'weekly_items' => 1,
        'week_pattern' => 'specified', 'active_weeks' => json_encode([1, 3], JSON_THROW_ON_ERROR),
        'room_mode' => 'class_default', 'allows_substitution' => true, 'status' => 'confirmed',
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $versionId = DB::table('timetable_versions')->insertGetId([
        'semester_id' => $semesterId, 'version_no' => 1, 'name' => '当前课表',
        'status' => 'active', 'source' => 'manual', 'created_by' => $userId,
        'input_revision' => 1, 'hard_conflict_count' => 0, 'soft_warning_count' => 0,
        'activated_at' => $now, 'created_at' => $now, 'updated_at' => $now,
    ]);
    $entryId = insertDailyEntry(
        $semesterId,
        $versionId,
        $assignmentId,
        $classId,
        $teacherId,
        $courseId,
        $roomId,
        $itemIds[0],
        $now,
    );

    if ($withTargetConflict) {
        $conflictTeacherId = DB::table('teachers')->insertGetId([
            'employee_no' => 'T003', 'name' => '李强', 'is_active' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $conflictCourseId = DB::table('courses')->insertGetId([
            'name' => '语文', 'short_name' => '语', 'is_active' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('teacher_course')->insert([
            'teacher_id' => $conflictTeacherId, 'course_id' => $conflictCourseId,
        ]);
        $conflictAssignmentId = DB::table('teaching_assignments')->insertGetId([
            'semester_id' => $semesterId, 'academic_year_id' => $yearId, 'school_class_id' => $classId,
            'course_id' => $conflictCourseId, 'teacher_id' => $conflictTeacherId, 'weekly_items' => 1,
            'week_pattern' => 'specified', 'active_weeks' => json_encode([1, 3], JSON_THROW_ON_ERROR),
            'room_mode' => 'class_default', 'status' => 'confirmed',
            'created_at' => $now, 'updated_at' => $now,
        ]);
        insertDailyEntry(
            $semesterId,
            $versionId,
            $conflictAssignmentId,
            $classId,
            $conflictTeacherId,
            $conflictCourseId,
            $roomId,
            $itemIds[1],
            $now,
        );
    }
    DB::table('semesters')->where('id', $semesterId)->update([
        'current_timetable_version_id' => $versionId,
        'updated_at' => $now,
    ]);

    return [
        'semester_id' => $semesterId,
        'version_id' => $versionId,
        'entry_id' => $entryId,
        'class_id' => $classId,
        'teacher_id' => $teacherId,
        'substitute_teacher_id' => $substituteTeacherId,
        'item_ids' => $itemIds,
    ];
}

function insertDailyEntry(
    int $semesterId,
    int $versionId,
    int $assignmentId,
    int $classId,
    int $teacherId,
    int $courseId,
    int $roomId,
    int $itemId,
    mixed $now,
): int {
    $entryId = DB::table('timetable_entries')->insertGetId([
        'entry_key' => (string) Str::uuid(),
        'semester_id' => $semesterId, 'timetable_version_id' => $versionId,
        'teaching_assignment_id' => $assignmentId, 'school_class_id' => $classId,
        'teacher_id' => $teacherId, 'course_id' => $courseId, 'actual_room_id' => $roomId,
        'week_pattern' => 'specified', 'active_weeks' => json_encode([1, 3], JSON_THROW_ON_ERROR),
        'weekday' => 1, 'item_id' => $itemId, 'source' => 'manual', 'is_locked' => false,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $pivot = [
        'timetable_entry_id' => $entryId,
        'timetable_version_id' => $versionId,
        'week_pattern' => 'specified',
        'weekday' => 1,
        'item_id' => $itemId,
    ];
    DB::table('timetable_entry_classes')->insert([...$pivot, 'school_class_id' => $classId]);
    DB::table('timetable_entry_teachers')->insert([...$pivot, 'teacher_id' => $teacherId]);

    return $entryId;
}
