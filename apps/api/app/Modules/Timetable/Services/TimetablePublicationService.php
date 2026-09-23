<?php

namespace App\Modules\Timetable\Services;

use App\Models\User;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\DailyOperations\Services\DailyTimetableService;
use App\Modules\Timetable\Models\TimetableVersion;
use App\Support\ApiProblemException;

class TimetablePublicationService
{
    public function __construct(
        private readonly TimetableVersionService $versions,
        private readonly TimetableEffectivePeriodService $periods,
        private readonly OperationalAdjustmentRebaseService $operationalAdjustments,
        private readonly DailyTimetableService $daily,
    ) {}

    /** @return array<string, mixed> */
    public function preview(
        Semester $semester,
        TimetableVersion $version,
        User $actor,
        string $effectiveFrom,
        string $effectiveTo,
        string $reason = '发布预检',
    ): array {
        $this->versions->assertActivatable($semester, $version);
        $impact = $this->operationalAdjustments->preview(
            $semester,
            $version,
            $effectiveFrom,
            $effectiveTo,
        );
        if ($impact['blocked']) {
            return [
                'allowed' => false,
                'effective_from' => $effectiveFrom,
                'effective_to' => $effectiveTo,
                'impact' => $impact,
                'summary' => '新课表本身可以发布，但有临时调整或代课无法安全自动迁移，需要先处理。',
            ];
        }

        $this->periods->ensureCurrentCoverage($semester, $actor);
        $simulation = $this->periods->publish(
            $semester,
            $version,
            $effectiveFrom,
            $effectiveTo,
            $actor,
            $reason,
        );
        $this->validateAffectedDates($semester, $simulation['affected_dates']);

        return [
            'allowed' => true,
            'effective_from' => $simulation['period']->effective_from->toDateString(),
            'effective_to' => $simulation['period']->effective_to->toDateString(),
            'impact' => $impact,
            'replaced_periods' => $simulation['replaced_periods'],
            'affected_dates' => $simulation['affected_dates'],
            'summary' => $impact['preserved'] > 0
                ? '可以发布；已有临时调整和代课会按稳定课次自动迁移并重新校验。'
                : '可以发布；当前没有需要迁移的临时调整或代课。',
        ];
    }

    /** @return array<string, mixed> */
    public function publishCurrent(
        Semester $semester,
        TimetableVersion $version,
        User $actor,
        string $reason,
    ): array {
        $effectiveFrom = $semester->start_date->toDateString();
        $effectiveTo = $semester->end_date->toDateString();
        $this->versions->assertActivatable($semester, $version);
        $impact = $this->operationalAdjustments->preview(
            $semester,
            $version,
            $effectiveFrom,
            $effectiveTo,
        );
        if ($impact['blocked']) {
            throw new ApiProblemException(
                'TIMETABLE_PUBLICATION_REVIEW_REQUIRED',
                '发布前有临时调整或代课需要处理，请查看发布影响后再继续',
                409,
                ['impact' => $impact],
            );
        }

        $this->periods->ensureCurrentCoverage($semester, $actor);
        $previous = $this->versions->activate($semester, $version);
        $result = $this->periods->publish(
            $semester,
            $version,
            $effectiveFrom,
            $effectiveTo,
            $actor,
            $reason,
        );
        $this->validateAffectedDates($semester, $result['affected_dates']);

        return [
            'previous' => $previous,
            'period' => $result['period'],
            'replaced_periods' => $result['replaced_periods'],
            'affected_dates' => $result['affected_dates'],
            'rebased_exceptions' => $result['rebased_exceptions'],
            'rebased_substitutions' => $result['rebased_substitutions'],
            'impact' => $impact,
        ];
    }

    /** @param list<string> $dates */
    private function validateAffectedDates(Semester $semester, array $dates): void
    {
        foreach ($dates as $date) {
            $daily = $this->daily->forDate($semester, $date);
            $this->daily->assertActualRowsConflictFree($daily['rows'], $date);
        }
    }
}
