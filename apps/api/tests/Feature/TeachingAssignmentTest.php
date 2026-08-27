<?php

use App\Enums\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->scheduler = User::factory()->create([
        'role' => Role::Scheduler,
        'must_change_password' => false,
    ]);
    $this->actingAs($this->scheduler)->withSession(['auth_version' => $this->scheduler->auth_version]);
});

it('supports teaching groups, collaborators, consecutive items and specified weeks', function (): void {
    $fixture = extendedAssignmentFixture();
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->assertOk()->headers->get('ETag');

    $createdGroup = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/teaching-groups", [
            'name' => '七年级体育合班',
            'mode' => 'combined',
            'school_class_ids' => $fixture['class_ids'],
        ])->assertCreated()
        ->assertJsonPath('data.mode', 'combined')
        ->assertJsonCount(2, 'data.school_classes');
    $groupId = $createdGroup->json('data.id');

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/teaching-groups?per_page=20")
        ->assertOk()
        ->assertJsonPath('meta.pagination.total', 1)
        ->assertJsonPath('data.0.assignments_count', 0);

    $createdAssignment = $this->withHeader('If-Match', $createdGroup->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/teaching-assignments", [
            'teaching_group_id' => $groupId,
            'course_id' => $fixture['course_id'],
            'teacher_id' => $fixture['teacher_ids'][0],
            'collaborator_ids' => [$fixture['teacher_ids'][1]],
            'weekly_items' => 2,
            'items_per_session' => 2,
            'week_pattern' => 'specified',
            'active_weeks' => [1, 3, 5],
            'room_mode' => 'specified',
            'specified_room_id' => $fixture['room_id'],
            'allows_substitution' => false,
        ])->assertCreated()
        ->assertJsonPath('data.teaching_group.id', $groupId)
        ->assertJsonPath('data.items_per_session', 2)
        ->assertJsonPath('data.week_pattern', 'specified')
        ->assertJsonPath('data.active_weeks.1', 3)
        ->assertJsonPath('data.allows_substitution', false)
        ->assertJsonPath('data.collaborators.0.id', $fixture['teacher_ids'][1]);

    $this->withHeader('If-Match', $createdAssignment->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/teaching-assignments", [
            'school_class_id' => $fixture['class_ids'][0],
            'course_id' => $fixture['course_id'],
            'teacher_id' => $fixture['teacher_ids'][0],
            'collaborator_ids' => [$fixture['teacher_ids'][0]],
            'weekly_items' => 1,
            'room_mode' => 'class_default',
        ])->assertStatus(422)
        ->assertJsonPath('code', 'ASSIGNMENT_COLLABORATOR_INVALID');

    $bulk = $this->withHeader('If-Match', $createdAssignment->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/teaching-assignments/bulk", [
            'operations' => collect($fixture['class_ids'])->map(fn (int $classId): array => [
                'school_class_id' => $classId,
                'course_id' => $fixture['course_id'],
                'teacher_id' => $fixture['teacher_ids'][0],
                'weekly_items' => 1,
                'room_mode' => 'class_default',
            ])->all(),
        ])->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.status', 'draft');

    $assignmentId = $createdAssignment->json('data.id');
    $confirmed = $this->withHeader('If-Match', $bulk->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/teaching-assignments/confirm", [
            'assignment_ids' => [$assignmentId],
        ])->assertOk()
        ->assertJsonPath('data.confirmed_ids.0', $assignmentId);

    $this->withHeader('If-Match', $confirmed->headers->get('ETag'))
        ->patchJson("/api/v1/semesters/{$fixture['semester_id']}/teaching-groups/{$groupId}", [
            'status' => 'inactive',
        ])->assertStatus(409)
        ->assertJsonPath('code', 'TEACHING_GROUP_IN_USE');
});

/**
 * @return array{semester_id: int, class_ids: list<int>, teacher_ids: list<int>, course_id: int, room_id: int}
 */
function extendedAssignmentFixture(): array
{
    $now = now();
    $yearId = DB::table('academic_years')->insertGetId([
        'name' => '2026-2027 学年', 'start_date' => '2026-09-01', 'end_date' => '2027-07-15',
        'status' => 'open', 'created_at' => $now, 'updated_at' => $now,
    ]);
    $semesterId = DB::table('semesters')->insertGetId([
        'academic_year_id' => $yearId, 'name' => '上学期', 'sequence' => 1,
        'start_date' => '2026-09-01', 'end_date' => '2027-01-20', 'status' => 'open',
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $gradeId = DB::table('grades')->insertGetId([
        'name' => '七年级', 'sort_order' => 7, 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $courseId = DB::table('courses')->insertGetId([
        'name' => '体育', 'short_name' => '体', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $roomId = DB::table('rooms')->insertGetId([
        'name' => '操场', 'type' => 'playground', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $teacherIds = [];
    foreach ([['T001', '周老师'], ['T002', '吴老师']] as [$employeeNo, $name]) {
        $teacherIds[] = DB::table('teachers')->insertGetId([
            'employee_no' => $employeeNo, 'name' => $name, 'is_active' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
    }
    foreach ($teacherIds as $teacherId) {
        DB::table('teacher_course')->insert(['teacher_id' => $teacherId, 'course_id' => $courseId]);
    }
    $classIds = [];
    foreach ([1, 2] as $index) {
        $classId = DB::table('school_classes')->insertGetId([
            'academic_year_id' => $yearId, 'grade_id' => $gradeId,
            'name' => "七年级 {$index} 班", 'code' => "G7C{$index}", 'status' => 'active',
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $classIds[] = $classId;
        DB::table('semester_class_settings')->insert([
            'semester_id' => $semesterId, 'academic_year_id' => $yearId,
            'school_class_id' => $classId, 'fixed_room_id' => $roomId, 'status' => 'active',
            'created_at' => $now, 'updated_at' => $now,
        ]);
    }
    $templateId = DB::table('schedule_templates')->insertGetId([
        'semester_id' => $semesterId, 'name' => '标准作息',
        'created_at' => $now, 'updated_at' => $now,
    ]);
    foreach (range(1, 5) as $weekday) {
        DB::table('schedule_template_days')->insert([
            'schedule_template_id' => $templateId, 'semester_id' => $semesterId,
            'weekday' => $weekday, 'is_enabled' => true,
        ]);
    }
    foreach (range(1, 4) as $order) {
        DB::table('items')->insert([
            'schedule_template_id' => $templateId, 'semester_id' => $semesterId,
            'name' => "第 {$order} 节", 'type' => 'course', 'start_time' => '08:00',
            'end_time' => '08:45', 'sort_order' => $order, 'allows_course' => true,
            'allows_teacher' => true, 'counts_as_course' => true, 'show_in_official' => true,
            'show_in_full' => true, 'is_active' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
    }

    return [
        'semester_id' => $semesterId,
        'class_ids' => $classIds,
        'teacher_ids' => $teacherIds,
        'course_id' => $courseId,
        'room_id' => $roomId,
    ];
}
