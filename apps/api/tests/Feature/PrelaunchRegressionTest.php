<?php

use App\Enums\Role;
use App\Models\User;
use App\Modules\DailyOperations\Services\DailyTimetableService;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/../Fixtures/DailyOperationsFixture.php';
beforeEach(function () {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->actor = User::factory()->create(['role' => Role::Scheduler, 'must_change_password' => false]);
    $this->actingAs($this->actor)->withSession(['auth_version' => $this->actor->auth_version]);
    $this->f = dailyOperationsFixture($this->actor->id);
    $this->base = '/api/v1/semesters/'.$this->f['semester_id'];
});
function reviewWrite($test, string $path, array $data = [], string $method = 'postJson')
{
    $etag = $test->getJson($test->base)->headers->get('ETag');
    $response = $test->withHeader('If-Match', $etag)->$method($test->base.$path, $data);

    return $response;
}

function reviewActualRows($test, string $date): array
{
    $rows = $test->getJson($test->base.'/daily-timetable?date='.$date)->assertOk()->json('data.rows');
    app(DailyTimetableService::class)->assertActualRowsConflictFree($rows, $date);

    return collect($rows)->reject(fn ($row) => $row['is_cancelled'])->values()->all();
}

it('R1 blocks moving an occurrence onto the same recurring lesson on another date', function () {
    $response = reviewWrite($this, '/calendar-exceptions', [
        'type' => 'move', 'effective_date' => '2026-09-07', 'replacement_date' => '2026-09-21',
        'original_entry_id' => $this->f['entry_id'], 'replacement_item_id' => $this->f['item_ids'][0],
        'reason' => 'review cross occurrence',
    ]);
    expect(reviewActualRows($this, '2026-09-21'))->toHaveCount(1);
    expect(reviewActualRows($this, '2026-09-07'))->toHaveCount(1);
    $response->assertStatus(409);
});
it('R2 blocks undoing a cancellation after the released slot is reused', function () {
    $cancel = reviewWrite($this, '/calendar-exceptions', [
        'type' => 'cancel', 'effective_date' => '2026-09-07',
        'original_entry_id' => $this->f['entry_id'], 'reason' => 'review cancel',
    ])->assertCreated();
    $assignment = DB::table('timetable_entries')->where('id', $this->f['entry_id'])->value('teaching_assignment_id');
    $makeup = reviewWrite($this, '/calendar-exceptions', [
        'type' => 'makeup', 'effective_date' => '2026-09-07', 'replacement_date' => '2026-09-07',
        'replacement_assignment_id' => $assignment, 'replacement_item_id' => $this->f['item_ids'][0],
        'reason' => 'review released slot reuse',
    ])->assertCreated();
    $response = reviewWrite($this, '/calendar-exceptions/'.$cancel->json('data.id').'/cancel');
    expect(reviewActualRows($this, '2026-09-07'))->toHaveCount(1);
    $this->assertDatabaseHas('calendar_exceptions', ['id' => $cancel->json('data.id'), 'status' => 'active']);
    $response->assertStatus(409)->assertJsonPath('code', 'DAILY_TIMETABLE_CONFLICT');
    reviewWrite($this, '/calendar-exceptions/'.$makeup->json('data.id').'/cancel')->assertOk();
    reviewWrite($this, '/calendar-exceptions/'.$cancel->json('data.id').'/cancel')->assertOk();
    expect(reviewActualRows($this, '2026-09-07')[0]['status'])->toBe('base');
});
it('R3 finds substitutes using the moved lesson actual time', function () {
    reviewWrite($this, '/calendar-exceptions', [
        'type' => 'move', 'effective_date' => '2026-09-07', 'replacement_date' => '2026-09-07',
        'original_entry_id' => $this->f['entry_id'], 'replacement_item_id' => $this->f['item_ids'][1],
        'reason' => 'review moved lesson',
    ])->assertCreated();
    $leave = reviewWrite($this, '/teacher-leaves', [
        'teacher_id' => $this->f['teacher_id'], 'starts_at' => '2026-09-07 08:50:00',
        'ends_at' => '2026-09-07 10:00:00', 'type' => 'personal', 'reason' => 'review later leave',
    ])->assertCreated()->assertJsonPath('data.affected_count', 1);
    $this->getJson($this->base.'/teacher-leaves/'.$leave->json('data.leave.id').'/recommendations?entry_id='.$this->f['entry_id'].'&date=2026-09-07')
        ->assertOk()->assertJsonPath('data.0.teacher.id', $this->f['substitute_teacher_id']);
    reviewWrite($this, '/teacher-leaves/'.$leave->json('data.leave.id').'/substitutions', [
        'substitutions' => [['entry_id' => $this->f['entry_id'], 'date' => '2026-09-07', 'replacement_teacher_id' => $this->f['substitute_teacher_id']]],
    ])->assertOk();
    $row = reviewActualRows($this, '2026-09-07')[0];
    expect($row['item_id'])->toBe($this->f['item_ids'][1])
        ->and($row['teacher_ids'])->toBe([$this->f['substitute_teacher_id']]);
});
it('R4 counts scheduled workload within one version when editing weekly hours', function () {
    reviewWrite($this, '/timetable-versions', ['base_version_id' => $this->f['version_id'], 'name' => 'review clone'])->assertCreated();
    $assignment = DB::table('timetable_entries')->where('id', $this->f['entry_id'])->value('teaching_assignment_id');
    reviewWrite($this, '/teaching-assignments/'.$assignment, ['weekly_items' => 1], 'patchJson')->assertOk();
    $model = TeachingAssignment::findOrFail($assignment);
    reviewWrite($this, '/teaching-assignments/bulk', ['operations' => [[
        'assignment_id' => $model->id, 'school_class_id' => $model->school_class_id, 'course_id' => $model->course_id,
        'teacher_id' => $model->teacher_id, 'weekly_items' => 1, 'room_mode' => 'class_default', 'allows_substitution' => false,
        'week_pattern' => 'specified', 'active_weeks' => [1, 3],
    ]]])->assertOk();
    expect($model->fresh()->allows_substitution)->toBeFalse();
});
it('R5 revalidates forbidden slots before publishing a cloned version', function () {
    $rule = reviewWrite($this, '/scheduling-constraints', [
        'name' => 'review teacher unavailable', 'kind' => 'hard', 'category' => 'forbidden_slot',
        'target_type' => 'teacher', 'target_id' => $this->f['teacher_id'],
        'scope' => ['weekdays' => [1], 'item_ids' => [$this->f['item_ids'][0]]],
        'requirement' => ['available' => false],
    ])->assertCreated();
    reviewWrite($this, '/scheduling-constraints/'.$rule->json('data.id').'/activate')->assertOk();
    $draft = reviewWrite($this, '/timetable-versions', ['base_version_id' => $this->f['version_id'], 'name' => 'review stale clone'])->assertCreated();
    reviewWrite($this, '/timetable-versions/'.$draft->json('data.id').'/activate', ['reason' => 'review forbid invalid publication'])
        ->assertStatus(409)->assertJsonPath('code', 'VERSION_HAS_HARD_CONFLICTS');
    $this->assertDatabaseHas('semesters', ['id' => $this->f['semester_id'], 'current_timetable_version_id' => $this->f['version_id']]);
    $this->getJson($this->base.'/timetable/validation?version_id='.$draft->json('data.id'))->assertOk()
        ->assertJsonPath('data.valid', false)->assertJsonPath('data.hard_conflicts.0.constraint_id', $rule->json('data.id'));
    $entryId = DB::table('timetable_entries')->where('timetable_version_id', $draft->json('data.id'))->value('id');
    reviewWrite($this, '/timetable/entries/'.$entryId, ['weekday' => 1, 'item_id' => $this->f['item_ids'][1]], 'patchJson')->assertOk();
    reviewWrite($this, '/timetable-versions/'.$draft->json('data.id').'/activate', ['reason' => '修复后发布'])->assertOk();
});
it('R6 reports malformed CSV rows without crashing the whole preview', function () {
    $yearId = DB::table('semesters')->where('id', $this->f['semester_id'])->value('academic_year_id');
    $file = UploadedFile::fake()->createWithContent('classes.csv', "grade_name,class_name,class_code\n七年级,少列\n七年级,多列,X,EXTRA\n七年级,正常班级,VALID\n");
    $this->postJson('/api/v1/academic-years/'.$yearId.'/classes/import/preview', ['file' => $file])->assertOk()
        ->assertJsonPath('data.rows.0.errors.0.code', 'CSV_COLUMN_COUNT')
        ->assertJsonPath('data.rows.1.errors.0.code', 'CSV_COLUMN_COUNT')
        ->assertJsonPath('data.rows.2.valid', true)->assertJsonPath('data.valid_rows', [4]);
});
it('R7 allows disjoint odd and even week loads that fit every actual week', function () {
    DB::table('timetable_entries')->where('semester_id', $this->f['semester_id'])->delete();
    DB::table('schedule_template_days')->where('semester_id', $this->f['semester_id'])->update(['is_enabled' => false]);
    DB::table('schedule_template_days')->where('semester_id', $this->f['semester_id'])->where('weekday', 1)->update(['is_enabled' => true]);
    $assignment = TeachingAssignment::where('semester_id', $this->f['semester_id'])->firstOrFail();
    $assignment->forceFill(['status' => 'draft', 'week_pattern' => 'a', 'active_weeks' => null, 'weekly_items' => 2])->save();
    $courseId = DB::table('courses')->insertGetId(['name' => 'review even course', 'short_name' => '偶', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
    DB::table('teacher_course')->insert(['teacher_id' => $this->f['teacher_id'], 'course_id' => $courseId]);
    $second = $assignment->replicate();
    $second->forceFill(['week_pattern' => 'b', 'course_id' => $courseId])->save();
    reviewWrite($this, '/teaching-assignments/confirm', ['assignment_ids' => [$assignment->id, $second->id]])->assertOk();
});
it('R8 checks moved-out destination when publishing a source-date room change', function () {
    $original = TeachingAssignment::where('semester_id', $this->f['semester_id'])->firstOrFail();
    $roomId = DB::table('rooms')->insertGetId(['name' => 'review room two', 'type' => 'classroom', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
    $class = SchoolClass::findOrFail($this->f['class_id'])->replicate();
    $class->forceFill(['name' => 'review class two', 'code' => 'REVIEW2'])->save();
    DB::table('semester_class_settings')->insert(['semester_id' => $this->f['semester_id'], 'academic_year_id' => $class->academic_year_id, 'school_class_id' => $class->id, 'fixed_room_id' => $roomId, 'status' => 'active', 'created_at' => now(), 'updated_at' => now()]);
    $second = $original->replicate();
    $second->forceFill(['school_class_id' => $class->id, 'teacher_id' => $this->f['substitute_teacher_id'], 'active_weeks' => [2]])->save();
    $otherEntry = insertDailyEntry($this->f['semester_id'], $this->f['version_id'], $second->id, $class->id, $second->teacher_id, $second->course_id, $roomId, $this->f['item_ids'][1], now());
    DB::table('timetable_entries')->where('id', $otherEntry)->update(['active_weeks' => '[2]']);
    reviewWrite($this, '/calendar-exceptions', [
        'type' => 'move', 'effective_date' => '2026-09-07', 'replacement_date' => '2026-09-14',
        'original_entry_id' => $this->f['entry_id'], 'replacement_item_id' => $this->f['item_ids'][1],
        'reason' => 'review cross period outgoing move',
    ])->assertCreated();
    $draft = reviewWrite($this, '/timetable-versions', ['base_version_id' => $this->f['version_id'], 'name' => 'review outgoing rebase'])->assertCreated();
    reviewWrite($this, '/teaching-assignments/'.$original->id.'/migrate-room', ['version_id' => $draft->json('data.id'), 'target_room_id' => $roomId])->assertOk();
    $payload = [
        'version_id' => $draft->json('data.id'), 'effective_from' => '2026-09-07', 'effective_to' => '2026-09-07', 'reason' => 'review outgoing source changed',
    ];
    $this->postJson($this->base.'/long-term-adjustments/preview', $payload)->assertStatus(409)->assertJsonPath('code', 'DAILY_TIMETABLE_CONFLICT');
    $response = reviewWrite($this, '/long-term-adjustments', $payload);
    expect(reviewActualRows($this, '2026-09-14'))->toHaveCount(2);
    $this->assertDatabaseHas('semesters', ['id' => $this->f['semester_id'], 'current_timetable_version_id' => $this->f['version_id']]);
    $this->assertDatabaseHas('calendar_exceptions', ['original_entry_id' => $this->f['entry_id'], 'replacement_date' => '2026-09-14']);
    $response->assertStatus(409)->assertJsonPath('code', 'DAILY_TIMETABLE_CONFLICT');
});
it('R10 accepts the corrected admin form payload for a specific teacher consecutive limit', function () {
    reviewWrite($this, '/scheduling-constraints', [
        'name' => 'review teacher consecutive limit', 'kind' => 'hard', 'category' => 'consecutive_items',
        'target_type' => 'teacher', 'target_id' => $this->f['teacher_id'], 'scope' => [],
        'condition' => null, 'requirement' => ['max_consecutive_items' => 2],
        'weight' => null, 'explanation' => null,
    ])->assertCreated();
});

it('R3 excludes a substitute who is busy at the moved time and rejects saving them', function () {
    $original = TeachingAssignment::where('semester_id', $this->f['semester_id'])->firstOrFail();
    $roomId = DB::table('rooms')->insertGetId(['name' => '代课检查教室', 'type' => 'classroom', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
    $class = SchoolClass::findOrFail($this->f['class_id'])->replicate();
    $class->forceFill(['name' => '代课检查班级', 'code' => 'SUBSTITUTE'])->save();
    $assignment = $original->replicate();
    $assignment->forceFill(['school_class_id' => $class->id, 'teacher_id' => $this->f['substitute_teacher_id']])->save();
    insertDailyEntry($this->f['semester_id'], $this->f['version_id'], $assignment->id, $class->id, $assignment->teacher_id, $assignment->course_id, $roomId, $this->f['item_ids'][1], now());
    reviewWrite($this, '/calendar-exceptions', [
        'type' => 'move', 'effective_date' => '2026-09-07', 'replacement_date' => '2026-09-07',
        'original_entry_id' => $this->f['entry_id'], 'replacement_item_id' => $this->f['item_ids'][1], 'reason' => '移到第二节',
    ])->assertCreated();
    $leave = reviewWrite($this, '/teacher-leaves', [
        'teacher_id' => $this->f['teacher_id'], 'starts_at' => '2026-09-07 08:50:00', 'ends_at' => '2026-09-07 10:00:00', 'type' => 'personal',
    ])->assertCreated();
    $this->getJson($this->base.'/teacher-leaves/'.$leave->json('data.leave.id').'/recommendations?entry_id='.$this->f['entry_id'].'&date=2026-09-07')
        ->assertOk()->assertJsonCount(0, 'data');
    reviewWrite($this, '/teacher-leaves/'.$leave->json('data.leave.id').'/substitutions', [
        'substitutions' => [['entry_id' => $this->f['entry_id'], 'date' => '2026-09-07', 'replacement_teacher_id' => $this->f['substitute_teacher_id']]],
    ])->assertStatus(409)->assertJsonPath('code', 'SUBSTITUTION_TEACHER_UNAVAILABLE');
    $this->assertDatabaseCount('substitutions', 0);
});

it('R3 applies substitution to a moved-in lesson from a different effective version', function () {
    reviewWrite($this, '/calendar-exceptions', [
        'type' => 'move', 'effective_date' => '2026-09-07', 'replacement_date' => '2026-09-08',
        'original_entry_id' => $this->f['entry_id'], 'replacement_item_id' => $this->f['item_ids'][1], 'reason' => '跨日调课',
    ])->assertCreated();
    $draft = reviewWrite($this, '/timetable-versions', ['base_version_id' => $this->f['version_id'], 'name' => '目标日期新版本'])->assertCreated();
    reviewWrite($this, '/long-term-adjustments', [
        'version_id' => $draft->json('data.id'), 'effective_from' => '2026-09-08', 'effective_to' => '2026-09-08', 'reason' => '发布目标日期版本',
    ])->assertCreated();
    $leave = reviewWrite($this, '/teacher-leaves', [
        'teacher_id' => $this->f['teacher_id'], 'starts_at' => '2026-09-08 08:50:00', 'ends_at' => '2026-09-08 10:00:00', 'type' => 'personal',
    ])->assertCreated()->assertJsonPath('data.affected_count', 1);
    reviewWrite($this, '/teacher-leaves/'.$leave->json('data.leave.id').'/substitutions', [
        'substitutions' => [['entry_id' => $this->f['entry_id'], 'date' => '2026-09-08', 'replacement_teacher_id' => $this->f['substitute_teacher_id']]],
    ])->assertOk();
    $row = reviewActualRows($this, '2026-09-08')[0];
    expect($row['original_entry_id'])->toBe($this->f['entry_id'])
        ->and($row['status'])->toBe('substitution')
        ->and($row['teacher_ids'])->toBe([$this->f['substitute_teacher_id']]);
});

it('R4 still rejects weekly hours below the workload of any single version', function () {
    $assignment = TeachingAssignment::where('semester_id', $this->f['semester_id'])->firstOrFail();
    $assignment->forceFill(['weekly_items' => 2])->save();
    $roomId = DB::table('timetable_entries')->where('id', $this->f['entry_id'])->value('actual_room_id');
    insertDailyEntry($this->f['semester_id'], $this->f['version_id'], $assignment->id, $this->f['class_id'], $assignment->teacher_id, $assignment->course_id, $roomId, $this->f['item_ids'][1], now());
    reviewWrite($this, '/timetable-versions', ['base_version_id' => $this->f['version_id'], 'name' => '多版本课时'])->assertCreated();
    reviewWrite($this, '/teaching-assignments/'.$assignment->id, ['weekly_items' => 1], 'patchJson')
        ->assertStatus(422)->assertJsonPath('code', 'WEEKLY_ITEMS_BELOW_SCHEDULED');
    reviewWrite($this, '/teaching-assignments/'.$assignment->id, ['weekly_items' => 2], 'patchJson')->assertOk();
});

it('R5 checks actual fixed rooms against current hard rules even on locked entries', function () {
    $roomId = DB::table('rooms')->insertGetId(['name' => '固定专用教室', 'type' => 'classroom', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
    DB::table('timetable_entries')->where('id', $this->f['entry_id'])->update(['actual_room_id' => $roomId, 'is_locked' => true]);
    $rule = reviewWrite($this, '/scheduling-constraints', [
        'name' => '实际教室禁排', 'kind' => 'hard', 'category' => 'forbidden_slot', 'target_type' => 'room', 'target_id' => $roomId,
        'scope' => ['weekdays' => [1], 'item_ids' => [$this->f['item_ids'][0]]], 'requirement' => ['available' => false],
    ])->assertCreated();
    reviewWrite($this, '/scheduling-constraints/'.$rule->json('data.id').'/activate')->assertOk();
    $draft = reviewWrite($this, '/timetable-versions', ['base_version_id' => $this->f['version_id'], 'name' => '专用教室草稿'])->assertCreated();
    reviewWrite($this, '/timetable-versions/'.$draft->json('data.id').'/activate', ['reason' => '发布检查'])
        ->assertStatus(409)->assertJsonPath('code', 'VERSION_HAS_HARD_CONFLICTS')
        ->assertJsonPath('hard_conflicts.0.constraint_id', $rule->json('data.id'));
});

it('R5 refuses a clone that omits a newly activated fixed placement', function () {
    $assignmentId = DB::table('timetable_entries')->where('id', $this->f['entry_id'])->value('teaching_assignment_id');
    $fixed = reviewWrite($this, '/fixed-placements', [
        'teaching_assignment_id' => $assignmentId, 'week_pattern' => 'specified', 'weekday' => 1, 'item_id' => $this->f['item_ids'][1],
    ])->assertCreated();
    reviewWrite($this, '/fixed-placements/'.$fixed->json('data.id').'/activate')->assertOk();
    $draft = reviewWrite($this, '/timetable-versions', ['base_version_id' => $this->f['version_id'], 'name' => '遗漏固定安排'])->assertCreated();
    reviewWrite($this, '/timetable-versions/'.$draft->json('data.id').'/activate', ['reason' => '固定安排检查'])
        ->assertStatus(409)->assertJsonPath('code', 'VERSION_HAS_HARD_CONFLICTS')
        ->assertJsonPath('hard_conflicts.0.type', 'fixed_placement');
});

it('R5 allows a valid locked clone to publish', function () {
    DB::table('timetable_entries')->where('id', $this->f['entry_id'])->update(['is_locked' => true]);
    $draft = reviewWrite($this, '/timetable-versions', ['base_version_id' => $this->f['version_id'], 'name' => '合法锁定课程'])->assertCreated();
    reviewWrite($this, '/timetable-versions/'.$draft->json('data.id').'/activate', ['reason' => '合法课表发布'])->assertOk();
    $this->getJson($this->base.'/timetable/validation?version_id='.$draft->json('data.id'))->assertOk()->assertJsonPath('data.valid', true);
});

it('R5 rechecks aggregate teacher load rules across all placements before publishing', function () {
    $assignment = TeachingAssignment::where('semester_id', $this->f['semester_id'])->firstOrFail();
    $assignment->forceFill(['weekly_items' => 2])->save();
    $roomId = DB::table('timetable_entries')->where('id', $this->f['entry_id'])->value('actual_room_id');
    insertDailyEntry($this->f['semester_id'], $this->f['version_id'], $assignment->id, $this->f['class_id'], $assignment->teacher_id, $assignment->course_id, $roomId, $this->f['item_ids'][1], now());
    $rule = reviewWrite($this, '/scheduling-constraints', [
        'name' => '教师最多连续一节', 'kind' => 'hard', 'category' => 'consecutive_items',
        'target_type' => 'teacher', 'target_id' => $assignment->teacher_id, 'scope' => [], 'requirement' => ['max_consecutive_items' => 1],
    ])->assertCreated();
    reviewWrite($this, '/scheduling-constraints/'.$rule->json('data.id').'/activate')->assertOk();
    $draft = reviewWrite($this, '/timetable-versions', ['base_version_id' => $this->f['version_id'], 'name' => '负荷校验'])->assertCreated();
    reviewWrite($this, '/timetable-versions/'.$draft->json('data.id').'/activate', ['reason' => '聚合规则校验'])
        ->assertStatus(409)->assertJsonPath('code', 'VERSION_HAS_HARD_CONFLICTS')
        ->assertJsonPath('hard_conflicts.0.constraint_id', $rule->json('data.id'));
});

it('R7 checks specified weeks separately and rejects only an overlapping overloaded week', function (array $secondWeeks, bool $allowed) {
    DB::table('timetable_entries')->where('semester_id', $this->f['semester_id'])->delete();
    DB::table('schedule_template_days')->where('semester_id', $this->f['semester_id'])->update(['is_enabled' => false]);
    DB::table('schedule_template_days')->where('semester_id', $this->f['semester_id'])->where('weekday', 1)->update(['is_enabled' => true]);
    $assignment = TeachingAssignment::where('semester_id', $this->f['semester_id'])->firstOrFail();
    $assignment->forceFill(['status' => 'draft', 'weekly_items' => 2, 'active_weeks' => [1, 3]])->save();
    $courseId = DB::table('courses')->insertGetId(['name' => '指定周课程', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
    DB::table('teacher_course')->insert(['teacher_id' => $this->f['teacher_id'], 'course_id' => $courseId]);
    $second = $assignment->replicate();
    $second->forceFill(['course_id' => $courseId, 'active_weeks' => $secondWeeks])->save();
    $response = reviewWrite($this, '/teaching-assignments/confirm', ['assignment_ids' => [$assignment->id, $second->id]]);
    if ($allowed) {
        $response->assertOk();
    } else {
        $response->assertStatus(409)->assertJsonPath('code', 'RESOURCE_CAPACITY_EXCEEDED')->assertJsonPath('week', 3);
        expect($assignment->fresh()->status->value)->toBe('draft')->and($second->fresh()->status->value)->toBe('draft');
    }
})->with(['disjoint' => [[2, 4], true], 'overlap' => [[3, 4], false]]);
