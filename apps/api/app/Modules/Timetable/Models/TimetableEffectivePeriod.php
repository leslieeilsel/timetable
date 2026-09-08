<?php

namespace App\Modules\Timetable\Models;

use App\Models\User;
use App\Modules\AcademicCalendar\Models\Semester;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $semester_id
 * @property int $timetable_version_id
 * @property Carbon $effective_from
 * @property Carbon $effective_to
 * @property string $status
 * @property string $reason
 * @property int $created_by
 * @property-read Semester $semester
 * @property-read TimetableVersion $timetableVersion
 * @property-read User $creator
 */
class TimetableEffectivePeriod extends Model
{
    protected $fillable = [
        'semester_id', 'timetable_version_id', 'effective_from', 'effective_to',
        'status', 'reason', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'effective_from' => 'date:Y-m-d',
            'effective_to' => 'date:Y-m-d',
        ];
    }

    /** @return BelongsTo<Semester, $this> */
    public function semester(): BelongsTo
    {
        return $this->belongsTo(Semester::class);
    }

    /** @return BelongsTo<TimetableVersion, $this> */
    public function timetableVersion(): BelongsTo
    {
        return $this->belongsTo(TimetableVersion::class);
    }

    /** @return BelongsTo<User, $this> */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
