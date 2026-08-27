<?php

namespace App\Modules\DailyOperations\Http\Controllers;

use App\Enums\CalendarExceptionType;
use App\Enums\OperationalStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\DailyOperations\Models\CalendarException;
use App\Modules\DailyOperations\Services\DailyTimetableService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class CalendarExceptionController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly DailyTimetableService $daily,
    ) {}

    public function timetable(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate(['date' => ['required', 'date_format:Y-m-d']]);
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json([
            'data' => $this->daily->forDate($semester, $data['date']),
            'meta' => $this->meta($semester, $settings),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $filters = $request->validate([
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d'],
            'type' => ['sometimes', Rule::enum(CalendarExceptionType::class)],
            'status' => ['sometimes', Rule::enum(OperationalStatus::class)],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ]);
        $paginator = $semester->calendarExceptions()
            ->with([
                'originalEntry.course:id,name', 'originalEntry.schoolClass:id,name',
                'originalEntry.teachingGroup:id,name', 'originalEntry.item:id,name',
                'relatedEntry.course:id,name', 'replacementTeacher:id,name',
                'replacementRoom:id,name', 'replacementItem:id,name',
                'creator:id,name',
            ])
            ->when(isset($filters['date_from']), fn ($query) => $query->whereDate('effective_date', '>=', $filters['date_from']))
            ->when(isset($filters['date_to']), fn ($query) => $query->whereDate('effective_date', '<=', $filters['date_to']))
            ->when(isset($filters['type']), fn ($query) => $query->where('type', $filters['type']))
            ->when(isset($filters['status']), fn ($query) => $query->where('status', $filters['status']))
            ->latest('effective_date')
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
        $data = $this->payload($request);
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json([
            'data' => $this->daily->previewException($semester, $data),
            'meta' => $this->meta($semester, $settings),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $data = $this->payload($request);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $preview = $this->daily->previewException($lockedSemester, $data);
            if (! $preview['allowed']) {
                throw new ApiProblemException('DAILY_EXCEPTION_CONFLICT', '临时调整存在冲突，未保存任何修改', 409, [
                    'preview' => $preview,
                ]);
            }
            $exception = CalendarException::query()->create([
                ...$data,
                'semester_id' => $lockedSemester->id,
                'timetable_version_id' => $preview['version_id'],
                'status' => OperationalStatus::Active,
                'created_by' => $actor->id,
            ]);
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record(
                $request,
                $actor,
                'create',
                'calendar_exception',
                $exception->id,
                null,
                [...$exception->toArray(), 'preview' => $preview],
            );

            return response()->json([
                'data' => $exception->load([
                    'originalEntry.course', 'relatedEntry.course', 'replacementAssignment.course',
                    'replacementTeacher', 'replacementRoom', 'replacementItem',
                ]),
                'meta' => $this->meta($lockedSemester, $settings),
            ], 201)->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function cancel(Request $request, Semester $semester, CalendarException $exception): JsonResponse
    {
        $this->assertParent($semester, $exception);

        return DB::transaction(function () use ($request, $semester, $exception): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $locked = CalendarException::query()->lockForUpdate()->findOrFail($exception->id);
            if ($locked->status === OperationalStatus::Cancelled) {
                throw new ApiProblemException('DAILY_EXCEPTION_ALREADY_CANCELLED', '该临时调整已经取消', 409);
            }
            $before = $locked->toArray();
            $locked->status = OperationalStatus::Cancelled;
            $locked->save();
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'cancel', 'calendar_exception', $locked->id, $before, $locked->toArray());

            return response()->json([
                'data' => $locked,
                'meta' => $this->meta($lockedSemester, $settings),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    /** @return array<string, mixed> */
    private function payload(Request $request): array
    {
        return $request->validate([
            'effective_date' => ['required', 'date_format:Y-m-d'],
            'replacement_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'type' => ['required', Rule::enum(CalendarExceptionType::class)],
            'original_entry_id' => ['sometimes', 'nullable', 'integer', 'exists:timetable_entries,id'],
            'related_entry_id' => ['sometimes', 'nullable', 'integer', 'different:original_entry_id', 'exists:timetable_entries,id'],
            'replacement_assignment_id' => ['sometimes', 'nullable', 'integer', 'exists:teaching_assignments,id'],
            'replacement_teacher_id' => ['sometimes', 'nullable', 'integer', Rule::exists('teachers', 'id')->where('is_active', true)],
            'replacement_room_id' => ['sometimes', 'nullable', 'integer', Rule::exists('rooms', 'id')->where('is_active', true)],
            'replacement_item_id' => ['sometimes', 'nullable', 'integer', 'exists:items,id'],
            'title' => ['sometimes', 'nullable', 'string', 'max:120'],
            'reason' => ['required', 'string', 'min:2', 'max:1000'],
        ]);
    }

    private function assertParent(Semester $semester, CalendarException $exception): void
    {
        if ($exception->semester_id !== $semester->id) {
            throw new ApiProblemException('DAILY_EXCEPTION_SEMESTER_MISMATCH', '临时调整不属于该学期', 404);
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
