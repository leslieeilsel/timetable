<?php

use App\Enums\Role;
use App\Models\User;
use App\Modules\Scheduling\Jobs\GenerateScheduleCandidates;
use App\Modules\Scheduling\Models\ScheduleRun;
use App\Modules\Scheduling\Services\AutoScheduler;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->scheduler = User::factory()->create([
        'email' => 'reliable-scheduler@example.test',
        'role' => Role::Scheduler,
        'must_change_password' => false,
    ]);
    $this->actingAs($this->scheduler)->withSession(['auth_version' => $this->scheduler->auth_version]);
});

it('persists the complete scheduling input baseline and dispatches a recoverable job after commit', function (): void {
    config(['queue.default' => 'sync']);
    $fixture = scheduleRunReliabilityFixture();
    $baseVersionId = addScheduleRunBaseVersion($fixture, $this->scheduler->id, true);
    DB::table('app_settings')->where('id', 1)->update(['catalog_revision' => 7]);
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->assertOk()->headers->get('ETag');

    $response = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs", scheduleRunPayload([
            'base_version_id' => $baseVersionId,
        ]))
        ->assertStatus(202)
        ->assertJsonPath('data.catalog_revision', 7)
        ->assertJsonPath('data.input_revision', 3)
        ->assertJsonPath('data.assignment_revision', 2)
        ->assertJsonPath('data.constraint_revision', 1)
        ->assertJsonPath('data.timetable_revision', 4)
        ->assertJsonPath('data.base_version_id', $baseVersionId)
        ->assertJsonPath('data.preservation.base_version_id', $baseVersionId);

    $run = ScheduleRun::query()->findOrFail($response->json('data.id'));
    expect($run->base_version_fingerprint)->toMatch('/^[a-f0-9]{64}$/')
        ->and($run->constraint_snapshot['constraints'])->toHaveCount(1)
        ->and($run->constraint_snapshot['constraints'][0])->toHaveKeys([
            'id', 'semester_id', 'name', 'kind', 'category', 'target_type', 'target_id',
            'scope', 'condition', 'requirement', 'weight', 'source', 'status', 'explanation',
            'created_at', 'updated_at',
        ]);
    $job = new GenerateScheduleCandidates($run->id);
    $overlapGuard = $job->middleware()[0];
    $queuedRow = DB::table('jobs')->sole();
    $queuedPayload = json_decode($queuedRow->payload, true, 512, JSON_THROW_ON_ERROR);
    $workspacePackage = json_decode(
        (string) file_get_contents(base_path('../../package.json')),
        true,
        512,
        JSON_THROW_ON_ERROR,
    );

    expect(Schema::hasTable('jobs'))->toBeTrue()
        ->and(Schema::hasTable('failed_jobs'))->toBeTrue()
        ->and(config('queue.default'))->toBe('sync')
        ->and($job->connection)->toBe('database')
        ->and($queuedRow->queue)->toBe('default')
        ->and($queuedRow->attempts)->toBe(0)
        ->and($queuedRow->reserved_at)->toBeNull()
        ->and($queuedPayload['displayName'])->toBe(GenerateScheduleCandidates::class)
        ->and(config('queue.connections.database.after_commit'))->toBeTrue()
        ->and(config('queue.connections.database.retry_after'))->toBeGreaterThan($job->timeout)
        ->and($job->tries)->toBe(3)
        ->and($job->backoff)->toBe([10, 30, 60])
        ->and($overlapGuard)->toBeInstanceOf(WithoutOverlapping::class)
        ->and($overlapGuard->expiresAfter)->toBe(330)
        ->and($overlapGuard->releaseAfter)->toBeNull()
        ->and($workspacePackage['scripts']['dev:queue'])->toContain('queue:work database')
        ->and($workspacePackage['scripts']['dev'])->toContain('dev:queue');
});

it('rethrows retryable infrastructure failures and becomes terminal only after queue exhaustion', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    $intercepted = false;

    DB::listen(function (QueryExecuted $query) use (&$intercepted): void {
        if ($intercepted || ! str_starts_with(strtolower($query->sql), 'select')
            || ! str_contains(strtolower($query->sql), 'schedule_templates')) {
            return;
        }
        $intercepted = true;
        throw new RuntimeException('temporary database read failure');
    });

    $caught = null;
    try {
        app(AutoScheduler::class)->generate($run);
    } catch (RuntimeException $exception) {
        $caught = $exception;
    }

    $retryable = $run->fresh();
    expect($intercepted)->toBeTrue()
        ->and($caught)->toBeInstanceOf(RuntimeException::class)
        ->and($retryable->status->value)->toBe('checking')
        ->and($retryable->error_code)->toBeNull()
        ->and($retryable->completed_at)->toBeNull()
        ->and($retryable->candidates()->count())->toBe(0);

    (new GenerateScheduleCandidates($run->id))->failed($caught);

    $exhausted = $run->fresh();
    expect($exhausted->status->value)->toBe('failed')
        ->and($exhausted->error_code)->toBe('SCHEDULER_RETRIES_EXHAUSTED')
        ->and($exhausted->completed_at)->not->toBeNull()
        ->and($exhausted->candidates()->count())->toBe(0);
});

it('fails a legacy non-terminal run whose input snapshot is incomplete', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    makeScheduleRunSnapshotIncomplete($run);

    app(AutoScheduler::class)->generate($run->fresh());

    $reloaded = $run->fresh();
    expect($reloaded->status->value)->toBe('failed')
        ->and($reloaded->error_code)->toBe('RUN_SNAPSHOT_INCOMPLETE')
        ->and($reloaded->candidates()->count())->toBe(0);
});

it('keeps a completed run idempotent when the same job is delivered again', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $run = createScheduleRunForReliabilityTest($this, $fixture);

    app(AutoScheduler::class)->generate($run);
    $firstCandidateIds = $run->fresh()->candidates()->orderBy('rank')->pluck('id')->all();
    app(AutoScheduler::class)->generate($run->fresh());

    $reloaded = $run->fresh();
    expect($reloaded->status->value)->toBe('completed')
        ->and($reloaded->candidates()->orderBy('rank')->pluck('id')->all())->toBe($firstCandidateIds)
        ->and($reloaded->candidates()->count())->toBe(1);
});

it('does not let a stale worker overwrite cancellation at the final checkpoint', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    $statusReads = 0;
    $cancelled = false;

    DB::listen(function (QueryExecuted $query) use (&$statusReads, &$cancelled, $run): void {
        $sql = strtolower($query->sql);
        if ($cancelled || ! str_starts_with($sql, 'select') || ! str_contains($sql, 'schedule_runs')
            || ! str_contains($sql, 'status')) {
            return;
        }
        $statusReads++;
        if ($statusReads !== 3) {
            return;
        }
        $cancelled = true;
        DB::table('schedule_runs')->where('id', $run->id)->update([
            'status' => 'cancelled',
            'progress_stage' => 'cancelled',
            'completed_at' => now(),
            'updated_at' => now(),
        ]);
    });

    app(AutoScheduler::class)->generate($run);

    $reloaded = $run->fresh();
    expect($cancelled)->toBeTrue()
        ->and($reloaded->status->value)->toBe('cancelled')
        ->and($reloaded->progress_stage)->toBe('cancelled')
        ->and($reloaded->candidates()->count())->toBe(0);
});

it('rechecks every revision in the locked completion transaction', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    $statusReads = 0;
    $changed = false;

    DB::listen(function (QueryExecuted $query) use (&$statusReads, &$changed): void {
        $sql = strtolower($query->sql);
        if ($changed || ! str_starts_with($sql, 'select') || ! str_contains($sql, 'schedule_runs')
            || ! str_contains($sql, 'status')) {
            return;
        }
        $statusReads++;
        if ($statusReads !== 3) {
            return;
        }
        $changed = true;
        DB::table('app_settings')->where('id', 1)->increment('catalog_revision');
    });

    app(AutoScheduler::class)->generate($run);

    $reloaded = $run->fresh();
    expect($changed)->toBeTrue()
        ->and($reloaded->status->value)->toBe('failed')
        ->and($reloaded->error_code)->toBe('RUN_INPUT_STALE')
        ->and($reloaded->candidates()->count())->toBe(0);
});

it('solves against the immutable constraint snapshot instead of changed live rows', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    DB::table('scheduling_constraints')->where('id', $fixture['constraint_id'])->update([
        'kind' => 'hard',
        'category' => 'forbidden_slot',
        'target_type' => 'teacher',
        'target_id' => $fixture['teacher_id'],
        'scope' => json_encode(['weekdays' => [1, 2, 3, 4, 5]], JSON_THROW_ON_ERROR),
        'requirement' => json_encode(['available' => false], JSON_THROW_ON_ERROR),
        'weight' => null,
        'updated_at' => now(),
    ]);
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    DB::table('scheduling_constraints')->where('id', $fixture['constraint_id'])->update([
        'status' => 'inactive',
        'updated_at' => now(),
    ]);

    app(AutoScheduler::class)->generate($run);

    $reloaded = $run->fresh();
    expect($reloaded->status->value)->toBe('failed')
        ->and($reloaded->error_code)->toBe('CONSECUTIVE_CAPACITY_INSUFFICIENT')
        ->and($reloaded->candidates()->count())->toBe(0);
});

it('rejects adopting a candidate after catalog resources or qualifications change', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    app(AutoScheduler::class)->generate($run);
    $candidate = $run->fresh()->candidates()->firstOrFail();

    DB::table('teachers')->where('id', $fixture['teacher_id'])->update(['is_active' => false]);
    DB::table('teacher_course')
        ->where('teacher_id', $fixture['teacher_id'])
        ->where('course_id', $fixture['course_id'])
        ->delete();
    DB::table('app_settings')->where('id', 1)->increment('catalog_revision');
    $detail = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}/candidates/{$candidate->id}")
        ->assertOk()
        ->assertJsonPath('data.is_stale', true);
    $etag = $detail->headers->get('ETag');

    $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}/candidates/{$candidate->id}/adopt", [
            'activate' => false,
        ])->assertStatus(409)
        ->assertJsonPath('code', 'CANDIDATE_INPUT_STALE')
        ->assertJsonPath('run_catalog_revision', 0)
        ->assertJsonPath('current_catalog_revision', 1);

    expect(DB::table('timetable_versions')->where('source_candidate_id', $candidate->id)->exists())->toBeFalse();
});

it('treats a completed legacy candidate with an incomplete run snapshot as stale', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    app(AutoScheduler::class)->generate($run);
    $candidate = $run->fresh()->candidates()->firstOrFail();
    makeScheduleRunSnapshotIncomplete($run);

    $detail = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}/candidates/{$candidate->id}")
        ->assertOk()
        ->assertJsonPath('data.is_stale', true);

    $this->withHeader('If-Match', $detail->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}/candidates/{$candidate->id}/adopt", [
            'activate' => false,
        ])->assertStatus(409)
        ->assertJsonPath('code', 'RUN_SNAPSHOT_INCOMPLETE');

    expect(DB::table('timetable_versions')->where('source_candidate_id', $candidate->id)->exists())->toBeFalse();
});

it('rejects adoption when the selected base version lock baseline changes', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $baseVersionId = addScheduleRunBaseVersion($fixture, $this->scheduler->id, true);
    $run = createScheduleRunForReliabilityTest($this, $fixture, [
        'base_version_id' => $baseVersionId,
        'keep_current' => true,
    ]);
    app(AutoScheduler::class)->generate($run);
    $candidate = $run->fresh()->candidates()->firstOrFail();

    DB::table('timetable_entries')->where('timetable_version_id', $baseVersionId)->update([
        'is_locked' => false,
        'updated_at' => now(),
    ]);
    DB::table('semesters')->where('id', $fixture['semester_id'])->increment('timetable_revision');
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');

    $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}/candidates/{$candidate->id}/adopt", [
            'activate' => false,
        ])->assertStatus(409)
        ->assertJsonPath('code', 'CANDIDATE_BASELINE_STALE');
});

it('carries candidate revision snapshots into drafts and rechecks them on activation', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    app(AutoScheduler::class)->generate($run);
    $candidate = $run->fresh()->candidates()->firstOrFail();
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $adopted = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}/candidates/{$candidate->id}/adopt", [
            'activate' => false,
        ])->assertCreated();
    $versionId = $adopted->json('data.id');

    DB::table('rooms')->where('id', $fixture['room_id'])->update(['is_active' => false]);
    DB::table('app_settings')->where('id', 1)->increment('catalog_revision');
    $freshEtag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');

    $this->withHeader('If-Match', $freshEtag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable-versions/{$versionId}/activate", [
            'reason' => '尝试启用旧资源版本',
        ])->assertStatus(409)
        ->assertJsonPath('code', 'VERSION_INPUT_STALE')
        ->assertJsonPath('version_catalog_revision', 0)
        ->assertJsonPath('current_catalog_revision', 1);
});

it('rejects activating a legacy draft without a catalog revision snapshot', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $versionId = addScheduleRunBaseVersion($fixture, $this->scheduler->id, false);
    expect(DB::table('timetable_versions')->where('id', $versionId)->value('catalog_revision'))->toBeNull();
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->assertOk()->headers->get('ETag');

    $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable-versions/{$versionId}/activate", [
            'reason' => '旧草稿不得绕过资料快照校验',
        ])->assertStatus(409)
        ->assertJsonPath('code', 'VERSION_INPUT_STALE')
        ->assertJsonPath('version_catalog_revision', null)
        ->assertJsonPath('current_catalog_revision', 0);

    expect(DB::table('timetable_versions')->where('id', $versionId)->value('status'))->toBe('draft');
});

/** @param array<string, mixed> $preservation */
function scheduleRunPayload(array $preservation = []): array
{
    return [
        'scope' => ['type' => 'all', 'ids' => []],
        'preservation' => array_merge(['keep_locked' => true, 'keep_current' => false], $preservation),
        'strategy' => ['profile' => 'balanced'],
        'candidate_count' => 1,
    ];
}

/**
 * @param  array<string, int>  $fixture
 * @param  array<string, mixed>  $preservation
 */
function createScheduleRunForReliabilityTest(object $test, array $fixture, array $preservation = []): ScheduleRun
{
    $etag = $test->getJson("/api/v1/semesters/{$fixture['semester_id']}")->assertOk()->headers->get('ETag');
    $response = $test->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs", scheduleRunPayload($preservation))
        ->assertStatus(202);

    return ScheduleRun::query()->findOrFail($response->json('data.id'));
}

function makeScheduleRunSnapshotIncomplete(ScheduleRun $run): void
{
    $snapshot = $run->constraint_snapshot;
    unset(
        $snapshot['catalog_revision'],
        $snapshot['timetable_revision'],
        $snapshot['base_version_id'],
        $snapshot['base_version_fingerprint'],
    );
    DB::table('schedule_runs')->where('id', $run->id)->update([
        'catalog_revision' => null,
        'timetable_revision' => null,
        'assignment_revision' => null,
        'constraint_revision' => null,
        'constraint_snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR),
        'updated_at' => now(),
    ]);
}

/**
 * @return array{
 *   semester_id: int, academic_year_id: int, class_id: int, teacher_id: int,
 *   course_id: int, room_id: int, assignment_id: int, constraint_id: int, item_ids: list<int>
 * }
 */
function scheduleRunReliabilityFixture(): array
{
    $now = now();
    $yearId = DB::table('academic_years')->insertGetId([
        'name' => '2027-2028 学年', 'start_date' => '2027-09-01', 'end_date' => '2028-07-15',
        'status' => 'open', 'created_at' => $now, 'updated_at' => $now,
    ]);
    $semesterId = DB::table('semesters')->insertGetId([
        'academic_year_id' => $yearId, 'name' => '上学期', 'sequence' => 1,
        'start_date' => '2027-09-01', 'end_date' => '2028-01-20', 'status' => 'open',
        'timetable_revision' => 4, 'input_revision' => 3, 'assignment_revision' => 2,
        'constraint_revision' => 1, 'created_at' => $now, 'updated_at' => $now,
    ]);
    $gradeId = DB::table('grades')->insertGetId([
        'name' => '八年级', 'sort_order' => 8, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
    ]);
    $teacherId = DB::table('teachers')->insertGetId([
        'employee_no' => 'T-RELIABLE-001', 'name' => '可靠性教师', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $courseId = DB::table('courses')->insertGetId([
        'name' => '可靠性数学', 'short_name' => '数', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    DB::table('teacher_course')->insert(['teacher_id' => $teacherId, 'course_id' => $courseId]);
    $roomId = DB::table('rooms')->insertGetId([
        'name' => '八年级 1 班教室', 'type' => 'classroom', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $classId = DB::table('school_classes')->insertGetId([
        'academic_year_id' => $yearId, 'grade_id' => $gradeId, 'name' => '八年级 1 班', 'code' => 'G8C1',
        'status' => 'active', 'created_at' => $now, 'updated_at' => $now,
    ]);
    DB::table('semester_class_settings')->insert([
        'semester_id' => $semesterId, 'academic_year_id' => $yearId, 'school_class_id' => $classId,
        'fixed_room_id' => $roomId, 'status' => 'active', 'created_at' => $now, 'updated_at' => $now,
    ]);
    $templateId = DB::table('schedule_templates')->insertGetId([
        'semester_id' => $semesterId, 'name' => '可靠性作息', 'created_at' => $now, 'updated_at' => $now,
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
        'items_per_session' => 1, 'room_mode' => 'class_default', 'status' => 'confirmed',
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $constraintId = DB::table('scheduling_constraints')->insertGetId([
        'semester_id' => $semesterId, 'name' => '优先周一排课', 'kind' => 'soft',
        'category' => 'preferred_slot', 'target_type' => 'teacher', 'target_id' => $teacherId,
        'scope' => json_encode(['weekdays' => [1]], JSON_THROW_ON_ERROR),
        'condition' => json_encode([], JSON_THROW_ON_ERROR),
        'requirement' => json_encode(['preference' => 'prefer'], JSON_THROW_ON_ERROR), 'weight' => 70,
        'source' => 'user', 'status' => 'active', 'explanation' => '尽量安排在周一',
        'created_at' => $now, 'updated_at' => $now,
    ]);

    return [
        'semester_id' => $semesterId,
        'academic_year_id' => $yearId,
        'class_id' => $classId,
        'teacher_id' => $teacherId,
        'course_id' => $courseId,
        'room_id' => $roomId,
        'assignment_id' => $assignmentId,
        'constraint_id' => $constraintId,
        'item_ids' => $itemIds,
    ];
}

/** @param array<string, int|array<int, int>> $fixture */
function addScheduleRunBaseVersion(array $fixture, int $userId, bool $locked): int
{
    $now = now();
    $versionId = DB::table('timetable_versions')->insertGetId([
        'semester_id' => $fixture['semester_id'], 'version_no' => 1, 'name' => '明确基线',
        'status' => 'draft', 'source' => 'manual', 'created_by' => $userId, 'input_revision' => 3,
        'hard_conflict_count' => 0, 'soft_warning_count' => 0, 'created_at' => $now, 'updated_at' => $now,
    ]);
    $entryId = DB::table('timetable_entries')->insertGetId([
        'semester_id' => $fixture['semester_id'], 'timetable_version_id' => $versionId,
        'teaching_assignment_id' => $fixture['assignment_id'], 'school_class_id' => $fixture['class_id'],
        'teacher_id' => $fixture['teacher_id'], 'course_id' => $fixture['course_id'],
        'actual_room_id' => $fixture['room_id'], 'week_pattern' => 'all', 'weekday' => 1,
        'item_id' => $fixture['item_ids'][0], 'source' => 'manual', 'is_locked' => $locked,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    DB::table('timetable_entry_classes')->insert([
        'timetable_entry_id' => $entryId, 'timetable_version_id' => $versionId,
        'school_class_id' => $fixture['class_id'], 'week_pattern' => 'all', 'weekday' => 1,
        'item_id' => $fixture['item_ids'][0],
    ]);
    DB::table('timetable_entry_teachers')->insert([
        'timetable_entry_id' => $entryId, 'timetable_version_id' => $versionId,
        'teacher_id' => $fixture['teacher_id'], 'week_pattern' => 'all', 'weekday' => 1,
        'item_id' => $fixture['item_ids'][0],
    ]);

    return (int) $versionId;
}
