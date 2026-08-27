<?php

namespace App\Modules\TeachingAssignment\Http\Controllers;

use App\Enums\AssignmentStatus;
use App\Enums\ResourceStatus;
use App\Enums\TeachingGroupMode;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\SemesterClassSetting\Models\SemesterClassSetting;
use App\Modules\TeachingAssignment\Models\TeachingGroup;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\Normalizer;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TeachingGroupController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
    ) {}

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $filters = $request->validate([
            'status' => ['sometimes', Rule::enum(ResourceStatus::class)],
            'search' => ['sometimes', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ]);
        $query = $semester->teachingGroups()
            ->with(['schoolClasses.grade:id,name'])
            ->withCount('assignments')
            ->orderBy('name');
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['search'])) {
            $search = Normalizer::text($filters['search']);
            $query->where(function ($query) use ($search): void {
                $query->where('name', 'like', '%'.$search.'%')
                    ->orWhereHas('schoolClasses', fn ($classes) => $classes
                        ->where('school_classes.name', 'like', '%'.$search.'%'));
            });
        }
        $paginator = $query->paginate((int) ($filters['per_page'] ?? 20));

        return response()->json(['data' => $paginator->items(), 'meta' => [
            ...$this->meta($semester, $settings),
            'pagination' => [
                'page' => $paginator->currentPage(), 'per_page' => $paginator->perPage(),
                'total' => $paginator->total(), 'last_page' => $paginator->lastPage(),
                'from' => $paginator->firstItem(), 'to' => $paginator->lastItem(),
            ],
        ]])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $data = $this->validateGroup($request, $semester);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $this->assertClassesConfigured($lockedSemester, $data['school_class_ids']);
            $group = TeachingGroup::query()->create([
                'semester_id' => $lockedSemester->id,
                'name' => Normalizer::text($data['name']),
                'mode' => $data['mode'],
                'status' => ResourceStatus::Active,
            ]);
            $group->schoolClasses()->sync($data['school_class_ids']);
            $this->bumpAssignmentRevision($lockedSemester);
            $after = $group->toArray();
            $after['school_class_ids'] = $data['school_class_ids'];
            $this->audit->record($request, $actor, 'create', 'teaching_group', $group->id, null, $after);

            return response()->json(['data' => $this->load($group), 'meta' => $this->meta($lockedSemester, $settings)], 201)
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function update(Request $request, Semester $semester, TeachingGroup $group): JsonResponse
    {
        $this->assertParent($semester, $group);
        $data = $this->validateGroup($request, $semester, $group, true);

        return DB::transaction(function () use ($request, $semester, $group, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = TeachingGroup::query()->with('schoolClasses')->lockForUpdate()->findOrFail($group->id);
            $classIds = isset($data['school_class_ids'])
                ? array_map('intval', $data['school_class_ids'])
                : $locked->schoolClasses->pluck('id')->map(fn ($id) => (int) $id)->all();
            sort($classIds);
            $this->assertClassesConfigured($lockedSemester, $classIds);
            $classesChanged = $classIds !== $locked->schoolClasses->pluck('id')->map(fn ($id) => (int) $id)->sort()->values()->all();
            if ($classesChanged && $locked->assignments()->whereHas('entries')->exists()) {
                throw new ApiProblemException('TEACHING_GROUP_HAS_ENTRIES', '教学组已有课程安排，不能修改所含班级', 409);
            }
            $targetStatus = $data['status'] ?? null;
            if (($targetStatus instanceof ResourceStatus ? $targetStatus->value : $targetStatus) === ResourceStatus::Inactive->value
                && $locked->assignments()->where('status', AssignmentStatus::Confirmed->value)->exists()) {
                throw new ApiProblemException('TEACHING_GROUP_IN_USE', '教学组仍有已确认任课关系，不能停用', 409);
            }
            $before = $locked->toArray();
            $before['school_class_ids'] = $locked->schoolClasses->pluck('id')->all();
            $locked->fill([
                ...collect($data)->only(['mode', 'status'])->all(),
                ...array_key_exists('name', $data) ? ['name' => Normalizer::text($data['name'])] : [],
            ]);
            $attributesChanged = $locked->isDirty();
            if ($attributesChanged) {
                $locked->save();
            }
            if ($classesChanged) {
                $locked->schoolClasses()->sync($classIds);
            }
            if ($attributesChanged || $classesChanged) {
                $this->bumpAssignmentRevision($lockedSemester);
                $after = $locked->fresh()->toArray();
                $after['school_class_ids'] = $classIds;
                $this->audit->record($request, $actor, 'update', 'teaching_group', $locked->id, $before, $after);
            }

            return response()->json(['data' => $this->load($locked), 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function destroy(Request $request, Semester $semester, TeachingGroup $group): JsonResponse
    {
        $this->assertParent($semester, $group);

        return DB::transaction(function () use ($request, $semester, $group): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = TeachingGroup::query()->with('schoolClasses')->lockForUpdate()->findOrFail($group->id);
            if ($locked->assignments()->exists()) {
                throw new ApiProblemException('TEACHING_GROUP_IN_USE', '教学组已有任课关系，不能删除', 409);
            }
            $before = $locked->toArray();
            $before['school_class_ids'] = $locked->schoolClasses->pluck('id')->all();
            $locked->delete();
            $this->bumpAssignmentRevision($lockedSemester);
            $this->audit->record($request, $actor, 'delete', 'teaching_group', $group->id, $before, null);

            return response()->json(['data' => ['deleted_id' => $group->id], 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    /** @return array<string, mixed> */
    private function validateGroup(Request $request, Semester $semester, ?TeachingGroup $group = null, bool $partial = false): array
    {
        return $request->validate([
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:100', Rule::unique('teaching_groups', 'name')->where('semester_id', $semester->id)->ignore($group?->id)],
            'mode' => [$partial ? 'sometimes' : 'required', Rule::enum(TeachingGroupMode::class)],
            'status' => ['sometimes', Rule::enum(ResourceStatus::class)],
            'school_class_ids' => [$partial ? 'sometimes' : 'required', 'array', 'min:1'],
            'school_class_ids.*' => ['integer', 'distinct', Rule::exists('school_classes', 'id')->where('academic_year_id', $semester->academic_year_id)],
        ]);
    }

    /** @param list<int> $classIds */
    private function assertClassesConfigured(Semester $semester, array $classIds): void
    {
        $configured = SemesterClassSetting::query()
            ->where('semester_id', $semester->id)
            ->where('status', ResourceStatus::Active->value)
            ->whereIn('school_class_id', $classIds)
            ->count();
        if ($configured !== count($classIds)) {
            throw new ApiProblemException('TEACHING_GROUP_CLASS_SETTING_REQUIRED', '教学组内所有班级必须已在本学期启用', 409);
        }
    }

    private function assertParent(Semester $semester, TeachingGroup $group): void
    {
        if ($group->semester_id !== $semester->id) {
            throw new ApiProblemException('TEACHING_GROUP_SEMESTER_MISMATCH', '教学组不属于该学期', 404);
        }
    }

    private function load(TeachingGroup $group): TeachingGroup
    {
        return $group->load(['schoolClasses.grade:id,name'])->loadCount('assignments');
    }

    private function bumpAssignmentRevision(Semester $semester): void
    {
        $semester->increment('assignment_revision');
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
            'assignment_revision' => (string) $semester->getRawOriginal('assignment_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
