<?php

namespace App\Modules\Timetable\Models;

use App\Enums\TimetableVersionSource;
use App\Enums\TimetableVersionStatus;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Scheduling\Models\ScheduleCandidate;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property int $id
 * @property int $semester_id
 * @property int $version_no
 * @property string $name
 * @property TimetableVersionStatus $status
 * @property TimetableVersionSource $source
 * @property int|null $source_candidate_id
 * @property int|null $base_version_id
 * @property int $created_by
 * @property int $input_revision
 * @property-read Semester $semester
 * @property-read User $creator
 * @property-read Collection<int, TimetableEntry> $entries
 */
class TimetableVersion extends Model
{
    protected $fillable = [
        'semester_id', 'version_no', 'name', 'status', 'source', 'source_candidate_id',
        'base_version_id', 'created_by', 'input_revision', 'quality_score', 'score_breakdown',
        'hard_conflict_count', 'soft_warning_count', 'activated_at',
    ];

    protected function casts(): array
    {
        return [
            'version_no' => 'integer',
            'status' => TimetableVersionStatus::class,
            'source' => TimetableVersionSource::class,
            'input_revision' => 'integer',
            'quality_score' => 'decimal:2',
            'score_breakdown' => 'array',
            'hard_conflict_count' => 'integer',
            'soft_warning_count' => 'integer',
            'activated_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Semester, $this> */
    public function semester(): BelongsTo
    {
        return $this->belongsTo(Semester::class);
    }

    /** @return BelongsTo<User, $this> */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** @return BelongsTo<ScheduleCandidate, $this> */
    public function sourceCandidate(): BelongsTo
    {
        return $this->belongsTo(ScheduleCandidate::class, 'source_candidate_id');
    }

    /** @return BelongsTo<TimetableVersion, $this> */
    public function baseVersion(): BelongsTo
    {
        return $this->belongsTo(self::class, 'base_version_id');
    }

    /** @return HasMany<TimetableEntry, $this> */
    public function entries(): HasMany
    {
        return $this->hasMany(TimetableEntry::class);
    }
}
