<?php

namespace App\Modules\TeachingAssignment\Models;

use App\Enums\ResourceStatus;
use App\Enums\TeachingGroupMode;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\SchoolClass;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property int $id
 * @property int $semester_id
 * @property string $name
 * @property TeachingGroupMode $mode
 * @property ResourceStatus $status
 * @property-read Semester $semester
 * @property-read Collection<int, SchoolClass> $schoolClasses
 * @property-read Collection<int, TeachingAssignment> $assignments
 */
class TeachingGroup extends Model
{
    protected $fillable = ['semester_id', 'name', 'mode', 'status'];

    protected function casts(): array
    {
        return ['mode' => TeachingGroupMode::class, 'status' => ResourceStatus::class];
    }

    /** @return BelongsTo<Semester, $this> */
    public function semester(): BelongsTo
    {
        return $this->belongsTo(Semester::class);
    }

    /** @return BelongsToMany<SchoolClass, $this> */
    public function schoolClasses(): BelongsToMany
    {
        return $this->belongsToMany(SchoolClass::class, 'teaching_group_classes');
    }

    /** @return HasMany<TeachingAssignment, $this> */
    public function assignments(): HasMany
    {
        return $this->hasMany(TeachingAssignment::class);
    }
}
