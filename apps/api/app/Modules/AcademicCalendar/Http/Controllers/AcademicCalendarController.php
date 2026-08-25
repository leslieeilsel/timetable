<?php

namespace App\Modules\AcademicCalendar\Http\Controllers;

use App\Enums\LifecycleStatus;
use App\Modules\AcademicCalendar\Models\AcademicYear;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\Normalizer;
use App\Support\WriteGuard;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AcademicCalendarController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
    ) {}

    public function years(): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $years = AcademicYear::query()->orderByDesc('start_date')->get()->map(fn (AcademicYear $year) => $this->yearData($year));

        return response()->json(['data' => $years])->header('ETag', $this->etags->catalog($settings));
    }

    public function storeYear(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100', 'unique:academic_years,name'],
            'start_date' => ['required', 'date_format:Y-m-d'],
            'end_date' => ['required', 'date_format:Y-m-d', 'after:start_date'],
        ]);

        return DB::transaction(function () use ($request, $data): JsonResponse {
            [$actor, $settings] = $this->guard->catalog($request);
            $year = AcademicYear::query()->create([
                'name' => Normalizer::text($data['name']),
                'start_date' => $data['start_date'],
                'end_date' => $data['end_date'],
                'status' => LifecycleStatus::Draft,
            ]);
            $settings->increment('catalog_revision');
            $settings->refresh();
            $this->audit->record($request, $actor, 'create', 'academic_year', $year->id, null, $this->yearData($year));

            return response()->json(['data' => $this->yearData($year)], 201)->header('ETag', $this->etags->catalog($settings));
        }, 3);
    }

    public function updateYear(Request $request, AcademicYear $year): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:100', Rule::unique('academic_years')->ignore($year->id)],
            'start_date' => ['sometimes', 'date_format:Y-m-d'],
            'end_date' => ['sometimes', 'date_format:Y-m-d'],
        ]);

        return DB::transaction(function () use ($request, $year, $data): JsonResponse {
            [$actor, $settings] = $this->guard->catalog($request);
            $locked = AcademicYear::query()->with('semesters')->lockForUpdate()->findOrFail($year->id);
            if ($locked->status === LifecycleStatus::Closed) {
                throw new ApiProblemException('ACADEMIC_YEAR_NOT_EDITABLE', '已关闭学年不能普通编辑', 409);
            }
            $start = CarbonImmutable::parse($data['start_date'] ?? $locked->start_date);
            $end = CarbonImmutable::parse($data['end_date'] ?? $locked->end_date);
            if ($start->greaterThanOrEqualTo($end)) {
                throw new ApiProblemException('INVALID_DATE_RANGE', '学年开始日期必须早于结束日期', 422);
            }
            foreach ($locked->semesters as $semester) {
                if ($semester->start_date->lessThan($start) || $semester->end_date->greaterThan($end)) {
                    throw new ApiProblemException('SEMESTER_OUTSIDE_YEAR', '新日期范围不能排除已有学期', 409);
                }
            }
            $before = $this->yearData($locked);
            $locked->fill([
                'name' => isset($data['name']) ? Normalizer::text($data['name']) : $locked->name,
                'start_date' => $start->toDateString(),
                'end_date' => $end->toDateString(),
            ]);
            if ($locked->isDirty()) {
                $locked->save();
                $settings->increment('catalog_revision');
                $settings->refresh();
                $this->audit->record($request, $actor, 'update', 'academic_year', $locked->id, $before, $this->yearData($locked));
            }

            return response()->json(['data' => $this->yearData($locked)])->header('ETag', $this->etags->catalog($settings));
        }, 3);
    }

    public function deleteYear(Request $request, AcademicYear $year): JsonResponse
    {
        return DB::transaction(function () use ($request, $year): JsonResponse {
            [$actor, $settings] = $this->guard->catalog($request, true);
            $locked = AcademicYear::query()->withCount(['semesters', 'schoolClasses'])->lockForUpdate()->findOrFail($year->id);
            if ($locked->status !== LifecycleStatus::Draft || $locked->semesters_count > 0 || $locked->school_classes_count > 0) {
                throw new ApiProblemException('ACADEMIC_YEAR_NOT_EMPTY', '只有完全空的草稿学年可以删除', 409);
            }
            $before = $this->yearData($locked);
            $locked->delete();
            $settings->increment('catalog_revision');
            $settings->refresh();
            $this->audit->record($request, $actor, 'delete', 'academic_year', $year->id, $before, null);

            return response()->json(['data' => ['deleted_id' => $year->id]])->header('ETag', $this->etags->catalog($settings));
        }, 3);
    }

    public function semesters(AcademicYear $year): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $items = $year->semesters()->get()->map(fn (Semester $semester) => $this->semesterData($semester, $settings));

        return response()->json(['data' => $items]);
    }

    public function storeSemester(Request $request, AcademicYear $year): JsonResponse
    {
        $data = $request->validate([
            'sequence' => ['required', 'integer', Rule::in([1, 2])],
            'start_date' => ['required', 'date_format:Y-m-d'],
            'end_date' => ['required', 'date_format:Y-m-d', 'after:start_date'],
        ]);

        return DB::transaction(function () use ($request, $year, $data): JsonResponse {
            [$actor, $settings] = $this->guard->catalog($request);
            $lockedYear = AcademicYear::query()->lockForUpdate()->findOrFail($year->id);
            if ($lockedYear->status !== LifecycleStatus::Draft) {
                throw new ApiProblemException('ACADEMIC_YEAR_NOT_DRAFT', '只能在草稿学年中创建学期', 409);
            }
            $this->assertSemesterDates($lockedYear, $data['start_date'], $data['end_date']);
            $semester = Semester::query()->create([
                'academic_year_id' => $lockedYear->id,
                'name' => $data['sequence'] === 1 ? '上学期' : '下学期',
                'sequence' => $data['sequence'],
                'start_date' => $data['start_date'],
                'end_date' => $data['end_date'],
                'status' => LifecycleStatus::Draft,
            ]);
            $settings->increment('catalog_revision');
            $settings->refresh();
            $this->audit->record($request, $actor, 'create', 'semester', $semester->id, null, $this->semesterData($semester, $settings));

            return response()->json(['data' => $this->semesterData($semester, $settings)], 201)->header('ETag', $this->etags->semester($semester, $settings));
        }, 3);
    }

    public function showSemester(Semester $semester): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $semester->load('academicYear');

        return response()->json(['data' => $this->semesterData($semester, $settings), 'meta' => $this->revisions($semester, $settings)])
            ->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function updateSemester(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'start_date' => ['sometimes', 'date_format:Y-m-d'],
            'end_date' => ['sometimes', 'date_format:Y-m-d'],
        ]);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $locked] = $this->guard->semester($request, $semester);
            $year = AcademicYear::query()->lockForUpdate()->findOrFail($locked->academic_year_id);
            $start = $data['start_date'] ?? $locked->start_date->toDateString();
            $end = $data['end_date'] ?? $locked->end_date->toDateString();
            $this->assertSemesterDates($year, $start, $end, $locked->id);
            $before = $this->semesterData($locked, $settings);
            $locked->fill(['start_date' => $start, 'end_date' => $end]);
            if ($locked->isDirty()) {
                $locked->save();
                $locked->increment('timetable_revision');
                $locked->refresh();
                $this->audit->record($request, $actor, 'update', 'semester', $locked->id, $before, $this->semesterData($locked, $settings));
            }

            return response()->json(['data' => $this->semesterData($locked, $settings), 'meta' => $this->revisions($locked, $settings)])
                ->header('ETag', $this->etags->semester($locked, $settings));
        }, 3);
    }

    public function deleteSemester(Request $request, Semester $semester): JsonResponse
    {
        return DB::transaction(function () use ($request, $semester): JsonResponse {
            [$actor, $settings, $locked] = $this->guard->semester($request, $semester, true);
            $hasData = $locked->classSettings()->exists()
                || $locked->scheduleTemplate()->exists()
                || $locked->teachingTasks()->exists()
                || $locked->timetableEntries()->exists();
            if ($locked->status !== LifecycleStatus::Draft || $hasData || $settings->current_semester_id === $locked->id) {
                throw new ApiProblemException('SEMESTER_NOT_EMPTY', '只有未开放且完全空的草稿学期可以删除', 409);
            }
            $before = $this->semesterData($locked, $settings);
            $id = $locked->id;
            $locked->delete();
            $settings->increment('catalog_revision');
            $settings->refresh();
            $this->audit->record($request, $actor, 'delete', 'semester', $id, $before, null);

            return response()->json(['data' => ['deleted_id' => $id]])
                ->header('ETag', $this->etags->catalog($settings));
        }, 3);
    }

    public function openYear(Request $request, AcademicYear $year): JsonResponse
    {
        return $this->changeYearStatus($request, $year, LifecycleStatus::Open);
    }

    public function closeYear(Request $request, AcademicYear $year): JsonResponse
    {
        return $this->changeYearStatus($request, $year, LifecycleStatus::Closed);
    }

    public function reopenYear(Request $request, AcademicYear $year): JsonResponse
    {
        return $this->changeYearStatus($request, $year, LifecycleStatus::Open, true);
    }

    private function changeYearStatus(Request $request, AcademicYear $year, LifecycleStatus $target, bool $adminOnly = false): JsonResponse
    {
        return DB::transaction(function () use ($request, $year, $target, $adminOnly): JsonResponse {
            [$actor, $settings] = $this->guard->catalog($request, $adminOnly);
            $locked = AcademicYear::query()->with('semesters')->lockForUpdate()->findOrFail($year->id);
            if ($target === LifecycleStatus::Open) {
                $expected = $adminOnly ? LifecycleStatus::Closed : LifecycleStatus::Draft;
                if ($locked->status !== $expected) {
                    throw new ApiProblemException('ACADEMIC_YEAR_STATUS_TRANSITION_INVALID', '学年状态迁移无效', 409);
                }
            } elseif ($locked->status !== LifecycleStatus::Open) {
                throw new ApiProblemException('ACADEMIC_YEAR_STATUS_TRANSITION_INVALID', '只有开放学年可以关闭', 409);
            }
            if ($target === LifecycleStatus::Open && $locked->status === LifecycleStatus::Draft) {
                $sequences = $locked->semesters->pluck('sequence')->sort()->values()->all();
                if ($sequences !== [1, 2]) {
                    throw new ApiProblemException('ACADEMIC_YEAR_REQUIRES_TWO_SEMESTERS', '开放学年前必须恰好创建上下两个学期', 409);
                }
            }
            if ($target === LifecycleStatus::Closed && $locked->semesters->contains(fn (Semester $semester) => $semester->status !== LifecycleStatus::Closed)) {
                throw new ApiProblemException('ACADEMIC_YEAR_HAS_OPEN_SEMESTER', '所有学期关闭后才能关闭学年', 409);
            }
            $before = $this->yearData($locked);
            $locked->status = $target;
            if ($locked->isDirty()) {
                $locked->save();
                $settings->increment('catalog_revision');
                $settings->refresh();
                $this->audit->record($request, $actor, $target->value, 'academic_year', $locked->id, $before, $this->yearData($locked));
            }

            return response()->json(['data' => $this->yearData($locked)])->header('ETag', $this->etags->catalog($settings));
        }, 3);
    }

    public function openSemester(Request $request, Semester $semester): JsonResponse
    {
        return $this->changeSemesterStatus($request, $semester, LifecycleStatus::Open);
    }

    public function closeSemester(Request $request, Semester $semester): JsonResponse
    {
        $request->validate([
            'reason' => ['nullable', 'string', 'max:500'],
            'replacement_semester_id' => ['nullable', 'integer', 'exists:semesters,id'],
        ]);

        return $this->changeSemesterStatus($request, $semester, LifecycleStatus::Closed);
    }

    public function reopenSemester(Request $request, Semester $semester): JsonResponse
    {
        $request->validate(['reason' => ['required', 'string', 'max:500']]);

        return $this->changeSemesterStatus($request, $semester, LifecycleStatus::Open, true);
    }

    private function changeSemesterStatus(Request $request, Semester $semester, LifecycleStatus $target, bool $adminOnly = false): JsonResponse
    {
        return DB::transaction(function () use ($request, $semester, $target, $adminOnly): JsonResponse {
            [$actor, $settings, $locked] = $this->guard->semester(
                $request,
                $semester,
                $adminOnly,
                false,
                $adminOnly && $target === LifecycleStatus::Open,
            );
            if ($target === LifecycleStatus::Open) {
                $expected = $adminOnly ? LifecycleStatus::Closed : LifecycleStatus::Draft;
                if ($locked->status !== $expected) {
                    throw new ApiProblemException('SEMESTER_STATUS_TRANSITION_INVALID', '学期状态迁移无效', 409);
                }
            } elseif ($locked->status !== LifecycleStatus::Open) {
                throw new ApiProblemException('SEMESTER_STATUS_TRANSITION_INVALID', '只有开放学期可以关闭', 409);
            }
            $year = AcademicYear::query()->lockForUpdate()->findOrFail($locked->academic_year_id);
            if ($target === LifecycleStatus::Open) {
                if ($year->status !== LifecycleStatus::Open) {
                    throw new ApiProblemException('ACADEMIC_YEAR_NOT_OPEN', '所属学年开放后才能开放学期', 409);
                }
                $template = $locked->scheduleTemplate()->with(['days', 'items'])->first();
                if ($template === null || $template->days->count() !== 7 || ! $template->days->contains('is_enabled', true) || ! $template->items->contains(fn ($item) => $item->is_active && $item->allows_course)) {
                    throw new ApiProblemException('SCHEDULE_TEMPLATE_INCOMPLETE', '作息模板不完整，无法开放学期', 409);
                }
            }
            if ($target === LifecycleStatus::Closed) {
                $incomplete = $locked->teachingTasks()->where('status', 'draft')->exists()
                    || $locked->teachingTasks()->where('status', 'confirmed')->withCount('entries')->get()->contains(fn ($task) => $task->entries_count !== $task->weekly_items);
                if ($incomplete && ! ($request->user()->role->value === 'admin' && $request->filled('reason'))) {
                    throw new ApiProblemException('SEMESTER_INCOMPLETE', '存在草稿或未排满教学任务，不能关闭学期', 409);
                }
                if ($settings->current_semester_id === $locked->id) {
                    $replacementId = $request->input('replacement_semester_id');
                    $replacement = $replacementId ? Semester::query()->lockForUpdate()->find($replacementId) : null;
                    if ($replacement !== null && $replacement->status !== LifecycleStatus::Open) {
                        throw new ApiProblemException('CURRENT_SEMESTER_MUST_BE_OPEN', '替代当前学期必须处于开放状态', 409);
                    }
                    $settings->current_semester_id = $replacement?->id;
                    $settings->save();
                }
            }
            $before = $this->semesterData($locked, $settings);
            $locked->status = $target;
            if ($locked->isDirty()) {
                $locked->save();
                $locked->increment('timetable_revision');
                $locked->refresh();
                $this->audit->record($request, $actor, $target->value, 'semester', $locked->id, $before, array_merge($this->semesterData($locked, $settings), ['reason' => $request->input('reason')]));
            }

            return response()->json(['data' => $this->semesterData($locked, $settings), 'meta' => $this->revisions($locked, $settings)])
                ->header('ETag', $this->etags->semester($locked, $settings));
        }, 3);
    }

    private function assertSemesterDates(AcademicYear $year, string $start, string $end, ?int $ignoreId = null): void
    {
        $startDate = CarbonImmutable::parse($start);
        $endDate = CarbonImmutable::parse($end);
        if ($startDate->greaterThanOrEqualTo($endDate) || $startDate->lessThan($year->start_date) || $endDate->greaterThan($year->end_date)) {
            throw new ApiProblemException('SEMESTER_DATE_INVALID', '学期日期必须位于学年范围内，且开始早于结束', 422);
        }
        $overlap = Semester::query()->where('academic_year_id', $year->id)
            ->when($ignoreId, fn ($query) => $query->whereKeyNot($ignoreId))
            ->whereDate('start_date', '<=', $end)
            ->whereDate('end_date', '>=', $start)
            ->exists();
        if ($overlap) {
            throw new ApiProblemException('SEMESTER_DATE_OVERLAP', '同一学年内的学期日期不能重叠', 409);
        }
    }

    /** @return array<string, mixed> */
    private function yearData(AcademicYear $year): array
    {
        return [
            'id' => $year->id,
            'name' => $year->name,
            'start_date' => $year->start_date->toDateString(),
            'end_date' => $year->end_date->toDateString(),
            'status' => $year->status->value,
        ];
    }

    /** @return array<string, mixed> */
    private function semesterData(Semester $semester, AppSetting $settings): array
    {
        $data = [
            'id' => $semester->id,
            'academic_year_id' => $semester->academic_year_id,
            'name' => $semester->name,
            'sequence' => $semester->sequence,
            'start_date' => $semester->start_date->toDateString(),
            'end_date' => $semester->end_date->toDateString(),
            'status' => $semester->status->value,
            'etag' => $this->etags->semester($semester, $settings),
        ];

        if ($semester->relationLoaded('academicYear')) {
            $data['academic_year'] = $this->yearData($semester->academicYear);
        }

        return $data;
    }

    /** @return array<string, string|int> */
    private function revisions(Semester $semester, AppSetting $settings): array
    {
        return [
            'semester_id' => $semester->id,
            'timetable_revision' => (string) $semester->getRawOriginal('timetable_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
