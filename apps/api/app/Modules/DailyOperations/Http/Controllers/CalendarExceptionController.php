<?php

namespace App\Modules\DailyOperations\Http\Controllers;

use App\Enums\CalendarExceptionType;
use App\Enums\OperationalStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\DailyOperations\Models\CalendarException;
use App\Modules\DailyOperations\Models\Substitution;
use App\Modules\DailyOperations\Services\DailyTimetableService;
use App\Modules\DailyOperations\Services\TimetableChangeMessages;
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
        private readonly TimetableChangeMessages $messages,
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
            'q' => ['sometimes', 'nullable', 'string', 'max:100'],
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
                'originalEntry.teachingGroup:id,name', 'originalEntry.item:id,name,start_time,end_time', 'originalEntry.schoolClasses:id,name',
                'originalEntry.teacher:id,name', 'originalEntry.teachers:id,name', 'originalEntry.actualRoom:id,name',
                'relatedEntry.course:id,name', 'relatedEntry.item:id,name,start_time,end_time', 'relatedEntry.schoolClasses:id,name',
                'relatedEntry.teacher:id,name', 'relatedEntry.teachers:id,name', 'relatedEntry.actualRoom:id,name',
                'relatedEntry.schoolClass:id,name', 'relatedEntry.teachingGroup:id,name', 'replacementTeacher:id,name',
                'replacementRoom:id,name', 'replacementItem:id,name,start_time,end_time',
                'replacementAssignment.course:id,name', 'replacementAssignment.schoolClass:id,name',
                'replacementAssignment.teachingGroup:id,name', 'replacementAssignment.teacher:id,name',
                'replacementAssignment.collaborators:id,name', 'replacementAssignment.specifiedRoom:id,name',
                'creator:id,name',
            ])
            ->when(trim($filters['q'] ?? '') !== '', function ($query) use ($filters): void {
                $term = '%'.trim($filters['q']).'%';
                $query->where(function ($search) use ($term): void {
                    $search->where('reason', 'like', $term)->orWhere('title', 'like', $term);
                    foreach (['originalEntry.course', 'originalEntry.schoolClass', 'originalEntry.teachingGroup', 'originalEntry.teacher', 'originalEntry.teachers', 'relatedEntry.course', 'relatedEntry.schoolClass', 'relatedEntry.teachingGroup', 'relatedEntry.teacher', 'relatedEntry.teachers', 'replacementTeacher', 'replacementAssignment.course', 'replacementAssignment.schoolClass', 'replacementAssignment.teachingGroup', 'replacementAssignment.teacher'] as $relation) {
                        $search->orWhereHas($relation, fn ($resource) => $resource->where('name', 'like', $term));
                    }
                });
            })
            ->when(isset($filters['date_from']) || isset($filters['date_to']), function ($query) use ($filters): void {
                $query->where(function ($dates) use ($filters): void {
                    foreach (['effective_date', 'replacement_date'] as $column) {
                        $dates->orWhere(function ($range) use ($filters, $column): void {
                            $range->when(isset($filters['date_from']), fn ($start) => $start->whereDate($column, '>=', $filters['date_from']))
                                ->when(isset($filters['date_to']), fn ($end) => $end->whereDate($column, '<=', $filters['date_to']));
                        });
                    }
                });
            })
            ->when(isset($filters['type']), fn ($query) => $query->where('type', $filters['type']))
            ->when(isset($filters['status']), fn ($query) => $query->where('status', $filters['status']))
            ->latest('effective_date')
            ->latest('id')
            ->paginate((int) ($filters['per_page'] ?? 20));
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json([
            'data' => collect($paginator->items())->map(fn (CalendarException $exception): array => [...$exception->toArray(), 'messages' => $this->messages->receipts($exception->id)])->all(),
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

    public function options(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'effective_date' => ['required', 'date_format:Y-m-d'],
            'original_entry_id' => ['required', 'integer', 'exists:timetable_entries,id'],
            'type' => ['required', Rule::in(['swap', 'move', 'teacher_change'])],
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d'],
            'scope' => ['sometimes', Rule::in(['class', 'school'])],
            'target_item_id' => ['sometimes', 'integer', 'exists:items,id'],
            'target_class_id' => ['sometimes', 'integer', 'exists:school_classes,id'],
            'q' => ['sometimes', 'nullable', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:60'],
        ]);

        return response()->json($this->daily->options($semester, $data));
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
            $this->assertResultConflictFree($lockedSemester, $exception);
            if ($request->boolean('notify_teachers', true)) {
                $this->messages->publish($exception, $preview['changes']);
            }
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
                'data' => [...$exception->load([
                    'originalEntry.course', 'relatedEntry.course', 'replacementAssignment.course',
                    'replacementTeacher', 'replacementRoom', 'replacementItem',
                ])->toArray(), 'messages' => $this->messages->receipts($exception->id)],
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
            if (Substitution::query()->where('status', OperationalStatus::Active->value)
                ->whereIn('original_entry_id', array_filter([$locked->original_entry_id, $locked->related_entry_id]))
                ->whereIn('effective_date', array_unique([$locked->effective_date->toDateString(), ($locked->replacement_date ?? $locked->effective_date)->toDateString()]))->exists()) {
                throw new ApiProblemException('DAILY_EXCEPTION_HAS_SUBSTITUTIONS', '该调整之后已有代课安排，请先在请假与代课中处理后续安排，再撤回本次调整', 409);
            }
            $before = $locked->toArray();
            $locked->status = OperationalStatus::Cancelled;
            $locked->save();
            $this->assertResultConflictFree($lockedSemester, $locked);
            $this->messages->cancel($locked, $this->daily->withdrawalChanges($lockedSemester, $locked));
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'cancel', 'calendar_exception', $locked->id, $before, $locked->toArray());

            return response()->json([
                'data' => $locked,
                'meta' => $this->meta($lockedSemester, $settings),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    private function assertResultConflictFree(Semester $semester, CalendarException $exception): void
    {
        $dates = array_unique([
            $exception->effective_date->toDateString(),
            ($exception->replacement_date ?? $exception->effective_date)->toDateString(),
        ]);
        foreach ($dates as $date) {
            $this->daily->assertActualRowsConflictFree($this->daily->forDate($semester, $date)['rows'], $date);
        }
    }

    /** @return array<string, mixed> */
    private function payload(Request $request): array
    {
        $data = $request->validate([
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
            'notify_teachers' => ['sometimes', 'boolean'],
        ]);
        unset($data['notify_teachers']);
        $fields = match ($data['type']) {
            'swap' => ['original_entry_id', 'related_entry_id', 'replacement_date'],
            'move' => ['original_entry_id', 'replacement_date', 'replacement_item_id', 'replacement_teacher_id', 'replacement_room_id'],
            'makeup' => ['replacement_assignment_id', 'replacement_date', 'replacement_item_id', 'replacement_teacher_id', 'replacement_room_id'],
            'teacher_change' => ['original_entry_id', 'replacement_teacher_id'],
            'room_change' => ['original_entry_id', 'replacement_room_id'],
            'activity' => ['original_entry_id', 'title'],
            default => ['original_entry_id'],
        };

        return array_intersect_key($data, array_flip(['type', 'effective_date', 'reason', ...$fields]));
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
