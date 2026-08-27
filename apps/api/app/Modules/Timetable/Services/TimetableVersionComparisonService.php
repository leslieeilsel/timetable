<?php

namespace App\Modules\Timetable\Services;

use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Models\TimetableVersion;
use Illuminate\Database\Eloquent\Collection;

class TimetableVersionComparisonService
{
    /**
     * @return array{
     *   left_version: TimetableVersion,
     *   right_version: TimetableVersion,
     *   summary: array<string, int>,
     *   changes: list<array<string, mixed>>
     * }
     */
    public function compare(
        Semester $semester,
        TimetableVersion $left,
        TimetableVersion $right,
    ): array {
        $leftEntries = $this->entries($semester, $left);
        $rightEntries = $this->entries($semester, $right);
        $leftGroups = $leftEntries->groupBy('teaching_assignment_id');
        $rightGroups = $rightEntries->groupBy('teaching_assignment_id');
        $assignmentIds = $leftGroups->keys()->merge($rightGroups->keys())->unique()->sort()->values();
        $changes = [];
        $unchanged = 0;

        foreach ($assignmentIds as $assignmentId) {
            $leftGroup = $leftGroups->get($assignmentId, new Collection)->values();
            $rightGroup = $rightGroups->get($assignmentId, new Collection)->values();
            [$groupChanges, $groupUnchanged] = $this->compareAssignment($leftGroup, $rightGroup);
            $changes = [...$changes, ...$groupChanges];
            $unchanged += $groupUnchanged;
        }

        usort($changes, fn (array $first, array $second): int => strcmp((string) ($first['target'] ?? ''), (string) ($second['target'] ?? ''))
            ?: strcmp((string) ($first['course'] ?? ''), (string) ($second['course'] ?? ''))
            ?: (($first['after']['weekday'] ?? $first['before']['weekday'] ?? 0)
                <=> ($second['after']['weekday'] ?? $second['before']['weekday'] ?? 0))
            ?: (($first['after']['item_sort_order'] ?? $first['before']['item_sort_order'] ?? 0)
                <=> ($second['after']['item_sort_order'] ?? $second['before']['item_sort_order'] ?? 0)));

        $summary = [
            'total_changes' => count($changes),
            'unchanged' => $unchanged,
            'added' => 0,
            'removed' => 0,
            'moved' => 0,
            'teacher_changed' => 0,
            'room_changed' => 0,
            'week_pattern_changed' => 0,
            'lock_changed' => 0,
        ];
        foreach ($changes as $change) {
            foreach ($change['change_types'] as $type) {
                $summary[$type]++;
            }
        }

        return [
            'left_version' => $left,
            'right_version' => $right,
            'summary' => $summary,
            'changes' => $changes,
        ];
    }

    /** @return Collection<int, TimetableEntry> */
    private function entries(Semester $semester, TimetableVersion $version): Collection
    {
        return TimetableEntry::query()
            ->where('semester_id', $semester->id)
            ->where('timetable_version_id', $version->id)
            ->with([
                'schoolClass:id,name',
                'teachingGroup:id,name',
                'schoolClasses:id,name',
                'teachers:id,name',
                'course:id,name',
                'actualRoom:id,name',
                'item:id,name,sort_order,start_time,end_time',
            ])
            ->orderBy('teaching_assignment_id')
            ->orderBy('weekday')
            ->orderBy('item_id')
            ->get();
    }

    /**
     * @param  Collection<int, TimetableEntry>  $left
     * @param  Collection<int, TimetableEntry>  $right
     * @return array{list<array<string, mixed>>, int}
     */
    private function compareAssignment(Collection $left, Collection $right): array
    {
        $changes = [];
        $unchanged = 0;
        $usedRight = [];
        $leftRemaining = [];

        foreach ($left as $leftEntry) {
            $rightIndex = $right->search(fn (TimetableEntry $rightEntry, int $index): bool => ! isset($usedRight[$index]) && $this->exactPositionKey($leftEntry) === $this->exactPositionKey($rightEntry));
            if ($rightIndex === false) {
                $leftRemaining[] = $leftEntry;

                continue;
            }
            $usedRight[$rightIndex] = true;
            $change = $this->pairedChange($leftEntry, $right[$rightIndex]);
            if ($change === null) {
                $unchanged++;
            } else {
                $changes[] = $change;
            }
        }

        $rightRemaining = $right
            ->reject(fn (TimetableEntry $entry, int $index): bool => isset($usedRight[$index]))
            ->sortBy(fn (TimetableEntry $entry): string => $this->sortKey($entry))
            ->values();
        usort($leftRemaining, fn (TimetableEntry $first, TimetableEntry $second): int => strcmp($this->sortKey($first), $this->sortKey($second)));
        $pairCount = min(count($leftRemaining), $rightRemaining->count());
        for ($index = 0; $index < $pairCount; $index++) {
            $change = $this->pairedChange($leftRemaining[$index], $rightRemaining[$index]);
            if ($change === null) {
                $unchanged++;
            } else {
                $changes[] = $change;
            }
        }
        foreach (array_slice($leftRemaining, $pairCount) as $entry) {
            $changes[] = $this->oneSidedChange($entry, 'removed');
        }
        foreach ($rightRemaining->slice($pairCount) as $entry) {
            $changes[] = $this->oneSidedChange($entry, 'added');
        }

        return [$changes, $unchanged];
    }

    /** @return array<string, mixed>|null */
    private function pairedChange(TimetableEntry $before, TimetableEntry $after): ?array
    {
        $types = [];
        if ($before->weekday !== $after->weekday || $before->item_id !== $after->item_id) {
            $types[] = 'moved';
        }
        if ($this->teacherIds($before) !== $this->teacherIds($after)) {
            $types[] = 'teacher_changed';
        }
        if ($before->actual_room_id !== $after->actual_room_id) {
            $types[] = 'room_changed';
        }
        if ($before->week_pattern !== $after->week_pattern || $before->active_weeks !== $after->active_weeks) {
            $types[] = 'week_pattern_changed';
        }
        if ($before->is_locked !== $after->is_locked) {
            $types[] = 'lock_changed';
        }
        if ($types === []) {
            return null;
        }

        return $this->change($before, $after, $types);
    }

    /** @return array<string, mixed> */
    private function oneSidedChange(TimetableEntry $entry, string $type): array
    {
        return $type === 'added'
            ? $this->change(null, $entry, [$type])
            : $this->change($entry, null, [$type]);
    }

    /**
     * @param  list<string>  $types
     * @return array<string, mixed>
     */
    private function change(?TimetableEntry $before, ?TimetableEntry $after, array $types): array
    {
        $reference = $after ?? $before;

        return [
            'assignment_id' => $reference?->teaching_assignment_id,
            'target' => $reference === null ? '' : $this->targetName($reference),
            'course' => $reference?->course->name ?? '',
            'change_types' => $types,
            'description' => $this->description($before, $after, $types),
            'before' => $before === null ? null : $this->entryData($before),
            'after' => $after === null ? null : $this->entryData($after),
        ];
    }

    /**
     * @param  list<string>  $types
     */
    private function description(?TimetableEntry $before, ?TimetableEntry $after, array $types): string
    {
        if (in_array('added', $types, true)) {
            return '新增至'.$this->positionName($after);
        }
        if (in_array('removed', $types, true)) {
            return '从'.$this->positionName($before).'移除';
        }
        $parts = [];
        if (in_array('moved', $types, true)) {
            $parts[] = $this->positionName($before).' → '.$this->positionName($after);
        }
        if (in_array('teacher_changed', $types, true)) {
            $parts[] = implode('、', $before?->teachers->pluck('name')->all() ?? [])
                .' → '.implode('、', $after?->teachers->pluck('name')->all() ?? []);
        }
        if (in_array('room_changed', $types, true)) {
            $parts[] = ($before?->actualRoom->name ?? '未设置').' → '.($after?->actualRoom->name ?? '未设置');
        }
        if (in_array('week_pattern_changed', $types, true)) {
            $parts[] = '周型发生变化';
        }
        if (in_array('lock_changed', $types, true)) {
            $parts[] = $after?->is_locked ? '设为锁定' : '解除锁定';
        }

        return implode('；', $parts);
    }

    /** @return array<string, mixed> */
    private function entryData(TimetableEntry $entry): array
    {
        return [
            'entry_id' => $entry->id,
            'weekday' => $entry->weekday,
            'item_id' => $entry->item_id,
            'item_name' => $entry->item->name,
            'item_sort_order' => $entry->item->sort_order,
            'time' => substr($entry->item->start_time, 0, 5).'-'.substr($entry->item->end_time, 0, 5),
            'teacher_ids' => $this->teacherIds($entry),
            'teacher_names' => $entry->teachers->pluck('name')->all(),
            'room_id' => $entry->actual_room_id,
            'room_name' => $entry->actualRoom->name,
            'week_pattern' => $entry->week_pattern->value,
            'active_weeks' => $entry->active_weeks,
            'is_locked' => $entry->is_locked,
        ];
    }

    private function exactPositionKey(TimetableEntry $entry): string
    {
        return implode(':', [
            $entry->weekday,
            $entry->item_id,
            $entry->week_pattern->value,
            json_encode($entry->active_weeks ?? [], JSON_THROW_ON_ERROR),
        ]);
    }

    private function sortKey(TimetableEntry $entry): string
    {
        return sprintf('%02d:%05d:%s', $entry->weekday, $entry->item->sort_order, $entry->week_pattern->value);
    }

    /** @return list<int> */
    private function teacherIds(TimetableEntry $entry): array
    {
        $ids = $entry->teachers->pluck('id')->map(fn ($id): int => (int) $id)->all();
        sort($ids);

        return $ids;
    }

    private function targetName(TimetableEntry $entry): string
    {
        if ($entry->schoolClass !== null) {
            return $entry->schoolClass->name;
        }

        return $entry->teachingGroup->name ?? $entry->schoolClasses->pluck('name')->join('、');
    }

    private function positionName(?TimetableEntry $entry): string
    {
        if ($entry === null) {
            return '未安排';
        }

        return '周'.['', '一', '二', '三', '四', '五', '六', '日'][$entry->weekday].$entry->item->name;
    }
}
