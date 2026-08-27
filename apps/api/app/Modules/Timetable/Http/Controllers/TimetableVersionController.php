<?php

namespace App\Modules\Timetable\Http\Controllers;

use App\Enums\TimetableVersionSource;
use App\Enums\TimetableVersionStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Timetable\Models\TimetableVersion;
use App\Modules\Timetable\Services\TimetableVersionComparisonService;
use App\Modules\Timetable\Services\TimetableVersionService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TimetableVersionController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly TimetableVersionService $versions,
        private readonly TimetableVersionComparisonService $comparisons,
    ) {}

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['sometimes', Rule::enum(TimetableVersionStatus::class)],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ]);
        $perPage = (int) ($filters['per_page'] ?? 20);
        $paginator = $semester->timetableVersions()
            ->with(['creator:id,name', 'sourceCandidate:id,name,rank'])
            ->withCount('entries')
            ->when(isset($filters['status']), fn ($query) => $query->where('status', $filters['status']))
            ->orderByDesc('version_no')
            ->paginate($perPage);
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

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:120'],
            'base_version_id' => ['nullable', 'integer'],
        ]);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $base = isset($data['base_version_id'])
                ? $this->versions->findForSemester($lockedSemester, (int) $data['base_version_id'])
                : null;
            $version = $this->versions->createDraft($lockedSemester, $actor, $base, $data['name'] ?? null);
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'create', 'timetable_version', $version->id, null, $version->toArray());

            return response()->json([
                'data' => $version->loadCount('entries'),
                'meta' => $this->meta($lockedSemester, $settings),
            ], 201)->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function compare(Request $request, Semester $semester): JsonResponse
    {
        $filters = $request->validate([
            'left_version_id' => ['required', 'integer'],
            'right_version_id' => ['required', 'integer', 'different:left_version_id'],
            'change_type' => ['sometimes', Rule::in([
                'added', 'removed', 'moved', 'teacher_changed', 'room_changed',
                'week_pattern_changed', 'lock_changed',
            ])],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ]);
        $left = $this->versions->findForSemester($semester, (int) $filters['left_version_id']);
        $right = $this->versions->findForSemester($semester, (int) $filters['right_version_id']);
        $comparison = $this->comparisons->compare($semester, $left, $right);
        $changes = isset($filters['change_type'])
            ? array_values(array_filter(
                $comparison['changes'],
                fn (array $change): bool => in_array($filters['change_type'], $change['change_types'], true),
            ))
            : $comparison['changes'];
        $page = (int) ($filters['page'] ?? 1);
        $perPage = (int) ($filters['per_page'] ?? 20);
        $total = count($changes);
        $lastPage = max(1, (int) ceil($total / $perPage));
        $pageItems = array_slice($changes, ($page - 1) * $perPage, $perPage);
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json([
            'data' => [
                'left_version' => $comparison['left_version'],
                'right_version' => $comparison['right_version'],
                'summary' => $comparison['summary'],
                'changes' => $pageItems,
            ],
            'meta' => array_merge($this->meta($semester, $settings), [
                'pagination' => [
                    'page' => $page,
                    'per_page' => $perPage,
                    'total' => $total,
                    'last_page' => $lastPage,
                    'from' => $total === 0 ? null : (($page - 1) * $perPage) + 1,
                    'to' => $total === 0 ? null : min($total, $page * $perPage),
                ],
            ]),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function activate(Request $request, Semester $semester, TimetableVersion $version): JsonResponse
    {
        $this->assertParent($semester, $version);
        $data = $request->validate([
            'reason' => ['required', 'string', 'min:2', 'max:500'],
        ]);

        return DB::transaction(function () use ($request, $semester, $version, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $locked = TimetableVersion::query()->lockForUpdate()->findOrFail($version->id);
            $before = $locked->toArray();
            $previous = $this->versions->activate($lockedSemester, $locked);
            $this->audit->record($request, $actor, 'activate', 'timetable_version', $locked->id, $before, [
                ...$locked->fresh()->toArray(),
                'previous_version_id' => $previous?->id,
                'reason' => $data['reason'],
            ]);

            return response()->json([
                'data' => $locked->fresh()->loadCount('entries'),
                'meta' => $this->meta($lockedSemester, $settings),
            ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function restore(Request $request, Semester $semester, TimetableVersion $version): JsonResponse
    {
        $this->assertParent($semester, $version);
        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:120'],
            'reason' => ['required', 'string', 'min:2', 'max:500'],
        ]);

        return DB::transaction(function () use ($request, $semester, $version, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $source = TimetableVersion::query()->lockForUpdate()->findOrFail($version->id);
            $draft = $this->versions->createDraft(
                $lockedSemester,
                $actor,
                $source,
                $data['name'] ?? "从 v{$source->version_no} 恢复的草稿",
            );
            $draft->source = TimetableVersionSource::Restored;
            $draft->save();
            $lockedSemester->increment('timetable_revision');
            $lockedSemester->refresh();
            $this->audit->record($request, $actor, 'restore', 'timetable_version', $draft->id, null, [
                ...$draft->toArray(),
                'restored_from_version_id' => $source->id,
                'reason' => $data['reason'],
            ]);

            return response()->json([
                'data' => $draft->loadCount('entries'),
                'meta' => $this->meta($lockedSemester, $settings),
            ], 201)->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    private function assertParent(Semester $semester, TimetableVersion $version): void
    {
        if ($version->semester_id !== $semester->id) {
            throw new ApiProblemException('VERSION_SEMESTER_MISMATCH', '课表版本不属于该学期', 404);
        }
    }

    /** @return array<string, int|string|null> */
    private function meta(Semester $semester, AppSetting $settings): array
    {
        return [
            'semester_id' => $semester->id,
            'current_timetable_version_id' => $semester->current_timetable_version_id,
            'timetable_revision' => (string) $semester->getRawOriginal('timetable_revision'),
            'input_revision' => (string) $semester->getRawOriginal('input_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
