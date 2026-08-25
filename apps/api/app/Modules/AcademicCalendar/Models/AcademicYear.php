<?php

namespace App\Modules\AcademicCalendar\Models;

use App\Enums\LifecycleStatus;
use App\Modules\Resources\Models\SchoolClass;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property string $name
 * @property Carbon $start_date
 * @property Carbon $end_date
 * @property LifecycleStatus $status
 * @property int $semesters_count
 * @property int $school_classes_count
 * @property-read Collection<int, Semester> $semesters
 * @property-read Collection<int, SchoolClass> $schoolClasses
 */
class AcademicYear extends Model
{
    protected $fillable = ['name', 'start_date', 'end_date', 'status'];

    protected function casts(): array
    {
        return ['start_date' => 'date', 'end_date' => 'date', 'status' => LifecycleStatus::class];
    }

    /** @return HasMany<Semester, $this> */
    public function semesters(): HasMany
    {
        return $this->hasMany(Semester::class)->orderBy('sequence');
    }

    /** @return HasMany<SchoolClass, $this> */
    public function schoolClasses(): HasMany
    {
        return $this->hasMany(SchoolClass::class);
    }
}
