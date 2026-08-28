<?php

use App\Enums\Role;
use App\Models\User;

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->admin = User::factory()->create([
        'email' => 'admin@example.test',
        'role' => Role::Admin,
        'must_change_password' => false,
    ]);
    $this->actingAs($this->admin)->withSession(['auth_version' => $this->admin->auth_version]);
});

it('enforces optimistic concurrency for catalog writes', function (): void {
    $etag = $this->getJson('/api/v1/catalog')->assertOk()->headers->get('ETag');

    $response = $this->withHeader('If-Match', $etag)->postJson('/api/v1/grades', [
        'name' => '一年级',
        'sort_order' => 1,
    ])->assertCreated();

    expect($response->headers->get('ETag'))->not->toBe($etag);

    $this->withHeader('If-Match', $etag)->postJson('/api/v1/courses', [
        'name' => '语文',
    ])->assertStatus(412)
        ->assertJsonPath('code', 'CATALOG_ETAG_CONFLICT');
});

it('updates a teacher course assignment through the declared pivot table', function (): void {
    $etag = $this->getJson('/api/v1/catalog')->headers->get('ETag');
    $courseResponse = $this->withHeader('If-Match', $etag)->postJson('/api/v1/courses', [
        'name' => '语文',
    ])->assertCreated();
    $courseId = $courseResponse->json('data.id');
    $etag = $courseResponse->headers->get('ETag');
    $teacherResponse = $this->withHeader('If-Match', $etag)->postJson('/api/v1/teachers', [
        'name' => '陈老师',
    ])->assertCreated();
    $teacherId = $teacherResponse->json('data.id');

    $assigned = $this->withHeader('If-Match', $teacherResponse->headers->get('ETag'))
        ->putJson("/api/v1/teachers/{$teacherId}/courses", ['course_ids' => [$courseId]])
        ->assertOk()
        ->assertJsonPath('data.courses.0.id', $courseId);

    $this->withHeader('If-Match', $assigned->headers->get('ETag'))
        ->putJson("/api/v1/teachers/{$teacherId}/courses", ['course_ids' => []])
        ->assertOk()
        ->assertJsonCount(0, 'data.courses');
});

it('builds a semester and rejects a teacher conflict in the same slot', function (): void {
    $catalogEtag = $this->getJson('/api/v1/catalog')->headers->get('ETag');

    $response = $this->withHeader('If-Match', $catalogEtag)->postJson('/api/v1/grades', [
        'name' => '一年级', 'sort_order' => 1,
    ])->assertCreated();
    $grade = $response->json('data');
    $catalogEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $catalogEtag)->postJson('/api/v1/teachers', [
        'name' => '陈老师', 'employee_no' => 'T001',
    ])->assertCreated();
    $teacher = $response->json('data');
    $catalogEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $catalogEtag)->postJson('/api/v1/courses', [
        'name' => '语文', 'short_name' => '语',
    ])->assertCreated();
    $courseA = $response->json('data');
    $catalogEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $catalogEtag)->postJson('/api/v1/courses', [
        'name' => '数学', 'short_name' => '数',
    ])->assertCreated();
    $courseB = $response->json('data');
    $catalogEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $catalogEtag)
        ->putJson("/api/v1/teachers/{$teacher['id']}/courses", [
            'course_ids' => [$courseA['id'], $courseB['id']],
        ])->assertOk();
    $catalogEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $catalogEtag)->postJson('/api/v1/rooms', [
        'name' => '101 教室', 'type' => 'classroom',
    ])->assertCreated();
    $roomA = $response->json('data');
    $catalogEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $catalogEtag)->postJson('/api/v1/rooms', [
        'name' => '102 教室', 'type' => 'classroom',
    ])->assertCreated();
    $roomB = $response->json('data');
    $catalogEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $catalogEtag)->postJson('/api/v1/academic-years', [
        'name' => '2026-2027 学年', 'start_date' => '2026-09-01', 'end_date' => '2027-07-15',
    ])->assertCreated();
    $year = $response->json('data');
    $catalogEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $catalogEtag)->postJson("/api/v1/academic-years/{$year['id']}/semesters", [
        'sequence' => 1, 'start_date' => '2026-09-01', 'end_date' => '2027-01-20',
    ])->assertCreated();
    $semesterA = $response->json('data');
    $catalogEtag = $this->getJson('/api/v1/catalog')->headers->get('ETag');

    $this->withHeader('If-Match', $catalogEtag)->postJson("/api/v1/academic-years/{$year['id']}/semesters", [
        'sequence' => 2, 'start_date' => '2027-02-15', 'end_date' => '2027-07-15',
    ])->assertCreated();
    $catalogEtag = $this->getJson('/api/v1/catalog')->headers->get('ETag');

    $response = $this->withHeader('If-Match', $catalogEtag)->postJson("/api/v1/academic-years/{$year['id']}/classes", [
        'grade_id' => $grade['id'], 'name' => '一年级 1 班', 'code' => 'G1C1',
    ])->assertCreated();
    $classA = $response->json('data');
    $catalogEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $catalogEtag)->postJson("/api/v1/academic-years/{$year['id']}/classes", [
        'grade_id' => $grade['id'], 'name' => '一年级 2 班', 'code' => 'G1C2',
    ])->assertCreated();
    $classB = $response->json('data');
    $catalogEtag = $response->headers->get('ETag');

    $this->withHeader('If-Match', $catalogEtag)->postJson("/api/v1/academic-years/{$year['id']}/open")
        ->assertOk();

    $semesterEtag = $this->getJson("/api/v1/semesters/{$semesterA['id']}")->headers->get('ETag');
    $response = $this->withHeader('If-Match', $semesterEtag)->putJson("/api/v1/semesters/{$semesterA['id']}/class-settings/{$classA['id']}", [
        'fixed_room_id' => $roomA['id'], 'status' => 'active',
    ])->assertOk();
    $semesterEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $semesterEtag)->putJson("/api/v1/semesters/{$semesterA['id']}/class-settings/{$classB['id']}", [
        'fixed_room_id' => $roomB['id'], 'status' => 'active',
    ])->assertOk();
    $semesterEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $semesterEtag)->putJson("/api/v1/semesters/{$semesterA['id']}/schedule-template", [
        'name' => '标准作息',
        'days' => collect(range(1, 7))->map(fn (int $day): array => ['weekday' => $day, 'is_enabled' => $day <= 5])->all(),
        'items' => [[
            'name' => '第 1 节', 'type' => 'course', 'start_time' => '08:00', 'end_time' => '08:40',
            'sort_order' => 1, 'is_active' => true,
        ]],
    ])->assertOk()
        ->assertJsonPath('data.items.0.start_time', '08:00')
        ->assertJsonPath('data.items.0.end_time', '08:40');
    $template = $response->json('data');
    $semesterEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $semesterEtag)->postJson("/api/v1/semesters/{$semesterA['id']}/open")
        ->assertOk();
    $semesterEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $semesterEtag)->postJson("/api/v1/semesters/{$semesterA['id']}/teaching-assignments", [
        'school_class_id' => $classA['id'], 'course_id' => $courseA['id'], 'teacher_id' => $teacher['id'],
        'weekly_items' => 1, 'room_mode' => 'class_default',
    ])->assertCreated();
    $assignmentA = $response->json('data');
    $semesterEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $semesterEtag)->postJson("/api/v1/semesters/{$semesterA['id']}/teaching-assignments", [
        'school_class_id' => $classB['id'], 'course_id' => $courseB['id'], 'teacher_id' => $teacher['id'],
        'weekly_items' => 1, 'room_mode' => 'class_default',
    ])->assertCreated();
    $assignmentB = $response->json('data');
    $semesterEtag = $response->headers->get('ETag');

    $response = $this->withHeader('If-Match', $semesterEtag)->postJson("/api/v1/semesters/{$semesterA['id']}/teaching-assignments/confirm", [
        'assignment_ids' => [$assignmentA['id'], $assignmentB['id']],
    ])->assertOk();
    $semesterEtag = $response->headers->get('ETag');

    $itemId = $template['items'][0]['id'];
    $response = $this->withHeader('If-Match', $semesterEtag)->postJson("/api/v1/semesters/{$semesterA['id']}/timetable/entries", [
        'teaching_assignment_id' => $assignmentA['id'], 'weekday' => 1, 'item_id' => $itemId,
    ])->assertCreated();
    $semesterEtag = $response->headers->get('ETag');

    $this->withHeader('If-Match', $semesterEtag)->postJson("/api/v1/semesters/{$semesterA['id']}/timetable/entries", [
        'teaching_assignment_id' => $assignmentB['id'], 'weekday' => 1, 'item_id' => $itemId,
    ])->assertStatus(409)
        ->assertJsonPath('code', 'TIMETABLE_PLACEMENT_NOT_ALLOWED')
        ->assertJsonPath('diagnostics.hard_conflicts.0.type', 'teacher')
        ->assertJsonPath('diagnostics.hard_conflicts.0.resource_name', '陈老师');

    $export = $this->get("/api/v1/semesters/{$semesterA['id']}/timetable/export.csv?view=class&resource_id={$classA['id']}&mode=official")
        ->assertOk();
    expect($export->headers->get('content-type'))->toContain('text/csv')
        ->and($export->streamedContent())->toContain('2026-2027 学年')
        ->and($export->streamedContent())->toContain('一年级 1 班');

    $this->get("/api/v1/semesters/{$semesterA['id']}/timetable/export.xlsx?view=class&resource_id={$classA['id']}&mode=official")
        ->assertOk()
        ->assertHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        ->assertDownload("timetable-semester-{$semesterA['id']}-v1-class-{$classA['id']}.xlsx");

    $this->putJson('/api/v1/context/current-semester', ['semester_id' => $semesterA['id']])
        ->assertOk()
        ->assertJsonPath('data.current_semester.id', $semesterA['id']);
    $closed = $this->withHeader('If-Match', $semesterEtag)
        ->postJson("/api/v1/semesters/{$semesterA['id']}/close", ['reason' => '验收未排满任务的管理员强制关闭'])
        ->assertOk()
        ->assertJsonPath('data.status', 'closed');
    $this->getJson('/api/v1/context')->assertOk()->assertJsonPath('data.current_semester', null);
    $this->withHeader('If-Match', $closed->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$semesterA['id']}/timetable/entries", [
            'teaching_assignment_id' => $assignmentA['id'], 'weekday' => 2, 'item_id' => $itemId,
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'SEMESTER_NOT_EDITABLE');
    $this->withHeader('If-Match', $closed->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$semesterA['id']}/reopen", ['reason' => '验收历史学期重开审计'])
        ->assertOk()
        ->assertJsonPath('data.status', 'open');
})->group('mysql');
