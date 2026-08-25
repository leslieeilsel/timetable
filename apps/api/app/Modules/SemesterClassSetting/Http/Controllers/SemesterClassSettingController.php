<?php

namespace App\Modules\SemesterClassSetting\Http\Controllers;

use App\Enums\ResourceStatus;
use App\Enums\RoomMode;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\SemesterClassSetting\Models\SemesterClassSetting;
use App\Modules\TeachingTask\Models\TeachingTask;
use App\Modules\TeachingTask\Services\CapacityService;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Services\TimetableConflictService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SemesterClassSettingController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly CapacityService $capacity,
        private readonly TimetableConflictService $conflicts,
    ) {}

    public function index(Semester $semester): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $items = $semester->classSettings()->with([
            'schoolClass.grade:id,name', 'fixedRoom:id,name,type,is_active', 'homeroomTeacher:id,name,employee_no,is_active',
        ])->orderBy('school_class_id')->get();

        return response()->json(['data' => $items, 'meta' => $this->meta($semester, $settings)])
            ->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function put(Request $request, Semester $semester, SchoolClass $schoolClass): JsonResponse
    {
        if ($schoolClass->academic_year_id !== $semester->academic_year_id) {
            throw new ApiProblemException('CLASS_YEAR_MISMATCH', '班级与学期不属于同一学年', 422);
        }
        $data = $request->validate([
            'fixed_room_id' => ['nullable', 'integer', 'exists:rooms,id'],
            'homeroom_teacher_id' => ['nullable', 'integer', 'exists:teachers,id'],
            'status' => ['sometimes', 'in:active,inactive'],
        ]);

        return DB::transaction(function () use ($request, $semester, $schoolClass, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $existing = SemesterClassSetting::query()->where('semester_id', $lockedSemester->id)
                ->where('school_class_id', $schoolClass->id)->lockForUpdate()->first();
            $hasTasks = $existing !== null && TeachingTask::query()
                ->where('semester_id', $lockedSemester->id)
                ->where('school_class_id', $schoolClass->id)
                ->exists();
            if (($data['status'] ?? 'active') === 'inactive' && $hasTasks) {
                throw new ApiProblemException('CLASS_SETTING_IN_USE', '存在教学任务时不能停用班级配置', 409);
            }
            $before = $existing?->toArray();
            $record = SemesterClassSetting::query()->updateOrCreate(
                ['semester_id' => $lockedSemester->id, 'school_class_id' => $schoolClass->id],
                [
                    'academic_year_id' => $lockedSemester->academic_year_id,
                    'fixed_room_id' => $data['fixed_room_id'] ?? null,
                    'homeroom_teacher_id' => $data['homeroom_teacher_id'] ?? null,
                    'status' => $data['status'] ?? ResourceStatus::Active->value,
                ],
            );
            if ($before !== $record->toArray()) {
                $lockedSemester->increment('timetable_revision');
                $lockedSemester->refresh();
                $this->audit->record($request, $actor, $existing === null ? 'create' : 'update', 'semester_class_setting', $record->id, $before, $record->toArray());
            }

            return response()->json(['data' => $record->load(['schoolClass.grade:id,name', 'fixedRoom:id,name,type,is_active', 'homeroomTeacher:id,name,employee_no,is_active']), 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function destroy(Request $request, Semester $semester, SchoolClass $schoolClass): JsonResponse
    {
        return DB::transaction(function () use ($request, $semester, $schoolClass): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $record = SemesterClassSetting::query()->where('semester_id', $lockedSemester->id)
                ->where('school_class_id', $schoolClass->id)->lockForUpdate()->firstOrFail();
            if ($lockedSemester->teachingTasks()->where('school_class_id', $schoolClass->id)->exists()) {
                throw new ApiProblemException('CLASS_SETTING_IN_USE', '存在教学任务时不能删除班级配置', 409);
            }
            $before = $record->toArray();
            $record->delete();
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'delete', 'semester_class_setting', $record->id, $before, null);

            return response()->json(['data' => ['deleted_class_id' => $schoolClass->id], 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function copy(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate(['source_semester_id' => ['required', 'integer', 'exists:semesters,id']]);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $target] = $this->guard->semester($request, $semester);
            $source = Semester::query()->with('classSettings')->lockForUpdate()->findOrFail($data['source_semester_id']);
            if ($source->academic_year_id !== $target->academic_year_id || $source->sequence >= $target->sequence) {
                throw new ApiProblemException('COPY_SOURCE_INVALID', '只能从同一学年较早学期复制', 422);
            }
            $conflicts = $target->classSettings()->whereIn('school_class_id', $source->classSettings->pluck('school_class_id'))->pluck('school_class_id');
            if ($conflicts->isNotEmpty()) {
                throw new ApiProblemException('COPY_TARGET_CONFLICT', '目标学期已存在部分班级配置', 409, ['class_ids' => $conflicts]);
            }
            foreach ($source->classSettings as $setting) {
                SemesterClassSetting::query()->create([
                    'semester_id' => $target->id,
                    'academic_year_id' => $target->academic_year_id,
                    'school_class_id' => $setting->school_class_id,
                    'fixed_room_id' => $setting->fixed_room_id,
                    'homeroom_teacher_id' => $setting->homeroom_teacher_id,
                    'status' => $setting->status,
                ]);
            }
            if ($source->classSettings->isNotEmpty()) {
                $target->increment('timetable_revision');
                $target->refresh();
                $this->audit->record($request, $actor, 'copy', 'semester_class_setting', $target->id, null, ['source_semester_id' => $source->id, 'count' => $source->classSettings->count()]);
            }

            return response()->json(['data' => ['copied' => $source->classSettings->count()], 'meta' => $this->meta($target, $settings)])
                ->header('ETag', $this->etags->semester($target, $settings));
        }, 3);
    }

    public function migrateRoom(Request $request, Semester $semester, SchoolClass $schoolClass): JsonResponse
    {
        if ($schoolClass->academic_year_id !== $semester->academic_year_id) {
            throw new ApiProblemException('CLASS_YEAR_MISMATCH', '班级与学期不属于同一学年', 422);
        }
        $data = $request->validate([
            'target_room_id' => ['required', 'integer', Rule::exists('rooms', 'id')->where('is_active', true)],
        ]);

        return DB::transaction(function () use ($request, $semester, $schoolClass, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $record = SemesterClassSetting::query()->where('semester_id', $lockedSemester->id)
                ->where('school_class_id', $schoolClass->id)->lockForUpdate()->firstOrFail();
            $targetRoomId = (int) $data['target_room_id'];
            $taskIds = TeachingTask::query()->where('semester_id', $lockedSemester->id)
                ->where('school_class_id', $schoolClass->id)
                ->where('room_mode', RoomMode::ClassDefault->value)
                ->orderBy('id')->lockForUpdate()->pluck('id');
            $entries = TimetableEntry::query()->whereIn('teaching_task_id', $taskIds)
                ->orderBy('id')->lockForUpdate()->get();
            if ($entries->contains('is_locked', true)) {
                throw new ApiProblemException('LOCKED_ENTRY_MIGRATION_FORBIDDEN', '包含已锁定课程，不能迁移班级固定教室', 409);
            }
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
            $before = ['fixed_room_id' => $record->fixed_room_id, 'entry_ids' => $entries->pluck('id')->all()];
            $changed = $record->fixed_room_id !== $targetRoomId;
            if ($changed) {
                $record->fixed_room_id = $targetRoomId;
                $record->save();
                TimetableEntry::query()->whereIn('id', $entries->pluck('id'))->update([
                    'actual_room_id' => $targetRoomId,
                    'updated_at' => now(),
                ]);
                $this->capacity->assertCanConfirm($lockedSemester, collect());
                $lockedSemester->increment('timetable_revision');
                $lockedSemester->refresh();
                $this->audit->record($request, $actor, 'migrate_room', 'semester_class_setting', $record->id, $before, [
                    'fixed_room_id' => $targetRoomId,
                    'entry_ids' => $entries->pluck('id')->all(),
                ]);
            }

            return response()->json(['data' => [
                'school_class_id' => $schoolClass->id,
                'target_room_id' => $targetRoomId,
                'migrated_entries' => $entries->count(),
                'changed' => $changed,
            ], 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
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
