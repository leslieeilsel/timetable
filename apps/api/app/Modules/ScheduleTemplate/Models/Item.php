<?php

namespace App\Modules\ScheduleTemplate\Models;

use App\Enums\ItemType;
use App\Modules\Timetable\Models\TimetableEntry;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property int $id
 * @property int $schedule_template_id
 * @property int $semester_id
 * @property string $name
 * @property ItemType $type
 * @property string $start_time
 * @property string $end_time
 * @property int $sort_order
 * @property bool $allows_course
 * @property bool $allows_teacher
 * @property bool $counts_as_course
 * @property bool $show_in_official
 * @property bool $show_in_full
 * @property bool $is_active
 */
class Item extends Model
{
    protected $fillable = [
        'schedule_template_id', 'semester_id', 'name', 'type', 'start_time', 'end_time',
        'sort_order', 'allows_course', 'allows_teacher', 'counts_as_course', 'show_in_official',
        'show_in_full', 'is_active',
    ];

    protected function casts(): array
    {
        return [
            'type' => ItemType::class,
            'sort_order' => 'integer',
            'allows_course' => 'boolean',
            'allows_teacher' => 'boolean',
            'counts_as_course' => 'boolean',
            'show_in_official' => 'boolean',
            'show_in_full' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    /** @return Attribute<string, never> */
    protected function startTime(): Attribute
    {
        return Attribute::make(get: fn (string $value): string => substr($value, 0, 5));
    }

    /** @return Attribute<string, never> */
    protected function endTime(): Attribute
    {
        return Attribute::make(get: fn (string $value): string => substr($value, 0, 5));
    }

    /** @return HasMany<TimetableEntry, $this> */
    public function timetableEntries(): HasMany
    {
        return $this->hasMany(TimetableEntry::class);
    }
}
