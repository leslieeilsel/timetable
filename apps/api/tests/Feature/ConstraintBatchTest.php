<?php

use App\Enums\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->scheduler = User::factory()->create(['role' => Role::Scheduler, 'must_change_password' => false]);
    $this->actingAs($this->scheduler)->withSession(['auth_version' => $this->scheduler->auth_version]);
    $now = now();
    $year = DB::table('academic_years')->insertGetId([
        'name' => '2026-2027', 'start_date' => '2026-09-01', 'end_date' => '2027-07-15',
        'status' => 'open', 'created_at' => $now, 'updated_at' => $now,
    ]);
    $this->semesterId = DB::table('semesters')->insertGetId([
        'academic_year_id' => $year, 'name' => '上学期', 'sequence' => 1,
        'start_date' => '2026-09-01', 'end_date' => '2027-01-20', 'status' => 'open',
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $teacher = DB::table('teachers')->insertGetId([
        'employee_no' => 'T001', 'name' => '李明', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $this->root = "/api/v1/semesters/{$this->semesterId}/scheduling-constraints";
    $this->draft = [
        'name' => '李明周二不排课', 'kind' => 'hard', 'category' => 'forbidden_slot',
        'target_type' => 'teacher', 'target_id' => $teacher, 'scope' => ['weekdays' => [2]],
        'condition' => (object) [], 'requirement' => ['available' => false], 'weight' => null,
    ];
});

it('previews valid drafts without writing rules, audits or revisions', function (): void {
    $before = DB::table('semesters')->find($this->semesterId);
    $audits = DB::table('audit_logs')->count();
    $this->getJson($this->root.'/capabilities')->assertOk()->assertJsonCount(3, 'data');
    $response = $this->postJson($this->root.'/preview', ['constraints' => [$this->draft]])
        ->assertOk()->assertJsonPath('data.constraints.0.name', '李明周二不排课');
    expect($response->json('data.summaries.0'))->toContain('李明', '每周二', '不安排课程')
        ->and($response->json('data.etag'))->toBe($response->headers->get('ETag'))
        ->and(DB::table('semesters')->find($this->semesterId))->toEqual($before);
    $this->assertDatabaseCount('scheduling_constraints', 0);
    $this->assertDatabaseCount('operation_receipts', 0);
    $this->assertDatabaseCount('audit_logs', $audits);
    expect(json_decode($response->getContent())->data->constraints[0]->condition)->toBeInstanceOf(stdClass::class);
});

it('atomically saves drafts and safely replays a retry with the old etag', function (): void {
    $preview = $this->postJson($this->root.'/preview', ['constraints' => [$this->draft]])->assertOk();
    $rows = [$this->draft, [...$this->draft, 'name' => '每日最多四节', 'category' => 'daily_load', 'scope' => (object) [], 'requirement' => ['max_items_per_day' => 4]]];
    $this->withHeaders(['If-Match' => $preview->headers->get('ETag'), 'Idempotency-Key' => (string) Str::uuid()]);
    $created = $this->postJson($this->root.'/bulk', ['constraints' => $rows])->assertCreated()
        ->assertJsonCount(2, 'data')->assertJsonPath('data.0.status', 'draft')->assertJsonPath('data.1.source', 'user');
    $this->postJson($this->root.'/bulk', ['constraints' => $rows])->assertOk()->assertExactJson($created->json());
    $this->assertDatabaseCount('scheduling_constraints', 2);
    $this->assertDatabaseCount('operation_receipts', 1);
    expect(DB::table('audit_logs')->where('auditable_type', 'scheduling_constraint')->count())->toBe(2)
        ->and((int) DB::table('semesters')->where('id', $this->semesterId)->value('constraint_revision'))->toBe(1);
    $rows[0]['name'] = '不同内容';
    $this->postJson($this->root.'/bulk', ['constraints' => $rows])->assertStatus(409)->assertJsonPath('code', 'IDEMPOTENCY_CONFLICT');
    $this->assertDatabaseCount('scheduling_constraints', 2);
});

it('rejects a whole batch when any draft is invalid or carries extra model fields', function (): void {
    $etag = $this->getJson("/api/v1/semesters/{$this->semesterId}")->headers->get('ETag');
    $this->withHeaders(['If-Match' => $etag, 'Idempotency-Key' => (string) Str::uuid()]);
    $this->postJson($this->root.'/bulk', ['constraints' => [$this->draft, [...$this->draft, 'target_id' => 99999]]])->assertStatus(422);
    $this->postJson($this->root.'/preview', ['constraints' => [[...$this->draft, 'status' => 'active']]])->assertStatus(422);
    $this->postJson($this->root.'/preview', ['constraints' => [[...$this->draft, 'scope' => ['weekdays' => [8]]]]])->assertStatus(422);
    $this->postJson($this->root.'/preview', ['constraints' => [[...$this->draft, 'scope' => ['item_ids' => [99999]]]]])->assertStatus(422);
    $this->postJson($this->root.'/preview', ['constraints' => [[...$this->draft, 'category' => 'weekly_load', 'scope' => [], 'requirement' => ['max_items_per_week' => 12]]]])->assertStatus(422);
    $this->assertDatabaseCount('scheduling_constraints', 0);
    $this->assertDatabaseCount('operation_receipts', 0);
    expect((int) DB::table('semesters')->where('id', $this->semesterId)->value('constraint_revision'))->toBe(0);
});

it('requires a fresh preview version and rejects a closed semester', function (): void {
    $preview = $this->postJson($this->root.'/preview', ['constraints' => [$this->draft]])->assertOk();
    $this->withHeaders(['If-Match' => $preview->headers->get('ETag'), 'Idempotency-Key' => (string) Str::uuid()]);
    DB::table('semesters')->where('id', $this->semesterId)->increment('timetable_revision');
    $this->postJson($this->root.'/bulk', ['constraints' => [$this->draft]])->assertStatus(412);
    DB::table('semesters')->where('id', $this->semesterId)->update(['status' => 'closed']);
    $this->postJson($this->root.'/preview', ['constraints' => [$this->draft]])->assertStatus(409);
    $this->assertDatabaseCount('scheduling_constraints', 0);
});

it('does not let viewers preview or commit rule drafts', function (): void {
    $viewer = User::factory()->create(['role' => Role::Viewer, 'must_change_password' => false]);
    $this->actingAs($viewer)->withSession(['auth_version' => $viewer->auth_version]);
    $this->postJson($this->root.'/preview', ['constraints' => [$this->draft]])->assertForbidden();
    $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson($this->root.'/bulk', ['constraints' => [$this->draft]])->assertForbidden();
});

it('checks the existing authenticated session and rejects revoked sessions', function (): void {
    $this->postJson('/api/v1/auth/session-check')->assertOk()->assertJsonPath('data.id', $this->scheduler->id);
    $this->withSession(['auth_version' => $this->scheduler->auth_version - 1]);
    $this->postJson('/api/v1/auth/session-check')->assertUnauthorized();
});
