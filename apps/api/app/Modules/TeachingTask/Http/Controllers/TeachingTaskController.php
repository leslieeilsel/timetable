<?php

namespace App\Modules\TeachingTask\Http\Controllers;

use App\Enums\ResourceStatus;
use App\Enums\RoomMode;
use App\Enums\TaskStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Resources\Models\Course;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use App\Modules\SemesterClassSetting\Models\SemesterClassSetting;
use App\Modules\TeachingTask\Models\TeachingTask;
use App\Modules\TeachingTask\Services\CapacityService;
use App\Modules\Timetable\Services\RoomResolver;
use App\Modules\Timetable\Services\TimetableConflictService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TeachingTaskController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly CapacityService $capacity,
        private readonly RoomResolver $rooms,
        private readonly TimetableConflictService $conflicts,
    ) {}

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $query = $semester->teachingTasks()->with([
            'schoolClass.grade:id,name', 'course:id,name,short_name,is_active', 'teacher:id,name,employee_no,is_active',
            'specifiedRoom:id,name,is_active',
        ])->withCount('entries')->orderBy('school_class_id')->orderBy('course_id');
        foreach (['school_class_id', 'teacher_id', 'course_id', 'status'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->input($filter));
            }
        }
        $items = $query->get()->map(function (TeachingTask $task): array {
            $data = $task->toArray();
            $data['scheduled'] = $task->entries_count;
            $data['remaining'] = max(0, $task->weekly_items - $task->entries_count);
            $data['completed'] = $task->status === TaskStatus::Confirmed && $task->entries_count === $task->weekly_items;

            return $data;
        });

        return response()->json(['data' => $items, 'meta' => $this->meta($semester, $settings)])
            ->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $data = $this->validateTask($request, $semester);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $this->assertClassSetting($lockedSemester, $data['school_class_id']);
            $task = TeachingTask::query()->create(array_merge($data, [
                'semester_id' => $lockedSemester->id,
                'academic_year_id' => $lockedSemester->academic_year_id,
                'status' => TaskStatus::Draft,
            ]));
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'create', 'teaching_task', $task->id, null, $task->toArray());

            return response()->json(['data' => $task->load(['schoolClass.grade', 'course', 'teacher', 'specifiedRoom']), 'meta' => $this->meta($lockedSemester, $settings)], 201)
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function update(Request $request, Semester $semester, TeachingTask $task): JsonResponse
    {
        $this->assertParent($semester, $task);
        $data = $request->validate([
            'school_class_id' => ['sometimes', 'integer', Rule::exists('school_classes', 'id')->where('academic_year_id', $semester->academic_year_id)],
            'course_id' => ['sometimes', 'integer', 'exists:courses,id'],
            'teacher_id' => ['sometimes', 'integer', 'exists:teachers,id'],
            'weekly_items' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'room_mode' => ['sometimes', Rule::enum(RoomMode::class)],
            'specified_room_id' => ['sometimes', 'nullable', 'integer', 'exists:rooms,id'],
        ]);

        return DB::transaction(function () use ($request, $semester, $task, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = TeachingTask::query()->withCount('entries')->lockForUpdate()->findOrFail($task->id);
            if ($locked->entries_count > 0 && collect(['school_class_id', 'course_id', 'teacher_id', 'room_mode', 'specified_room_id'])->contains(fn ($field) => array_key_exists($field, $data))) {
                throw new ApiProblemException('TASK_HAS_ENTRIES', '已有课程时不能修改班级、课程、教师或教室规则', 409);
            }
            if (isset($data['weekly_items']) && $data['weekly_items'] < $locked->entries_count) {
                throw new ApiProblemException('WEEKLY_ITEMS_BELOW_SCHEDULED', '每周课时不能低于已排课时', 422);
            }
            $merged = array_merge($locked->only(['school_class_id', 'course_id', 'teacher_id', 'weekly_items', 'room_mode', 'specified_room_id']), $data);
            $this->assertRoomMode($merged);
            $this->assertClassSetting($lockedSemester, (int) $merged['school_class_id']);
            $before = $locked->toArray();
            $locked->fill($data);
            if ($locked->isDirty()) {
                $locked->save();
                if ($locked->status === TaskStatus::Confirmed) {
                    $this->capacity->assertCanConfirm($lockedSemester, collect([$locked]));
                }
                $lockedSemester->increment('timetable_revision');
                $lockedSemester->refresh();
                $this->audit->record($request, $actor, 'update', 'teaching_task', $locked->id, $before, $locked->toArray());
            }

            return response()->json(['data' => $locked->load(['schoolClass.grade', 'course', 'teacher', 'specifiedRoom']), 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function confirm(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate(['task_ids' => ['required', 'array', 'min:1'], 'task_ids.*' => ['integer', 'distinct']]);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $tasks = TeachingTask::query()->where('semester_id', $lockedSemester->id)->whereIn('id', $data['task_ids'])->orderBy('id')->lockForUpdate()->get();
            if ($tasks->count() !== count($data['task_ids']) || $tasks->contains(fn (TeachingTask $task) => $task->status !== TaskStatus::Draft)) {
                throw new ApiProblemException('TASK_CONFIRM_SELECTION_INVALID', '只能批量确认本学期的草稿任务', 409);
            }
            foreach ($tasks as $task) {
                $this->assertResourcesActive($task);
                $this->rooms->resolve($task);
            }
            $this->capacity->assertCanConfirm($lockedSemester, $tasks);
            TeachingTask::query()->whereIn('id', $tasks->pluck('id'))->update(['status' => TaskStatus::Confirmed->value, 'updated_at' => now()]);
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'confirm', 'teaching_task', $lockedSemester->id, null, ['task_ids' => $tasks->pluck('id')->all()]);

            return response()->json(['data' => ['confirmed_ids' => $tasks->pluck('id')->all()], 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function unconfirm(Request $request, Semester $semester, TeachingTask $task): JsonResponse
    {
        return $this->transition($request, $semester, $task, TaskStatus::Draft, [TaskStatus::Confirmed]);
    }

    public function deactivate(Request $request, Semester $semester, TeachingTask $task): JsonResponse
    {
        return $this->transition($request, $semester, $task, TaskStatus::Inactive, [TaskStatus::Draft, TaskStatus::Confirmed]);
    }

    public function restore(Request $request, Semester $semester, TeachingTask $task): JsonResponse
    {
        return $this->transition($request, $semester, $task, TaskStatus::Draft, [TaskStatus::Inactive]);
    }

    /** @param list<TaskStatus> $allowed */
    private function transition(Request $request, Semester $semester, TeachingTask $task, TaskStatus $target, array $allowed): JsonResponse
    {
        $this->assertParent($semester, $task);

        return DB::transaction(function () use ($request, $semester, $task, $target, $allowed): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $locked = TeachingTask::query()->withCount('entries')->lockForUpdate()->findOrFail($task->id);
            if (! in_array($locked->status, $allowed, true)) {
                throw new ApiProblemException('TASK_STATUS_TRANSITION_INVALID', '教学任务状态迁移无效', 409);
            }
            if ($locked->entries_count > 0 && $locked->status === TaskStatus::Confirmed) {
                throw new ApiProblemException('TASK_HAS_ENTRIES', '已有课程时不能退回草稿或停用', 409);
            }
            $before = $locked->toArray();
            $locked->status = $target;
            $locked->save();
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, $target->value, 'teaching_task', $locked->id, $before, $locked->toArray());

            return response()->json(['data' => $locked, 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function destroy(Request $request, Semester $semester, TeachingTask $task): JsonResponse
    {
        $this->assertParent($semester, $task);

        return DB::transaction(function () use ($request, $semester, $task): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = TeachingTask::query()->withCount('entries')->lockForUpdate()->findOrFail($task->id);
            if ($locked->entries_count > 0) {
                throw new ApiProblemException('TASK_HAS_ENTRIES', '已有课程的教学任务不能删除', 409);
            }
            $before = $locked->toArray();
            $locked->delete();
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'delete', 'teaching_task', $task->id, $before, null);

            return response()->json(['data' => ['deleted_id' => $task->id], 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function copy(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'source_semester_id' => ['required', 'integer', 'exists:semesters,id'],
            'task_ids' => ['required', 'array', 'min:1'],
            'task_ids.*' => ['integer', 'distinct'],
        ]);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $target] = $this->guard->semester($request, $semester);
            $source = Semester::query()->lockForUpdate()->findOrFail($data['source_semester_id']);
            if ($source->academic_year_id !== $target->academic_year_id || $source->sequence >= $target->sequence) {
                throw new ApiProblemException('COPY_SOURCE_INVALID', '只能从同一学年较早学期复制', 422);
            }
            $tasks = TeachingTask::query()->where('semester_id', $source->id)->where('status', TaskStatus::Confirmed->value)
                ->whereIn('id', $data['task_ids'])->orderBy('id')->lockForUpdate()->get();
            if ($tasks->count() !== count($data['task_ids'])) {
                throw new ApiProblemException('COPY_TASK_SELECTION_INVALID', '只能复制来源学期已确认任务', 422);
            }
            $targetClassIds = $target->classSettings()->pluck('school_class_id');
            if ($tasks->contains(fn (TeachingTask $task) => ! $targetClassIds->contains($task->school_class_id))) {
                throw new ApiProblemException('TARGET_CLASS_SETTING_MISSING', '目标学期缺少对应班级配置', 409);
            }
            $conflicts = $target->teachingTasks()->where(function ($query) use ($tasks): void {
                foreach ($tasks as $task) {
                    $query->orWhere(fn ($q) => $q->where('school_class_id', $task->school_class_id)->where('course_id', $task->course_id));
                }
            })->get(['school_class_id', 'course_id']);
            if ($conflicts->isNotEmpty()) {
                throw new ApiProblemException('COPY_TARGET_CONFLICT', '目标学期已存在同班同科任务', 409, ['conflicts' => $conflicts]);
            }
            $created = [];
            foreach ($tasks as $sourceTask) {
                $created[] = TeachingTask::query()->create(array_merge($sourceTask->only([
                    'school_class_id', 'course_id', 'teacher_id', 'weekly_items', 'room_mode', 'specified_room_id',
                ]), [
                    'semester_id' => $target->id,
                    'academic_year_id' => $target->academic_year_id,
                    'status' => TaskStatus::Draft,
                ]));
            }
            $target->increment('timetable_revision');
            $target->refresh();
            $this->audit->record($request, $actor, 'copy', 'teaching_task', $target->id, null, ['source_semester_id' => $source->id, 'task_ids' => collect($created)->pluck('id')->all()]);

            return response()->json(['data' => $created, 'meta' => $this->meta($target, $settings)], 201)
                ->header('ETag', $this->etags->semester($target, $settings));
        }, 3);
    }

    public function migrateRoom(Request $request, Semester $semester, TeachingTask $task): JsonResponse
    {
        $this->assertParent($semester, $task);
        $data = $request->validate([
            'target_room_id' => ['required', 'integer', Rule::exists('rooms', 'id')->where('is_active', true)],
        ]);

        return DB::transaction(function () use ($request, $semester, $task, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = TeachingTask::query()->lockForUpdate()->findOrFail($task->id);
            $entries = $locked->entries()->orderBy('id')->lockForUpdate()->get();
            if ($entries->contains('is_locked', true)) {
                throw new ApiProblemException('LOCKED_ENTRY_MIGRATION_FORBIDDEN', '包含已锁定课程，不能迁移教学任务教室', 409);
            }
            $targetRoomId = (int) $data['target_room_id'];
            foreach ($entries as $entry) {
                $this->conflicts->assertAvailable(
                    $lockedSemester->id,
                    $entry->school_class_id,
                    $entry->teacher_id,
                    $targetRoomId,
                    $entry->weekday,
                    $entry->item_id,
                    $entry->id,
                );
            }
            $before = [
                'room_mode' => $locked->room_mode->value,
                'specified_room_id' => $locked->specified_room_id,
                'entry_ids' => $entries->pluck('id')->all(),
            ];
            $changed = $locked->room_mode !== RoomMode::Specified || $locked->specified_room_id !== $targetRoomId;
            if ($changed) {
                $locked->room_mode = RoomMode::Specified;
                $locked->specified_room_id = $targetRoomId;
                $locked->save();
                $locked->entries()->update(['actual_room_id' => $targetRoomId, 'updated_at' => now()]);
                if ($locked->status === TaskStatus::Confirmed) {
                    $this->capacity->assertCanConfirm($lockedSemester, collect([$locked]));
                }
                $lockedSemester->increment('timetable_revision');
                $lockedSemester->refresh();
                $this->audit->record($request, $actor, 'migrate_room', 'teaching_task', $locked->id, $before, [
                    'room_mode' => RoomMode::Specified->value,
                    'specified_room_id' => $targetRoomId,
                    'entry_ids' => $entries->pluck('id')->all(),
                ]);
            }

            return response()->json(['data' => [
                'task_id' => $locked->id,
                'target_room_id' => $targetRoomId,
                'migrated_entries' => $entries->count(),
                'changed' => $changed,
            ], 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    /** @return array<string, mixed> */
    private function validateTask(Request $request, Semester $semester): array
    {
        $data = $request->validate([
            'school_class_id' => ['required', 'integer', Rule::exists('school_classes', 'id')->where('academic_year_id', $semester->academic_year_id)],
            'course_id' => ['required', 'integer', 'exists:courses,id'],
            'teacher_id' => ['required', 'integer', 'exists:teachers,id'],
            'weekly_items' => ['required', 'integer', 'min:1', 'max:100'],
            'room_mode' => ['required', Rule::enum(RoomMode::class)],
            'specified_room_id' => ['nullable', 'integer', 'exists:rooms,id'],
        ]);
        $this->assertRoomMode($data);

        return $data;
    }

    /** @param array<string, mixed> $data */
    private function assertRoomMode(array $data): void
    {
        $mode = $data['room_mode'] instanceof RoomMode ? $data['room_mode']->value : $data['room_mode'];
        $roomId = $data['specified_room_id'] ?? null;
        if (($mode === RoomMode::Specified->value) !== ($roomId !== null)) {
            throw new ApiProblemException('TASK_ROOM_MODE_INVALID', '指定教室模式必须选择教室，固定教室模式不能指定教室', 422);
        }
    }

    private function assertClassSetting(Semester $semester, int $classId): void
    {
        if (! SemesterClassSetting::query()->where('semester_id', $semester->id)->where('school_class_id', $classId)->exists()) {
            throw new ApiProblemException('CLASS_SETTING_REQUIRED', '创建教学任务前必须先配置本学期班级', 409);
        }
    }

    private function assertResourcesActive(TeachingTask $task): void
    {
        $class = SchoolClass::query()->with('grade')->findOrFail($task->school_class_id);
        $teacher = Teacher::query()->findOrFail($task->teacher_id);
        $course = Course::query()->findOrFail($task->course_id);
        $setting = SemesterClassSetting::query()->where('semester_id', $task->semester_id)->where('school_class_id', $task->school_class_id)->firstOrFail();
        $roomId = $this->rooms->resolve($task);
        $room = Room::query()->findOrFail($roomId);
        if ($class->status !== ResourceStatus::Active || ! $class->grade->is_active || ! $teacher->is_active || ! $course->is_active || $setting->status !== ResourceStatus::Active || ! $room->is_active) {
            throw new ApiProblemException('TASK_RESOURCE_INACTIVE', '班级、年级、教师、课程、班级配置或教室已停用', 409, ['task_id' => $task->id]);
        }
    }

    private function assertParent(Semester $semester, TeachingTask $task): void
    {
        if ($task->semester_id !== $semester->id) {
            throw new ApiProblemException('TASK_SEMESTER_MISMATCH', '教学任务不属于该学期', 404);
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
