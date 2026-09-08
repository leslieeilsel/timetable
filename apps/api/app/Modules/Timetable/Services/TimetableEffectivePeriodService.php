<?php

namespace App\Modules\Timetable\Services;

use App\Enums\OperationalStatus;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\DailyOperations\Models\CalendarException;
use App\Modules\DailyOperations\Models\Substitution;
use App\Modules\Timetable\Models\TimetableEffectivePeriod;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Models\TimetableVersion;
use App\Support\ApiProblemException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class TimetableEffectivePeriodService
{
    public function versionForDate(Semester $semester, string|Carbon $date): ?TimetableVersion
    {
        $day = $date instanceof Carbon ? $date->toDateString() : $date;
        $period = TimetableEffectivePeriod::query()
            ->where('semester_id', $semester->id)
            ->where('status', 'active')
            ->whereDate('effective_from', '<=', $day)
            ->whereDate('effective_to', '>=', $day)
            ->with('timetableVersion')
            ->latest('effective_from')
            ->latest('id')
            ->first();

        if ($period !== null) {
            return $period->timetableVersion;
        }

        return $semester->current_timetable_version_id === null
            ? null
            : $semester->currentTimetableVersion()->first();
    }

    public function ensureCurrentCoverage(Semester $semester, User $actor): void
    {
        if ($semester->current_timetable_version_id === null
            || TimetableEffectivePeriod::query()->where('semester_id', $semester->id)->where('status', 'active')->exists()) {
            return;
        }

        TimetableEffectivePeriod::query()->create([
            'semester_id' => $semester->id,
            'timetable_version_id' => $semester->current_timetable_version_id,
            'effective_from' => $semester->start_date,
            'effective_to' => $semester->end_date,
            'status' => 'active',
            'reason' => '补齐既有当前课表生效区间',
            'created_by' => $actor->id,
        ]);
    }

    /**
     * Caller must hold the semester row lock and run inside a transaction.
     *
     * @return array{
     *     period: TimetableEffectivePeriod,
     *     replaced_periods: list<array{id: int, version_id: int, effective_from: string, effective_to: string}>,
     *     affected_dates: list<string>,
     *     rebased_exceptions: int,
     *     cross_period_exceptions: int,
     *     rebased_substitutions: int
     * }
     */
    public function publish(
        Semester $semester,
        TimetableVersion $version,
        string $effectiveFrom,
        string $effectiveTo,
        User $actor,
        string $reason,
    ): array {
        [$from, $to] = $this->range($semester, $effectiveFrom, $effectiveTo);
        $overlapping = $this->overlappingPeriods($semester, $from, $to);
        $replacedPeriods = $overlapping->map(fn (TimetableEffectivePeriod $period): array => [
            'id' => $period->id,
            'version_id' => $period->timetable_version_id,
            'effective_from' => $period->effective_from->toDateString(),
            'effective_to' => $period->effective_to->toDateString(),
        ])->values()->all();
        foreach ($overlapping as $existing) {
            $oldFrom = $existing->effective_from->copy();
            $oldTo = $existing->effective_to->copy();
            if ($oldFrom->lessThan($from) && $oldTo->greaterThan($to)) {
                $existing->effective_to = $from->copy()->subDay();
                $existing->save();
                TimetableEffectivePeriod::query()->create([
                    'semester_id' => $semester->id,
                    'timetable_version_id' => $existing->timetable_version_id,
                    'effective_from' => $to->copy()->addDay(),
                    'effective_to' => $oldTo,
                    'status' => 'active',
                    'reason' => $existing->reason,
                    'created_by' => $existing->created_by,
                ]);
            } elseif ($oldFrom->lessThan($from) && $oldTo->lessThanOrEqualTo($to)) {
                $existing->effective_to = $from->copy()->subDay();
                $existing->save();
            } elseif ($oldFrom->greaterThanOrEqualTo($from) && $oldTo->greaterThan($to)) {
                $existing->effective_from = $to->copy()->addDay();
                $existing->save();
            } else {
                $existing->status = 'cancelled';
                $existing->save();
            }
        }

        $period = TimetableEffectivePeriod::query()->create([
            'semester_id' => $semester->id,
            'timetable_version_id' => $version->id,
            'effective_from' => $from,
            'effective_to' => $to,
            'status' => 'active',
            'reason' => $reason,
            'created_by' => $actor->id,
        ]);

        $affectedDates = [];
        $rebasedExceptions = 0;
        $crossPeriodExceptions = 0;
        $rebasedSubstitutions = 0;
        $exceptions = CalendarException::query()
            ->where('semester_id', $semester->id)
            ->where('status', OperationalStatus::Active->value)
            ->where(function ($query) use ($from, $to): void {
                $query->whereBetween('effective_date', [$from->toDateString(), $to->toDateString()])
                    ->orWhereBetween('replacement_date', [$from->toDateString(), $to->toDateString()]);
            })
            ->lockForUpdate()
            ->get();
        foreach ($exceptions as $exception) {
            $effectiveDate = $exception->effective_date->toDateString();
            $replacementDate = $exception->replacement_date?->toDateString();
            $effectiveIsInside = $effectiveDate >= $from->toDateString()
                && $effectiveDate <= $to->toDateString();
            if ($effectiveIsInside && $exception->timetable_version_id !== $version->id) {
                $exception->original_entry_id = $this->mappedEntryId($version, $exception->original_entry_id);
                $exception->related_entry_id = $this->mappedEntryId($version, $exception->related_entry_id);
                $exception->timetable_version_id = $version->id;
                $exception->save();
                $rebasedExceptions++;
            }
            if ($effectiveIsInside) {
                $affectedDates[] = $effectiveDate;
            }
            if ($replacementDate !== null
                && $replacementDate >= $from->toDateString()
                && $replacementDate <= $to->toDateString()) {
                $affectedDates[] = $replacementDate;
                if (! $effectiveIsInside) {
                    $crossPeriodExceptions++;
                }
            }
        }

        $substitutions = Substitution::query()
            ->where('status', OperationalStatus::Active->value)
            ->whereBetween('effective_date', [$from->toDateString(), $to->toDateString()])
            ->whereHas('originalEntry', fn ($query) => $query->where('semester_id', $semester->id))
            ->lockForUpdate()
            ->get();
        foreach ($substitutions as $substitution) {
            $mapped = $this->mappedEntryId($version, $substitution->original_entry_id);
            if ($mapped !== $substitution->original_entry_id) {
                $substitution->original_entry_id = $mapped;
                $substitution->save();
                $affectedDates[] = $substitution->effective_date->toDateString();
                $rebasedSubstitutions++;
            }
        }

        return [
            'period' => $period,
            'replaced_periods' => $replacedPeriods,
            'affected_dates' => array_values(array_unique($affectedDates)),
            'rebased_exceptions' => $rebasedExceptions,
            'cross_period_exceptions' => $crossPeriodExceptions,
            'rebased_substitutions' => $rebasedSubstitutions,
        ];
    }

    /** @return array{Carbon, Carbon} */
    private function range(Semester $semester, string $effectiveFrom, string $effectiveTo): array
    {
        $from = Carbon::parse($effectiveFrom)->startOfDay();
        $to = Carbon::parse($effectiveTo)->startOfDay();
        if ($from->greaterThan($to)
            || $from->lessThan($semester->start_date)
            || $to->greaterThan($semester->end_date)) {
            throw new ApiProblemException('TIMETABLE_PERIOD_INVALID', '长期调课生效日期必须位于学期内，且开始日期不能晚于结束日期', 422);
        }

        return [$from, $to];
    }

    /** @return Collection<int, TimetableEffectivePeriod> */
    private function overlappingPeriods(
        Semester $semester,
        Carbon $from,
        Carbon $to,
    ): Collection {
        return TimetableEffectivePeriod::query()
            ->where('semester_id', $semester->id)
            ->where('status', 'active')
            ->whereDate('effective_from', '<=', $to->toDateString())
            ->whereDate('effective_to', '>=', $from->toDateString())
            ->orderBy('effective_from')
            ->orderBy('id')
            ->lockForUpdate()
            ->get();
    }

    private function mappedEntryId(TimetableVersion $version, ?int $entryId): ?int
    {
        if ($entryId === null) {
            return null;
        }
        $entry = TimetableEntry::query()->find($entryId);
        if ($entry === null || $entry->entry_key === null) {
            throw new ApiProblemException('TIMETABLE_PERIOD_REBASE_FAILED', '已有临时调整无法映射到长期调课版本', 409, [
                'entry_id' => $entryId,
            ]);
        }
        $mapped = TimetableEntry::query()
            ->where('timetable_version_id', $version->id)
            ->where('entry_key', $entry->entry_key)
            ->value('id');
        if ($mapped === null) {
            throw new ApiProblemException('TIMETABLE_PERIOD_REBASE_FAILED', '长期调课草稿移除了已有临时调整引用的课程，请先处理该临时调整', 409, [
                'entry_id' => $entryId,
                'entry_key' => $entry->entry_key,
            ]);
        }

        return (int) $mapped;
    }
}
