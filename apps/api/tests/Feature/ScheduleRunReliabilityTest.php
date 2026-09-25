<?php

use App\Enums\Role;
use App\Models\User;
use App\Modules\Scheduling\Jobs\GenerateScheduleCandidates;
use App\Modules\Scheduling\Models\ScheduleRun;
use App\Modules\Scheduling\Services\AutoScheduler;
use App\Modules\Scheduling\Services\PreparationCheckService;
use App\Modules\Scheduling\Services\WeekPatternService;
use App\Modules\Timetable\Services\RoomResolver;
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

it('keeps temporary preservation separate from persistent locks after candidate adoption', function (string $mode, bool $locked, bool $fixed): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $baseId = addScheduleRunBaseVersion($fixture, $this->scheduler->id, $locked);
    $courseId = DB::table('courses')->insertGetId(['name' => '待补课程', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
    DB::table('teacher_course')->insert(['teacher_id' => $fixture['teacher_id'], 'course_id' => $courseId]);
    $assignment = (array) DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->sole();
    unset($assignment['id']);
    $missingId = DB::table('teaching_assignments')->insertGetId([...$assignment, 'course_id' => $courseId]);
    if ($fixed) {
        DB::table('fixed_placements')->insert([
            'semester_id' => $fixture['semester_id'], 'teaching_assignment_id' => $fixture['assignment_id'],
            'week_pattern' => 'all', 'weekday' => 1, 'item_id' => $fixture['item_ids'][0],
            'room_id' => $fixture['room_id'], 'is_locked' => true, 'status' => 'active',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }
    $base = "/api/v1/semesters/{$fixture['semester_id']}";
    $payload = scheduleRunPayload(['keep_current' => $mode === 'fill', 'base_version_id' => $baseId]);
    if ($mode === 'local') {
        $payload['scope'] = ['type' => 'assignment', 'ids' => [$missingId]];
    }
    $etag = $this->getJson($base)->headers->get('ETag');
    $created = $this->withHeader('If-Match', $etag)->postJson($base.'/schedule-runs', $payload)->assertStatus(202);
    $run = ScheduleRun::query()->findOrFail($created->json('data.id'));
    app(AutoScheduler::class)->generate($run);
    $candidate = $run->fresh()->candidates()->sole();
    $kept = $candidate->entries()->where('teaching_assignment_id', $fixture['assignment_id'])->sole();
    expect($kept->weekday)->toBe(1)->and($kept->item_id)->toBe($fixture['item_ids'][0])
        ->and($kept->is_locked)->toBe($locked || $fixed)
        ->and($candidate->score_breakdown['change_counts']['added'])->toBe(1)
        ->and($candidate->score_breakdown['change_counts']['moved'])->toBe(0);
    $path = $base.'/schedule-runs/'.$run->id.'/candidates/'.$candidate->id;
    $detail = $this->getJson($path)->assertOk();
    $adopted = $this->withHeader('If-Match', $detail->headers->get('ETag'))->postJson($path.'/adopt', ['activate' => false])->assertCreated();
    expect((bool) DB::table('timetable_entries')->where('timetable_version_id', $adopted->json('data.id'))
        ->where('teaching_assignment_id', $fixture['assignment_id'])->value('is_locked'))->toBe($locked || $fixed);
})->with([['fill', false, false], ['local', false, false], ['fill', true, false], ['fill', false, true]]);

it('scores teaching gaps and morning preferences using actual teaching periods and clock times', function (bool $teachingGap, string $lastStart, float $expectedCore): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    DB::table('courses')->where('id', $fixture['course_id'])->update(['name' => '数学']);
    DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->update(['weekly_items' => 2]);
    DB::table('items')->where('id', $fixture['item_ids'][1])->update(['sort_order' => 9, 'start_time' => $lastStart, 'end_time' => substr($lastStart, 0, 2).':45']);
    $item = (array) DB::table('items')->where('id', $fixture['item_ids'][0])->first();
    unset($item['id']);
    $middleId = DB::table('items')->insertGetId([...$item, 'name' => $teachingGap ? '中间正式课节' : '课间操',
        'sort_order' => 5, 'start_time' => '09:30', 'end_time' => '10:15',
        'type' => $teachingGap ? 'course' : 'fixed_non_course',
        'allows_course' => $teachingGap, 'counts_as_course' => $teachingGap]);
    foreach ($fixture['item_ids'] as $itemId) {
        DB::table('fixed_placements')->insert([
            'semester_id' => $fixture['semester_id'], 'teaching_assignment_id' => $fixture['assignment_id'],
            'week_pattern' => 'all', 'weekday' => 1, 'item_id' => $itemId, 'room_id' => $fixture['room_id'],
            'is_locked' => false, 'status' => 'active', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }
    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/fixed-placements")
        ->assertOk()->assertJsonPath('data.0.is_locked', true);
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    app(AutoScheduler::class)->generate($run);
    $candidate = $run->fresh()->candidates()->sole();
    $score = $candidate->score_breakdown;
    expect($score['methodology_version'])->toBe(2)
        ->and((float) $score['teacher_gaps'])->toBe($teachingGap ? 1.0 : 0.0)
        ->and((float) $score['core_course_priority'])->toBe($expectedCore)
        ->and($candidate->entries()->where('is_locked', true)->count())->toBe(2);
    if ($teachingGap) {
        expect($score['teacher_gap_details'][0]['teacher_id'])->toBe($fixture['teacher_id'])
            ->and($score['teacher_gap_details'][0]['item_ids'])->toBe([$middleId]);
    } else {
        expect($score['teacher_gap_details'])->toBe([]);
    }
})->with([[false, '11:00', 100.0], [true, '11:00', 100.0], [false, '12:00', 50.0]]);

it('protects active fixed placements after an entry is unlocked and exposes both conflicting requirements', function (): void {
    $fixture = scheduleRunReliabilityFixture();
    $versionId = addScheduleRunBaseVersion($fixture, $this->scheduler->id, false);
    $entryId = DB::table('timetable_entries')->where('timetable_version_id', $versionId)->value('id');
    $fixedId = DB::table('fixed_placements')->insertGetId([
        'semester_id' => $fixture['semester_id'], 'teaching_assignment_id' => $fixture['assignment_id'],
        'week_pattern' => 'all', 'weekday' => 1, 'item_id' => $fixture['item_ids'][0],
        'room_id' => $fixture['room_id'], 'is_locked' => false, 'status' => 'active',
        'created_at' => now(), 'updated_at' => now(),
    ]);
    $base = "/api/v1/semesters/{$fixture['semester_id']}";
    $this->postJson($base.'/timetable/diagnose', ['version_id' => $versionId, 'entry_id' => $entryId,
        'weekday' => 2, 'item_id' => $fixture['item_ids'][0]])
        ->assertOk()->assertJsonPath('data.allowed', false)->assertJsonPath('data.hard_conflicts.0.fixed_placement_id', $fixedId);
    $etag = $this->getJson($base)->headers->get('ETag');
    $this->withHeader('If-Match', $etag)->deleteJson($base.'/timetable/entries/'.$entryId)
        ->assertConflict()->assertJsonPath('code', 'FIXED_PLACEMENT_REQUIRED');
    $this->withHeader('If-Match', $etag)->patchJson($base.'/timetable/entries/'.$entryId, [
        'weekday' => 2, 'item_id' => $fixture['item_ids'][0],
    ])->assertConflict();
    DB::table('scheduling_constraints')->where('id', $fixture['constraint_id'])->update([
        'name' => '周一不可排课', 'kind' => 'hard', 'category' => 'availability',
        'requirement' => json_encode(['available' => false], JSON_THROW_ON_ERROR),
    ]);
    $conflicts = $this->getJson($base.'/timetable/validation?version_id='.$versionId)
        ->assertOk()->json('data.hard_conflicts');
    $conflict = collect($conflicts)->firstWhere('fixed_placement_id', $fixedId);
    expect($conflict['constraint_id'])->toBe($fixture['constraint_id'])
        ->and($conflict['weekday'])->toBe(1)
        ->and($conflict['item_id'])->toBe($fixture['item_ids'][0])
        ->and($conflict['message'])->toContain('固定安排要求', '周一不可排课');
    $this->postJson($base.'/timetable-versions/'.$versionId.'/publication-preview')->assertConflict();
    DB::table('fixed_placements')->where('id', $fixedId)->update(['status' => 'inactive']);
    $this->withHeader('If-Match', $etag)->patchJson($base.'/timetable/entries/'.$entryId, [
        'weekday' => 2, 'item_id' => $fixture['item_ids'][0],
    ])->assertOk();
});

it('rejects an unlocked fixed placement and creates a locked requirement when the flag is omitted', function (): void {
    $fixture = scheduleRunReliabilityFixture();
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $payload = ['teaching_assignment_id' => $fixture['assignment_id'], 'week_pattern' => 'all',
        'weekday' => 1, 'item_id' => $fixture['item_ids'][0]];
    $this->withHeader('If-Match', $etag)->postJson("/api/v1/semesters/{$fixture['semester_id']}/fixed-placements", [...$payload, 'is_locked' => false])
        ->assertUnprocessable()->assertJsonValidationErrors('is_locked');
    $this->withHeader('If-Match', $etag)->postJson("/api/v1/semesters/{$fixture['semester_id']}/fixed-placements", $payload)
        ->assertCreated()->assertJsonPath('data.is_locked', true);
});

it('does not combine alternating weeks into a fictitious teacher gap', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->update(['week_pattern' => 'a']);
    DB::table('items')->where('id', $fixture['item_ids'][1])->update(['sort_order' => 3, 'start_time' => '11:00', 'end_time' => '11:45']);
    $middle = (array) DB::table('items')->where('id', $fixture['item_ids'][0])->first();
    unset($middle['id']);
    DB::table('items')->insert([...$middle, 'name' => '中间正式课节', 'sort_order' => 2, 'start_time' => '10:00', 'end_time' => '10:45']);
    $course = DB::table('courses')->insertGetId(['name' => '科学', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
    DB::table('teacher_course')->insert(['teacher_id' => $fixture['teacher_id'], 'course_id' => $course]);
    $assignment = (array) DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->first();
    unset($assignment['id']);
    $secondAssignment = DB::table('teaching_assignments')->insertGetId([...$assignment, 'course_id' => $course, 'week_pattern' => 'b']);
    foreach ([[$fixture['assignment_id'], 'a', $fixture['item_ids'][0]], [$secondAssignment, 'b', $fixture['item_ids'][1]]] as [$assignmentId, $pattern, $itemId]) {
        DB::table('fixed_placements')->insert([
            'semester_id' => $fixture['semester_id'], 'teaching_assignment_id' => $assignmentId,
            'week_pattern' => $pattern, 'weekday' => 1, 'item_id' => $itemId,
            'room_id' => $fixture['room_id'], 'is_locked' => true, 'status' => 'active',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    app(AutoScheduler::class)->generate($run);
    $score = $run->fresh()->candidates()->sole()->score_breakdown;
    expect((float) $score['teacher_gaps'])->toBe(0.0)->and($score['teacher_gap_details'])->toBe([]);
});

it('persists the scheduling input snapshot and queues a recoverable database job', function (): void {
    config(['queue.default' => 'sync']);
    $fixture = scheduleRunReliabilityFixture();
    $baseVersionId = addScheduleRunBaseVersion($fixture, $this->scheduler->id, true);
    DB::table('app_settings')->where('id', 1)->update(['catalog_revision' => 7]);
    $semester = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")
        ->assertOk()
        ->assertJsonPath('data.input_revision', '3')
        ->assertJsonPath('data.assignment_revision', '2')
        ->assertJsonPath('data.constraint_revision', '1')
        ->assertJsonPath('data.timetable_revision', '4');
    $etag = $semester->headers->get('ETag');

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
        ->and($job->tries)->toBeGreaterThan(1)
        ->and($overlapGuard)->toBeInstanceOf(WithoutOverlapping::class)
        ->and($overlapGuard->expiresAfter)->toBeGreaterThan($job->timeout)
        ->and($overlapGuard->releaseAfter)->toBeNull();
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

it('does not score rebuild tasks against the previous timetable or unconfigured soft dimensions', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    DB::table('scheduling_constraints')->where('id', $fixture['constraint_id'])->delete();
    $run = createScheduleRunForReliabilityTest($this, $fixture);

    app(AutoScheduler::class)->generate($run);

    $breakdown = $run->fresh()->candidates()->sole()->score_breakdown;
    expect((float) $breakdown['weights']['stability'])->toBe(0.0)
        ->and((float) $breakdown['weights']['custom_rules'])->toBe(0.0)
        ->and((float) $breakdown['weights']['session_spacing'])->toBe(0.0)
        ->and(abs(array_sum($breakdown['weights']) - 1.0))->toBeLessThan(0.000001);
});

it('keeps searching later candidates when an earlier candidate exhausts its attempts', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    DB::table('schedule_runs')->where('id', $run->id)->update(['candidate_count' => 3]);
    $run = $run->fresh();

    $scheduler = new class(app(PreparationCheckService::class), app(RoomResolver::class), app(WeekPatternService::class)) extends AutoScheduler
    {
        public bool $firstCandidateFinished = false;

        protected function solveAttempt(array $problem, int $seed): array
        {
            if (! $this->firstCandidateFinished) {
                return [
                    'solution' => null,
                    'failure' => ['reason' => 'forced first candidate failure'],
                ];
            }

            return parent::solveAttempt($problem, $seed);
        }
    };

    ScheduleRun::updated(function (ScheduleRun $updated) use ($run, $scheduler): void {
        if ($updated->id === $run->id && $updated->progress_stage === 'optimizing_candidate_1') {
            $scheduler->firstCandidateFinished = true;
        }
    });

    $scheduler->generate($run);

    $reloaded = $run->fresh();
    expect($reloaded->status->value)->toBe('completed')
        ->and($reloaded->candidates()->count())->toBeGreaterThan(0)
        ->and($reloaded->diagnostics['requested_candidate_count'])->toBe(3)
        ->and($reloaded->diagnostics['failed_candidate_count'])->toBe(1)
        ->and($reloaded->diagnostics['failed_candidates'][0]['failed_candidate_rank'])->toBe(1);
});

it('fails only after every requested candidate exhausts its attempts without a solution', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    DB::table('schedule_runs')->where('id', $run->id)->update(['candidate_count' => 3]);
    $run = $run->fresh();

    $scheduler = new class(app(PreparationCheckService::class), app(RoomResolver::class), app(WeekPatternService::class)) extends AutoScheduler
    {
        protected function solveAttempt(array $problem, int $seed): array
        {
            return [
                'solution' => null,
                'failure' => ['reason' => 'forced candidate failure'],
            ];
        }
    };

    $scheduler->generate($run);

    $reloaded = $run->fresh();
    expect($reloaded->status->value)->toBe('failed')
        ->and($reloaded->error_code)->toBe('NO_FEASIBLE_SOLUTION')
        ->and($reloaded->candidates()->count())->toBe(0)
        ->and($reloaded->diagnostics['failed_candidate_rank'])->toBe(3)
        ->and(array_column($reloaded->diagnostics['failed_candidates'], 'failed_candidate_rank'))->toBe([1, 2, 3]);
});

it('solves saturated class schedules that must alternate shared teachers across every slot', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    DB::table('schedule_template_days')
        ->where('semester_id', $fixture['semester_id'])
        ->where('weekday', '!=', 1)
        ->update(['is_enabled' => false]);

    $clone = function (string $table, int $id, array $changes): int {
        $attributes = (array) DB::table($table)->where('id', $id)->sole();
        unset($attributes['id']);

        return DB::table($table)->insertGetId(array_replace($attributes, $changes));
    };
    $teacherId = $clone('teachers', $fixture['teacher_id'], [
        'employee_no' => 'T-DENSE-002',
        'name' => '满负载教师 2',
    ]);
    $courseId = $clone('courses', $fixture['course_id'], [
        'name' => '满负载课程 2',
        'short_name' => '满2',
    ]);
    $roomId = $clone('rooms', $fixture['room_id'], ['name' => '满负载 2 班教室']);
    $classId = $clone('school_classes', $fixture['class_id'], [
        'code' => 'DENSE-002',
        'name' => '满负载 2 班',
    ]);
    DB::table('teacher_course')->insert(['teacher_id' => $teacherId, 'course_id' => $courseId]);
    $setting = (array) DB::table('semester_class_settings')
        ->where('school_class_id', $fixture['class_id'])->sole();
    unset($setting['id']);
    DB::table('semester_class_settings')->insert(array_replace($setting, [
        'school_class_id' => $classId,
        'fixed_room_id' => $roomId,
    ]));
    $clone('teaching_assignments', $fixture['assignment_id'], [
        'course_id' => $courseId,
        'teacher_id' => $teacherId,
    ]);
    $clone('teaching_assignments', $fixture['assignment_id'], ['school_class_id' => $classId]);
    $clone('teaching_assignments', $fixture['assignment_id'], [
        'school_class_id' => $classId,
        'course_id' => $courseId,
        'teacher_id' => $teacherId,
    ]);

    $run = createScheduleRunForReliabilityTest($this, $fixture);
    app(AutoScheduler::class)->generate($run);

    $reloaded = $run->fresh();
    expect($reloaded->status->value)->toBe('completed')
        ->and($reloaded->candidates()->count())->toBe(1);
    $candidate = $reloaded->candidates()->sole();
    expect((float) $candidate->score_breakdown['teacher_experience'])->toBe(100.0);
    $entries = $candidate->entries()->with('teachingAssignment:id,teacher_id')->get();
    expect($entries)->toHaveCount(4);
    foreach ($entries->groupBy(fn ($entry): string => $entry->weekday.':'.$entry->item_id) as $slotEntries) {
        expect($slotEntries)->toHaveCount(2)
            ->and($slotEntries->pluck('teachingAssignment.teacher_id')->unique())->toHaveCount(2);
    }
});

it('preserves cancellation before a stage update or candidate persistence', function (string $checkpoint): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    $cancelled = false;
    $awaitingStatusRead = false;

    $cancel = function () use (&$cancelled, $run): void {
        $cancelled = true;
        DB::table('schedule_runs')->where('id', $run->id)->update([
            'status' => 'cancelled',
            'progress_stage' => 'cancelled',
            'completed_at' => now(),
            'updated_at' => now(),
        ]);
    };
    ScheduleRun::updated(function (ScheduleRun $updated) use ($run, $checkpoint, $cancel, &$awaitingStatusRead): void {
        if ($updated->id !== $run->id) {
            return;
        }
        if ($checkpoint === 'stage' && $updated->progress_stage === 'optimizing_candidate_1') {
            $awaitingStatusRead = true;
        }
        if ($checkpoint === 'persistence' && $updated->progress_stage === 'building_candidates') {
            $cancel();
        }
    });
    // Cancel after the final status read returns, before the next locked stage update.
    DB::listen(function (QueryExecuted $query) use (&$awaitingStatusRead, $cancel): void {
        $sql = strtolower($query->sql);
        if ($awaitingStatusRead && str_starts_with($sql, 'select')
            && str_contains($sql, 'schedule_runs') && str_contains($sql, 'status')) {
            $awaitingStatusRead = false;
            $cancel();
        }
    });

    app(AutoScheduler::class)->generate($run);

    $reloaded = $run->fresh();
    expect($cancelled)->toBeTrue()
        ->and($reloaded->status->value)->toBe('cancelled')
        ->and($reloaded->progress_stage)->toBe('cancelled')
        ->and($reloaded->candidates()->count())->toBe(0);
})->with(['stage', 'persistence']);

it('rechecks the catalog revision before persisting completed candidates', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    $changed = false;

    ScheduleRun::updated(function (ScheduleRun $updated) use (&$changed, $run): void {
        if ($changed || $updated->id !== $run->id || $updated->progress_stage !== 'building_candidates') {
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

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}")
        ->assertOk()->assertJsonPath('meta.is_stale', false);

    DB::table('teachers')->where('id', $fixture['teacher_id'])->update(['is_active' => false]);
    DB::table('teacher_course')
        ->where('teacher_id', $fixture['teacher_id'])
        ->where('course_id', $fixture['course_id'])
        ->delete();
    DB::table('app_settings')->where('id', 1)->increment('catalog_revision');
    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}")
        ->assertOk()->assertJsonPath('meta.is_stale', true);
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

it('keeps completed candidates usable when only operational timetable revision changes', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $baseVersionId = addScheduleRunBaseVersion($fixture, $this->scheduler->id, false);
    DB::table('timetable_versions')->where('id', $baseVersionId)->update([
        'status' => 'active',
        'activated_at' => now(),
    ]);
    DB::table('semesters')->where('id', $fixture['semester_id'])->update([
        'current_timetable_version_id' => $baseVersionId,
    ]);
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    app(AutoScheduler::class)->generate($run);
    $candidate = $run->fresh()->candidates()->firstOrFail();

    DB::table('semesters')->where('id', $fixture['semester_id'])->increment('timetable_revision');

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}")
        ->assertOk()
        ->assertJsonPath('meta.is_stale', false);
    $detail = $this->getJson(
        "/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}/candidates/{$candidate->id}",
    )->assertOk()
        ->assertJsonPath('data.is_stale', false);

    $this->withHeader('If-Match', $detail->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}/candidates/{$candidate->id}/adopt", [
            'activate' => false,
        ])->assertCreated();
});

it('marks completed candidates stale when their current baseline version is replaced', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $baseVersionId = addScheduleRunBaseVersion($fixture, $this->scheduler->id, false);
    DB::table('timetable_versions')->where('id', $baseVersionId)->update([
        'status' => 'active',
        'activated_at' => now(),
    ]);
    DB::table('semesters')->where('id', $fixture['semester_id'])->update([
        'current_timetable_version_id' => $baseVersionId,
    ]);
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    app(AutoScheduler::class)->generate($run);
    $candidate = $run->fresh()->candidates()->firstOrFail();
    $now = now();
    $replacementVersionId = DB::table('timetable_versions')->insertGetId([
        'semester_id' => $fixture['semester_id'],
        'version_no' => 2,
        'name' => '替代当前版本',
        'status' => 'active',
        'source' => 'manual',
        'created_by' => $this->scheduler->id,
        'input_revision' => 3,
        'hard_conflict_count' => 0,
        'soft_warning_count' => 0,
        'activated_at' => $now,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    DB::table('timetable_versions')->where('id', $baseVersionId)->update(['status' => 'historical']);
    DB::table('semesters')->where('id', $fixture['semester_id'])->update([
        'current_timetable_version_id' => $replacementVersionId,
    ]);

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}")
        ->assertOk()
        ->assertJsonPath('meta.is_stale', true);
    $detail = $this->getJson(
        "/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}/candidates/{$candidate->id}",
    )->assertOk()
        ->assertJsonPath('data.is_stale', true);

    $this->withHeader('If-Match', $detail->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}/candidates/{$candidate->id}/adopt", [
            'activate' => false,
        ])->assertStatus(409)
        ->assertJsonPath('code', 'CANDIDATE_BASELINE_STALE');
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
    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$run->id}")
        ->assertOk()->assertJsonPath('meta.is_stale', true);
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

it('generates synchronized lessons when the primary assignment is placed before its peer', function (): void {
    Queue::fake();
    $fixture = scheduleRunReliabilityFixture();
    $clone = function (string $table, int $id, array $changes): int {
        $attributes = (array) DB::table($table)->where('id', $id)->sole();
        unset($attributes['id']);

        return DB::table($table)->insertGetId(array_replace($attributes, $changes));
    };
    $teacherId = $clone('teachers', $fixture['teacher_id'], ['employee_no' => 'T-SYNC-002', 'name' => '同步教师']);
    $roomId = $clone('rooms', $fixture['room_id'], ['name' => '同步教室']);
    $classId = $clone('school_classes', $fixture['class_id'], ['code' => 'SYNC-002', 'name' => '同步班级']);
    DB::table('teacher_course')->insert(['teacher_id' => $teacherId, 'course_id' => $fixture['course_id']]);
    $setting = (array) DB::table('semester_class_settings')->where('school_class_id', $fixture['class_id'])->sole();
    unset($setting['id']);
    DB::table('semester_class_settings')->insert(array_replace($setting, ['school_class_id' => $classId, 'fixed_room_id' => $roomId]));
    $peerId = $clone('teaching_assignments', $fixture['assignment_id'], ['teacher_id' => $teacherId, 'school_class_id' => $classId]);
    $clone('scheduling_constraints', $fixture['constraint_id'], [
        'name' => '主关系只可周一首节', 'kind' => 'hard', 'category' => 'availability',
        'target_type' => 'teaching_assignment', 'target_id' => $fixture['assignment_id'],
        'scope' => json_encode(['weekdays' => [1], 'item_ids' => [$fixture['item_ids'][0]]], JSON_THROW_ON_ERROR),
        'requirement' => json_encode(['allowed_only' => true], JSON_THROW_ON_ERROR), 'weight' => null,
    ]);
    $clone('scheduling_constraints', $fixture['constraint_id'], [
        'name' => '关联教师偏好周二', 'target_id' => $teacherId,
        'scope' => json_encode(['weekdays' => [2]], JSON_THROW_ON_ERROR), 'weight' => 90,
    ]);
    $clone('scheduling_constraints', $fixture['constraint_id'], [
        'name' => '两个班级同步', 'kind' => 'hard', 'category' => 'synchronization',
        'target_type' => 'teaching_assignment', 'target_id' => $fixture['assignment_id'],
        'scope' => '[]', 'requirement' => json_encode(['with_assignment_ids' => [$peerId]], JSON_THROW_ON_ERROR), 'weight' => null,
    ]);
    $run = createScheduleRunForReliabilityTest($this, $fixture);
    app(AutoScheduler::class)->generate($run);

    expect($run->fresh()->status->value)->toBe('completed');
    $candidate = $run->candidates()->sole();
    $entries = $candidate->entries()->orderBy('teaching_assignment_id')->get();
    expect($candidate->hard_conflict_count)->toBe(0)
        ->and($entries)->toHaveCount(2)
        ->and($entries->pluck('weekday')->all())->toBe([1, 1])
        ->and($entries->pluck('item_id')->all())->toBe([$fixture['item_ids'][0], $fixture['item_ids'][0]]);
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
