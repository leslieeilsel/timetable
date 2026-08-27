<?php

use App\Enums\Role;
use App\Models\User;
use App\Modules\Scheduling\Jobs\GenerateScheduleCandidates;
use App\Modules\Scheduling\Models\ScheduleRun;
use App\Modules\Scheduling\Services\AutoScheduler;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->scheduler = User::factory()->create([
        'email' => 'scheduler@example.test',
        'role' => Role::Scheduler,
        'must_change_password' => false,
    ]);
    $this->actingAs($this->scheduler)->withSession(['auth_version' => $this->scheduler->auth_version]);
});

it('keeps active timetable versions immutable and promotes a complete draft without approval', function (): void {
    $fixture = timetableVersionFixture();
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->assertOk()->headers->get('ETag');
    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/preparation-check")
        ->assertOk()
        ->assertJsonPath('data.ready', true)
        ->assertJsonPath('data.status', 'warning')
        ->assertJsonPath('data.summary.confirmed_assignments', 1)
        ->assertJsonPath('data.summary.required_entries', 1);

    $placed = $this->withHeader('If-Match', $etag)->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
        'teaching_assignment_id' => $fixture['assignment_id'],
        'weekday' => 1,
        'item_id' => $fixture['item_ids'][0],
    ])->assertCreated()
        ->assertJsonPath('data.week_pattern', 'all')
        ->assertJsonPath('meta.version_status', 'draft');
    $draftId = $placed->json('meta.version_id');

    $activated = $this->withHeader('If-Match', $placed->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable-versions/{$draftId}/activate", [
            'reason' => '首次启用完整课表',
        ])->assertOk()
        ->assertJsonPath('data.status', 'active');

    $copy = $this->withHeader('If-Match', $activated->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable-versions", [
            'name' => '第二版调整草稿',
            'base_version_id' => $draftId,
        ])->assertCreated()
        ->assertJsonPath('data.entries_count', 1)
        ->assertJsonPath('data.status', 'draft');
    $secondDraftId = $copy->json('data.id');

    $draftTimetable = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/timetable?version_id={$secondDraftId}")
        ->assertOk();
    $draftEntryId = $draftTimetable->json('data.entries.0.id');
    $moved = $this->withHeader('If-Match', $copy->headers->get('ETag'))
        ->patchJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries/{$draftEntryId}", [
            'weekday' => 2,
            'item_id' => $fixture['item_ids'][1],
        ])->assertOk()
        ->assertJsonPath('data.weekday', 2);

    $this->getJson(
        "/api/v1/semesters/{$fixture['semester_id']}/timetable-versions/compare"
        ."?left_version_id={$draftId}&right_version_id={$secondDraftId}&per_page=20",
    )->assertOk()
        ->assertJsonPath('data.summary.total_changes', 1)
        ->assertJsonPath('data.summary.moved', 1)
        ->assertJsonPath('data.changes.0.change_types.0', 'moved')
        ->assertJsonPath('data.changes.0.before.weekday', 1)
        ->assertJsonPath('data.changes.0.after.weekday', 2)
        ->assertJsonPath('meta.pagination.total', 1);

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/timetable?version_id={$draftId}")
        ->assertOk()
        ->assertJsonPath('data.entries.0.weekday', 1);

    $this->withHeader('If-Match', $moved->headers->get('ETag'))
        ->patchJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries/{$placed->json('data.id')}", [
            'weekday' => 3,
            'item_id' => $fixture['item_ids'][0],
        ])->assertStatus(409)
        ->assertJsonPath('code', 'VERSION_READ_ONLY');

    $this->withHeader('If-Match', $moved->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable-versions/{$secondDraftId}/activate", [
            'reason' => '调整后切换当前版本',
        ])->assertOk()
        ->assertJsonPath('data.status', 'active');

    expect(DB::table('timetable_versions')->where('id', $draftId)->value('status'))->toBe('historical')
        ->and(DB::table('semesters')->where('id', $fixture['semester_id'])->value('current_timetable_version_id'))->toBe($secondDraftId);
});

it('generates comparable candidates and directly adopts one as the current timetable', function (): void {
    Queue::fake();
    $fixture = timetableVersionFixture();
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->assertOk()->headers->get('ETag');

    $created = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs", [
            'scope' => ['type' => 'all', 'ids' => []],
            'preservation' => ['keep_locked' => true, 'keep_current' => false],
            'strategy' => ['profile' => 'balanced'],
            'candidate_count' => 3,
        ])->assertStatus(202)
        ->assertJsonPath('data.status', 'queued')
        ->assertJsonPath('data.progress_stage', 'queued');
    $runId = $created->json('data.id');
    Queue::assertPushed(GenerateScheduleCandidates::class);

    $run = ScheduleRun::query()->findOrFail($runId);
    app(AutoScheduler::class)->generate($run);
    $run->refresh();
    expect($run->status->value)->toBe('completed')
        ->and($run->candidates()->count())->toBe(3)
        ->and($run->candidates()->withCount('entries')->get()->pluck('entries_count')->all())->toBe([1, 1, 1]);

    $candidate = $run->candidates()->orderBy('rank')->firstOrFail();
    expect($candidate->score_breakdown)->toHaveKeys([
        'course_distribution', 'teacher_experience', 'class_load', 'session_spacing',
        'room_stability', 'custom_rules', 'rule_results',
    ]);
    $detail = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$runId}/candidates/{$candidate->id}?per_page=20")
        ->assertOk()
        ->assertJsonPath('data.candidate.hard_conflict_count', 0)
        ->assertJsonPath('data.candidate.unscheduled_count', 0)
        ->assertJsonPath('data.is_stale', false)
        ->assertJsonPath('meta.pagination.total', 1)
        ->assertJsonCount(1, 'data.entries');

    $adopted = $this->withHeader('If-Match', $detail->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$runId}/candidates/{$candidate->id}/adopt", [
            'name' => '自动排课正式版本',
            'activate' => true,
            'reason' => '采用综合质量最优方案',
        ])->assertCreated()
        ->assertJsonPath('data.status', 'active')
        ->assertJsonPath('data.source', 'candidate')
        ->assertJsonPath('data.entries_count', 1);
    $versionId = $adopted->json('data.id');

    expect(DB::table('semesters')->where('id', $fixture['semester_id'])->value('current_timetable_version_id'))->toBe($versionId)
        ->and(DB::table('timetable_entries')->where('timetable_version_id', $versionId)->value('source'))->toBe('automatic')
        ->and(DB::table('timetable_entry_classes')->where('timetable_version_id', $versionId)->count())->toBe(1)
        ->and(DB::table('timetable_entry_teachers')->where('timetable_version_id', $versionId)->count())->toBe(1);

    $this->withHeader('If-Match', $adopted->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs/{$runId}/candidates/{$candidate->id}/adopt", [
            'activate' => false,
        ])->assertStatus(409)
        ->assertJsonPath('code', 'CANDIDATE_ALREADY_ADOPTED');
});

it('uses a selected draft as the preserved baseline for local replanning', function (): void {
    Queue::fake();
    $fixture = timetableVersionFixture();
    $classId = (int) DB::table('teaching_assignments')
        ->where('id', $fixture['assignment_id'])
        ->value('school_class_id');
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $placed = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
            'teaching_assignment_id' => $fixture['assignment_id'],
            'weekday' => 1,
            'item_id' => $fixture['item_ids'][0],
        ])->assertCreated();
    $created = $this->withHeader('If-Match', $placed->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs", [
            'scope' => ['type' => 'class', 'ids' => [$classId]],
            'preservation' => [
                'keep_locked' => true,
                'keep_current' => false,
                'base_version_id' => $placed->json('meta.version_id'),
            ],
            'strategy' => ['profile' => 'balanced'],
            'candidate_count' => 1,
        ])->assertStatus(202)
        ->assertJsonPath('data.preservation.base_version_id', $placed->json('meta.version_id'));

    $run = ScheduleRun::query()->findOrFail($created->json('data.id'));
    app(AutoScheduler::class)->generate($run);

    expect($run->fresh()->status->value)->toBe('completed')
        ->and($run->fresh()->candidates()->firstOrFail()->entries()->count())->toBe(1);
});

it('preserves existing placements while automatically filling the remaining class items', function (): void {
    Queue::fake();
    $fixture = timetableVersionFixture();
    DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->update([
        'weekly_items' => 2,
        'items_per_session' => 1,
    ]);
    DB::table('semesters')->where('id', $fixture['semester_id'])->increment('input_revision');
    $classId = (int) DB::table('teaching_assignments')
        ->where('id', $fixture['assignment_id'])
        ->value('school_class_id');
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $placed = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
            'teaching_assignment_id' => $fixture['assignment_id'],
            'weekday' => 1,
            'item_id' => $fixture['item_ids'][0],
        ])->assertCreated();

    $created = $this->withHeader('If-Match', $placed->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs", [
            'scope' => ['type' => 'class', 'ids' => [$classId]],
            'preservation' => [
                'keep_locked' => true,
                'keep_current' => true,
                'base_version_id' => $placed->json('meta.version_id'),
            ],
            'strategy' => ['profile' => 'balanced'],
            'candidate_count' => 1,
        ])->assertStatus(202);

    $run = ScheduleRun::query()->findOrFail($created->json('data.id'));
    app(AutoScheduler::class)->generate($run);
    $candidate = $run->fresh()->candidates()->firstOrFail();
    $entries = $candidate->entries()->get();

    expect($run->fresh()->status->value)->toBe('completed')
        ->and($candidate->unscheduled_count)->toBe(0)
        ->and($candidate->hard_conflict_count)->toBe(0)
        ->and($entries)->toHaveCount(2)
        ->and($entries->contains(
            fn ($entry): bool => $entry->weekday === 1 && $entry->item_id === $fixture['item_ids'][0],
        ))->toBeTrue();
});

it('calculates each assignment remaining count against the timetable version being viewed', function (): void {
    $fixture = timetableVersionFixture();
    DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->update([
        'weekly_items' => 2,
        'items_per_session' => 1,
    ]);
    DB::table('semesters')->where('id', $fixture['semester_id'])->increment('input_revision');
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $first = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
            'teaching_assignment_id' => $fixture['assignment_id'],
            'weekday' => 1,
            'item_id' => $fixture['item_ids'][0],
        ])->assertCreated();
    $firstVersionId = $first->json('meta.version_id');
    $copy = $this->withHeader('If-Match', $first->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable-versions", [
            'name' => '保留一节的对照草稿',
            'base_version_id' => $firstVersionId,
        ])->assertCreated();
    $copyVersionId = $copy->json('data.id');

    $this->withHeader('If-Match', $copy->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
            'teaching_assignment_id' => $fixture['assignment_id'],
            'weekday' => 2,
            'item_id' => $fixture['item_ids'][1],
            'version_id' => $firstVersionId,
        ])->assertCreated();

    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/teaching-assignments?status=confirmed&version_id={$firstVersionId}")
        ->assertOk()
        ->assertJsonPath('data.0.scheduled', 2)
        ->assertJsonPath('data.0.remaining', 0);
    $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/teaching-assignments?status=confirmed&version_id={$copyVersionId}")
        ->assertOk()
        ->assertJsonPath('data.0.scheduled', 1)
        ->assertJsonPath('data.0.remaining', 1);
});

it('places every multi-item teaching session in consecutive slots', function (): void {
    Queue::fake();
    $fixture = timetableVersionFixture();
    DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->update([
        'weekly_items' => 2,
        'items_per_session' => 2,
    ]);
    DB::table('semesters')->where('id', $fixture['semester_id'])->increment('input_revision');
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $created = $this->withHeader('If-Match', $etag)->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs", [
        'scope' => ['type' => 'all', 'ids' => []],
        'preservation' => ['keep_locked' => true, 'keep_current' => false],
        'strategy' => ['profile' => 'balanced'],
        'candidate_count' => 1,
    ])->assertStatus(202);

    $run = ScheduleRun::query()->findOrFail($created->json('data.id'));
    app(AutoScheduler::class)->generate($run);
    $entries = $run->fresh()->candidates()->firstOrFail()->entries()->with('item')->get()->sortBy('item.sort_order')->values();

    expect($run->fresh()->status->value)->toBe('completed')
        ->and($entries)->toHaveCount(2)
        ->and($entries[0]->weekday)->toBe($entries[1]->weekday)
        ->and($entries[1]->item->sort_order - $entries[0]->item->sort_order)->toBe(1);
});

it('enforces a hard teacher daily item limit while solving', function (): void {
    Queue::fake();
    $fixture = timetableVersionFixture();
    DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->update([
        'weekly_items' => 2,
        'items_per_session' => 1,
    ]);
    DB::table('scheduling_constraints')->insert([
        'semester_id' => $fixture['semester_id'],
        'name' => '胡静每天最多一节课',
        'kind' => 'hard',
        'category' => 'daily_load',
        'target_type' => 'teacher',
        'target_id' => $fixture['teacher_id'],
        'scope' => json_encode([], JSON_THROW_ON_ERROR),
        'requirement' => json_encode(['max_items_per_day' => 1], JSON_THROW_ON_ERROR),
        'source' => 'user',
        'status' => 'active',
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    DB::table('semesters')->where('id', $fixture['semester_id'])->increment('input_revision');
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $created = $this->withHeader('If-Match', $etag)->postJson("/api/v1/semesters/{$fixture['semester_id']}/schedule-runs", [
        'scope' => ['type' => 'all', 'ids' => []],
        'preservation' => ['keep_locked' => true, 'keep_current' => false],
        'strategy' => ['profile' => 'balanced'],
        'candidate_count' => 1,
    ])->assertStatus(202);

    $run = ScheduleRun::query()->findOrFail($created->json('data.id'));
    app(AutoScheduler::class)->generate($run);
    $weekdays = $run->fresh()->candidates()->firstOrFail()->entries()->pluck('weekday');

    expect($run->fresh()->status->value)->toBe('completed')
        ->and($weekdays)->toHaveCount(2)
        ->and($weekdays->unique())->toHaveCount(2);
});

it('allows the same resources in disjoint specified weeks and blocks real week overlap', function (): void {
    $fixture = timetableVersionFixture();
    $base = DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->first();
    DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->update([
        'week_pattern' => 'specified',
        'active_weeks' => json_encode([1, 3], JSON_THROW_ON_ERROR),
    ]);
    $now = now();
    $makeAssignment = function (string $courseName, string $teacherNo, array $activeWeeks) use ($base, $now): int {
        $teacherId = DB::table('teachers')->insertGetId([
            'employee_no' => $teacherNo,
            'name' => $teacherNo,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $courseId = DB::table('courses')->insertGetId([
            'name' => $courseName,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('teacher_course')->insert(['teacher_id' => $teacherId, 'course_id' => $courseId]);

        return DB::table('teaching_assignments')->insertGetId([
            'semester_id' => $base->semester_id,
            'academic_year_id' => $base->academic_year_id,
            'school_class_id' => $base->school_class_id,
            'course_id' => $courseId,
            'teacher_id' => $teacherId,
            'weekly_items' => 1,
            'items_per_session' => 1,
            'week_pattern' => 'specified',
            'active_weeks' => json_encode($activeWeeks, JSON_THROW_ON_ERROR),
            'room_mode' => 'class_default',
            'status' => 'confirmed',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    };
    $disjointAssignmentId = $makeAssignment('科学', 'T002', [2, 4]);
    $overlappingAssignmentId = $makeAssignment('劳动', 'T003', [3, 5]);
    DB::table('semesters')->where('id', $fixture['semester_id'])->increment('input_revision');

    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $first = $this->withHeader('If-Match', $etag)->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
        'teaching_assignment_id' => $fixture['assignment_id'],
        'weekday' => 1,
        'item_id' => $fixture['item_ids'][0],
    ])->assertCreated()
        ->assertJsonPath('data.week_pattern', 'specified')
        ->assertJsonPath('data.active_weeks', [1, 3]);

    $second = $this->withHeader('If-Match', $first->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
            'teaching_assignment_id' => $disjointAssignmentId,
            'weekday' => 1,
            'item_id' => $fixture['item_ids'][0],
        ])->assertCreated()
        ->assertJsonPath('data.active_weeks', [2, 4]);

    $this->withHeader('If-Match', $second->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
            'teaching_assignment_id' => $overlappingAssignmentId,
            'weekday' => 1,
            'item_id' => $fixture['item_ids'][0],
        ])->assertStatus(409)
        ->assertJsonPath('code', 'TIMETABLE_PLACEMENT_NOT_ALLOWED')
        ->assertJsonPath('diagnostics.hard_conflicts.0.active_weeks', [1, 3]);
});

it('diagnoses a timetable move before saving and suggests feasible alternatives', function (): void {
    $fixture = timetableVersionFixture();
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $placed = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
            'teaching_assignment_id' => $fixture['assignment_id'],
            'weekday' => 1,
            'item_id' => $fixture['item_ids'][0],
        ])->assertCreated();

    $this->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/diagnose", [
        'entry_id' => $placed->json('data.id'),
        'weekday' => 2,
        'item_id' => $fixture['item_ids'][1],
        'version_id' => $placed->json('meta.version_id'),
    ])->assertOk()
        ->assertJsonPath('data.allowed', true)
        ->assertJsonPath('data.target.weekday', 2)
        ->assertJsonPath('data.assignment.course', '数学')
        ->assertJsonStructure(['data' => ['alternatives' => [['weekday', 'item_id', 'soft_penalty']]]]);
});

it('returns readable hard conflicts when a proposed timetable slot is occupied', function (): void {
    $fixture = timetableVersionFixture();
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $placed = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
            'teaching_assignment_id' => $fixture['assignment_id'],
            'weekday' => 1,
            'item_id' => $fixture['item_ids'][0],
        ])->assertCreated();
    $base = DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->first();
    $now = now();
    $teacherId = DB::table('teachers')->insertGetId([
        'employee_no' => 'T-DIAG', 'name' => '诊断教师', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $courseId = DB::table('courses')->insertGetId([
        'name' => '诊断课程', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
    ]);
    $assignmentId = DB::table('teaching_assignments')->insertGetId([
        'semester_id' => $base->semester_id,
        'academic_year_id' => $base->academic_year_id,
        'school_class_id' => $base->school_class_id,
        'course_id' => $courseId,
        'teacher_id' => $teacherId,
        'weekly_items' => 1,
        'room_mode' => 'class_default',
        'status' => 'confirmed',
        'created_at' => $now,
        'updated_at' => $now,
    ]);

    $this->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/diagnose", [
        'teaching_assignment_id' => $assignmentId,
        'weekday' => 1,
        'item_id' => $fixture['item_ids'][0],
        'version_id' => $placed->json('meta.version_id'),
    ])->assertOk()
        ->assertJsonPath('data.allowed', false)
        ->assertJsonPath('data.summary', '不能移动：存在必须先处理的硬冲突。')
        ->assertJsonPath('data.hard_conflicts.0.type', 'room')
        ->assertJsonPath('data.hard_conflicts.0.resource_name', '七年级 1 班教室');
});

it('enforces hard scheduling rules again when a timetable entry is saved', function (): void {
    $fixture = timetableVersionFixture();
    DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->update([
        'weekly_items' => 2,
    ]);
    DB::table('scheduling_constraints')->insert([
        'semester_id' => $fixture['semester_id'],
        'name' => '胡静每天最多一节课',
        'kind' => 'hard',
        'category' => 'daily_load',
        'target_type' => 'teacher',
        'target_id' => $fixture['teacher_id'],
        'scope' => json_encode([], JSON_THROW_ON_ERROR),
        'requirement' => json_encode(['max_items_per_day' => 1], JSON_THROW_ON_ERROR),
        'source' => 'user',
        'status' => 'active',
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $first = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
            'teaching_assignment_id' => $fixture['assignment_id'],
            'weekday' => 1,
            'item_id' => $fixture['item_ids'][0],
        ])->assertCreated();

    $this->withHeader('If-Match', $first->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
            'teaching_assignment_id' => $fixture['assignment_id'],
            'weekday' => 1,
            'item_id' => $fixture['item_ids'][1],
            'version_id' => $first->json('meta.version_id'),
        ])->assertStatus(409)
        ->assertJsonPath('code', 'TIMETABLE_PLACEMENT_NOT_ALLOWED')
        ->assertJsonPath('diagnostics.allowed', false)
        ->assertJsonPath('diagnostics.hard_conflicts.0.constraint_id', fn ($value) => is_int($value));
});

it('previews and atomically swaps two timetable entries', function (): void {
    $fixture = timetableVersionFixture();
    $base = DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->first();
    $now = now();
    $teacherId = DB::table('teachers')->insertGetId([
        'employee_no' => 'T-SWAP', 'name' => '交换教师', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $courseId = DB::table('courses')->insertGetId([
        'name' => '交换课程', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
    ]);
    $targetAssignmentId = DB::table('teaching_assignments')->insertGetId([
        'semester_id' => $base->semester_id,
        'academic_year_id' => $base->academic_year_id,
        'school_class_id' => $base->school_class_id,
        'course_id' => $courseId,
        'teacher_id' => $teacherId,
        'weekly_items' => 1,
        'room_mode' => 'class_default',
        'status' => 'confirmed',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $etag = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}")->headers->get('ETag');
    $first = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
            'teaching_assignment_id' => $fixture['assignment_id'],
            'weekday' => 1,
            'item_id' => $fixture['item_ids'][0],
        ])->assertCreated();
    $second = $this->withHeader('If-Match', $first->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/entries", [
            'teaching_assignment_id' => $targetAssignmentId,
            'weekday' => 1,
            'item_id' => $fixture['item_ids'][1],
            'version_id' => $first->json('meta.version_id'),
        ])->assertCreated();
    $payload = [
        'entry_id' => $first->json('data.id'),
        'target_entry_id' => $second->json('data.id'),
        'version_id' => $first->json('meta.version_id'),
    ];

    $this->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/swap/diagnose", $payload)
        ->assertOk()
        ->assertJsonPath('data.allowed', true)
        ->assertJsonPath('data.summary', '可以交换：两节课程互换后没有硬冲突。');
    $this->withHeader('If-Match', $second->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$fixture['semester_id']}/timetable/swap", $payload)
        ->assertOk()
        ->assertJsonPath('data.entries.0.item_id', $fixture['item_ids'][1])
        ->assertJsonPath('data.entries.1.item_id', $fixture['item_ids'][0]);

    expect(DB::table('timetable_entries')->where('id', $first->json('data.id'))->value('item_id'))
        ->toBe($fixture['item_ids'][1])
        ->and(DB::table('timetable_entries')->where('id', $second->json('data.id'))->value('item_id'))
        ->toBe($fixture['item_ids'][0]);
});

/** @return array{semester_id: int, assignment_id: int, teacher_id: int, item_ids: list<int>} */
function timetableVersionFixture(): array
{
    $now = now();
    $yearId = DB::table('academic_years')->insertGetId([
        'name' => '2026-2027 学年', 'start_date' => '2026-09-01', 'end_date' => '2027-07-15',
        'status' => 'open', 'created_at' => $now, 'updated_at' => $now,
    ]);
    $semesterId = DB::table('semesters')->insertGetId([
        'academic_year_id' => $yearId, 'name' => '上学期', 'sequence' => 1,
        'start_date' => '2026-09-01', 'end_date' => '2027-01-20', 'status' => 'open',
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $gradeId = DB::table('grades')->insertGetId([
        'name' => '七年级', 'sort_order' => 7, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
    ]);
    $teacherId = DB::table('teachers')->insertGetId([
        'employee_no' => 'T001', 'name' => '胡静', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
    ]);
    $courseId = DB::table('courses')->insertGetId([
        'name' => '数学', 'short_name' => '数', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
    ]);
    DB::table('teacher_course')->insert(['teacher_id' => $teacherId, 'course_id' => $courseId]);
    $roomId = DB::table('rooms')->insertGetId([
        'name' => '七年级 1 班教室', 'type' => 'classroom', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
    ]);
    $classId = DB::table('school_classes')->insertGetId([
        'academic_year_id' => $yearId, 'grade_id' => $gradeId, 'name' => '七年级 1 班', 'code' => 'G7C1',
        'status' => 'active', 'created_at' => $now, 'updated_at' => $now,
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
        'room_mode' => 'class_default', 'status' => 'confirmed', 'created_at' => $now, 'updated_at' => $now,
    ]);
    DB::table('semesters')->where('id', $semesterId)->update([
        'input_revision' => 1, 'assignment_revision' => 1, 'updated_at' => $now,
    ]);

    return [
        'semester_id' => $semesterId,
        'assignment_id' => $assignmentId,
        'teacher_id' => $teacherId,
        'item_ids' => $itemIds,
    ];
}
