<?php

use App\Enums\Role;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Services\TimetableEffectivePeriodService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

require_once __DIR__.'/../Fixtures/DailyOperationsFixture.php';

beforeEach(function () {
    $this->travelTo(now()->setDate(2026, 9, 1)->startOfDay());
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->staff = User::factory()->create(['role' => Role::Scheduler, 'must_change_password' => false]);
    $this->actingAs($this->staff)->withSession(['auth_version' => $this->staff->auth_version]);
    $this->fixture = dailyOperationsFixture($this->staff->id, true);
    $this->base = '/api/v1/semesters/'.$this->fixture['semester_id'];
    $this->other = DB::table('timetable_entries')->where('semester_id', $this->fixture['semester_id'])->where('id', '!=', $this->fixture['entry_id'])->first();
    foreach (['timetable_entries', 'teaching_assignments'] as $table) {
        DB::table($table)->where('semester_id', $this->fixture['semester_id'])->update(['week_pattern' => 'all', 'active_weeks' => null]);
    }
    foreach (['timetable_entry_classes', 'timetable_entry_teachers'] as $table) {
        DB::table($table)->where('timetable_version_id', $this->fixture['version_id'])->update(['week_pattern' => 'all']);
    }
    DB::table('app_settings')->where('id', 1)->update(['current_semester_id' => $this->fixture['semester_id']]);
    $this->key = DB::table('timetable_entries')->where('id', $this->fixture['entry_id'])->value('entry_key');
    $this->room = DB::table('rooms')->insertGetId(['name' => '备用教室', 'type' => 'classroom', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
});

function ltWrite($test, string $path, array $data = [])
{
    $etag = $test->getJson($test->base)->headers->get('ETag');

    return $test->withHeader('If-Match', $etag)->postJson($test->base.'/long-term-changes'.$path, $data);
}
function ltEntry($test, string $date, ?string $key = null): TimetableEntry
{
    $semester = Semester::query()->findOrFail($test->fixture['semester_id']);
    $version = app(TimetableEffectivePeriodService::class)->versionForDate($semester, $date);

    return $version->entries()->where('entry_key', $key ?? $test->key)->firstOrFail();
}
function ltPayload($test, array $fields = [], string $from = '2026-09-07', string $to = '2026-09-30'): array
{
    $entry = ltEntry($test, $from);

    return ['source_version_id' => $entry->timetable_version_id, 'effective_from' => $from, 'effective_to' => $to,
        'reason' => '固定教研安排调整', 'changes' => [['entry_id' => $entry->id, ...($fields ?: ['weekday' => 2])]]];
}

it('previews without persisting drafts, periods, messages or changing the revision', function () {
    $etag = $this->getJson($this->base)->headers->get('ETag');
    ltWrite($this, '/preview', ltPayload($this))->assertOk()->assertJsonPath('data.allowed', true)
        ->assertJsonPath('data.changes.0.before.weekday', 1)->assertJsonPath('data.changes.0.after.weekday', 2)
        ->assertJsonPath('data.following.0.effective_from', '2026-10-01')
        ->assertJsonPath('data.following.0.effective_to', Semester::query()->findOrFail($this->fixture['semester_id'])->end_date->toDateString());
    $this->assertDatabaseCount('long_term_changes', 0);
    $this->assertDatabaseCount('timetable_versions', 1);
    $this->assertDatabaseCount('timetable_change_messages', 0);
    expect($this->getJson($this->base)->headers->get('ETag'))->toBe($etag);
});

it('publishes only the selected recurring changes and keeps earlier and later arrangements', function () {
    ltWrite($this, '', ltPayload($this))->assertCreated();
    expect(ltEntry($this, '2026-09-01')->weekday)->toBe(1)
        ->and(ltEntry($this, '2026-09-07')->weekday)->toBe(2)
        ->and(ltEntry($this, '2026-09-28')->weekday)->toBe(2)
        ->and(ltEntry($this, '2026-10-01')->weekday)->toBe(1)
        ->and(ltEntry($this, '2026-09-07', $this->other->entry_key)->item_id)->toBe($this->fixture['item_ids'][1]);
    $this->assertDatabaseHas('semesters', ['id' => $this->fixture['semester_id'], 'current_timetable_version_id' => $this->fixture['version_id']]);
});

it('preserves an unrelated future field change while applying a time change across periods', function () {
    ltWrite($this, '', ltPayload($this, ['actual_room_id' => $this->room], '2026-09-21', '2026-10-31'))->assertCreated();
    ltWrite($this, '', ltPayload($this, ['weekday' => 2], '2026-09-07', '2026-10-31'))->assertCreated();
    expect(ltEntry($this, '2026-09-14')->weekday)->toBe(2)
        ->and(ltEntry($this, '2026-09-21')->weekday)->toBe(2)
        ->and(ltEntry($this, '2026-09-21')->actual_room_id)->toBe($this->room);
});

it('blocks overlapping edits to the same future field and rolls back every segment', function () {
    ltWrite($this, '', ltPayload($this, ['weekday' => 3], '2026-09-21'))->assertCreated();
    $versionCount = DB::table('timetable_versions')->count();
    ltWrite($this, '', ltPayload($this))->assertStatus(409)->assertJsonPath('code', 'LONG_TERM_FUTURE_CONFLICT');
    expect(DB::table('timetable_versions')->count())->toBe($versionCount)
        ->and(ltEntry($this, '2026-09-14')->weekday)->toBe(1)
        ->and(ltEntry($this, '2026-09-21')->weekday)->toBe(3);
});

it('swaps both recurring lessons atomically and refuses a one-sided collision', function () {
    $payload = ltPayload($this, ['item_id' => $this->fixture['item_ids'][1]]);
    ltWrite($this, '', $payload)->assertStatus(409)->assertJsonPath('code', 'VERSION_HAS_HARD_CONFLICTS');
    $payload['changes'][] = ['entry_id' => $this->other->id, 'item_id' => $this->fixture['item_ids'][0]];
    ltWrite($this, '', $payload)->assertCreated()->assertJsonCount(2, 'data.changes');
    expect(ltEntry($this, '2026-09-07')->item_id)->toBe($this->fixture['item_ids'][1]);
});

it('swaps lessons of the same assignment without transient duplicate slots and restores their identities', function () {
    $first = ltEntry($this, '2026-09-07');
    $second = $first->replicate()->forceFill([
        'entry_key' => (string) Str::uuid(), 'weekday' => 2,
        'teacher_id' => $this->fixture['substitute_teacher_id'],
    ]);
    $second->save();
    $pivot = ['timetable_version_id' => $second->timetable_version_id, 'week_pattern' => 'all', 'weekday' => 2, 'item_id' => $second->item_id];
    $second->schoolClasses()->attach($this->fixture['class_id'], $pivot);
    $second->teachers()->attach($second->teacher_id, $pivot);
    DB::table('teaching_assignments')->where('id', $first->teaching_assignment_id)->update(['weekly_items' => 2]);

    $payload = ltPayload($this, ['weekday' => 2]);
    ltWrite($this, '/preview', $payload)->assertStatus(409)->assertJsonPath('code', 'VERSION_HAS_HARD_CONFLICTS');
    $payload['changes'][] = ['entry_id' => $second->id, 'weekday' => 1];
    ltWrite($this, '/preview', $payload)->assertOk();
    expect(ltEntry($this, '2026-09-07')->weekday)->toBe(1);
    $id = ltWrite($this, '', $payload)->assertCreated()->json('data.record.id');
    expect(ltEntry($this, '2026-09-07')->weekday)->toBe(2)
        ->and(ltEntry($this, '2026-09-07', $second->entry_key)->weekday)->toBe(1)
        ->and(ltEntry($this, '2026-09-07', $second->entry_key)->teachers->pluck('id')->all())->toBe([$second->teacher_id]);
    ltWrite($this, '/'.$id.'/restore', ['effective_from' => '2026-09-07'])->assertCreated();
    expect(ltEntry($this, '2026-09-07')->weekday)->toBe(1)
        ->and(ltEntry($this, '2026-09-07', $second->entry_key)->weekday)->toBe(2);
});

it('changes the effective teacher and sends private recurring messages to both teachers', function () {
    ltWrite($this, '', ltPayload($this, ['teacher_id' => $this->fixture['substitute_teacher_id']]))->assertCreated();
    $entry = ltEntry($this, '2026-09-07');
    expect($entry->teachers->pluck('id')->all())->toBe([$this->fixture['substitute_teacher_id']]);
    $this->getJson($this->base.'/daily-timetable?date=2026-09-07')->assertOk()->assertJsonPath('data.rows.0.teacher_id', $this->fixture['substitute_teacher_id']);
    expect(DB::table('timetable_change_messages')->pluck('teacher_id')->all())
        ->toEqualCanonicalizing([$this->fixture['teacher_id'], $this->fixture['substitute_teacher_id']]);
    $teacher = User::factory()->create(['role' => Role::Teacher, 'teacher_id' => $this->fixture['substitute_teacher_id'], 'must_change_password' => false]);
    $this->actingAs($teacher)->withSession(['auth_version' => $teacher->auth_version]);
    $this->getJson('/api/v1/teacher/me/change-messages')->assertOk()->assertJsonPath('data.unread', 1)->assertJsonPath('data.messages.0.type', 'long_term');
});

it('rejects unqualified replacements and effective-teacher conflicts', function () {
    ltWrite($this, '', ltPayload($this, ['teacher_id' => $this->other->teacher_id]))->assertStatus(409);
    DB::table('teacher_course')->insert(['teacher_id' => $this->other->teacher_id, 'course_id' => ltEntry($this, '2026-09-07')->course_id]);
    $thirdClass = DB::table('school_classes')->insertGetId(['academic_year_id' => 1, 'grade_id' => 1, 'name' => '另一个班', 'status' => 'active', 'created_at' => now(), 'updated_at' => now()]);
    DB::table('timetable_entry_classes')->where('timetable_entry_id', $this->other->id)->update(['school_class_id' => $thirdClass]);
    DB::table('timetable_entries')->where('id', $this->other->id)->update(['actual_room_id' => $this->room, 'item_id' => $this->fixture['item_ids'][0]]);
    ltWrite($this, '/preview', ltPayload($this, ['teacher_id' => $this->other->teacher_id]))->assertStatus(409)
        ->assertJsonFragment(['type' => 'teacher']);
});

it('cancels a future change without erasing a later independent room change', function () {
    $original = ltWrite($this, '', ltPayload($this))->assertCreated()->json('data.record.id');
    ltWrite($this, '', ltPayload($this, ['actual_room_id' => $this->room], '2026-09-14'))->assertCreated();
    ltWrite($this, '/'.$original.'/restore/preview', ['effective_from' => '2026-09-07'])->assertOk();
    expect(ltEntry($this, '2026-09-14')->weekday)->toBe(2);
    ltWrite($this, '/'.$original.'/restore', ['effective_from' => '2026-09-07'])->assertCreated();
    expect(ltEntry($this, '2026-09-14')->weekday)->toBe(1)
        ->and(ltEntry($this, '2026-09-14')->actual_room_id)->toBe($this->room);
    ltWrite($this, '/'.$original.'/restore', ['effective_from' => '2026-09-07'])->assertStatus(409);
});

it('restores from a future date without rewriting already executed weeks', function () {
    $id = ltWrite($this, '', ltPayload($this))->assertCreated()->json('data.record.id');
    $this->travelTo(now()->setDate(2026, 9, 15));
    ltWrite($this, '/'.$id.'/restore', ['effective_from' => '2026-09-14'])->assertStatus(422);
    ltWrite($this, '/'.$id.'/restore', ['effective_from' => '2026-09-21'])->assertCreated();
    expect(ltEntry($this, '2026-09-14')->weekday)->toBe(2)->and(ltEntry($this, '2026-09-21')->weekday)->toBe(1);
});

it('blocks undo when a later time change depends on the current arrangement', function () {
    $id = ltWrite($this, '', ltPayload($this))->assertCreated()->json('data.record.id');
    ltWrite($this, '', ltPayload($this, ['weekday' => 3], '2026-09-14'))->assertCreated();
    ltWrite($this, '/'.$id.'/restore', ['effective_from' => '2026-09-07'])->assertStatus(409);
    expect(ltEntry($this, '2026-09-07')->weekday)->toBe(2)->and(ltEntry($this, '2026-09-14')->weekday)->toBe(3);
});

it('preserves and validates existing temporary changes inside the interval', function () {
    $etag = $this->getJson($this->base)->headers->get('ETag');
    $this->withHeader('If-Match', $etag)->postJson($this->base.'/calendar-exceptions', ['type' => 'room_change', 'effective_date' => '2026-09-07', 'original_entry_id' => $this->fixture['entry_id'], 'replacement_room_id' => $this->room, 'reason' => '临时场地变更'])->assertCreated();
    ltWrite($this, '', ltPayload($this, ['teacher_id' => $this->fixture['substitute_teacher_id']]))->assertCreated();
    $this->getJson($this->base.'/daily-timetable?date=2026-09-07')->assertOk()->assertJsonPath('data.rows.0.room_id', $this->room)->assertJsonPath('data.rows.0.teacher_id', $this->fixture['substitute_teacher_id']);
});

it('does not publish an assignment to a teacher on leave', function () {
    DB::table('teacher_leaves')->insert(['semester_id' => $this->fixture['semester_id'], 'teacher_id' => $this->fixture['substitute_teacher_id'], 'starts_at' => '2026-09-07 07:00:00', 'ends_at' => '2026-09-07 11:00:00', 'type' => 'official', 'status' => 'active', 'created_by' => $this->staff->id, 'created_at' => now(), 'updated_at' => now()]);
    ltWrite($this, '', ltPayload($this, ['teacher_id' => $this->fixture['substitute_teacher_id']]))->assertStatus(409)->assertJsonPath('code', 'LONG_TERM_TEACHER_LEAVE');
    $this->assertDatabaseCount('long_term_changes', 0);
});

it('filters records by teacher text, status and overlapping effective dates', function () {
    ltWrite($this, '', ltPayload($this, ['teacher_id' => $this->fixture['substitute_teacher_id']]))->assertCreated();
    expect(DB::table('long_term_changes')->value('search_text'))->toContain('陈敏');
    $this->getJson($this->base.'/long-term-changes?status=upcoming')->assertOk()->assertJsonCount(1, 'data');
    $this->getJson($this->base.'/long-term-changes?'.http_build_query(['q' => '陈敏', 'status' => 'upcoming', 'date_from' => '2026-09-15', 'date_to' => '2026-09-16']))->assertOk()->assertJsonCount(1, 'data');
    $this->getJson($this->base.'/long-term-changes?q=不存在')->assertOk()->assertJsonCount(0, 'data');
    $this->getJson($this->base.'/long-term-changes?status=active')->assertOk()->assertJsonCount(0, 'data');
});

it('enforces permissions and optimistic concurrency for preview and publication', function () {
    $payload = ltPayload($this);
    $old = $this->getJson($this->base)->headers->get('ETag');
    ltWrite($this, '', ltPayload($this, ['actual_room_id' => $this->room], '2026-10-01', '2026-10-30'))->assertCreated();
    $this->withHeader('If-Match', $old)->postJson($this->base.'/long-term-changes/preview', $payload)->assertStatus(412);
    $viewer = User::factory()->create(['role' => Role::Viewer, 'must_change_password' => false]);
    $this->actingAs($viewer)->withSession(['auth_version' => $viewer->auth_version]);
    $this->getJson($this->base.'/long-term-changes')->assertOk();
    ltWrite($this, '/preview', $payload)->assertForbidden();
    ltWrite($this, '', $payload)->assertForbidden();
});

it('blocks a weekday change that would orphan an existing temporary occurrence', function () {
    $etag = $this->getJson($this->base)->headers->get('ETag');
    $this->withHeader('If-Match', $etag)->postJson($this->base.'/calendar-exceptions', ['type' => 'room_change', 'effective_date' => '2026-09-07', 'original_entry_id' => $this->fixture['entry_id'], 'replacement_room_id' => $this->room, 'reason' => '已有单日安排'])->assertCreated();
    ltWrite($this, '', ltPayload($this))->assertStatus(409)->assertJsonPath('code', 'LONG_TERM_TEMPORARY_DEPENDENCY');
    expect(ltEntry($this, '2026-09-07')->weekday)->toBe(1);
    $this->assertDatabaseCount('long_term_changes', 0);
});

it('returns only each records message receipts without marking messages as read', function () {
    $first = ltWrite($this, '', ltPayload($this, ['actual_room_id' => $this->room], '2026-09-07', '2026-09-14'))->assertCreated()->json('data.record.id');
    $second = ltWrite($this, '', ltPayload($this, ['actual_room_id' => $this->room], '2026-09-21', '2026-09-30'))->assertCreated()->json('data.record.id');
    $firstMessage = DB::table('timetable_change_messages')->where('long_term_change_id', $first)->first();
    DB::table('timetable_change_messages')->where('id', $firstMessage->id)->update(['read_at' => now()]);
    $records = collect($this->getJson($this->base.'/long-term-changes')->assertOk()->json('data'))->keyBy('id');
    expect($records[$first]['messages'])->toHaveCount(1)
        ->and($records[$first]['messages'][0]['id'])->toBe($firstMessage->id)
        ->and($records[$first]['messages'][0]['read_at'])->not->toBeNull()
        ->and($records[$second]['messages'])->toHaveCount(1)
        ->and($records[$second]['messages'][0]['event'])->toBe('published')
        ->and($records[$second]['messages'][0]['read_at'])->toBeNull();
    expect(DB::table('timetable_change_messages')->where('long_term_change_id', $second)->value('read_at'))->toBeNull();
});
