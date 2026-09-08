<?php

namespace App\Modules\Timetable\Http\Controllers;

use App\Enums\TimetableVersionStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\DailyOperations\Services\DailyTimetableService;
use App\Modules\Timetable\Models\TimetableVersion;
use App\Modules\Timetable\Services\TimetableEffectivePeriodService;
use App\Modules\Timetable\Services\TimetableVersionService;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class LongTermAdjustmentController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly TimetableVersionService $versions,
        private readonly TimetableEffectivePeriodService $periods,
        private readonly DailyTimetableService $daily,
    ) {}

    public function index(Semester $semester): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $periods = $semester->timetableEffectivePeriods()
            ->where('status', 'active')
            ->with(['timetableVersion:id,semester_id,version_no,name,status,source,activated_at', 'creator:id,name'])
            ->orderBy('effective_from')
            ->orderBy('id')
            ->get();

        return response()->json([
            'data' => $periods,
            'meta' => $this->meta($semester, $settings),
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function preview(Request $request, Semester $semester): JsonResponse
    {
        $data = $this->payload($request);
        DB::beginTransaction();
        try {
            $settings = AppSetting::query()->lockForUpdate()->findOrFail(1);
            $lockedSemester = Semester::query()->lockForUpdate()->findOrFail($semester->id);
            $version = $this->draft($lockedSemester, (int) $data['version_id']);
            $this->versions->assertActivatable($lockedSemester, $version);
            $this->periods->ensureCurrentCoverage($lockedSemester, $request->user());
            $simulation = $this->periods->publish(
                $lockedSemester,
                $version,
                $data['effective_from'],
                $data['effective_to'],
                $request->user(),
                $data['reason'],
            );
            foreach ($simulation['affected_dates'] as $date) {
                $daily = $this->daily->forDate($lockedSemester, $date);
                $this->daily->assertActualRowsConflictFree($daily['rows'], $date);
            }
        } finally {
            DB::rollBack();
        }

        return response()->json([
            'data' => [
                'allowed' => true,
                'version' => $version,
                'effective_from' => $simulation['period']->effective_from->toDateString(),
                'effective_to' => $simulation['period']->effective_to->toDateString(),
                'replaced_periods' => $simulation['replaced_periods'],
                'calendar_exceptions_to_rebase' => $simulation['rebased_exceptions'],
                'cross_period_exceptions_to_validate' => $simulation['cross_period_exceptions'],
                'substitutions_to_rebase' => $simulation['rebased_substitutions'],
                'summary' => $simulation['affected_dates'] !== []
                    ? '可以发布；系统会迁移并重新校验生效区间内已有的临时调课和代课。'
                    : '可以发布；该版本将在指定日期区间成为基础课表。',
            ],
            'meta' => $this->meta($lockedSemester, $settings),
        ])->header('ETag', $this->etags->semester($lockedSemester, $settings));
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $data = $this->payload($request);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester, false, true);
            $version = $this->draft($lockedSemester, (int) $data['version_id']);
            $this->periods->ensureCurrentCoverage($lockedSemester, $actor);
            $previous = $this->versions->activate($lockedSemester, $version);
            $result = $this->periods->publish(
                $lockedSemester,
                $version,
                $data['effective_from'],
                $data['effective_to'],
                $actor,
                $data['reason'],
            );
            foreach ($result['affected_dates'] as $date) {
                $daily = $this->daily->forDate($lockedSemester, $date);
                $this->daily->assertActualRowsConflictFree($daily['rows'], $date);
            }
            $this->audit->record($request, $actor, 'publish_period', 'timetable_effective_period', $result['period']->id, null, [
                ...$result['period']->toArray(),
                'previous_version_id' => $previous?->id,
                'rebased_exceptions' => $result['rebased_exceptions'],
                'rebased_substitutions' => $result['rebased_substitutions'],
            ]);

            return response()->json([
                'data' => $result['period']->load(['timetableVersion', 'creator:id,name']),
                'meta' => $this->meta($lockedSemester, $settings),
            ], 201)->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    /** @return array{version_id: int, effective_from: string, effective_to: string, reason: string} */
    private function payload(Request $request): array
    {
        return $request->validate([
            'version_id' => ['required', 'integer'],
            'effective_from' => ['required', 'date_format:Y-m-d'],
            'effective_to' => ['required', 'date_format:Y-m-d', 'after_or_equal:effective_from'],
            'reason' => ['required', 'string', 'min:2', 'max:500'],
        ]);
    }

    private function draft(Semester $semester, int $versionId): TimetableVersion
    {
        return TimetableVersion::query()
            ->where('semester_id', $semester->id)
            ->where('status', TimetableVersionStatus::Draft->value)
            ->lockForUpdate()
            ->findOrFail($versionId);
    }

    /** @return array<string, int|string|null> */
    private function meta(Semester $semester, AppSetting $settings): array
    {
        return [
            'semester_id' => $semester->id,
            'current_timetable_version_id' => $semester->current_timetable_version_id,
            'timetable_revision' => (string) $semester->getRawOriginal('timetable_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
