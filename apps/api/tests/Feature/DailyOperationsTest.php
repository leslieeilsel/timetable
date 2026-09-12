<?php

use App\Enums\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/../Fixtures/DailyOperationsFixture.php';

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->scheduler = User::factory()->create([
        'email' => 'daily-operator@example.test',
        'role' => Role::Scheduler,
        'must_change_password' => false,
    ]);
    $this->actingAs($this->scheduler)->withSession(['auth_version' => $this->scheduler->auth_version]);
});

it('resolves the actual date timetable with real specified-week semantics', function (): void {
    $fixture = dailyOperationsFixture($this->scheduler->id);

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date=2026-09-07")
        ->assertOk()
        ->assertJsonPath('data.week_number', 1)
        ->assertJsonPath('data.summary.total', 1)
        ->assertJsonPath('data.rows.0.original_entry_id', $fixture['entry_id'])
        ->assertJsonPath('data.rows.0.week_pattern', 'specified');

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date=2026-09-14")
        ->assertOk()
        ->assertJsonPath('data.week_number', 2)
        ->assertJsonPath('data.summary.total', 0)
        ->assertJsonCount(0, 'data.rows');
});

it('previews and stores a date-only move without mutating the base weekly timetable', function (): void {
    $fixture = dailyOperationsFixture($this->scheduler->id);
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $payload = [
        'effective_date' => '2026-09-07',
        'type' => 'move',
        'original_entry_id' => $fixture['entry_id'],
        'replacement_item_id' => $fixture['item_ids'][1],
        'reason' => '参加年级统一体检，临时后移一节',
    ];

    $preview = $this->postJson("/api/v1/semesters/{$fixture['semester_id']}/calendar-exceptions/preview", $payload)
        ->assertOk()
        ->assertJsonPath('data.allowed', true)
        ->assertJsonPath('data.affected.0.entry_id', $fixture['entry_id'])
        ->assertJsonPath('data.version_id', $fixture['version_id']);

    $stored = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/calendar-exceptions", $payload)
        ->assertCreated()
        ->assertJsonPath('data.effective_date', '2026-09-07')
        ->assertJsonPath('data.type', 'move')
        ->assertJsonPath('data.status', 'active');

    expect(DB::table('timetable_entries')->where('id', $fixture['entry_id'])->value('item_id'))
        ->toBe($fixture['item_ids'][0]);

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date=2026-09-07")
        ->assertOk()
        ->assertJsonPath('data.summary.temporary', 2)
        ->assertJsonPath('data.summary.cancelled', 1)
        ->assertJsonPath('data.rows.0.status', 'moved_out')
        ->assertJsonPath('data.rows.1.status', 'moved_in')
        ->assertJsonPath('data.rows.1.item_id', $fixture['item_ids'][1]);

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/calendar-exceptions?per_page=20")
        ->assertOk()
        ->assertJsonPath('meta.pagination.page', 1)
        ->assertJsonPath('meta.pagination.per_page', 20)
        ->assertJsonPath('meta.pagination.total', 1)
        ->assertJsonPath('data.0.effective_date', '2026-09-07')
        ->assertJsonCount(1, 'data');

    $this->withHeader('If-Match', $stored->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/calendar-exceptions/{$stored->json('data.id')}/cancel")
        ->assertOk()
        ->assertJsonPath('data.status', 'cancelled');
});

it('includes the course and target of a makeup lesson in the adjustment list', function (): void {
    $fixture = dailyOperationsFixture($this->scheduler->id);
    $assignmentId = DB::table('timetable_entries')->where('id', $fixture['entry_id'])->value('teaching_assignment_id');
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');

    $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/calendar-exceptions", [
            'effective_date' => '2026-09-07',
            'type' => 'makeup',
            'replacement_assignment_id' => $assignmentId,
            'replacement_item_id' => $fixture['item_ids'][1],
            'reason' => '补课列表显示测试',
        ])->assertCreated();

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/calendar-exceptions")
        ->assertOk()
        ->assertJsonPath('data.0.replacement_assignment.id', $assignmentId)
        ->assertJsonPath('data.0.replacement_assignment.school_class.id', $fixture['class_id'])
        ->assertJsonStructure(['data' => [['replacement_assignment' => ['course' => ['id', 'name']]]]]);
});

it('blocks a temporary adjustment when the target date has a hard resource conflict', function (): void {
    $fixture = dailyOperationsFixture($this->scheduler->id, true);
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $payload = [
        'effective_date' => '2026-09-07',
        'type' => 'move',
        'original_entry_id' => $fixture['entry_id'],
        'replacement_item_id' => $fixture['item_ids'][1],
        'reason' => '冲突测试',
    ];

    $this->postJson("/api/v1/semesters/{$fixture['semester_id']}/calendar-exceptions/preview", $payload)
        ->assertOk()
        ->assertJsonPath('data.allowed', false)
        ->assertJsonPath('data.conflicts.0.type', 'class');

    $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/calendar-exceptions", $payload)
        ->assertStatus(409)
        ->assertJsonPath('code', 'DAILY_EXCEPTION_CONFLICT');

    expect(DB::table('calendar_exceptions')->count())->toBe(0);
});

it('previews leave impact, explains substitute recommendations and supports multi-date batch substitution', function (): void {
    $fixture = dailyOperationsFixture($this->scheduler->id);
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $leavePayload = [
        'teacher_id' => $fixture['teacher_id'],
        'starts_at' => '2026-09-07 07:00:00',
        'ends_at' => '2026-09-21 10:00:00',
        'type' => 'training',
        'reason' => '参加市级教研培训',
        'includes_non_course_items' => false,
    ];

    $this->postJson("/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves/preview", $leavePayload)
        ->assertOk()
        ->assertJsonPath('data.affected_count', 2)
        ->assertJsonPath('data.affected.0.original_entry_id', $fixture['entry_id'])
        ->assertJsonPath('data.affected.1.date', '2026-09-21');

    $created = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves", $leavePayload)
        ->assertCreated()
        ->assertJsonPath('data.affected_count', 2)
        ->assertJsonPath('data.leave.status', 'active');
    $leaveId = $created->json('data.leave.id');

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves?date_to=2026-09-07&per_page=20")
        ->assertOk()
        ->assertJsonPath('meta.pagination.total', 1)
        ->assertJsonPath('data.0.id', $leaveId);

    $recommendations = $this->getJson(
        "/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves/{$leaveId}/recommendations"
        ."?entry_id={$fixture['entry_id']}&date=2026-09-07",
    )->assertOk()
        ->assertJsonPath('data.0.teacher.id', $fixture['substitute_teacher_id'])
        ->assertJsonPath('data.0.reasons.0', '具备数学授课资格')
        ->assertJsonPath('data.0.daily_load', 0)
        ->assertJsonPath('data.0.weekly_load', 0)
        ->assertJsonPath('data.0.consecutive_load', 1)
        ->assertJsonFragment(['本周基础课表共 0 节课']);

    $substituted = $this->withHeader('If-Match', $recommendations->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves/{$leaveId}/substitutions", [
            'substitutions' => [
                [
                    'entry_id' => $fixture['entry_id'],
                    'date' => '2026-09-07',
                    'replacement_teacher_id' => $fixture['substitute_teacher_id'],
                    'reason' => '同学科教师代课',
                ],
                [
                    'entry_id' => $fixture['entry_id'],
                    'date' => '2026-09-21',
                    'replacement_teacher_id' => $fixture['substitute_teacher_id'],
                    'reason' => '同学科教师代课',
                ],
            ],
        ])->assertOk()
        ->assertJsonPath('data.0.effective_date', '2026-09-07')
        ->assertJsonPath('data.1.effective_date', '2026-09-21')
        ->assertJsonCount(2, 'data');

    foreach (['2026-09-07', '2026-09-21'] as $date) {
        $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date={$date}")
            ->assertOk()
            ->assertJsonPath('data.rows.0.status', 'substitution')
            ->assertJsonPath('data.rows.0.teacher_id', $fixture['substitute_teacher_id']);
    }
    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves/{$leaveId}")
        ->assertOk()
        ->assertJsonPath('data.affected_count', 2)
        ->assertJsonPath('data.leave.substitutions.0.effective_date', '2026-09-07')
        ->assertJsonPath('data.leave.substitutions.0.replacement_teacher_id', $fixture['substitute_teacher_id']);
    expect(DB::table('timetable_entries')->where('id', $fixture['entry_id'])->value('teacher_id'))
        ->toBe($fixture['teacher_id']);

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves?per_page=20")
        ->assertOk()
        ->assertJsonPath('meta.pagination.total', 1)
        ->assertJsonPath('data.0.substitutions_count', 2);

    $this->withHeader('If-Match', $substituted->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves/{$leaveId}/cancel")
        ->assertOk()
        ->assertJsonPath('data.status', 'cancelled');
    expect(DB::table('substitutions')->where('teacher_leave_id', $leaveId)->where('status', 'cancelled')->count())
        ->toBe(2);
});

it('keeps independent substitutions when two teachers on the same entry are absent', function (): void {
    $fixture = dailyOperationsFixture($this->scheduler->id);
    $now = now();
    $entry = DB::table('timetable_entries')->where('id', $fixture['entry_id'])->first();
    $collaboratorId = DB::table('teachers')->insertGetId([
        'employee_no' => 'T-COLLABORATOR', 'name' => '胡静', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $secondReplacementId = DB::table('teachers')->insertGetId([
        'employee_no' => 'T-SECOND-SUBSTITUTE', 'name' => '陈敏', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    DB::table('teacher_course')->insert([
        ['teacher_id' => $collaboratorId, 'course_id' => $entry->course_id],
        ['teacher_id' => $secondReplacementId, 'course_id' => $entry->course_id],
    ]);
    DB::table('teaching_assignment_collaborators')->insert([
        'teaching_assignment_id' => $entry->teaching_assignment_id,
        'teacher_id' => $collaboratorId,
        'role' => 'collaborator',
    ]);
    DB::table('timetable_entry_teachers')->insert([
        'timetable_entry_id' => $fixture['entry_id'],
        'timetable_version_id' => $fixture['version_id'],
        'teacher_id' => $collaboratorId,
        'week_pattern' => $entry->week_pattern,
        'weekday' => $entry->weekday,
        'item_id' => $entry->item_id,
    ]);

    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $leave = fn (int $teacherId, string $reason): array => [
        'teacher_id' => $teacherId,
        'starts_at' => '2026-09-07 07:00:00',
        'ends_at' => '2026-09-07 10:00:00',
        'type' => 'training',
        'reason' => $reason,
        'includes_non_course_items' => false,
    ];
    $primaryLeave = $this->withHeader('If-Match', $etag)
        ->postJson(
            "/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves",
            $leave($fixture['teacher_id'], '主讲教师培训'),
        )->assertCreated();
    $collaboratorLeave = $this->withHeader('If-Match', $primaryLeave->headers->get('ETag'))
        ->postJson(
            "/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves",
            $leave($collaboratorId, '协同教师培训'),
        )->assertCreated();

    $primaryLeaveId = (int) $primaryLeave->json('data.leave.id');
    $collaboratorLeaveId = (int) $collaboratorLeave->json('data.leave.id');
    $primaryRecommendations = $this->getJson(
        "/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves/{$primaryLeaveId}/recommendations"
        ."?entry_id={$fixture['entry_id']}&date=2026-09-07",
    )->assertOk();
    $primarySubstitution = $this->withHeader('If-Match', $primaryRecommendations->headers->get('ETag'))
        ->postJson(
            "/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves/{$primaryLeaveId}/substitutions",
            ['substitutions' => [[
                'entry_id' => $fixture['entry_id'],
                'date' => '2026-09-07',
                'replacement_teacher_id' => $fixture['substitute_teacher_id'],
                'reason' => '主讲教师由同名教师代课',
            ]]],
        )->assertOk()
        ->assertJsonPath('data.0.replaced_teacher_id', $fixture['teacher_id']);
    $primarySubstitutionId = (int) $primarySubstitution->json('data.0.id');

    $collaboratorRecommendations = $this->getJson(
        "/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves/{$collaboratorLeaveId}/recommendations"
        ."?entry_id={$fixture['entry_id']}&date=2026-09-07",
    )->assertOk();
    $collaboratorSubstitution = $this->withHeader('If-Match', $collaboratorRecommendations->headers->get('ETag'))
        ->postJson(
            "/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves/{$collaboratorLeaveId}/substitutions",
            ['substitutions' => [[
                'entry_id' => $fixture['entry_id'],
                'date' => '2026-09-07',
                'replacement_teacher_id' => $secondReplacementId,
                'reason' => '协同教师由同名教师代课',
            ]]],
        )->assertOk()
        ->assertJsonPath('data.0.replaced_teacher_id', $collaboratorId);
    $collaboratorSubstitutionId = (int) $collaboratorSubstitution->json('data.0.id');

    $rows = $this->getJson(
        "/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date=2026-09-07",
    )->assertOk()->json('data.rows');
    expect($rows)->toHaveCount(1)
        ->and($rows[0]['teacher_id'])->toBe($fixture['substitute_teacher_id'])
        ->and($rows[0]['teacher_ids'])->toContain($fixture['substitute_teacher_id'], $secondReplacementId)
        ->not->toContain($fixture['teacher_id'], $collaboratorId)
        ->and($rows[0]['teacher_names'])->toBe(['陈敏', '陈敏'])
        ->and(count($rows[0]['teacher_ids']))->toBe(count($rows[0]['teacher_names']))
        ->and(array_combine($rows[0]['teacher_ids'], $rows[0]['teacher_names']))->toBe([
            $fixture['substitute_teacher_id'] => '陈敏',
            $secondReplacementId => '陈敏',
        ])
        ->and($rows[0]['substitution_id'])->toBe($collaboratorSubstitutionId)
        ->and($rows[0]['substitution_ids'])->toBe([$primarySubstitutionId, $collaboratorSubstitutionId])
        ->and($rows[0]['substitution_notes'])->toBe([
            '主讲教师由同名教师代课',
            '协同教师由同名教师代课',
        ])
        ->and($rows[0]['note'])->toBe('协同教师由同名教师代课');
    expect(DB::table('substitutions')->where('original_entry_id', $fixture['entry_id'])->count())->toBe(2)
        ->and(DB::table('substitutions')->pluck('teacher_leave_id')->all())
        ->toContain($primaryLeaveId, $collaboratorLeaveId)
        ->and(DB::table('substitutions')->pluck('replaced_teacher_id')->all())
        ->toContain($fixture['teacher_id'], $collaboratorId);

    $this->withHeader('If-Match', $collaboratorSubstitution->headers->get('ETag'))
        ->postJson(
            "/api/v1/semesters/{$fixture['semester_id']}/teacher-leaves/{$primaryLeaveId}/cancel",
        )->assertOk();
    $afterPrimaryCancellation = $this->getJson(
        "/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date=2026-09-07",
    )->assertOk()->json('data.rows.0');
    expect($afterPrimaryCancellation['teacher_id'])->toBe($fixture['teacher_id'])
        ->and($afterPrimaryCancellation['teacher_ids'])->toContain($fixture['teacher_id'], $secondReplacementId)
        ->not->toContain($fixture['substitute_teacher_id'], $collaboratorId)
        ->and(array_combine(
            $afterPrimaryCancellation['teacher_ids'],
            $afterPrimaryCancellation['teacher_names'],
        ))->toBe([
            $fixture['teacher_id'] => '胡静',
            $secondReplacementId => '陈敏',
        ])
        ->and($afterPrimaryCancellation['substitution_ids'])->toBe([$collaboratorSubstitutionId])
        ->and($afterPrimaryCancellation['substitution_notes'])->toBe(['协同教师由同名教师代课']);
    expect(DB::table('substitutions')->where('teacher_leave_id', $primaryLeaveId)->value('status'))
        ->toBe('cancelled')
        ->and(DB::table('substitutions')->where('teacher_leave_id', $collaboratorLeaveId)->value('status'))
        ->toBe('active');
});

it('rejects an unqualified teacher in a temporary teacher change preview', function (): void {
    $fixture = dailyOperationsFixture($this->scheduler->id);
    $unqualifiedTeacherId = DB::table('teachers')->insertGetId([
        'employee_no' => 'T-NO-QUALIFICATION',
        'name' => '未授权教师',
        'is_active' => true,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $this->postJson("/api/v1/semesters/{$fixture['semester_id']}/calendar-exceptions/preview", [
        'effective_date' => '2026-09-07',
        'type' => 'teacher_change',
        'original_entry_id' => $fixture['entry_id'],
        'replacement_teacher_id' => $unqualifiedTeacherId,
        'reason' => '资格校验测试',
    ])->assertStatus(422)
        ->assertJsonPath('code', 'DAILY_TEACHER_NOT_QUALIFIED');
});

it('lets a teacher view only their own effective timetable', function (): void {
    $fixture = dailyOperationsFixture($this->scheduler->id);
    DB::table('app_settings')->where('id', 1)->update(['current_semester_id' => $fixture['semester_id']]);
    $teacherUser = User::factory()->create([
        'email' => 'teacher@example.test',
        'role' => Role::Teacher,
        'teacher_id' => $fixture['teacher_id'],
        'must_change_password' => false,
    ]);

    $this->actingAs($teacherUser)->withSession(['auth_version' => $teacherUser->auth_version]);

    $this->getJson('/api/v1/teacher/me/timetable?from=2026-09-07&to=2026-09-07')
        ->assertOk()
        ->assertJsonPath('data.teacher.id', $fixture['teacher_id'])
        ->assertJsonPath('data.days.0.rows.0.original_entry_id', $fixture['entry_id'])
        ->assertJsonPath('data.days.0.rows.0.duty_status', 'assigned');
    $this->getJson('/api/v1/teacher/me/classes?from=2026-09-07&to=2026-09-07')
        ->assertOk()
        ->assertJsonPath('data.classes.0.id', $fixture['class_id'])
        ->assertJsonPath('data.classes.0.accessible_dates.0', '2026-09-07')
        ->assertJsonCount(1, 'data.classes');
    $this->getJson("/api/v1/teacher/me/classes/{$fixture['class_id']}/timetable?from=2026-09-07&to=2026-09-07")
        ->assertOk()
        ->assertJsonPath('data.school_class.id', $fixture['class_id'])
        ->assertJsonPath('data.days.0.accessible', true)
        ->assertJsonPath('data.days.0.rows.0.original_entry_id', $fixture['entry_id']);

    $class = DB::table('school_classes')->where('id', $fixture['class_id'])->first();
    $unauthorizedClassId = DB::table('school_classes')->insertGetId([
        'academic_year_id' => $class->academic_year_id,
        'grade_id' => $class->grade_id,
        'name' => '无权查看班级',
        'code' => 'NO-ACCESS',
        'status' => 'active',
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    $this->getJson("/api/v1/teacher/me/classes/{$unauthorizedClassId}/timetable?from=2026-09-07&to=2026-09-07")
        ->assertForbidden()
        ->assertJsonPath('code', 'TEACHER_CLASS_FORBIDDEN');
    $this->getJson('/api/v1/catalog')
        ->assertForbidden()
        ->assertJsonPath('code', 'FORBIDDEN');
    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date=2026-09-07")
        ->assertForbidden()
        ->assertJsonPath('code', 'FORBIDDEN');
});

it('does not grant long-term class access to a temporary replacement teacher', function (): void {
    $fixture = dailyOperationsFixture($this->scheduler->id);
    DB::table('app_settings')->where('id', 1)->update(['current_semester_id' => $fixture['semester_id']]);
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/calendar-exceptions", [
            'effective_date' => '2026-09-07',
            'type' => 'teacher_change',
            'original_entry_id' => $fixture['entry_id'],
            'replacement_teacher_id' => $fixture['substitute_teacher_id'],
            'reason' => '仅当天临时代课',
        ])->assertCreated();
    $replacementUser = User::factory()->create([
        'email' => 'temporary-replacement@example.test',
        'role' => Role::Teacher,
        'teacher_id' => $fixture['substitute_teacher_id'],
        'must_change_password' => false,
    ]);
    $this->actingAs($replacementUser)->withSession(['auth_version' => $replacementUser->auth_version]);

    $this->getJson('/api/v1/teacher/me/timetable?from=2026-09-07&to=2026-09-07')
        ->assertOk()
        ->assertJsonPath('data.days.0.rows.0.duty_status', 'added')
        ->assertJsonPath('data.days.0.rows.0.status', 'teacher_change');
    $this->getJson('/api/v1/teacher/me/classes?from=2026-09-07&to=2026-09-07')
        ->assertOk()
        ->assertJsonCount(0, 'data.classes');
    $this->getJson("/api/v1/teacher/me/classes/{$fixture['class_id']}/timetable?from=2026-09-07&to=2026-09-07")
        ->assertForbidden()
        ->assertJsonPath('code', 'TEACHER_CLASS_FORBIDDEN');
});

it('changes class access when a different teacher is assigned in the date-effective long-term version', function (): void {
    $fixture = dailyOperationsFixture($this->scheduler->id);
    DB::table('app_settings')->where('id', 1)->update(['current_semester_id' => $fixture['semester_id']]);
    DB::table('timetable_effective_periods')->insert([
        'semester_id' => $fixture['semester_id'],
        'timetable_version_id' => $fixture['version_id'],
        'effective_from' => '2026-09-01',
        'effective_to' => '2026-09-13',
        'status' => 'active',
        'reason' => '原任课关系',
        'created_by' => $this->scheduler->id,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $draft = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable-versions", [
            'name' => '长期任课变更版本',
            'base_version_id' => $fixture['version_id'],
        ])->assertCreated();
    $draftId = (int) $draft->json('data.id');
    $draftEntry = DB::table('timetable_entries')->where('timetable_version_id', $draftId)->first();
    DB::table('timetable_entries')->where('id', $draftEntry->id)->update([
        'teacher_id' => $fixture['substitute_teacher_id'],
    ]);
    DB::table('timetable_entry_teachers')->where('timetable_entry_id', $draftEntry->id)->delete();
    DB::table('timetable_entry_teachers')->insert([
        'timetable_entry_id' => $draftEntry->id,
        'timetable_version_id' => $draftId,
        'teacher_id' => $fixture['substitute_teacher_id'],
        'week_pattern' => $draftEntry->week_pattern,
        'weekday' => $draftEntry->weekday,
        'item_id' => $draftEntry->item_id,
    ]);
    DB::table('timetable_effective_periods')->insert([
        [
            'semester_id' => $fixture['semester_id'],
            'timetable_version_id' => $draftId,
            'effective_from' => '2026-09-14',
            'effective_to' => '2026-09-20',
            'status' => 'active',
            'reason' => '长期更换任课教师',
            'created_by' => $this->scheduler->id,
            'created_at' => now(),
            'updated_at' => now(),
        ],
        [
            'semester_id' => $fixture['semester_id'],
            'timetable_version_id' => $fixture['version_id'],
            'effective_from' => '2026-09-21',
            'effective_to' => '2027-01-20',
            'status' => 'active',
            'reason' => '恢复原任课关系',
            'created_by' => $this->scheduler->id,
            'created_at' => now(),
            'updated_at' => now(),
        ],
    ]);

    $originalUser = User::factory()->create([
        'email' => 'original-long-term-teacher@example.test',
        'role' => Role::Teacher,
        'teacher_id' => $fixture['teacher_id'],
        'must_change_password' => false,
    ]);
    $replacementUser = User::factory()->create([
        'email' => 'replacement-long-term-teacher@example.test',
        'role' => Role::Teacher,
        'teacher_id' => $fixture['substitute_teacher_id'],
        'must_change_password' => false,
    ]);

    $this->actingAs($originalUser)->withSession(['auth_version' => $originalUser->auth_version]);
    $this->getJson('/api/v1/teacher/me/classes?from=2026-09-07&to=2026-09-07')
        ->assertOk()
        ->assertJsonPath('data.classes.0.id', $fixture['class_id']);
    $this->getJson('/api/v1/teacher/me/classes?from=2026-09-15&to=2026-09-15')
        ->assertOk()
        ->assertJsonCount(0, 'data.classes');

    $this->actingAs($replacementUser)->withSession(['auth_version' => $replacementUser->auth_version]);
    $this->getJson('/api/v1/teacher/me/classes?from=2026-09-07&to=2026-09-07')
        ->assertOk()
        ->assertJsonCount(0, 'data.classes');
    $this->getJson('/api/v1/teacher/me/classes?from=2026-09-15&to=2026-09-15')
        ->assertOk()
        ->assertJsonPath('data.classes.0.id', $fixture['class_id']);
});

it('publishes a long-term adjustment for only the selected date range', function (bool $existingCoverage): void {
    $fixture = dailyOperationsFixture($this->scheduler->id);
    if ($existingCoverage) {
        DB::table('timetable_effective_periods')->insert([
            'semester_id' => $fixture['semester_id'],
            'timetable_version_id' => $fixture['version_id'],
            'effective_from' => '2026-09-01',
            'effective_to' => '2027-01-20',
            'status' => 'active',
            'reason' => '初始课表',
            'created_by' => $this->scheduler->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $draft = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable-versions", [
            'name' => '九月长期调课',
            'base_version_id' => $fixture['version_id'],
        ])->assertCreated();
    $draftId = (int) $draft->json('data.id');
    $draftEntryId = (int) DB::table('timetable_entries')
        ->where('timetable_version_id', $draftId)
        ->value('id');
    $moved = $this->withHeader('If-Match', $draft->headers->get('ETag'))
        ->patchJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries/{$draftEntryId}", [
            'weekday' => 2,
            'item_id' => $fixture['item_ids'][0],
        ])->assertOk();

    $payload = [
        'version_id' => $draftId,
        'effective_from' => '2026-09-14',
        'effective_to' => '2026-09-20',
        'reason' => '九月教研活动期间长期调课',
    ];
    $beforePeriods = DB::table('timetable_effective_periods')->orderBy('id')->get()->toJson();
    $beforeSemester = DB::table('semesters')->where('id', $fixture['semester_id'])->first();
    $preview = $this->postJson("/api/v1/semesters/{$fixture['semester_id']}/long-term-adjustments/preview", $payload)
        ->assertOk()
        ->assertJsonPath('data.allowed', true)
        ->assertJsonPath('data.replaced_periods.0.version_id', $fixture['version_id'])
        ->assertJsonPath('data.replaced_periods.0.effective_from', '2026-09-01')
        ->assertJsonPath('data.replaced_periods.0.effective_to', '2027-01-20')
        ->assertJsonPath('data.calendar_exceptions_to_rebase', 0)
        ->assertJsonPath('data.cross_period_exceptions_to_validate', 0)
        ->assertJsonPath('data.substitutions_to_rebase', 0);
    expect(DB::table('timetable_effective_periods')->orderBy('id')->get()->toJson())->toBe($beforePeriods)
        ->and(DB::table('semesters')->where('id', $fixture['semester_id'])->first())->toEqual($beforeSemester)
        ->and(DB::table('timetable_versions')->where('id', $draftId)->value('status'))->toBe('draft')
        ->and($preview->headers->get('ETag'))->toBe($moved->headers->get('ETag'));
    $this->withHeader('If-Match', $moved->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/long-term-adjustments", $payload)
        ->assertCreated()
        ->assertJsonPath('data.timetable_version_id', $draftId);

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date=2026-09-07")
        ->assertOk()
        ->assertJsonPath('data.version.id', $fixture['version_id'])
        ->assertJsonPath('data.summary.total', 1);
    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date=2026-09-14")
        ->assertOk()
        ->assertJsonPath('data.version.id', $draftId)
        ->assertJsonPath('data.summary.total', 0);
    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date=2026-09-15")
        ->assertOk()
        ->assertJsonPath('data.version.id', $draftId)
        ->assertJsonPath('data.summary.total', 1);
    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date=2026-10-05")
        ->assertOk()
        ->assertJsonPath('data.version.id', $fixture['version_id'])
        ->assertJsonPath('data.summary.total', 0);

    expect(DB::table('timetable_effective_periods')
        ->where('semester_id', $fixture['semester_id'])
        ->where('status', 'active')
        ->count())->toBe(3);
})->with([true, false]);

it('previews the same temporary rebase that publishing applies without retaining preview writes', function (): void {
    $fixture = dailyOperationsFixture($this->scheduler->id);
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $exception = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/calendar-exceptions", [
            'effective_date' => '2026-09-07',
            'type' => 'move',
            'original_entry_id' => $fixture['entry_id'],
            'replacement_item_id' => $fixture['item_ids'][1],
            'reason' => '临时后移一节',
        ])->assertCreated();
    $substitutionId = DB::table('substitutions')->insertGetId([
        'original_entry_id' => $fixture['entry_id'],
        'effective_date' => '2026-09-21',
        'replaced_teacher_id' => $fixture['teacher_id'],
        'replacement_teacher_id' => $fixture['substitute_teacher_id'],
        'created_by' => $this->scheduler->id,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    $draft = $this->withHeader('If-Match', $exception->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable-versions", [
            'name' => '保留临时安排',
            'base_version_id' => $fixture['version_id'],
        ])->assertCreated();
    $draftId = (int) $draft->json('data.id');
    $draftEntryId = (int) DB::table('timetable_entries')->where('timetable_version_id', $draftId)->value('id');
    $payload = [
        'version_id' => $draftId,
        'effective_from' => '2026-09-01',
        'effective_to' => '2026-09-30',
        'reason' => '保留临时安排',
    ];
    $beforeException = DB::table('calendar_exceptions')->where('id', $exception->json('data.id'))->first();
    $beforeSubstitution = DB::table('substitutions')->where('id', $substitutionId)->first();

    $this->postJson("/api/v1/semesters/{$fixture['semester_id']}/long-term-adjustments/preview", $payload)
        ->assertOk()
        ->assertJsonPath('data.calendar_exceptions_to_rebase', 1)
        ->assertJsonPath('data.cross_period_exceptions_to_validate', 0)
        ->assertJsonPath('data.substitutions_to_rebase', 1);
    expect(DB::table('calendar_exceptions')->where('id', $exception->json('data.id'))->first())->toEqual($beforeException)
        ->and(DB::table('substitutions')->where('id', $substitutionId)->first())->toEqual($beforeSubstitution)
        ->and(DB::table('timetable_effective_periods')->count())->toBe(0);

    $this->withHeader('If-Match', $draft->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/long-term-adjustments", $payload)
        ->assertCreated();
    expect(DB::table('calendar_exceptions')->where('id', $exception->json('data.id'))->value('original_entry_id'))->toBe($draftEntryId)
        ->and(DB::table('substitutions')->where('id', $substitutionId)->value('original_entry_id'))->toBe($draftEntryId);
    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date=2026-09-07")
        ->assertOk()
        ->assertJsonPath('data.rows.1.status', 'moved_in')
        ->assertJsonPath('data.rows.1.item_id', $fixture['item_ids'][1]);
    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/daily-timetable?date=2026-09-21")
        ->assertOk()
        ->assertJsonPath('data.rows.0.status', 'substitution')
        ->assertJsonPath('data.rows.0.teacher_id', $fixture['substitute_teacher_id']);
});

it('prevents a long-term timetable from conflicting with a temporary move into its date range', function (): void {
    $fixture = dailyOperationsFixture($this->scheduler->id);
    DB::table('timetable_effective_periods')->insert([
        'semester_id' => $fixture['semester_id'],
        'timetable_version_id' => $fixture['version_id'],
        'effective_from' => '2026-09-01',
        'effective_to' => '2027-01-20',
        'status' => 'active',
        'reason' => '初始课表',
        'created_by' => $this->scheduler->id,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $temporaryMove = [
        'effective_date' => '2026-09-07',
        'replacement_date' => '2026-09-15',
        'type' => 'move',
        'original_entry_id' => $fixture['entry_id'],
        'replacement_item_id' => $fixture['item_ids'][0],
        'reason' => '从区间外临时移入长期调整区间',
    ];
    $storedMove = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/calendar-exceptions", $temporaryMove)
        ->assertCreated();
    $draft = $this->withHeader('If-Match', $storedMove->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable-versions", [
            'name' => '跨区间冲突草稿',
            'base_version_id' => $fixture['version_id'],
        ])->assertCreated();
    $draftId = (int) $draft->json('data.id');
    $draftEntryId = (int) DB::table('timetable_entries')
        ->where('timetable_version_id', $draftId)
        ->value('id');
    $movedDraft = $this->withHeader('If-Match', $draft->headers->get('ETag'))
        ->patchJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries/{$draftEntryId}", [
            'weekday' => 2,
            'item_id' => $fixture['item_ids'][0],
        ])->assertOk();
    $payload = [
        'version_id' => $draftId,
        'effective_from' => '2026-09-14',
        'effective_to' => '2026-09-20',
        'reason' => '应检测移入课程冲突',
    ];

    $this->postJson("/api/v1/semesters/{$fixture['semester_id']}/long-term-adjustments/preview", $payload)
        ->assertStatus(409)
        ->assertJsonPath('code', 'DAILY_TIMETABLE_CONFLICT')
        ->assertJsonPath('date', '2026-09-15');
    $this->withHeader('If-Match', $movedDraft->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/long-term-adjustments", $payload)
        ->assertStatus(409)
        ->assertJsonPath('code', 'DAILY_TIMETABLE_CONFLICT');

    expect(DB::table('timetable_effective_periods')
        ->where('semester_id', $fixture['semester_id'])
        ->where('status', 'active')
        ->count())->toBe(1)
        ->and(DB::table('calendar_exceptions')->where('id', $storedMove->json('data.id'))->value('timetable_version_id'))
        ->toBe($fixture['version_id'])
        ->and(DB::table('semesters')->where('id', $fixture['semester_id'])->value('current_timetable_version_id'))
        ->toBe($fixture['version_id']);
});
