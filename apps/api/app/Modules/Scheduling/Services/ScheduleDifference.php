<?php

namespace App\Modules\Scheduling\Services;

final class ScheduleDifference
{
    /**
     * Lessons within one assignment/week pattern are interchangeable. Match unchanged
     * positions first, then pair remaining occurrences; additions are never called moves.
     *
     * @param  list<array{assignment_id: int, week_pattern: string, weekday: int, item_id: int, room_id: int, teacher_ids: list<int>}>  $before
     * @param  list<array{assignment_id: int, week_pattern: string, weekday: int, item_id: int, room_id: int, teacher_ids: list<int>}>  $after
     * @return array{added: int, removed: int, moved: int, teacher_changed: int, room_changed: int, unchanged: int, existing_changed: int}
     */
    public function compare(array $before, array $after): array
    {
        $counts = ['added' => 0, 'removed' => 0, 'moved' => 0, 'teacher_changed' => 0, 'room_changed' => 0, 'unchanged' => 0, 'existing_changed' => 0];
        $groups = [];
        foreach ($before as $row) {
            $groups[$row['assignment_id'].':'.$row['week_pattern']]['before'][] = $row;
        }
        foreach ($after as $row) {
            $groups[$row['assignment_id'].':'.$row['week_pattern']]['after'][] = $row;
        }
        foreach ($groups as $group) {
            $old = $group['before'] ?? [];
            $new = $group['after'] ?? [];
            $pairs = [];
            foreach ($new as $index => $row) {
                foreach ($old as $oldIndex => $original) {
                    if ($original['weekday'] === $row['weekday'] && $original['item_id'] === $row['item_id']) {
                        $pairs[] = [$original, $row];
                        unset($old[$oldIndex], $new[$index]);
                        break;
                    }
                }
            }
            $old = array_values($old);
            $new = array_values($new);
            $paired = min(count($old), count($new));
            for ($i = 0; $i < $paired; $i++) {
                $pairs[] = [$old[$i], $new[$i]];
            }
            $counts['added'] += count($new) - $paired;
            $counts['removed'] += count($old) - $paired;
            foreach ($pairs as [$original, $row]) {
                $moved = $original['weekday'] !== $row['weekday'] || $original['item_id'] !== $row['item_id'];
                sort($original['teacher_ids']);
                sort($row['teacher_ids']);
                $teacher = $original['teacher_ids'] !== $row['teacher_ids'];
                $room = $original['room_id'] !== $row['room_id'];
                $counts['moved'] += (int) $moved;
                $counts['teacher_changed'] += (int) $teacher;
                $counts['room_changed'] += (int) $room;
                $counts[$moved || $teacher || $room ? 'existing_changed' : 'unchanged']++;
            }
        }

        return $counts;
    }
}
