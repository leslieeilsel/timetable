<?php

namespace App\Modules\Scheduling\Models;

use App\Enums\WeekPattern;
use App\Modules\Resources\Models\Room;
use App\Modules\ScheduleTemplate\Models\Item;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $schedule_candidate_id
 * @property int $teaching_assignment_id
 * @property WeekPattern $week_pattern
 * @property array<int, int>|null $active_weeks
 * @property int $weekday
 * @property int $item_id
 * @property int $actual_room_id
 * @property bool $is_locked
 * @property-read ScheduleCandidate $candidate
 * @property-read TeachingAssignment $teachingAssignment
 * @property-read Item $item
 * @property-read Room $actualRoom
 */
class ScheduleCandidateEntry extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'schedule_candidate_id', 'teaching_assignment_id', 'week_pattern', 'active_weeks', 'weekday',
        'item_id', 'actual_room_id', 'is_locked',
    ];

    protected function casts(): array
    {
        return [
            'week_pattern' => WeekPattern::class,
            'active_weeks' => 'array',
            'weekday' => 'integer',
            'is_locked' => 'boolean',
        ];
    }

    /** @return BelongsTo<ScheduleCandidate, $this> */
    public function candidate(): BelongsTo
    {
        return $this->belongsTo(ScheduleCandidate::class, 'schedule_candidate_id');
    }

    /** @return BelongsTo<TeachingAssignment, $this> */
    public function teachingAssignment(): BelongsTo
    {
        return $this->belongsTo(TeachingAssignment::class);
    }

    /** @return BelongsTo<Item, $this> */
    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    /** @return BelongsTo<Room, $this> */
    public function actualRoom(): BelongsTo
    {
        return $this->belongsTo(Room::class, 'actual_room_id');
    }
}
