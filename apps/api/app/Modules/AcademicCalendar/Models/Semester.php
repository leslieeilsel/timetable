<?php

namespace App\Modules\AcademicCalendar\Models;

use App\Enums\LifecycleStatus;
use App\Modules\ScheduleTemplate\Models\ScheduleTemplate;
use App\Modules\SemesterClassSetting\Models\SemesterClassSetting;
use App\Modules\TeachingTask\Models\TeachingTask;
use App\Modules\Timetable\Models\TimetableEntry;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $academic_year_id
 * @property string $name
 * @property int $sequence
 * @property Carbon $start_date
 * @property Carbon $end_date
 * @property LifecycleStatus $status
 * @property string $timetable_revision
 * @property-read AcademicYear $academicYear
 * @property-read Collection<int, SemesterClassSetting> $classSettings
 * @property-read ScheduleTemplate|null $scheduleTemplate
 * @property-read Collection<int, TeachingTask> $teachingTasks
 * @property-read Collection<int, TimetableEntry> $timetableEntries
 */
class Semester extends Model
{
    protected $fillable = ['academic_year_id', 'name', 'sequence', 'start_date', 'end_date', 'status'];

    protected function casts(): array
    {
        return [
            'start_date' => 'date',
            'end_date' => 'date',
            'status' => LifecycleStatus::class,
            'sequence' => 'integer',
            'timetable_revision' => 'string',
        ];
    }

    /** @return BelongsTo<AcademicYear, $this> */
    public function academicYear(): BelongsTo
    {
        return $this->belongsTo(AcademicYear::class);
    }

    /** @return HasMany<SemesterClassSetting, $this> */
    public function classSettings(): HasMany
    {
        return $this->hasMany(SemesterClassSetting::class);
    }

    /** @return HasOne<ScheduleTemplate, $this> */
    public function scheduleTemplate(): HasOne
    {
        return $this->hasOne(ScheduleTemplate::class);
    }

    /** @return HasMany<TeachingTask, $this> */
    public function teachingTasks(): HasMany
    {
        return $this->hasMany(TeachingTask::class);
    }

    /** @return HasMany<TimetableEntry, $this> */
    public function timetableEntries(): HasMany
    {
        return $this->hasMany(TimetableEntry::class);
    }
}
