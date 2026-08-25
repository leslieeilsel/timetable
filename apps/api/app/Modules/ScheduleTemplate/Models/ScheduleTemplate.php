<?php

namespace App\Modules\ScheduleTemplate\Models;

use App\Modules\AcademicCalendar\Models\Semester;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property int $id
 * @property int $semester_id
 * @property string $name
 * @property-read Semester $semester
 * @property-read Collection<int, ScheduleTemplateDay> $days
 * @property-read Collection<int, Item> $items
 */
class ScheduleTemplate extends Model
{
    protected $fillable = ['semester_id', 'name'];

    /** @return BelongsTo<Semester, $this> */
    public function semester(): BelongsTo
    {
        return $this->belongsTo(Semester::class);
    }

    /** @return HasMany<ScheduleTemplateDay, $this> */
    public function days(): HasMany
    {
        return $this->hasMany(ScheduleTemplateDay::class)->orderBy('weekday');
    }

    /** @return HasMany<Item, $this> */
    public function items(): HasMany
    {
        return $this->hasMany(Item::class)->orderBy('sort_order');
    }
}
