<?php

namespace App\Modules\Scheduling\Services;

use App\Enums\WeekPattern;
use App\Modules\AcademicCalendar\Models\Semester;

class WeekPatternService
{
    public function weekCount(Semester $semester): int
    {
        return min(60, max(1, (int) ceil(($semester->start_date->diffInDays($semester->end_date) + 1) / 7)));
    }

    /** @param array<int, int>|null $activeWeeks */
    public function mask(Semester $semester, WeekPattern $pattern, ?array $activeWeeks = null): int
    {
        return $this->maskForWeekCount($pattern, $activeWeeks, $this->weekCount($semester));
    }

    /** @param array<int, int>|null $activeWeeks */
    public function maskForWeekCount(WeekPattern $pattern, ?array $activeWeeks, int $weekCount): int
    {
        $specified = array_fill_keys(array_map('intval', $activeWeeks ?? []), true);
        $mask = 0;
        for ($week = 1; $week <= $weekCount; $week++) {
            $active = match ($pattern) {
                WeekPattern::All => true,
                WeekPattern::A => $week % 2 === 1,
                WeekPattern::B => $week % 2 === 0,
                WeekPattern::Specified => isset($specified[$week]),
            };
            if ($active) {
                $mask |= 1 << ($week - 1);
            }
        }

        return $mask;
    }

    /**
     * @param  array<int, int>|null  $leftWeeks
     * @param  array<int, int>|null  $rightWeeks
     */
    public function overlaps(
        Semester $semester,
        WeekPattern $leftPattern,
        ?array $leftWeeks,
        WeekPattern $rightPattern,
        ?array $rightWeeks,
    ): bool {
        return ($this->mask($semester, $leftPattern, $leftWeeks)
            & $this->mask($semester, $rightPattern, $rightWeeks)) !== 0;
    }
}
