<?php

namespace App\Modules\Resources\Http\Controllers;

use App\Enums\Role;
use App\Enums\RoomType;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Resources\Models\Course;
use App\Modules\Resources\Models\Grade;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\Teacher;
use App\Modules\Resources\Services\CatalogImpactService;
use App\Modules\Resources\Services\HistoricalReferenceService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\Normalizer;
use App\Support\WriteGuard;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class CatalogController
{
    public function __construct(
        private readonly EtagService $etags,
        private readonly WriteGuard $guard,
        private readonly AuditLogger $audit,
        private readonly CatalogImpactService $impacts,
        private readonly HistoricalReferenceService $history,
    ) {}

    public function catalog(): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json(['data' => [
            'catalog_revision' => (string) $settings->catalog_revision,
            'timezone' => $settings->timezone,
        ]])->header('ETag', $this->etags->catalog($settings));
    }

    public function grades(Request $request): JsonResponse
    {
        $filters = $request->validate($this->listRules(['sort_order', 'name', 'created_at']));
        $query = Grade::query()
            ->when(isset($filters['search']), fn (Builder $query) => $query->where('name', 'like', '%'.Normalizer::text($filters['search']).'%'));
        $this->applyActiveFilter($query, $filters);

        return $this->paginatedList($query, $filters, 'sort_order');
    }

    public function storeGrade(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100', 'unique:grades,name'],
            'sort_order' => ['required', 'integer', 'min:0', 'unique:grades,sort_order'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        return $this->create($request, Grade::class, [
            'name' => Normalizer::text($data['name']),
            'sort_order' => $data['sort_order'],
            'is_active' => $data['is_active'] ?? true,
        ], 'grade');
    }

    public function updateGrade(Request $request, Grade $grade): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:100', Rule::unique('grades')->ignore($grade->id)],
            'sort_order' => ['sometimes', 'integer', 'min:0', Rule::unique('grades')->ignore($grade->id)],
            'is_active' => ['sometimes', 'boolean'],
            'confirm_open_impact' => ['sometimes', 'boolean'],
            'impact_hash' => ['sometimes', 'string', 'max:2000'],
        ]);
        unset($data['confirm_open_impact'], $data['impact_hash']);
        if (isset($data['name'])) {
            $data['name'] = Normalizer::text($data['name']);
        }

        return $this->update($request, $grade, $data, 'grade');
    }

    public function deleteGrade(Request $request, Grade $grade): JsonResponse
    {
        return $this->delete($request, $grade, 'grade');
    }

    public function teachers(Request $request): JsonResponse
    {
        $filters = $request->validate([
            ...$this->listRules(['name', 'employee_no', 'created_at']),
            'course_id' => ['sometimes', 'integer', 'exists:courses,id'],
        ]);
        $query = Teacher::query()->with('courses:id,name')
            ->when(isset($filters['search']), function (Builder $query) use ($filters): void {
                $search = '%'.Normalizer::text($filters['search']).'%';
                $query->where(fn (Builder $match) => $match->where('name', 'like', $search)
                    ->orWhere('employee_no', 'like', $search));
            })
            ->when(isset($filters['course_id']), fn (Builder $query) => $query->whereHas(
                'courses',
                fn (Builder $courses) => $courses->whereKey((int) $filters['course_id']),
            ));
        $this->applyActiveFilter($query, $filters);

        return $this->paginatedList($query, $filters, 'name');
    }

    public function storeTeacher(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'employee_no' => ['nullable', 'string', 'max:50', 'unique:teachers,employee_no'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        return $this->create($request, Teacher::class, [
            'name' => Normalizer::text($data['name']),
            'employee_no' => Normalizer::code($data['employee_no'] ?? null),
            'is_active' => $data['is_active'] ?? true,
        ], 'teacher');
    }

    public function updateTeacher(Request $request, Teacher $teacher): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:100'],
            'employee_no' => ['sometimes', 'nullable', 'string', 'max:50', Rule::unique('teachers')->ignore($teacher->id)],
            'is_active' => ['sometimes', 'boolean'],
            'confirm_open_impact' => ['sometimes', 'boolean'],
            'impact_hash' => ['sometimes', 'string', 'max:2000'],
        ]);
        unset($data['confirm_open_impact'], $data['impact_hash']);
        if (isset($data['name'])) {
            $data['name'] = Normalizer::text($data['name']);
        }
        if (array_key_exists('employee_no', $data)) {
            $data['employee_no'] = Normalizer::code($data['employee_no']);
        }

        return $this->update($request, $teacher, $data, 'teacher');
    }

    public function teacherCourses(Request $request, Teacher $teacher): JsonResponse
    {
        $data = $request->validate(['course_ids' => ['required', 'array'], 'course_ids.*' => ['integer', 'distinct', 'exists:courses,id']]);

        return DB::transaction(function () use ($request, $teacher, $data): JsonResponse {
            [$actor, $settings] = $this->guard->catalog($request);
            $locked = Teacher::query()->lockForUpdate()->findOrFail($teacher->id);
            $before = $locked->courses()->pluck('courses.id')->sort()->values()->all();
            $after = $this->integerList($data['course_ids']);
            sort($after);
            if ($before !== $after) {
                $locked->courses()->sync($after);
                $settings->increment('catalog_revision');
                $settings->refresh();
                $this->audit->record($request, $actor, 'sync_courses', 'teacher', $locked->id, ['course_ids' => $before], ['course_ids' => $after]);
            }

            return response()->json(['data' => $this->serialize($locked->load('courses:id,name'))])
                ->header('ETag', $this->etags->catalog($settings));
        }, 3);
    }

    public function deleteTeacher(Request $request, Teacher $teacher): JsonResponse
    {
        return $this->delete($request, $teacher, 'teacher');
    }

    public function courses(Request $request): JsonResponse
    {
        $filters = $request->validate($this->listRules(['name', 'short_name', 'created_at']));
        $query = Course::query()
            ->when(isset($filters['search']), function (Builder $query) use ($filters): void {
                $search = '%'.Normalizer::text($filters['search']).'%';
                $query->where(fn (Builder $match) => $match->where('name', 'like', $search)
                    ->orWhere('short_name', 'like', $search));
            });
        $this->applyActiveFilter($query, $filters);

        return $this->paginatedList($query, $filters, 'name');
    }

    public function storeCourse(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100', 'unique:courses,name'],
            'short_name' => ['nullable', 'string', 'max:50'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        return $this->create($request, Course::class, [
            'name' => Normalizer::text($data['name']),
            'short_name' => Normalizer::optional($data['short_name'] ?? null),
            'is_active' => $data['is_active'] ?? true,
        ], 'course');
    }

    public function updateCourse(Request $request, Course $course): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:100', Rule::unique('courses')->ignore($course->id)],
            'short_name' => ['sometimes', 'nullable', 'string', 'max:50'],
            'is_active' => ['sometimes', 'boolean'],
            'confirm_open_impact' => ['sometimes', 'boolean'],
            'impact_hash' => ['sometimes', 'string', 'max:2000'],
        ]);
        unset($data['confirm_open_impact'], $data['impact_hash']);
        if (isset($data['name'])) {
            $data['name'] = Normalizer::text($data['name']);
        }
        if (array_key_exists('short_name', $data)) {
            $data['short_name'] = Normalizer::optional($data['short_name']);
        }

        return $this->update($request, $course, $data, 'course');
    }

    public function deleteCourse(Request $request, Course $course): JsonResponse
    {
        return $this->delete($request, $course, 'course');
    }

    public function rooms(Request $request): JsonResponse
    {
        $filters = $request->validate([
            ...$this->listRules(['name', 'type', 'created_at']),
            'type' => ['sometimes', Rule::enum(RoomType::class)],
        ]);
        $query = Room::query()
            ->when(isset($filters['search']), fn (Builder $query) => $query->where('name', 'like', '%'.Normalizer::text($filters['search']).'%'))
            ->when(isset($filters['type']), fn (Builder $query) => $query->where('type', $filters['type']));
        $this->applyActiveFilter($query, $filters);

        return $this->paginatedList($query, $filters, 'name');
    }

    public function storeRoom(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100', 'unique:rooms,name'],
            'type' => ['required', Rule::enum(RoomType::class)],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        return $this->create($request, Room::class, [
            'name' => Normalizer::text($data['name']),
            'type' => $data['type'],
            'is_active' => $data['is_active'] ?? true,
        ], 'room');
    }

    public function updateRoom(Request $request, Room $room): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:100', Rule::unique('rooms')->ignore($room->id)],
            'type' => ['sometimes', Rule::enum(RoomType::class)],
            'is_active' => ['sometimes', 'boolean'],
            'confirm_open_impact' => ['sometimes', 'boolean'],
            'impact_hash' => ['sometimes', 'string', 'max:2000'],
        ]);
        unset($data['confirm_open_impact'], $data['impact_hash']);
        if (isset($data['name'])) {
            $data['name'] = Normalizer::text($data['name']);
        }

        return $this->update($request, $room, $data, 'room');
    }

    public function deleteRoom(Request $request, Room $room): JsonResponse
    {
        return $this->delete($request, $room, 'room');
    }

    /**
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $query
     * @param  array<string, mixed>  $filters
     */
    private function paginatedList(Builder $query, array $filters, string $defaultSort): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $sort = (string) ($filters['sort'] ?? $defaultSort);
        $direction = (string) ($filters['direction'] ?? 'asc');
        $paginator = $query->orderBy($sort, $direction)->orderBy('id')->paginate((int) ($filters['per_page'] ?? 20));

        return response()->json([
            'data' => collect($paginator->items())->map(fn (Model $model) => $this->serialize($model))->values(),
            'meta' => [
                'pagination' => [
                    'page' => $paginator->currentPage(),
                    'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(),
                    'last_page' => $paginator->lastPage(),
                    'from' => $paginator->firstItem(),
                    'to' => $paginator->lastItem(),
                ],
            ],
        ])
            ->header('ETag', $this->etags->catalog($settings));
    }

    /**
     * @param  list<string>  $sorts
     * @return array<string, list<mixed>>
     */
    private function listRules(array $sorts): array
    {
        return [
            'search' => ['sometimes', 'string', 'max:100'],
            'status' => ['sometimes', Rule::in(['active', 'inactive'])],
            'sort' => ['sometimes', Rule::in($sorts)],
            'direction' => ['sometimes', Rule::in(['asc', 'desc'])],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ];
    }

    /**
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $query
     * @param  array<string, mixed>  $filters
     */
    private function applyActiveFilter(Builder $query, array $filters): void
    {
        if (isset($filters['status'])) {
            $query->where('is_active', $filters['status'] === 'active');
        }
    }

    /**
     * @param  class-string<Model>  $modelClass
     * @param  array<string, mixed>  $data
     */
    private function create(Request $request, string $modelClass, array $data, string $type): JsonResponse
    {
        return DB::transaction(function () use ($request, $modelClass, $data, $type): JsonResponse {
            [$actor, $settings] = $this->guard->catalog($request);
            $model = $modelClass::query()->create($data);
            $settings->increment('catalog_revision');
            $settings->refresh();
            $this->audit->record($request, $actor, 'create', $type, $model->getKey(), null, $this->serialize($model));

            return response()->json(['data' => $this->serialize($model)], 201)->header('ETag', $this->etags->catalog($settings));
        }, 3);
    }

    /** @param array<string, mixed> $data */
    private function update(Request $request, Model $model, array $data, string $type): JsonResponse
    {
        return DB::transaction(function () use ($request, $model, $data, $type): JsonResponse {
            [$actor, $settings] = $this->guard->catalog($request);
            $locked = $model->newQuery()->lockForUpdate()->findOrFail($model->getKey());
            $historicalCorrection = array_key_exists('name', $data)
                && $data['name'] !== $locked->getAttribute('name')
                && $this->history->hasClosedReference($type, (int) $locked->getKey());
            if ($historicalCorrection && $actor->role !== Role::Admin) {
                throw new ApiProblemException('HISTORICAL_CORRECTION_ADMIN_REQUIRED', '该资料已有历史引用，仅管理员可以更正名称', 403);
            }
            if ($locked->getAttribute('is_active') === true && ($data['is_active'] ?? true) === false) {
                $this->impacts->assertCanDeactivate($request, $type, (int) $locked->getKey(), $settings);
            }
            $before = $this->serialize($locked);
            $locked->fill($data);
            if ($locked->isDirty()) {
                $locked->save();
                $settings->increment('catalog_revision');
                $settings->refresh();
                $this->audit->record($request, $actor, $historicalCorrection ? 'historical_correction' : 'update', $type, $locked->getKey(), $before, $this->serialize($locked));
            }

            return response()->json(['data' => $this->serialize($locked), 'meta' => ['changed' => $before !== $this->serialize($locked)]])
                ->header('ETag', $this->etags->catalog($settings));
        }, 3);
    }

    private function delete(Request $request, Model $model, string $type): JsonResponse
    {
        try {
            return DB::transaction(function () use ($request, $model, $type): JsonResponse {
                [$actor, $settings] = $this->guard->catalog($request);
                $locked = $model->newQuery()->lockForUpdate()->findOrFail($model->getKey());
                $before = $this->serialize($locked);
                $locked->delete();
                $settings->increment('catalog_revision');
                $settings->refresh();
                $this->audit->record($request, $actor, 'delete', $type, $model->getKey(), $before, null);

                return response()->json(['data' => ['deleted_id' => $model->getKey()]])->header('ETag', $this->etags->catalog($settings));
            }, 3);
        } catch (QueryException) {
            throw new ApiProblemException('RESOURCE_IN_USE', '该资料已被业务数据引用，请改为停用', 409);
        }
    }

    /** @return array<string, mixed> */
    private function serialize(Model $model): array
    {
        $data = $model->toArray();
        foreach (['type', 'status'] as $field) {
            if (isset($data[$field]) && $data[$field] instanceof \BackedEnum) {
                $data[$field] = $data[$field]->value;
            }
        }

        return $data;
    }

    /** @return list<int> */
    private function integerList(mixed $value): array
    {
        if (! is_array($value)) {
            throw new \LogicException('Validated integer list must be an array.');
        }

        return array_map(static fn (mixed $item): int => (int) $item, array_values($value));
    }
}
