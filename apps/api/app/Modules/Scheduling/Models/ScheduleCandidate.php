<?php

namespace App\Modules\Scheduling\Models;

use App\Modules\AcademicCalendar\Models\Semester;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property int $id
 * @property int $schedule_run_id
 * @property int $semester_id
 * @property int $rank
 * @property string $name
 * @property string|null $quality_score
 * @property array<string, mixed> $score_breakdown
 * @property int $hard_conflict_count
 * @property int $soft_warning_count
 * @property int $unscheduled_count
 * @property-read ScheduleRun $run
 * @property-read Semester $semester
 * @property-read Collection<int, ScheduleCandidateEntry> $entries
 */
class ScheduleCandidate extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'schedule_run_id', 'semester_id', 'rank', 'name', 'quality_score', 'score_breakdown',
        'hard_conflict_count', 'soft_warning_count', 'unscheduled_count', 'created_at',
    ];

    protected function casts(): array
    {
        return [
            'rank' => 'integer',
            'quality_score' => 'decimal:2',
            'score_breakdown' => 'array',
            'hard_conflict_count' => 'integer',
            'soft_warning_count' => 'integer',
            'unscheduled_count' => 'integer',
            'created_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<ScheduleRun, $this> */
    public function run(): BelongsTo
    {
        return $this->belongsTo(ScheduleRun::class, 'schedule_run_id');
    }

    /** @return BelongsTo<Semester, $this> */
    public function semester(): BelongsTo
    {
        return $this->belongsTo(Semester::class);
    }

    /** @return HasMany<ScheduleCandidateEntry, $this> */
    public function entries(): HasMany
    {
        return $this->hasMany(ScheduleCandidateEntry::class);
    }
}
