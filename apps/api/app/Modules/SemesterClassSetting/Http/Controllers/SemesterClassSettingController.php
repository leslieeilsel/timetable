<?php

namespace App\Modules\SemesterClassSetting\Http\Controllers;

use App\Enums\ResourceStatus;
use App\Enums\RoomMode;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\SemesterClassSetting\Models\SemesterClassSetting;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\TeachingAssignment\Services\CapacityService;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Services\TimetableConflictService;
use App\Modules\Timetable\Services\TimetableVersionService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\Normalizer;
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
        private readonly TimetableVersionService $versions,
    ) {}

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['sometimes', 'string', 'max:100'],
            'grade_id' => ['sometimes', 'integer', 'exists:grades,id'],
            'status' => ['sometimes', Rule::enum(ResourceStatus::class)],
            'sort' => ['sometimes', Rule::in(['school_class_id', 'status', 'created_at'])],
            'direction' => ['sometimes', Rule::in(['asc', 'desc'])],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ]);
        $settings = AppSetting::query()->findOrFail(1);
        $query = $semester->classSettings()
            ->when(isset($filters['search']), fn ($query) => $query->whereHas(
                'schoolClass',
                fn ($classes) => $classes->where('name', 'like', '%'.Normalizer::text($filters['search']).'%'),
            ))
            ->when(isset($filters['grade_id']), fn ($query) => $query->whereHas(
                'schoolClass',
                fn ($classes) => $classes->where('grade_id', $filters['grade_id']),
            ))
            ->when(isset($filters['status']), fn ($query) => $query->where('status', $filters['status']));
        $summaryQuery = clone $query;
        $paginator = $query->with([
            'schoolClass.grade:id,name', 'fixedRoom:id,name,type,is_active', 'homeroomTeacher:id,name,employee_no,is_active',
        ])->orderBy(
            (string) ($filters['sort'] ?? 'school_class_id'),
            (string) ($filters['direction'] ?? 'asc'),
        )->orderBy('id')->paginate((int) ($filters['per_page'] ?? 20));

        return response()->json(['data' => $paginator->items(), 'meta' => [
            ...$this->meta($semester, $settings),
            'summary' => [
                'total' => (clone $summaryQuery)->count(),
                'fixed_room_count' => (clone $summaryQuery)->whereNotNull('fixed_room_id')->count(),
                'homeroom_teacher_count' => (clone $summaryQuery)->whereNotNull('homeroom_teacher_id')->count(),
            ],
            'pagination' => [
                'page' => $paginator->currentPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'last_page' => $paginator->lastPage(),
                'from' => $paginator->firstItem(),
                'to' => $paginator->lastItem(),
            ],
        ]])
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
            $hasAssignments = $existing !== null && TeachingAssignment::query()
                ->where('semester_id', $lockedSemester->id)
                ->where('school_class_id', $schoolClass->id)
                ->exists();
            if (($data['status'] ?? 'active') === 'inactive' && $hasAssignments) {
                throw new ApiProblemException('CLASS_SETTING_IN_USE', '存在任课关系时不能停用班级配置', 409);
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
                $this->bumpInputRevision($lockedSemester);
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
            if ($lockedSemester->teachingAssignments()->where('school_class_id', $schoolClass->id)->exists()) {
                throw new ApiProblemException('CLASS_SETTING_IN_USE', '存在任课关系时不能删除班级配置', 409);
            }
            $before = $record->toArray();
            $record->delete();
            $this->bumpInputRevision($lockedSemester);
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
                $this->bumpInputRevision($target);
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
            'version_id' => ['sometimes', 'integer'],
        ]);

        return DB::transaction(function () use ($request, $semester, $schoolClass, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $version = $this->versions->ensureWorkingDraft(
                $lockedSemester,
                $actor,
                isset($data['version_id']) ? (int) $data['version_id'] : null,
            );
            $record = SemesterClassSetting::query()->where('semester_id', $lockedSemester->id)
                ->where('school_class_id', $schoolClass->id)->lockForUpdate()->firstOrFail();
            $targetRoomId = (int) $data['target_room_id'];
            $assignmentIds = TeachingAssignment::query()->where('semester_id', $lockedSemester->id)
                ->where('school_class_id', $schoolClass->id)
                ->where('room_mode', RoomMode::ClassDefault->value)
                ->orderBy('id')->lockForUpdate()->pluck('id');
            $entries = TimetableEntry::query()->whereIn('teaching_assignment_id', $assignmentIds)
                ->where('timetable_version_id', $version->id)
                ->orderBy('id')->lockForUpdate()->get();
            if ($entries->contains('is_locked', true)) {
                throw new ApiProblemException('LOCKED_ENTRY_MIGRATION_FORBIDDEN', '包含已锁定课程，不能迁移班级固定教室', 409);
            }
            foreach ($entries as $entry) {
                $this->conflicts->assertAvailable(
                    $lockedSemester->id,
                    $version->id,
                    $entry->schoolClasses()->pluck('school_classes.id')->map(fn ($id) => (int) $id)->all(),
                    $entry->teachers()->pluck('teachers.id')->map(fn ($id) => (int) $id)->all(),
                    $targetRoomId,
                    $entry->weekday,
                    $entry->item_id,
                    $entry->week_pattern,
                    $entry->id,
                    $entry->active_weeks,
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
                $this->bumpInputRevision($lockedSemester);
                $version->input_revision = (int) $lockedSemester->getRawOriginal('input_revision');
                $version->save();
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

    private function bumpInputRevision(Semester $semester): void
    {
        $semester->increment('input_revision');
        $semester->increment('timetable_revision');
        $semester->refresh();
    }

    /** @return array<string, int|string> */
    private function meta(Semester $semester, AppSetting $settings): array
    {
        return [
            'semester_id' => $semester->id,
            'timetable_revision' => (string) $semester->getRawOriginal('timetable_revision'),
            'input_revision' => (string) $semester->getRawOriginal('input_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
