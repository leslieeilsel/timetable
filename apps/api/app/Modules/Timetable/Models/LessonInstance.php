<?php

namespace App\Modules\Timetable\Models;

use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Stable business identity for one recurring lesson occurrence inside a semester.
 * Timetable entries are version-specific placements of this identity.
 *
 * @property int $id
 * @property int $semester_id
 * @property int $teaching_assignment_id
 * @property int $occurrence_no
 * @property string $status
 */
class LessonInstance extends Model
{
    protected $fillable = [
        'semester_id', 'teaching_assignment_id', 'occurrence_no', 'status',
    ];

    protected function casts(): array
    {
        return ['occurrence_no' => 'integer'];
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

    /** @return HasMany<TimetableEntry, $this> */
    public function timetableEntries(): HasMany
    {
        return $this->hasMany(TimetableEntry::class);
    }
}
