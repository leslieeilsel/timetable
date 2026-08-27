<?php

namespace App\Modules\Scheduling\Http\Controllers;

use App\Enums\ScheduleRunStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Scheduling\Jobs\GenerateScheduleCandidates;
use App\Modules\Scheduling\Models\ScheduleRun;
use App\Modules\Scheduling\Models\SchedulingConstraint;
use App\Modules\Scheduling\Services\PreparationCheckService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ScheduleRunController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly PreparationCheckService $preparation,
    ) {}

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['sometimes', Rule::enum(ScheduleRunStatus::class)],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ]);
        $paginator = $semester->scheduleRuns()
            ->with('creator:id,name')
            ->withCount('candidates')
            ->when(isset($filters['status']), fn ($query) => $query->where('status', $filters['status']))
            ->latest('id')
            ->paginate((int) ($filters['per_page'] ?? 20));
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json([
            'data' => $paginator->items(),
            'meta' => array_merge($this->meta($semester, $settings), [
                'pagination' => [
                    'page' => $paginator->currentPage(), 'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(), 'last_page' => $paginator->lastPage(),
                    'from' => $paginator->firstItem(), 'to' => $paginator->lastItem(),
                ],
            ]),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function show(Semester $semester, ScheduleRun $run): JsonResponse
    {
        $this->assertParent($semester, $run);
        $settings = AppSetting::query()->findOrFail(1);
        $run->load(['creator:id,name', 'candidates' => fn ($query) => $query->orderBy('rank')]);

        return response()->json([
            'data' => $run,
            'meta' => $this->meta($semester, $settings),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'scope' => ['required', 'array'],
            'scope.type' => ['required', Rule::in(['all', 'grade', 'class', 'assignment'])],
            'scope.ids' => ['sometimes', 'array', 'max:500'],
            'scope.ids.*' => ['integer', 'distinct'],
            'preservation' => ['sometimes', 'array'],
            'preservation.keep_locked' => ['sometimes', 'boolean'],
            'preservation.keep_current' => ['sometimes', 'boolean'],
            'preservation.base_version_id' => ['sometimes', 'nullable', 'integer'],
            'strategy' => ['required', 'array'],
            'strategy.profile' => ['required', Rule::in(['balanced', 'class_distribution', 'teacher_experience', 'room_utilization', 'custom'])],
            'strategy.weights' => ['sometimes', 'array'],
            'strategy.weights.*' => ['integer', 'between:0,100'],
            'candidate_count' => ['required', Rule::in([1, 3])],
        ]);
        $scope = $data['scope'];
        $scope['ids'] = array_values(array_map('intval', $scope['ids'] ?? []));
        if ($scope['type'] !== 'all' && $scope['ids'] === []) {
            throw new ApiProblemException('SCHEDULE_SCOPE_EMPTY', '局部生成必须至少选择一个年级、班级或任课关系', 422);
        }
        $preservation = array_merge(['keep_locked' => true, 'keep_current' => false], $data['preservation'] ?? []);

        [$run, $settings, $lockedSemester] = DB::transaction(function () use ($request, $semester, $data, $scope, $preservation): array {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            if (isset($preservation['base_version_id'])) {
                $baseVersion = $lockedSemester->timetableVersions()->find((int) $preservation['base_version_id']);
                if ($baseVersion === null) {
                    throw new ApiProblemException('VERSION_SEMESTER_MISMATCH', '局部重排的基础课表版本不属于该学期', 404);
                }
            }
            $preparation = $this->preparation->inspect($lockedSemester);
            if (! $preparation['ready']) {
                throw new ApiProblemException('PREPARATION_BLOCKED', '准备检查存在阻塞项，无法创建自动排课任务', 409, [
                    'checks' => collect($preparation['checks'])->where('status', 'blocking')->values()->all(),
                ]);
            }
            $activeConstraints = $lockedSemester->schedulingConstraints()
                ->where('status', 'active')->orderBy('id')->get()->map(fn (SchedulingConstraint $constraint): array => [
                    'id' => $constraint->id,
                    'kind' => $constraint->kind->value,
                    'category' => $constraint->category->value,
                    'target_type' => $constraint->target_type?->value,
                    'target_id' => $constraint->target_id,
                    'scope' => $constraint->scope,
                    'condition' => $constraint->condition,
                    'requirement' => $constraint->requirement,
                    'weight' => $constraint->weight,
                ])->all();
            $run = ScheduleRun::query()->create([
                'semester_id' => $lockedSemester->id,
                'created_by' => $actor->id,
                'status' => ScheduleRunStatus::Queued,
                'scope' => $scope,
                'preservation' => $preservation,
                'constraint_snapshot' => [
                    'input_revision' => (int) $lockedSemester->getRawOriginal('input_revision'),
                    'assignment_revision' => (int) $lockedSemester->getRawOriginal('assignment_revision'),
                    'constraint_revision' => (int) $lockedSemester->getRawOriginal('constraint_revision'),
                    'constraints' => $activeConstraints,
                ],
                'strategy' => $data['strategy'],
                'candidate_count' => (int) $data['candidate_count'],
                'input_revision' => (int) $lockedSemester->getRawOriginal('input_revision'),
                'algorithm_version' => 'resource-block-v2',
                'random_seed' => random_int(1, 2_000_000_000),
                'progress_stage' => 'queued',
                'progress_percent' => 0,
            ]);
            $this->audit->record($request, $actor, 'create', 'schedule_run', $run->id, null, [
                ...$run->toArray(),
                'preparation_summary' => $preparation['summary'],
            ]);

            return [$run, $settings, $lockedSemester];
        }, 3);
        GenerateScheduleCandidates::dispatchAfterResponse($run->id);

        return response()->json([
            'data' => $run,
            'meta' => $this->meta($lockedSemester, $settings),
        ], 202)->header('ETag', $this->etags->semester($lockedSemester, $settings));
    }

    public function cancel(Request $request, Semester $semester, ScheduleRun $run): JsonResponse
    {
        $this->assertParent($semester, $run);

        return DB::transaction(function () use ($request, $semester, $run): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $locked = ScheduleRun::query()->lockForUpdate()->findOrFail($run->id);
            if (in_array($locked->status, [ScheduleRunStatus::Completed, ScheduleRunStatus::Failed, ScheduleRunStatus::Cancelled], true)) {
                throw new ApiProblemException('SCHEDULE_RUN_TERMINAL', '已结束的自动排课任务不能取消', 409);
            }
            $before = $locked->toArray();
            $locked->forceFill([
                'status' => ScheduleRunStatus::Cancelled,
                'progress_stage' => 'cancelled',
                'completed_at' => now(),
            ])->save();
            $this->audit->record($request, $actor, 'cancel', 'schedule_run', $locked->id, $before, $locked->toArray());

            return response()->json([
                'data' => $locked,
                'meta' => $this->meta($lockedSemester, $settings),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    private function assertParent(Semester $semester, ScheduleRun $run): void
    {
        if ($run->semester_id !== $semester->id) {
            throw new ApiProblemException('SCHEDULE_RUN_SEMESTER_MISMATCH', '自动排课任务不属于该学期', 404);
        }
    }

    /** @return array<string, int|string> */
    private function meta(Semester $semester, AppSetting $settings): array
    {
        return [
            'semester_id' => $semester->id,
            'input_revision' => (string) $semester->getRawOriginal('input_revision'),
            'timetable_revision' => (string) $semester->getRawOriginal('timetable_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
