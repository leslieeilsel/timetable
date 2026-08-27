<?php

namespace App\Modules\AcademicCalendar\Models;

use App\Enums\LifecycleStatus;
use App\Modules\DailyOperations\Models\CalendarException;
use App\Modules\DailyOperations\Models\TeacherLeave;
use App\Modules\ScheduleTemplate\Models\ScheduleTemplate;
use App\Modules\Scheduling\Models\FixedPlacement;
use App\Modules\Scheduling\Models\ScheduleRun;
use App\Modules\Scheduling\Models\SchedulingConstraint;
use App\Modules\SemesterClassSetting\Models\SemesterClassSetting;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\TeachingAssignment\Models\TeachingGroup;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Models\TimetableVersion;
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
 * @property string $input_revision
 * @property string $assignment_revision
 * @property string $constraint_revision
 * @property int|null $current_timetable_version_id
 * @property-read AcademicYear $academicYear
 * @property-read Collection<int, SemesterClassSetting> $classSettings
 * @property-read ScheduleTemplate|null $scheduleTemplate
 * @property-read Collection<int, TeachingAssignment> $teachingAssignments
 * @property-read Collection<int, TeachingGroup> $teachingGroups
 * @property-read Collection<int, SchedulingConstraint> $schedulingConstraints
 * @property-read Collection<int, FixedPlacement> $fixedPlacements
 * @property-read Collection<int, ScheduleRun> $scheduleRuns
 * @property-read Collection<int, TimetableVersion> $timetableVersions
 * @property-read TimetableVersion|null $currentTimetableVersion
 * @property-read Collection<int, CalendarException> $calendarExceptions
 * @property-read Collection<int, TeacherLeave> $teacherLeaves
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
            'input_revision' => 'string',
            'assignment_revision' => 'string',
            'constraint_revision' => 'string',
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

    /** @return HasMany<TeachingAssignment, $this> */
    public function teachingAssignments(): HasMany
    {
        return $this->hasMany(TeachingAssignment::class);
    }

    /** @return HasMany<TeachingGroup, $this> */
    public function teachingGroups(): HasMany
    {
        return $this->hasMany(TeachingGroup::class);
    }

    /** @return HasMany<SchedulingConstraint, $this> */
    public function schedulingConstraints(): HasMany
    {
        return $this->hasMany(SchedulingConstraint::class);
    }

    /** @return HasMany<FixedPlacement, $this> */
    public function fixedPlacements(): HasMany
    {
        return $this->hasMany(FixedPlacement::class);
    }

    /** @return HasMany<ScheduleRun, $this> */
    public function scheduleRuns(): HasMany
    {
        return $this->hasMany(ScheduleRun::class);
    }

    /** @return HasMany<TimetableVersion, $this> */
    public function timetableVersions(): HasMany
    {
        return $this->hasMany(TimetableVersion::class);
    }

    /** @return BelongsTo<TimetableVersion, $this> */
    public function currentTimetableVersion(): BelongsTo
    {
        return $this->belongsTo(TimetableVersion::class, 'current_timetable_version_id');
    }

    /** @return HasMany<CalendarException, $this> */
    public function calendarExceptions(): HasMany
    {
        return $this->hasMany(CalendarException::class);
    }

    /** @return HasMany<TeacherLeave, $this> */
    public function teacherLeaves(): HasMany
    {
        return $this->hasMany(TeacherLeave::class);
    }

    /** @return HasMany<TimetableEntry, $this> */
    public function timetableEntries(): HasMany
    {
        return $this->hasMany(TimetableEntry::class);
    }
}
