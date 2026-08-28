<?php

namespace App\Modules\Scheduling\Http\Controllers;

use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Scheduling\Models\ScheduleCandidate;
use App\Modules\Scheduling\Models\ScheduleRun;
use App\Modules\Timetable\Services\TimetableVersionService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ScheduleCandidateController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly TimetableVersionService $versions,
    ) {}

    public function show(
        Request $request,
        Semester $semester,
        ScheduleRun $run,
        ScheduleCandidate $candidate,
    ): JsonResponse {
        $this->assertParents($semester, $run, $candidate);
        $filters = $request->validate([
            'school_class_id' => ['sometimes', 'integer'],
            'teacher_id' => ['sometimes', 'integer'],
            'room_id' => ['sometimes', 'integer'],
            'course_id' => ['sometimes', 'integer'],
            'weekday' => ['sometimes', 'integer', 'between:1,7'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ]);
        $query = $candidate->entries()->with([
            'teachingAssignment.schoolClass.grade:id,name',
            'teachingAssignment.teachingGroup.schoolClasses.grade:id,name',
            'teachingAssignment.teacher:id,name',
            'teachingAssignment.collaborators:id,name',
            'teachingAssignment.course:id,name,short_name',
            'actualRoom:id,name',
            'item:id,name,sort_order,start_time,end_time',
        ]);
        if (isset($filters['school_class_id'])) {
            $classId = (int) $filters['school_class_id'];
            $query->whereHas('teachingAssignment', function ($assignmentQuery) use ($classId): void {
                $assignmentQuery->where(function ($targetQuery) use ($classId): void {
                    $targetQuery->where('school_class_id', $classId)
                        ->orWhereIn('teaching_group_id', DB::table('teaching_group_classes')
                            ->select('teaching_group_id')
                            ->where('school_class_id', $classId));
                });
            });
        }
        if (isset($filters['teacher_id'])) {
            $teacherId = (int) $filters['teacher_id'];
            $query->whereHas('teachingAssignment', function ($assignmentQuery) use ($teacherId): void {
                $assignmentQuery->where(function ($teacherQuery) use ($teacherId): void {
                    $teacherQuery->where('teacher_id', $teacherId)
                        ->orWhereIn('id', DB::table('teaching_assignment_collaborators')
                            ->select('teaching_assignment_id')
                            ->where('teacher_id', $teacherId));
                });
            });
        }
        if (isset($filters['room_id'])) {
            $query->where('actual_room_id', (int) $filters['room_id']);
        }
        if (isset($filters['course_id'])) {
            $courseId = (int) $filters['course_id'];
            $query->whereHas('teachingAssignment', fn ($assignmentQuery) => $assignmentQuery->where('course_id', $courseId));
        }
        if (isset($filters['weekday'])) {
            $query->where('weekday', (int) $filters['weekday']);
        }
        $paginator = $query->orderBy('weekday')->orderBy('item_id')->orderBy('id')
            ->paginate((int) ($filters['per_page'] ?? 50));
        $settings = AppSetting::query()->findOrFail(1);
        $isStale = ! $run->hasCompleteInputSnapshot()
            || $run->revisionDifferences($semester, $settings) !== []
            || ! $run->baselineMatches();

        return response()->json([
            'data' => [
                'candidate' => $candidate->load('run.creator:id,name'),
                'entries' => $paginator->items(),
                'is_stale' => $isStale,
            ],
            'meta' => array_merge($this->meta($semester, $settings), [
                'pagination' => [
                    'page' => $paginator->currentPage(),
                    'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(),
                    'last_page' => $paginator->lastPage(),
                    'from' => $paginator->firstItem(),
                    'to' => $paginator->lastItem(),
                ],
            ]),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function adopt(
        Request $request,
        Semester $semester,
        ScheduleRun $run,
        ScheduleCandidate $candidate,
    ): JsonResponse {
        $this->assertParents($semester, $run, $candidate);
        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:120'],
            'activate' => ['sometimes', 'boolean'],
            'reason' => ['required_if:activate,true', 'nullable', 'string', 'min:2', 'max:500'],
        ]);

        return DB::transaction(function () use ($request, $semester, $run, $candidate, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $lockedRun = ScheduleRun::query()->lockForUpdate()->findOrFail($run->id);
            $lockedCandidate = ScheduleCandidate::query()->lockForUpdate()->findOrFail($candidate->id);
            $this->assertParents($lockedSemester, $lockedRun, $lockedCandidate);

            $version = $this->versions->createFromCandidate(
                $lockedSemester,
                $actor,
                $lockedCandidate,
                $data['name'] ?? null,
            );
            $activate = (bool) ($data['activate'] ?? false);
            $previous = null;
            if ($activate) {
                $previous = $this->versions->activate($lockedSemester, $version);
            } else {
                $lockedSemester->increment('timetable_revision');
                $lockedSemester->refresh();
            }
            $this->audit->record($request, $actor, 'adopt', 'schedule_candidate', $lockedCandidate->id, null, [
                'candidate_id' => $lockedCandidate->id,
                'schedule_run_id' => $lockedRun->id,
                'version_id' => $version->id,
                'activated' => $activate,
                'previous_version_id' => $previous?->id,
                'reason' => $data['reason'] ?? null,
            ]);

            return response()->json([
                'data' => $version->fresh()->load(['creator:id,name', 'sourceCandidate:id,name,rank'])->loadCount('entries'),
                'meta' => $this->meta($lockedSemester, $settings),
            ], 201)->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    private function assertParents(Semester $semester, ScheduleRun $run, ScheduleCandidate $candidate): void
    {
        if ($run->semester_id !== $semester->id
            || $candidate->semester_id !== $semester->id
            || $candidate->schedule_run_id !== $run->id) {
            throw new ApiProblemException('CANDIDATE_PARENT_MISMATCH', '候选方案不属于该学期或求解任务', 404);
        }
    }

    /** @return array<string, int|string|null> */
    private function meta(Semester $semester, AppSetting $settings): array
    {
        return [
            'semester_id' => $semester->id,
            'current_timetable_version_id' => $semester->current_timetable_version_id,
            'input_revision' => (string) $semester->getRawOriginal('input_revision'),
            'timetable_revision' => (string) $semester->getRawOriginal('timetable_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
