<?php

namespace App\Modules\ScheduleTemplate\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * @property int $id
 * @property int $schedule_template_id
 * @property int $semester_id
 * @property int $weekday
 * @property bool $is_enabled
 */
class ScheduleTemplateDay extends Model
{
    public $timestamps = false;

    protected $fillable = ['schedule_template_id', 'semester_id', 'weekday', 'is_enabled'];

    protected function casts(): array
    {
        return ['weekday' => 'integer', 'is_enabled' => 'boolean'];
    }
}
