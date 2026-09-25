<?php

use App\Enums\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/../Fixtures/DailyOperationsFixture.php';

it('keeps manual contact separate from teacher read state and enforces identity boundaries', function (): void {
    $this->travelTo(now()->setDate(2026, 9, 1));
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $staff = User::factory()->create(['role' => Role::Scheduler, 'must_change_password' => false]);
    $this->actingAs($staff)->withSession(['auth_version' => $staff->auth_version]);
    $fixture = dailyOperationsFixture($staff->id);
    $base = '/api/v1/semesters/'.$fixture['semester_id'];
    DB::table('app_settings')->where('id', 1)->update(['current_semester_id' => $fixture['semester_id']]);
    DB::table('teaching_assignments')->update(['week_pattern' => 'all', 'active_weeks' => null]);
    DB::table('timetable_entries')->update(['week_pattern' => 'all', 'active_weeks' => null]);
    foreach (['timetable_entry_classes', 'timetable_entry_teachers'] as $table) {
        DB::table($table)->update(['week_pattern' => 'all']);
    }
    $etag = $this->getJson($base)->headers->get('ETag');
    $created = $this->withHeader('If-Match', $etag)->postJson($base.'/calendar-exceptions', [
        'type' => 'cancel', 'effective_date' => '2026-09-07', 'original_entry_id' => $fixture['entry_id'],
        'reason' => '年级活动停课', 'notify_teachers' => true,
    ])->assertCreated();
    $exception = $created->json('data.id');
    $message = DB::table('timetable_change_messages')->where('calendar_exception_id', $exception)->sole();
    $path = '/api/v1/change-messages/'.$message->id.'/contact';
    $this->postJson($path, ['note' => '电话已告知停课日期'])->assertOk()->assertJsonPath('data.read_at', null);
    $this->postJson($path, ['note' => '重复点击'])->assertOk()->assertJsonPath('data.contact_note', '电话已告知停课日期');
    $this->getJson('/api/v1/change-messages?calendar_exception_id='.$exception)->assertOk()->assertJsonPath('data.0.contacted_by_name', $staff->name)->assertJsonPath('data.0.read_at', null);
    $teacher = User::factory()->create(['role' => Role::Teacher, 'teacher_id' => $fixture['teacher_id'], 'must_change_password' => false]);
    $this->actingAs($teacher)->withSession(['auth_version' => $teacher->auth_version]);
    $this->postJson($path, ['note' => '教师不能代教务标记'])->assertForbidden();
    $this->postJson('/api/v1/teacher/me/change-messages/'.$message->id.'/read')->assertOk();
    expect(DB::table('timetable_change_messages')->where('id', $message->id)->value('read_at'))->not->toBeNull();
    $other = User::factory()->create(['role' => Role::Teacher, 'teacher_id' => $fixture['substitute_teacher_id'], 'must_change_password' => false]);
    $this->actingAs($other)->withSession(['auth_version' => $other->auth_version]);
    $this->postJson('/api/v1/teacher/me/change-messages/'.$message->id.'/read')->assertNotFound();
    $viewer = User::factory()->create(['role' => Role::Viewer, 'must_change_password' => false]);
    $this->actingAs($viewer)->withSession(['auth_version' => $viewer->auth_version]);
    $this->postJson($path, ['note' => '只读账号不能标记'])->assertForbidden();
    $this->travelBack();
});
