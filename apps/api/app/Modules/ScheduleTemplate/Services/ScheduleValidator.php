<?php

namespace App\Modules\ScheduleTemplate\Services;

use App\Support\ApiProblemException;

class ScheduleValidator
{
    /**
     * @param list<array{
     *     allows_course: bool,
     *     counts_as_course: bool,
     *     allows_teacher: bool,
     *     show_in_official: bool,
     *     show_in_full: bool,
     *     id: int|null,
     *     name: string,
     *     type: string,
     *     start_time: string,
     *     end_time: string,
     *     sort_order: int,
     *     is_active: bool
     * }> $items
     */
    public function assertNoOverlap(array $items): void
    {
        $active = collect($items)->where('is_active', true)->sortBy('start_time')->values();
        for ($index = 0; $index < $active->count(); $index++) {
            $current = $active[$index];
            if ($current['start_time'] >= $current['end_time']) {
                throw new ApiProblemException('ITEM_TIME_INVALID', '课节开始时间必须早于结束时间', 422, ['item' => $current['name']]);
            }
            for ($other = $index + 1; $other < $active->count(); $other++) {
                $candidate = $active[$other];
                if ($current['start_time'] < $candidate['end_time'] && $candidate['start_time'] < $current['end_time']) {
                    throw new ApiProblemException('ITEM_TIME_OVERLAP', '课节不能重叠', 422, [
                        'items' => [$current['name'], $candidate['name']],
                    ]);
                }
            }
        }
    }
}
