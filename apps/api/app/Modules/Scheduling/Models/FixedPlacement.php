<?php

namespace App\Modules\Scheduling\Models;

use App\Enums\ResourceStatus;
use App\Enums\WeekPattern;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\Room;
use App\Modules\ScheduleTemplate\Models\Item;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $semester_id
 * @property int $teaching_assignment_id
 * @property WeekPattern $week_pattern
 * @property array<int, int>|null $active_weeks
 * @property int $weekday
 * @property int $item_id
 * @property int|null $room_id
 * @property bool $is_locked
 * @property ResourceStatus $status
 * @property-read TeachingAssignment $teachingAssignment
 */
class FixedPlacement extends Model
{
    protected $fillable = [
        'semester_id', 'teaching_assignment_id', 'week_pattern', 'active_weeks', 'weekday', 'item_id',
        'room_id', 'is_locked', 'status',
    ];

    protected function casts(): array
    {
        return [
            'week_pattern' => WeekPattern::class,
            'active_weeks' => 'array',
            'weekday' => 'integer',
            'is_locked' => 'boolean',
            'status' => ResourceStatus::class,
        ];
    }

    /** @return BelongsTo<Semester, $this> */
    public function semester(): BelongsTo
    {
        return $this->belongsTo(Semester::class);
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
    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }
}
