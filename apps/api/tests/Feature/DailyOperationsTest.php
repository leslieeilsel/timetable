<?php

use App\Enums\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;

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

/**
 * @return array{
 *   semester_id: int,
 *   version_id: int,
 *   entry_id: int,
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
