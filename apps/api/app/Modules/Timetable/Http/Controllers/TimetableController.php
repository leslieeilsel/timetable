<?php

namespace App\Modules\Timetable\Http\Controllers;

use App\Enums\ResourceStatus;
use App\Enums\TaskStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use App\Modules\ScheduleTemplate\Models\Item;
use App\Modules\ScheduleTemplate\Models\ScheduleTemplateDay;
use App\Modules\TeachingTask\Models\TeachingTask;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Services\RoomResolver;
use App\Modules\Timetable\Services\TimetableConflictService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TimetableController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly RoomResolver $rooms,
        private readonly TimetableConflictService $conflicts,
    ) {}

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $filters = $request->validate([
            'view' => ['sometimes', Rule::in(['class', 'teacher', 'room'])],
            'resource_id' => ['nullable', 'integer'],
            'mode' => ['sometimes', Rule::in(['official', 'full'])],
        ]);
        $view = $filters['view'] ?? 'class';
        $mode = $filters['mode'] ?? 'official';
        $resourceId = $filters['resource_id'] ?? null;
        $settings = AppSetting::query()->findOrFail(1);
        $template = $semester->scheduleTemplate()->with(['days', 'items'])->first();
        $items = $template?->items->filter(fn (Item $item) => $item->is_active && ($mode === 'full' ? $item->show_in_full : $item->show_in_official))->values() ?? collect();
        $query = $semester->timetableEntries()->with([
            'teachingTask:id,weekly_items', 'schoolClass:id,name', 'teacher:id,name', 'course:id,name,short_name',
            'actualRoom:id,name', 'item:id,name,start_time,end_time,sort_order',
        ])->orderBy('weekday')->orderBy('item_id');
        if ($resourceId !== null) {
            $query->where($this->resourceColumn($view), $resourceId);
        }

        return response()->json(['data' => [
            'view' => $view,
            'resource_id' => $resourceId,
            'mode' => $mode,
            'days' => $template?->days->where('is_enabled', true)->values() ?? [],
            'items' => $items,
            'entries' => $query->get(),
        ], 'meta' => $this->meta($semester, $settings)])
            ->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'teaching_task_id' => ['required', 'integer'],
            'weekday' => ['required', 'integer', 'between:1,7'],
            'item_id' => ['required', 'integer'],
        ]);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $task = TeachingTask::query()->with(['semester', 'schoolClass.grade', 'teacher', 'course'])->withCount('entries')
                ->where('semester_id', $lockedSemester->id)->lockForUpdate()->findOrFail($data['teaching_task_id']);
            $this->assertPlaceable($task, $data['weekday'], $data['item_id']);
            if ($task->entries_count >= $task->weekly_items) {
                throw new ApiProblemException('TASK_WEEKLY_LIMIT_REACHED', '该教学任务已达到每周课时上限', 409);
            }
            $roomId = $this->rooms->resolve($task);
            $room = Room::query()->findOrFail($roomId);
            if (! $room->is_active) {
                throw new ApiProblemException('ROOM_INACTIVE', '教室已停用，不能新增课程', 409);
            }
            $this->conflicts->assertAvailable($lockedSemester->id, $task->school_class_id, $task->teacher_id, $roomId, $data['weekday'], $data['item_id']);
            try {
                $entry = TimetableEntry::query()->create([
                    'semester_id' => $lockedSemester->id,
                    'teaching_task_id' => $task->id,
                    'school_class_id' => $task->school_class_id,
                    'teacher_id' => $task->teacher_id,
                    'course_id' => $task->course_id,
                    'actual_room_id' => $roomId,
                    'weekday' => $data['weekday'],
                    'item_id' => $data['item_id'],
                    'source' => 'manual',
                    'is_locked' => false,
                ]);
            } catch (QueryException $exception) {
                throw $this->mapConstraint($exception);
            }
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'create', 'timetable_entry', $entry->id, null, $entry->toArray());

            return response()->json(['data' => $entry->load(['schoolClass', 'teacher', 'course', 'actualRoom', 'item']), 'meta' => $this->meta($lockedSemester, $settings)], 201)
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function update(Request $request, Semester $semester, TimetableEntry $entry): JsonResponse
    {
        $this->assertParent($semester, $entry);
        $data = $request->validate([
            'weekday' => ['required', 'integer', 'between:1,7'],
            'item_id' => ['required', 'integer'],
        ]);

        return DB::transaction(function () use ($request, $semester, $entry, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $locked = TimetableEntry::query()->with('teachingTask.semester')->lockForUpdate()->findOrFail($entry->id);
            if ($locked->is_locked) {
                throw new ApiProblemException('TIMETABLE_ENTRY_LOCKED', '课程已锁定，请先解锁', 409);
            }
            $this->assertPlaceable($locked->teachingTask, $data['weekday'], $data['item_id']);
            $this->conflicts->assertAvailable($lockedSemester->id, $locked->school_class_id, $locked->teacher_id, $locked->actual_room_id, $data['weekday'], $data['item_id'], $locked->id);
            $before = $locked->toArray();
            $locked->fill($data);
            if ($locked->isDirty()) {
                try {
                    $locked->save();
                } catch (QueryException $exception) {
                    throw $this->mapConstraint($exception);
                }
                $lockedSemester->increment('timetable_revision');
                $lockedSemester->refresh();
                $this->audit->record($request, $actor, 'move', 'timetable_entry', $locked->id, $before, $locked->toArray());
            }

            return response()->json(['data' => $locked->load(['schoolClass', 'teacher', 'course', 'actualRoom', 'item']), 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function destroy(Request $request, Semester $semester, TimetableEntry $entry): JsonResponse
    {
        $this->assertParent($semester, $entry);

        return DB::transaction(function () use ($request, $semester, $entry): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $locked = TimetableEntry::query()->lockForUpdate()->findOrFail($entry->id);
            if ($locked->is_locked) {
                throw new ApiProblemException('TIMETABLE_ENTRY_LOCKED', '课程已锁定，请先解锁', 409);
            }
            $before = $locked->toArray();
            $locked->delete();
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'delete', 'timetable_entry', $entry->id, $before, null);

            return response()->json(['data' => ['deleted_id' => $entry->id], 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function lock(Request $request, Semester $semester, TimetableEntry $entry): JsonResponse
    {
        return $this->setLocked($request, $semester, $entry, true);
    }

    public function unlock(Request $request, Semester $semester, TimetableEntry $entry): JsonResponse
    {
        return $this->setLocked($request, $semester, $entry, false);
    }

    private function setLocked(Request $request, Semester $semester, TimetableEntry $entry, bool $value): JsonResponse
    {
        $this->assertParent($semester, $entry);

        return DB::transaction(function () use ($request, $semester, $entry, $value): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $locked = TimetableEntry::query()->lockForUpdate()->findOrFail($entry->id);
            $before = $locked->toArray();
            $locked->is_locked = $value;
            if ($locked->isDirty()) {
                $locked->save();
                $lockedSemester->increment('timetable_revision');
                $lockedSemester->refresh();
                $this->audit->record($request, $actor, $value ? 'lock' : 'unlock', 'timetable_entry', $locked->id, $before, $locked->toArray());
            }

            return response()->json(['data' => $locked, 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function completeness(Semester $semester): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $items = $semester->teachingTasks()->where('status', TaskStatus::Confirmed->value)->withCount('entries')->get()->map(fn (TeachingTask $task) => [
            'teaching_task_id' => $task->id,
            'required' => $task->weekly_items,
            'scheduled' => $task->entries_count,
            'remaining' => max(0, $task->weekly_items - $task->entries_count),
            'completed' => $task->entries_count === $task->weekly_items,
        ]);

        return response()->json(['data' => $items, 'meta' => $this->meta($semester, $settings)])
            ->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function validation(Semester $semester): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $draftCount = $semester->teachingTasks()->where('status', TaskStatus::Draft->value)->count();
        $incomplete = $semester->teachingTasks()->where('status', TaskStatus::Confirmed->value)->withCount('entries')->get()
            ->filter(fn (TeachingTask $task) => $task->entries_count !== $task->weekly_items)->values();

        return response()->json(['data' => [
            'valid' => $draftCount === 0 && $incomplete->isEmpty(),
            'draft_task_count' => $draftCount,
            'incomplete_tasks' => $incomplete->map(fn (TeachingTask $task) => [
                'id' => $task->id, 'required' => $task->weekly_items, 'scheduled' => $task->entries_count,
            ]),
        ], 'meta' => $this->meta($semester, $settings)])
            ->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function export(Request $request, Semester $semester): StreamedResponse
    {
        $data = $request->validate([
            'view' => ['required', Rule::in(['class', 'teacher', 'room'])],
            'resource_id' => ['required', 'integer'],
            'mode' => ['sometimes', Rule::in(['official', 'full'])],
        ]);
        $column = $this->resourceColumn($data['view']);
        $resourceExists = match ($data['view']) {
            'class' => SchoolClass::query()->where('academic_year_id', $semester->academic_year_id)->whereKey($data['resource_id'])->exists(),
            'teacher' => Teacher::query()->whereKey($data['resource_id'])->exists(),
            'room' => Room::query()->whereKey($data['resource_id'])->exists(),
            default => throw new \LogicException('Validated timetable view is invalid.'),
        };
        if (! $resourceExists) {
            throw new ApiProblemException('TIMETABLE_RESOURCE_NOT_FOUND', '导出资源不存在或不属于该学期', 422);
        }
        $entries = $semester->timetableEntries()->where($column, $data['resource_id'])->with([
            'schoolClass:id,name', 'teacher:id,name', 'course:id,name', 'actualRoom:id,name', 'item:id,name,start_time,end_time,sort_order',
        ])->orderBy('weekday')->orderBy('item_id')->get();
        $filename = sprintf('timetable-semester-%d-%s-%d.csv', $semester->id, $data['view'], $data['resource_id']);

        return response()->streamDownload(function () use ($entries): void {
            $output = fopen('php://output', 'w');
            fwrite($output, "\xEF\xBB\xBF");
            fputcsv($output, ['星期', '课节', '时间', '班级', '课程', '教师', '教室']);
            foreach ($entries as $entry) {
                fputcsv($output, array_map([$this, 'csvSafe'], [
                    '周'.$entry->weekday,
                    $entry->item->name,
                    substr($entry->item->start_time, 0, 5).'-'.substr($entry->item->end_time, 0, 5),
                    $entry->schoolClass->name,
                    $entry->course->name,
                    $entry->teacher->name,
                    $entry->actualRoom->name,
                ]));
            }
            fclose($output);
        }, $filename, ['Content-Type' => 'text/csv; charset=utf-8', 'Cache-Control' => 'private, no-store']);
    }

    private function assertPlaceable(TeachingTask $task, int $weekday, int $itemId): void
    {
        if ($task->status !== TaskStatus::Confirmed) {
            throw new ApiProblemException('TASK_NOT_CONFIRMED', '只能安排已确认教学任务', 409);
        }
        $day = ScheduleTemplateDay::query()->where('semester_id', $task->semester_id)->where('weekday', $weekday)->first();
        $item = Item::query()->where('semester_id', $task->semester_id)->find($itemId);
        if ($day === null || ! $day->is_enabled || $item === null || ! $item->is_active || ! $item->allows_course || ! $item->counts_as_course) {
            throw new ApiProblemException('ITEM_NOT_AVAILABLE', '该星期或课节不可安排普通课程', 409);
        }
        $setting = $task->semester->classSettings()->where('school_class_id', $task->school_class_id)->first();
        if ($task->schoolClass->status !== ResourceStatus::Active || ! $task->schoolClass->grade->is_active || ! $task->teacher->is_active || ! $task->course->is_active || $setting === null || $setting->status !== ResourceStatus::Active) {
            throw new ApiProblemException('TASK_RESOURCE_INACTIVE', '班级、年级、教师、课程或本学期班级配置已停用', 409);
        }
    }

    private function mapConstraint(QueryException $exception): ApiProblemException
    {
        $message = $exception->getMessage();
        $type = str_contains($message, 'uq_timetable_teacher_slot') ? 'teacher'
            : (str_contains($message, 'uq_timetable_room_slot') ? 'room'
                : (str_contains($message, 'uq_timetable_class_slot') ? 'class' : 'task'));

        return new ApiProblemException('TIMETABLE_RESOURCE_CONFLICT', '该课节存在资源冲突', 409, ['resource_type' => $type]);
    }

    private function assertParent(Semester $semester, TimetableEntry $entry): void
    {
        if ($entry->semester_id !== $semester->id) {
            throw new ApiProblemException('ENTRY_SEMESTER_MISMATCH', '课表条目不属于该学期', 404);
        }
    }

    private function csvSafe(mixed $value): string
    {
        $text = (string) $value;
        $detected = ltrim($text, ' ');

        return preg_match('/^[=+\-@\t\r\n]/u', $detected) ? "'".$text : $text;
    }

    private function resourceColumn(mixed $view): string
    {
        return match ($view) {
            'class' => 'school_class_id',
            'teacher' => 'teacher_id',
            'room' => 'actual_room_id',
            default => throw new \LogicException('Validated timetable view is invalid.'),
        };
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
