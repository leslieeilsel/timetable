<?php

use App\Modules\Scheduling\Services\ScheduleDifference;

it('separates additions, removals, moves and teacher changes independent of occurrence order', function (): void {
    $lesson = ['assignment_id' => 1, 'week_pattern' => 'all', 'weekday' => 1, 'item_id' => 1, 'room_id' => 1, 'teacher_ids' => [1, 2]];
    $before = [$lesson, [...$lesson, 'weekday' => 2], [...$lesson, 'assignment_id' => 2]];
    $after = [[...$lesson, 'weekday' => 3, 'teacher_ids' => [3]], [...$lesson, 'teacher_ids' => [2, 1]], [...$lesson, 'weekday' => 4]];
    expect((new ScheduleDifference)->compare($before, $after))->toBe(['added' => 1, 'removed' => 1, 'moved' => 1, 'teacher_changed' => 1, 'room_changed' => 0, 'unchanged' => 1, 'existing_changed' => 1]);
});
