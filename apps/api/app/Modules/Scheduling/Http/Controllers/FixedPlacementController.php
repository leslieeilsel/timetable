<?php

namespace App\Modules\Scheduling\Http\Controllers;

use App\Enums\ResourceStatus;
use App\Enums\WeekPattern;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Scheduling\Models\FixedPlacement;
use App\Modules\Scheduling\Services\FixedPlacementService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class FixedPlacementController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly FixedPlacementService $placements,
    ) {}

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['sometimes', Rule::enum(ResourceStatus::class)],
            'teaching_assignment_id' => ['sometimes', 'integer'],
            'weekday' => ['sometimes', 'integer', 'between:1,7'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ]);
        $paginator = $semester->fixedPlacements()
            ->with([
                'teachingAssignment.schoolClass:id,name', 'teachingAssignment.teachingGroup:id,name',
                'teachingAssignment.course:id,name,short_name', 'teachingAssignment.teacher:id,name',
                'item:id,name,sort_order', 'room:id,name',
            ])
            ->when(isset($filters['status']), fn ($query) => $query->where('status', $filters['status']))
            ->when(isset($filters['teaching_assignment_id']), fn ($query) => $query->where('teaching_assignment_id', $filters['teaching_assignment_id']))
            ->when(isset($filters['weekday']), fn ($query) => $query->where('weekday', $filters['weekday']))
            ->orderBy('weekday')->orderBy('item_id')->orderBy('id')
            ->paginate((int) ($filters['per_page'] ?? 20));
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json([
            'data' => $paginator->items(),
            'meta' => array_merge($this->meta($semester, $settings), [
                'pagination' => [
                    'page' => $paginator->currentPage(), 'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(), 'last_page' => $paginator->lastPage(),
                    'from' => $paginator->firstItem(), 'to' => $paginator->lastItem(),
                ],
            ]),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $data = $this->validatePayload($request);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $resolved = $this->placements->assertValid($lockedSemester, $data);
            $placement = FixedPlacement::query()->create([
                ...$data,
                'semester_id' => $lockedSemester->id,
                'room_id' => $resolved['room_id'],
                'active_weeks' => $resolved['active_weeks'],
                'status' => ResourceStatus::Active,
            ]);
            $this->bumpRevision($lockedSemester);
            $this->audit->record($request, $actor, 'create', 'fixed_placement', $placement->id, null, $placement->toArray());

            return response()->json([
                'data' => $placement->load(['teachingAssignment.schoolClass', 'teachingAssignment.course', 'teachingAssignment.teacher', 'item', 'room']),
                'meta' => $this->meta($lockedSemester, $settings),
            ], 201)->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function update(Request $request, Semester $semester, FixedPlacement $placement): JsonResponse
    {
        $this->assertParent($semester, $placement);
        $data = $this->validatePayload($request, true);

        return DB::transaction(function () use ($request, $semester, $placement, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = FixedPlacement::query()->lockForUpdate()->findOrFail($placement->id);
            $merged = [...$locked->only([
                'teaching_assignment_id', 'week_pattern', 'weekday', 'item_id', 'room_id', 'is_locked',
            ]), ...$data];
            $resolved = $this->placements->assertValid($lockedSemester, $merged, $locked->id);
            $before = $locked->toArray();
            $locked->fill([
                ...$data,
                'room_id' => $resolved['room_id'],
                'active_weeks' => $resolved['active_weeks'],
            ]);
            if ($locked->isDirty()) {
                $locked->save();
                $this->bumpRevision($lockedSemester);
                $this->audit->record($request, $actor, 'update', 'fixed_placement', $locked->id, $before, $locked->toArray());
            }

            return response()->json([
                'data' => $locked->load(['teachingAssignment.schoolClass', 'teachingAssignment.course', 'teachingAssignment.teacher', 'item', 'room']),
                'meta' => $this->meta($lockedSemester, $settings),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function activate(Request $request, Semester $semester, FixedPlacement $placement): JsonResponse
    {
        return $this->transition($request, $semester, $placement, ResourceStatus::Active);
    }

    public function deactivate(Request $request, Semester $semester, FixedPlacement $placement): JsonResponse
    {
        return $this->transition($request, $semester, $placement, ResourceStatus::Inactive);
    }

    public function destroy(Request $request, Semester $semester, FixedPlacement $placement): JsonResponse
    {
        $this->assertParent($semester, $placement);

        return DB::transaction(function () use ($request, $semester, $placement): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = FixedPlacement::query()->lockForUpdate()->findOrFail($placement->id);
            $before = $locked->toArray();
            $locked->delete();
            $this->bumpRevision($lockedSemester);
            $this->audit->record($request, $actor, 'delete', 'fixed_placement', $placement->id, $before, null);

            return response()->json([
                'data' => ['deleted_id' => $placement->id],
                'meta' => $this->meta($lockedSemester, $settings),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    private function transition(
        Request $request,
        Semester $semester,
        FixedPlacement $placement,
        ResourceStatus $status,
    ): JsonResponse {
        $this->assertParent($semester, $placement);

        return DB::transaction(function () use ($request, $semester, $placement, $status): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $locked = FixedPlacement::query()->lockForUpdate()->findOrFail($placement->id);
            if ($status === ResourceStatus::Active) {
                $this->placements->assertValid($lockedSemester, $locked->only([
                    'teaching_assignment_id', 'week_pattern', 'weekday', 'item_id', 'room_id', 'is_locked',
                ]), $locked->id);
            }
            $before = $locked->toArray();
            $locked->status = $status;
            if ($locked->isDirty()) {
                $locked->save();
                $this->bumpRevision($lockedSemester);
                $this->audit->record($request, $actor, $status->value, 'fixed_placement', $locked->id, $before, $locked->toArray());
            }

            return response()->json([
                'data' => $locked,
                'meta' => $this->meta($lockedSemester, $settings),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    /** @return array<string, mixed> */
    private function validatePayload(Request $request, bool $partial = false): array
    {
        $presence = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'teaching_assignment_id' => [$presence, 'integer'],
            'week_pattern' => [$partial ? 'sometimes' : 'required', Rule::enum(WeekPattern::class)],
            'weekday' => [$presence, 'integer', 'between:1,7'],
            'item_id' => [$presence, 'integer'],
            'room_id' => ['sometimes', 'nullable', 'integer'],
            'is_locked' => ['sometimes', 'boolean'],
        ]);
    }

    private function assertParent(Semester $semester, FixedPlacement $placement): void
    {
        if ($placement->semester_id !== $semester->id) {
            throw new ApiProblemException('FIXED_PLACEMENT_SEMESTER_MISMATCH', '固定安排不属于该学期', 404);
        }
    }

    private function bumpRevision(Semester $semester): void
    {
        $semester->increment('constraint_revision');
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
            'constraint_revision' => (string) $semester->getRawOriginal('constraint_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
