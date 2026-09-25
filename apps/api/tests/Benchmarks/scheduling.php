<?php

use App\Models\User;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Scheduling\Http\Controllers\ScheduleRunController;
use App\Modules\Scheduling\Models\ScheduleRun;
use App\Modules\Scheduling\Services\AutoScheduler;
use App\Modules\Timetable\Models\TimetableVersion;
use App\Modules\Timetable\Services\RoomResolver;
use App\Modules\Timetable\Services\TimetableVersionService;
use App\Support\EtagService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Request;

// Run against a disposable COPY of a seeded SQLite database, never a school database:
// TIMETABLE_BENCHMARK_DB=/tmp/timetable-benchmark.sqlite php tests/Benchmarks/scheduling.php 3
$path = getenv('TIMETABLE_BENCHMARK_DB');
if (! $path || ! str_starts_with($path, '/tmp/timetable-benchmark') || ! is_file($path)) {
    throw new RuntimeException('Provide a disposable /tmp/timetable-benchmark*.sqlite copy via TIMETABLE_BENCHMARK_DB.');
}
putenv('APP_ENV=testing');
putenv('DB_CONNECTION=sqlite');
putenv('DB_DATABASE='.$path);
putenv('QUEUE_CONNECTION=database');
require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$semester = Semester::query()->findOrFail((int) ($argv[1] ?? 3));
$actor = User::query()->where('role', 'admin')->where('must_change_password', false)->firstOrFail();
$published = TimetableVersion::query()->findOrFail($semester->current_timetable_version_id);
$publishedFingerprint = ScheduleRun::fingerprintTimetableVersion($published->id);
$baseline = app(TimetableVersionService::class)->createDraft($semester, $actor, $published, '基准测试独立草稿');
$first = $baseline->entries()->where('is_locked', false)->orderBy('id')->firstOrFail();
$first->is_locked = true;
$first->save();
$lockedSignature = [$first->teaching_assignment_id, $first->weekday, $first->item_id, $first->actual_room_id];
$removed = $baseline->entries()->where('is_locked', false)->orderByDesc('id')->firstOrFail();
$assignmentId = $removed->teaching_assignment_id;
$removed->delete();
$lockKey = fn ($assignment, $pattern, $day, $item, $room): string => implode(':', [$assignment, $pattern, $day, $item, $room]);
$allowedLocks = $baseline->entries()->where('is_locked', true)->get()->map(fn ($entry) => $lockKey($entry->teaching_assignment_id, $entry->week_pattern->value, $entry->weekday, $entry->item_id, $entry->actual_room_id))->all();
foreach ($semester->fixedPlacements()->where('status', 'active')->get() as $placement) {
    $allowedLocks[] = $lockKey($placement->teaching_assignment_id, $placement->week_pattern->value, $placement->weekday, $placement->item_id, $placement->room_id ?? app(RoomResolver::class)->resolve($placement->teachingAssignment));
}
$allowedLocks = array_unique($allowedLocks);
$input = ['classes' => $semester->classSettings()->count(), 'assignments' => $semester->teachingAssignments()->where('status', 'confirmed')->count(), 'published_entries' => $published->entries()->count(), 'baseline_entries' => $baseline->entries()->count(), 'baseline_locked' => $baseline->entries()->where('is_locked', true)->count(), 'allowed_locked' => count($allowedLocks), 'active_rules' => $semester->schedulingConstraints()->where('status', 'active')->count(), 'seed' => 20260925];
echo json_encode(['input' => $input], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR).PHP_EOL;
foreach (['full', 'fill', 'local'] as $mode) {
    $semester->refresh();
    $request = Request::create('/benchmark', 'POST', [
        'scope' => ['type' => $mode === 'local' ? 'assignment' : 'all', 'ids' => $mode === 'local' ? [$assignmentId] : []],
        'preservation' => ['keep_locked' => true, 'keep_current' => $mode === 'fill', 'base_version_id' => $baseline->id],
        'strategy' => ['profile' => 'balanced'], 'candidate_count' => 1,
    ]);
    $request->setUserResolver(fn () => $actor);
    $request->setLaravelSession(app('session.store'));
    $request->session()->put('auth_version', $actor->auth_version);
    $request->headers->set('If-Match', app(EtagService::class)->semester($semester, AppSetting::query()->findOrFail(1)));
    $response = app(ScheduleRunController::class)->store($request, $semester);
    $run = ScheduleRun::query()->findOrFail($response->getData(true)['data']['id']);
    $run->random_seed = 20260925;
    $run->save();
    $start = hrtime(true);
    app(AutoScheduler::class)->generate($run);
    $elapsed = round((hrtime(true) - $start) / 1e9, 3);
    $run->refresh();
    $candidate = $run->candidates()->first();
    $entries = $candidate?->entries()->get();
    $lockKept = $entries?->contains(fn ($entry) => [$entry->teaching_assignment_id, $entry->weekday, $entry->item_id, $entry->actual_room_id] === $lockedSignature && $entry->is_locked);
    $outsideKept = $mode !== 'local' || $baseline->entries()->where('teaching_assignment_id', '!=', $assignmentId)->get()->every(fn ($entry) => $entries?->contains(fn ($new) => $new->teaching_assignment_id === $entry->teaching_assignment_id && $new->weekday === $entry->weekday && $new->item_id === $entry->item_id && $new->actual_room_id === $entry->actual_room_id));
    echo json_encode(['mode' => $mode, 'seconds' => $elapsed, 'status' => $run->status->value, 'error_code' => $run->error_code, 'diagnostics' => $candidate ? null : $run->diagnostics, 'candidate_entries' => $entries?->count(), 'candidate_locked' => $entries?->where('is_locked', true)->count(), 'unintended_locks' => $entries?->filter(fn ($entry) => $entry->is_locked && ! in_array($lockKey($entry->teaching_assignment_id, $entry->week_pattern->value, $entry->weekday, $entry->item_id, $entry->actual_room_id), $allowedLocks, true))->count(), 'changes' => $candidate?->score_breakdown['change_counts'], 'locked_preserved' => $lockKept, 'outside_scope_preserved' => $outsideKept, 'published_unchanged' => $publishedFingerprint === ScheduleRun::fingerprintTimetableVersion($published->id)], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR).PHP_EOL;
}
