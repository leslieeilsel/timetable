<?php

namespace App\Modules\DailyOperations\Http\Controllers;

use App\Enums\OperationalStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\DailyOperations\Models\Substitution;
use App\Modules\DailyOperations\Models\TeacherLeave;
use App\Modules\DailyOperations\Services\DailyTimetableService;
use App\Modules\Resources\Models\Teacher;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TeacherLeaveController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly DailyTimetableService $daily,
    ) {}

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $filters = $request->validate([
            'teacher_id' => ['sometimes', 'integer'],
            'status' => ['sometimes', Rule::enum(OperationalStatus::class)],
            'date_from' => ['sometimes', 'date'],
            'date_to' => ['sometimes', 'date'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ]);
        $paginator = $semester->teacherLeaves()
            ->with(['teacher:id,name,employee_no', 'creator:id,name'])
            ->withCount(['substitutions' => fn ($query) => $query->where('status', OperationalStatus::Active->value)])
            ->when(isset($filters['teacher_id']), fn ($query) => $query->where('teacher_id', $filters['teacher_id']))
            ->when(isset($filters['status']), fn ($query) => $query->where('status', $filters['status']))
            ->when(isset($filters['date_from']), fn ($query) => $query->where('ends_at', '>=', $filters['date_from']))
            ->when(isset($filters['date_to']), fn ($query) => $query->where('starts_at', '<=', $filters['date_to']))
            ->latest('starts_at')
            ->latest('id')
            ->paginate((int) ($filters['per_page'] ?? 20));
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json([
            'data' => $paginator->items(),
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

    public function preview(Request $request, Semester $semester): JsonResponse
    {
        $data = $this->leavePayload($request);
        $settings = AppSetting::query()->findOrFail(1);
        [$startsAt, $endsAt] = $this->range($semester, $data);
        $teacher = Teacher::query()->where('is_active', true)->findOrFail((int) $data['teacher_id']);
        $affected = $this->daily->affectedByLeave($semester, $teacher->id, $startsAt, $endsAt);

        return response()->json([
            'data' => [
                'teacher' => $teacher,
                'starts_at' => $startsAt->toIso8601String(),
                'ends_at' => $endsAt->toIso8601String(),
                'affected_count' => count($affected),
                'affected' => $affected,
            ],
            'meta' => $this->meta($semester, $settings),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $data = $this->leavePayload($request);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            [$startsAt, $endsAt] = $this->range($lockedSemester, $data);
            $teacher = Teacher::query()->where('is_active', true)->findOrFail((int) $data['teacher_id']);
            $overlap = TeacherLeave::query()
                ->where('semester_id', $lockedSemester->id)
                ->where('teacher_id', $teacher->id)
                ->where('status', OperationalStatus::Active->value)
                ->where('starts_at', '<', $endsAt)
                ->where('ends_at', '>', $startsAt)
                ->exists();
            if ($overlap) {
                throw new ApiProblemException('TEACHER_LEAVE_OVERLAP', '该教师已有重叠的请假记录', 409);
            }
            $affected = $this->daily->affectedByLeave($lockedSemester, $teacher->id, $startsAt, $endsAt);
            $leave = TeacherLeave::query()->create([
                ...$data,
                'semester_id' => $lockedSemester->id,
                'starts_at' => $startsAt,
                'ends_at' => $endsAt,
                'status' => OperationalStatus::Active,
                'created_by' => $actor->id,
            ]);
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'create', 'teacher_leave', $leave->id, null, [
                ...$leave->toArray(),
                'affected_count' => count($affected),
                'affected_entry_ids' => collect($affected)->pluck('original_entry_id')->unique()->values()->all(),
            ]);

            return response()->json([
                'data' => [
                    'leave' => $leave->load('teacher:id,name,employee_no'),
                    'affected_count' => count($affected),
                    'affected' => $affected,
                ],
                'meta' => $this->meta($lockedSemester, $settings),
            ], 201)->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function show(Semester $semester, TeacherLeave $leave): JsonResponse
    {
        $this->assertParent($semester, $leave);
        $settings = AppSetting::query()->findOrFail(1);
        $affected = $this->daily->affectedByLeave(
            $semester,
            $leave->teacher_id,
            $leave->starts_at,
            $leave->ends_at,
        );
        $leave->load([
            'teacher:id,name,employee_no',
            'substitutions' => fn ($query) => $query->with([
                'originalEntry.course:id,name', 'originalEntry.item:id,name',
                'replacementTeacher:id,name,employee_no',
            ])->orderBy('effective_date')->orderBy('id'),
        ]);

        return response()->json([
            'data' => [
                'leave' => $leave,
                'affected_count' => count($affected),
                'affected' => $affected,
            ],
            'meta' => $this->meta($semester, $settings),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function recommendations(
        Request $request,
        Semester $semester,
        TeacherLeave $leave,
    ): JsonResponse {
        $this->assertParent($semester, $leave);
        $data = $request->validate([
            'entry_id' => ['required', 'integer'],
            'date' => ['required', 'date_format:Y-m-d'],
        ]);
        $entry = $this->entryForCurrentVersion($semester, (int) $data['entry_id']);
        $this->assertAffected($semester, $leave, $entry, $data['date']);
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json([
            'data' => $this->daily->substitutionRecommendations(
                $semester,
                $entry,
                $data['date'],
                $leave->teacher_id,
            ),
            'meta' => $this->meta($semester, $settings),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function substitute(
        Request $request,
        Semester $semester,
        TeacherLeave $leave,
    ): JsonResponse {
        $this->assertParent($semester, $leave);
        $data = $request->validate([
            'substitutions' => ['required', 'array', 'min:1', 'max:100'],
            'substitutions.*.entry_id' => ['required', 'integer'],
            'substitutions.*.date' => ['required', 'date_format:Y-m-d'],
            'substitutions.*.replacement_teacher_id' => [
                'required', 'integer', Rule::exists('teachers', 'id')->where('is_active', true),
            ],
            'substitutions.*.reason' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        return DB::transaction(function () use ($request, $semester, $leave, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $lockedLeave = TeacherLeave::query()->lockForUpdate()->findOrFail($leave->id);
            if ($lockedLeave->status !== OperationalStatus::Active) {
                throw new ApiProblemException('TEACHER_LEAVE_NOT_ACTIVE', '只有生效中的请假可以安排代课', 409);
            }
            $saved = [];
            $seen = [];
            foreach ($data['substitutions'] as $item) {
                $pair = $item['entry_id'].'@'.$item['date'];
                if (isset($seen[$pair])) {
                    throw new ApiProblemException('SUBSTITUTION_DUPLICATE', '同一课程在同一日期不能重复安排代课', 422, [
                        'entry_id' => $item['entry_id'],
                        'date' => $item['date'],
                    ]);
                }
                $seen[$pair] = true;
                $entry = $this->entryForCurrentVersion($lockedSemester, (int) $item['entry_id']);
                $this->assertAffected($lockedSemester, $lockedLeave, $entry, $item['date']);
                $entry->loadMissing('teachingAssignment');
                if (! $entry->teachingAssignment->allows_substitution) {
                    throw new ApiProblemException('SUBSTITUTION_NOT_ALLOWED', $entry->course->name.'不允许临时代课', 409);
                }
                $recommendations = $this->daily->substitutionRecommendations(
                    $lockedSemester,
                    $entry,
                    $item['date'],
                    $lockedLeave->teacher_id,
                );
                $recommended = collect($recommendations)
                    ->first(fn (array $candidate): bool => $candidate['teacher']->id === (int) $item['replacement_teacher_id']);
                if (! is_array($recommended)) {
                    throw new ApiProblemException('SUBSTITUTION_TEACHER_UNAVAILABLE', '所选代课教师无资格、请假或目标课节已有安排', 409, [
                        'entry_id' => $entry->id,
                        'date' => $item['date'],
                    ]);
                }
                $substitution = Substitution::query()->updateOrCreate(
                    ['original_entry_id' => $entry->id, 'effective_date' => $item['date']],
                    [
                        'teacher_leave_id' => $lockedLeave->id,
                        'replacement_teacher_id' => (int) $item['replacement_teacher_id'],
                        'status' => OperationalStatus::Active,
                        'reason' => $item['reason'] ?? $lockedLeave->reason,
                        'created_by' => $actor->id,
                    ],
                );
                $saved[] = $substitution->load(['originalEntry.course', 'replacementTeacher']);
            }
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'batch_substitute', 'teacher_leave', $lockedLeave->id, null, [
                'count' => count($saved),
                'substitution_ids' => collect($saved)->pluck('id')->all(),
            ]);

            return response()->json([
                'data' => $saved,
                'meta' => $this->meta($lockedSemester, $settings),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function cancel(Request $request, Semester $semester, TeacherLeave $leave): JsonResponse
    {
        $this->assertParent($semester, $leave);

        return DB::transaction(function () use ($request, $semester, $leave): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $locked = TeacherLeave::query()->lockForUpdate()->findOrFail($leave->id);
            if ($locked->status === OperationalStatus::Cancelled) {
                throw new ApiProblemException('TEACHER_LEAVE_ALREADY_CANCELLED', '该请假记录已经取消', 409);
            }
            $before = $locked->toArray();
            $locked->status = OperationalStatus::Cancelled;
            $locked->save();
            $locked->substitutions()->where('status', OperationalStatus::Active->value)
                ->update(['status' => OperationalStatus::Cancelled->value, 'updated_at' => now()]);
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'cancel', 'teacher_leave', $locked->id, $before, $locked->toArray());

            return response()->json([
                'data' => $locked,
                'meta' => $this->meta($lockedSemester, $settings),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    /** @return array<string, mixed> */
    private function leavePayload(Request $request): array
    {
        return $request->validate([
            'teacher_id' => ['required', 'integer', Rule::exists('teachers', 'id')->where('is_active', true)],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date', 'after:starts_at'],
            'type' => ['required', 'string', Rule::in(['sick', 'personal', 'training', 'official', 'other'])],
            'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'includes_non_course_items' => ['sometimes', 'boolean'],
        ]);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{Carbon, Carbon}
     */
    private function range(Semester $semester, array $data): array
    {
        $startsAt = Carbon::parse($data['starts_at']);
        $endsAt = Carbon::parse($data['ends_at']);
        if ($startsAt->lessThan($semester->start_date->copy()->startOfDay())
            || $endsAt->greaterThan($semester->end_date->copy()->endOfDay())) {
            throw new ApiProblemException('TEACHER_LEAVE_OUTSIDE_SEMESTER', '请假时间必须位于当前学期内', 422);
        }
        if ($startsAt->diffInDays($endsAt) > 60) {
            throw new ApiProblemException('TEACHER_LEAVE_RANGE_TOO_LONG', '单条请假记录不能超过 60 天', 422);
        }

        return [$startsAt, $endsAt];
    }

    private function entryForCurrentVersion(Semester $semester, int $entryId): TimetableEntry
    {
        $version = $this->daily->currentVersion($semester);

        return TimetableEntry::query()->with([
            'teacher', 'teachers', 'course', 'item', 'schoolClasses', 'teachingAssignment',
        ])->where('timetable_version_id', $version->id)->findOrFail($entryId);
    }

    private function assertAffected(
        Semester $semester,
        TeacherLeave $leave,
        TimetableEntry $entry,
        string $date,
    ): void {
        $start = Carbon::parse($date.' '.$entry->item->start_time);
        $end = Carbon::parse($date.' '.$entry->item->end_time);
        $actual = collect($this->daily->forDate($semester, $date, $leave->teacher_id)['rows'])
            ->first(fn (array $row): bool => $row['original_entry_id'] === $entry->id
                && ! $row['is_cancelled']
                && in_array($leave->teacher_id, $row['teacher_ids'], true));
        if ($start->greaterThanOrEqualTo($leave->ends_at) || $end->lessThanOrEqualTo($leave->starts_at)
            || ! is_array($actual)) {
            throw new ApiProblemException('SUBSTITUTION_ENTRY_NOT_AFFECTED', '所选课程不在该教师请假影响范围内', 422);
        }
    }

    private function assertParent(Semester $semester, TeacherLeave $leave): void
    {
        if ($leave->semester_id !== $semester->id) {
            throw new ApiProblemException('TEACHER_LEAVE_SEMESTER_MISMATCH', '请假记录不属于该学期', 404);
        }
    }

    /** @return array<string, int|string> */
    private function meta(Semester $semester, AppSetting $settings): array
    {
        return [
            'semester_id' => $semester->id,
            'timetable_revision' => (string) $semester->getRawOriginal('timetable_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
