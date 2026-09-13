<?php

use App\Enums\Role;
use App\Models\User;
use App\Modules\DailyOperations\Services\DailyTimetableService;
use App\Modules\DailyOperations\Services\TimetableChangeMessages;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/../Fixtures/DailyOperationsFixture.php';

beforeEach(function () {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->staff = User::factory()->create(['role' => Role::Scheduler, 'must_change_password' => false]);
    $this->actingAs($this->staff)->withSession(['auth_version' => $this->staff->auth_version]);
    $this->fixture = dailyOperationsFixture($this->staff->id, true);
    $this->base = '/api/v1/semesters/'.$this->fixture['semester_id'];
    $this->other = DB::table('timetable_entries')->where('semester_id', $this->fixture['semester_id'])->where('id', '!=', $this->fixture['entry_id'])->first();
    DB::table('timetable_entries')->where('semester_id', $this->fixture['semester_id'])->update(['week_pattern' => 'all', 'active_weeks' => null]);
    DB::table('teaching_assignments')->where('semester_id', $this->fixture['semester_id'])->update(['week_pattern' => 'all', 'active_weeks' => null]);
    DB::table('timetable_entries')->where('id', $this->other->id)->update(['weekday' => 2]);
    foreach (['timetable_entry_classes', 'timetable_entry_teachers'] as $table) {
        DB::table($table)->where('timetable_version_id', $this->fixture['version_id'])->update(['week_pattern' => 'all']);
        DB::table($table)->where('timetable_entry_id', $this->other->id)->update(['weekday' => 2]);
    }
    DB::table('app_settings')->where('id', 1)->update(['current_semester_id' => $this->fixture['semester_id']]);
    $this->swap = ['type' => 'swap', 'effective_date' => '2026-09-07', 'replacement_date' => '2026-09-08', 'original_entry_id' => $this->fixture['entry_id'], 'related_entry_id' => $this->other->id, 'reason' => '跨日教研调课'];
});

function workbenchWrite($test, string $path, array $payload = [])
{
    $etag = $test->getJson($test->base)->headers->get('ETag');

    return $test->withHeader('If-Match', $etag)->postJson($test->base.$path, $payload);
}
function workbenchRows($test, string $date): array
{
    $rows = $test->getJson($test->base.'/daily-timetable?date='.$date)->assertOk()->json('data.rows');
    app(DailyTimetableService::class)->assertActualRowsConflictFree($rows, $date);

    return collect($rows)->reject(fn ($row) => $row['is_cancelled'])->values()->all();
}

it('publishes a cross-date swap atomically with exact before and after dates', function () {
    $preview = $this->postJson($this->base.'/calendar-exceptions/preview', $this->swap)->assertOk()->assertJsonPath('data.allowed', true)->assertJsonCount(2, 'data.changes');
    $preview->assertJsonPath('data.changes.0.before.date', '2026-09-07')->assertJsonPath('data.changes.0.after.date', '2026-09-08')->assertJsonPath('data.changes.1.after.date', '2026-09-07');
    $stored = workbenchWrite($this, '/calendar-exceptions', $this->swap)->assertCreated()->assertJsonCount(2, 'data.messages');
    $this->getJson($this->base.'/calendar-exceptions')->assertOk()->assertJsonStructure(['data' => [['original_entry' => ['item' => ['start_time', 'end_time'], 'school_classes'], 'related_entry' => ['item' => ['start_time', 'end_time'], 'school_classes']]]]);
    expect(workbenchRows($this, '2026-09-07')[0]['original_entry_id'])->toBe($this->other->id)
        ->and(workbenchRows($this, '2026-09-08')[0]['original_entry_id'])->toBe($this->fixture['entry_id']);
    expect(workbenchRows($this, '2026-09-14')[0]['original_entry_id'])->toBe($this->fixture['entry_id']);
    workbenchWrite($this, '/calendar-exceptions/'.$stored->json('data.id').'/cancel')->assertOk();
    expect(workbenchRows($this, '2026-09-07')[0]['original_entry_id'])->toBe($this->fixture['entry_id'])
        ->and(workbenchRows($this, '2026-09-08')[0]['original_entry_id'])->toBe($this->other->id);
    $this->assertDatabaseCount('timetable_change_messages', 4);
});

it('rejects an inactive target occurrence and duplicate edits on the target day', function () {
    $this->postJson($this->base.'/calendar-exceptions/preview', [...$this->swap, 'replacement_date' => '2026-09-09'])->assertStatus(422)->assertJsonPath('code', 'DAILY_ORIGINAL_NOT_ACTIVE');
    workbenchWrite($this, '/calendar-exceptions', $this->swap)->assertCreated();
    workbenchWrite($this, '/calendar-exceptions', ['type' => 'cancel', 'effective_date' => '2026-09-08', 'original_entry_id' => $this->fixture['entry_id'], 'reason' => '重复调整'])->assertStatus(409)->assertJsonPath('code', 'DAILY_EXCEPTION_ALREADY_EXISTS');
    $this->assertDatabaseCount('calendar_exceptions', 1);
});

it('checks both target times against teacher leave and writes no partial result', function () {
    DB::table('teacher_leaves')->insert(['semester_id' => $this->fixture['semester_id'], 'teacher_id' => $this->other->teacher_id, 'starts_at' => '2026-09-07 07:00:00', 'ends_at' => '2026-09-07 10:00:00', 'type' => 'official', 'status' => 'active', 'created_by' => $this->staff->id, 'created_at' => now(), 'updated_at' => now()]);
    $this->postJson($this->base.'/calendar-exceptions/preview', $this->swap)->assertOk()->assertJsonPath('data.allowed', false)->assertJsonPath('data.conflicts.0.type', 'teacher_leave');
    workbenchWrite($this, '/calendar-exceptions', $this->swap)->assertStatus(409);
    $this->assertDatabaseCount('calendar_exceptions', 0);
    $this->assertDatabaseCount('timetable_change_messages', 0);
});

it('keeps teacher messages private and marks only an opened personal message read', function () {
    workbenchWrite($this, '/calendar-exceptions', $this->swap)->assertCreated();
    $teacher = User::factory()->create(['role' => Role::Teacher, 'teacher_id' => $this->fixture['teacher_id'], 'must_change_password' => false]);
    $this->actingAs($teacher)->withSession(['auth_version' => $teacher->auth_version]);
    $messages = $this->getJson('/api/v1/teacher/me/change-messages')->assertOk()->assertJsonPath('data.unread', 1)->assertJsonCount(1, 'data.messages')->assertJsonCount(1, 'data.messages.0.changes');
    $ownId = $messages->json('data.messages.0.id');
    $otherId = DB::table('timetable_change_messages')->where('teacher_id', $this->other->teacher_id)->value('id');
    $this->postJson('/api/v1/teacher/me/change-messages/'.$otherId.'/read')->assertNotFound();
    $this->postJson('/api/v1/teacher/me/change-messages/'.$ownId.'/read')->assertOk();
    $this->getJson('/api/v1/teacher/me/change-messages')->assertOk()->assertJsonPath('data.unread', 0);
    $this->getJson('/api/v1/teacher/me/timetable?from=2026-09-07&to=2026-09-08')->assertOk()->assertJsonPath('data.days.1.rows.0.course_name', '数学')->assertJsonPath('data.days.1.rows.0.status', 'swap');
    $this->assertDatabaseHas('timetable_change_messages', ['id' => $otherId, 'read_at' => null]);
});

it('allows publication without generating messages and rejects stale publish attempts', function () {
    $etag = $this->getJson($this->base)->headers->get('ETag');
    workbenchWrite($this, '/calendar-exceptions', [...$this->swap, 'notify_teachers' => false])->assertCreated()->assertJsonCount(0, 'data.messages');
    $this->withHeader('If-Match', $etag)->postJson($this->base.'/calendar-exceptions', $this->swap)->assertStatus(412);
    $this->assertDatabaseCount('timetable_change_messages', 0);
    $this->assertDatabaseCount('calendar_exceptions', 1);
});

it('finds independently scoped cross-course options using the same conflict validation', function () {
    $query = http_build_query(['type' => 'swap', 'effective_date' => '2026-09-07', 'original_entry_id' => $this->fixture['entry_id'], 'from' => '2026-09-07', 'to' => '2026-09-13', 'scope' => 'class']);
    $this->getJson($this->base.'/calendar-exceptions/options?'.$query)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.allowed', true)->assertJsonPath('data.0.row.course_name', '语文')->assertJsonPath('data.0.payload.replacement_date', '2026-09-08');
    $this->getJson($this->base.'/calendar-exceptions/options?'.str_replace('2026-09-13', '2026-09-21', $query))->assertStatus(422);
});

it('supports cross-week swaps and preserves other recurring occurrences', function () {
    workbenchWrite($this, '/calendar-exceptions', [...$this->swap, 'replacement_date' => '2026-09-15'])->assertCreated();
    expect(workbenchRows($this, '2026-09-08')[0]['original_entry_id'])->toBe($this->other->id)
        ->and(workbenchRows($this, '2026-09-15')[0]['original_entry_id'])->toBe($this->fixture['entry_id']);
});

it('rebinds each side independently when a long-term version covers only the swap target', function () {
    workbenchWrite($this, '/calendar-exceptions', $this->swap)->assertCreated();
    $draft = workbenchWrite($this, '/timetable-versions', ['base_version_id' => $this->fixture['version_id'], 'name' => '目标日期新版本'])->assertCreated();
    workbenchWrite($this, '/long-term-adjustments', ['version_id' => $draft->json('data.id'), 'effective_from' => '2026-09-08', 'effective_to' => '2026-09-08', 'reason' => '目标日期版本'])->assertCreated();
    expect(workbenchRows($this, '2026-09-08')[0]['original_entry_id'])->toBe($this->fixture['entry_id']);
    $source = workbenchRows($this, '2026-09-07')[0];
    expect($source['course_name'])->toBe('语文')->and($source['original_entry_id'])->not->toBe($this->other->id);
});

it('finds a cross-date adjustment when filtering only its replacement date', function () {
    workbenchWrite($this, '/calendar-exceptions', $this->swap)->assertCreated();
    $this->getJson($this->base.'/calendar-exceptions?date_from=2026-09-08&date_to=2026-09-08')->assertOk()->assertJsonCount(1, 'data')
        ->assertJsonStructure(['data' => [['original_entry' => ['teacher' => ['id', 'name'], 'teachers', 'actual_room' => ['id', 'name'], 'item' => ['id', 'name']], 'related_entry' => ['teacher' => ['id', 'name'], 'teachers', 'actual_room' => ['id', 'name'], 'item' => ['id', 'name']]]]])
        ->assertJsonPath('data.0.original_entry.teacher.id', $this->fixture['teacher_id'])
        ->assertJsonPath('data.0.related_entry.teacher.id', $this->other->teacher_id);
    $this->getJson($this->base.'/calendar-exceptions?date_from=2026-09-09&date_to=2026-09-09')->assertOk()->assertJsonCount(0, 'data');
});

it('rolls back the timetable change if creating its messages fails', function () {
    $this->mock(TimetableChangeMessages::class)
        ->shouldReceive('publish')->once()->andThrow(new RuntimeException('simulated message persistence failure'));
    workbenchWrite($this, '/calendar-exceptions', $this->swap)->assertStatus(500);
    $this->assertDatabaseCount('calendar_exceptions', 0);
    $this->assertDatabaseCount('timetable_change_messages', 0);
    expect(workbenchRows($this, '2026-09-07')[0]['original_entry_id'])->toBe($this->fixture['entry_id']);
});

it('refuses withdrawal when a later substitution depends on the moved occurrence', function () {
    $stored = workbenchWrite($this, '/calendar-exceptions', $this->swap)->assertCreated();
    DB::table('substitutions')->insert(['original_entry_id' => $this->fixture['entry_id'], 'effective_date' => '2026-09-08', 'replacement_teacher_id' => $this->fixture['substitute_teacher_id'], 'replaced_teacher_id' => $this->fixture['teacher_id'], 'status' => 'active', 'created_by' => $this->staff->id, 'created_at' => now(), 'updated_at' => now()]);
    workbenchWrite($this, '/calendar-exceptions/'.$stored->json('data.id').'/cancel')->assertStatus(409)->assertJsonPath('code', 'DAILY_EXCEPTION_HAS_SUBSTITUTIONS');
    $this->assertDatabaseHas('calendar_exceptions', ['id' => $stored->json('data.id'), 'status' => 'active']);
});

it('searches the complete target range before paginating and keeps later days reachable', function () {
    $query = ['type' => 'move', 'effective_date' => '2026-09-07', 'original_entry_id' => $this->fixture['entry_id'], 'from' => '2026-09-07', 'to' => '2026-09-13', 'per_page' => 1];
    $this->getJson($this->base.'/calendar-exceptions/options?'.http_build_query($query))
        ->assertOk()->assertJsonPath('meta.pagination.total', 13)->assertJsonPath('meta.pagination.last_page', 13)->assertJsonCount(1, 'data');
    $this->getJson($this->base.'/calendar-exceptions/options?'.http_build_query([...$query, 'page' => 13]))
        ->assertOk()->assertJsonPath('data.0.date', '2026-09-13');
    $this->getJson($this->base.'/calendar-exceptions/options?'.http_build_query([...$query, 'q' => '2026-09-13']))
        ->assertOk()->assertJsonPath('meta.pagination.total', 2)->assertJsonPath('data.0.date', '2026-09-13');
});

it('filters a known target period before pagination and keeps later dates reachable', function () {
    $query = ['type' => 'move', 'effective_date' => '2026-09-07', 'original_entry_id' => $this->fixture['entry_id'], 'from' => '2026-09-07', 'to' => '2026-09-13', 'target_item_id' => $this->fixture['item_ids'][1], 'per_page' => 1];
    $this->getJson($this->base.'/calendar-exceptions/options?'.http_build_query($query))->assertOk()->assertJsonPath('meta.pagination.total', 7)->assertJsonPath('data.0.item.id', $this->fixture['item_ids'][1]);
    $this->getJson($this->base.'/calendar-exceptions/options?'.http_build_query([...$query, 'page' => 7]))->assertOk()->assertJsonPath('data.0.date', '2026-09-13');
    $swapQuery = [...$query, 'type' => 'swap', 'from' => '2026-09-08', 'to' => '2026-09-08'];
    $this->getJson($this->base.'/calendar-exceptions/options?'.http_build_query($swapQuery))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.row.original_entry_id', $this->other->id);
    $this->getJson($this->base.'/calendar-exceptions/options?'.http_build_query([...$swapQuery, 'target_item_id' => $this->fixture['item_ids'][0]]))->assertOk()->assertJsonCount(0, 'data');
});

it('filters the target class before pagination and includes merged-class lessons', function () {
    $class = (array) DB::table('school_classes')->find($this->fixture['class_id']);
    unset($class['id']);
    $targetClassId = DB::table('school_classes')->insertGetId([...$class, 'name' => '七年级 2 班', 'code' => 'G7C2']);
    $pivot = (array) DB::table('timetable_entry_classes')->where('timetable_entry_id', $this->other->id)->first();
    unset($pivot['id']);
    DB::table('timetable_entry_classes')->insert([...$pivot, 'school_class_id' => $targetClassId]);
    $distractorId = insertDailyEntry($this->fixture['semester_id'], $this->fixture['version_id'], $this->other->teaching_assignment_id, $this->fixture['class_id'], $this->other->teacher_id, $this->other->course_id, $this->other->actual_room_id, $this->fixture['item_ids'][1], now());
    DB::table('timetable_entries')->where('id', $distractorId)->update(['week_pattern' => 'all', 'active_weeks' => null]);
    foreach (['timetable_entry_classes', 'timetable_entry_teachers'] as $table) {
        DB::table($table)->where('timetable_entry_id', $distractorId)->update(['week_pattern' => 'all']);
    }
    $query = ['type' => 'swap', 'effective_date' => '2026-09-07', 'original_entry_id' => $this->fixture['entry_id'], 'from' => '2026-09-07', 'to' => '2026-09-13', 'per_page' => 1, 'target_item_id' => $this->fixture['item_ids'][1]];
    $this->getJson($this->base.'/calendar-exceptions/options?'.http_build_query($query))->assertOk()->assertJsonPath('meta.pagination.total', 2)->assertJsonPath('data.0.row.original_entry_id', $distractorId);
    $this->getJson($this->base.'/calendar-exceptions/options?'.http_build_query([...$query, 'target_class_id' => $targetClassId]))->assertOk()->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.row.original_entry_id', $this->other->id)->assertJsonCount(2, 'data.0.row.class_ids');
    $this->getJson($this->base.'/calendar-exceptions/options?'.http_build_query([...$query, 'target_class_id' => 999999]))->assertStatus(422);
    $this->assertDatabaseCount('calendar_exceptions', 0);
});

it('keeps conflicting targets visible in chronological order without recommending or hiding them', function () {
    DB::table('teacher_leaves')->insert(['semester_id' => $this->fixture['semester_id'], 'teacher_id' => $this->fixture['teacher_id'], 'starts_at' => '2026-09-07 08:50:00', 'ends_at' => '2026-09-08 23:59:00', 'type' => 'official', 'status' => 'active', 'created_by' => $this->staff->id, 'created_at' => now(), 'updated_at' => now()]);
    $query = ['type' => 'move', 'effective_date' => '2026-09-07', 'original_entry_id' => $this->fixture['entry_id'], 'from' => '2026-09-07', 'to' => '2026-09-13'];
    $this->getJson($this->base.'/calendar-exceptions/options?'.http_build_query($query))->assertOk()->assertJsonCount(13, 'data')->assertJsonPath('data.0.date', '2026-09-07')->assertJsonPath('data.0.allowed', false)->assertJsonPath('data.0.conflicts.0.type', 'teacher_leave')->assertJsonPath('data.3.date', '2026-09-09')->assertJsonPath('data.3.allowed', true);
    $this->assertDatabaseCount('calendar_exceptions', 0);
    $this->assertDatabaseCount('timetable_change_messages', 0);
});

it('uses current restored resource details in withdrawal messages while preserving the original snapshot', function () {
    $stored = workbenchWrite($this, '/calendar-exceptions', $this->swap)->assertCreated();
    DB::table('teachers')->where('id', $this->fixture['teacher_id'])->update(['name' => '胡静（已更正）']);
    workbenchWrite($this, '/calendar-exceptions/'.$stored->json('data.id').'/cancel')->assertOk();
    $messages = DB::table('timetable_change_messages')->where('teacher_id', $this->fixture['teacher_id'])->get()->keyBy('event');
    $published = json_decode($messages['published']->changes, true, 512, JSON_THROW_ON_ERROR);
    $cancelled = json_decode($messages['cancelled']->changes, true, 512, JSON_THROW_ON_ERROR);
    expect($published[0]['before']['teacher_names'])->toBe(['胡静'])
        ->and($cancelled[0]['after']['teacher_names'])->toBe(['胡静（已更正）']);
});

it('keeps preview, actual timetable and messages consistent for replacement resources', function (string $type) {
    $entry = DB::table('timetable_entries')->find($this->fixture['entry_id']);
    $roomId = DB::table('rooms')->insertGetId(['name' => '备用教室', 'type' => 'classroom', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
    $payload = ['type' => $type, 'effective_date' => '2026-09-07', 'replacement_date' => '2026-09-07', 'replacement_item_id' => $this->fixture['item_ids'][1], 'replacement_teacher_id' => $this->fixture['substitute_teacher_id'], 'replacement_room_id' => $roomId, 'reason' => '调整教师与教室'];
    $payload[$type === 'move' ? 'original_entry_id' : 'replacement_assignment_id'] = $type === 'move' ? $entry->id : $entry->teaching_assignment_id;
    $this->postJson($this->base.'/calendar-exceptions/preview', $payload)->assertOk()->assertJsonPath('data.changes.0.after.teacher_id', $this->fixture['substitute_teacher_id'])->assertJsonPath('data.changes.0.after.room_id', $roomId);
    $stored = workbenchWrite($this, '/calendar-exceptions', $payload)->assertCreated();
    $actual = collect(workbenchRows($this, '2026-09-07'))->firstWhere('exception_id', $stored->json('data.id'));
    expect($actual['teacher_id'])->toBe($this->fixture['substitute_teacher_id'])->and($actual['room_id'])->toBe($roomId);
    $message = DB::table('timetable_change_messages')->where('teacher_id', $this->fixture['substitute_teacher_id'])->first();
    expect(json_decode($message->changes, true, 512, JSON_THROW_ON_ERROR)[0]['after']['room_id'])->toBe($roomId);
})->with(['move', 'makeup']);

it('searches both sides of adjustment records before pagination and combines filters', function () {
    $stored = workbenchWrite($this, '/calendar-exceptions', [...$this->swap, 'reason' => '唯一目标事项'])->assertCreated();
    $copy = (array) DB::table('calendar_exceptions')->where('id', $stored->json('data.id'))->first();
    unset($copy['id']);
    $copy['status'] = 'cancelled';
    $copy['reason'] = '其他历史调整';
    for ($index = 0; $index < 24; $index++) {
        DB::table('calendar_exceptions')->insert($copy);
    }
    $this->getJson($this->base.'/calendar-exceptions?'.http_build_query(['q' => '唯一目标事项']))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $stored->json('data.id'));
    foreach ([$this->fixture['teacher_id'], $this->other->teacher_id] as $teacherId) {
        $name = DB::table('teachers')->where('id', $teacherId)->value('name');
        $this->getJson($this->base.'/calendar-exceptions?'.http_build_query(['q' => $name]))->assertOk()->assertJsonPath('meta.pagination.total', 25);
    }
    $className = DB::table('school_classes')->where('id', $this->fixture['class_id'])->value('name');
    $this->getJson($this->base.'/calendar-exceptions?'.http_build_query(['q' => $className, 'status' => 'active']))->assertOk()->assertJsonCount(1, 'data');
    $this->getJson($this->base.'/calendar-exceptions?'.http_build_query(['q' => '唯一目标事项', 'status' => 'cancelled']))->assertOk()->assertJsonCount(0, 'data');
    $this->getJson($this->base.'/calendar-exceptions?'.http_build_query(['q' => '不存在的老师']))->assertOk()->assertJsonCount(0, 'data');
});
