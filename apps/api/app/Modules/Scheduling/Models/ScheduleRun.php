<?php

namespace App\Modules\Scheduling\Models;

use App\Enums\ScheduleRunStatus;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\Semester;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $semester_id
 * @property int $created_by
 * @property ScheduleRunStatus $status
 * @property array<string, mixed> $scope
 * @property array<string, mixed> $preservation
 * @property array<string, mixed> $constraint_snapshot
 * @property array<string, mixed> $strategy
 * @property int $candidate_count
 * @property int $input_revision
 * @property string $algorithm_version
 * @property int $random_seed
 * @property string $progress_stage
 * @property int $progress_percent
 * @property string|null $error_code
 * @property string|null $error_message
 * @property array<string, mixed>|null $diagnostics
 * @property Carbon|null $started_at
 * @property Carbon|null $completed_at
 * @property-read Semester $semester
 * @property-read User $creator
 * @property-read Collection<int, ScheduleCandidate> $candidates
 */
class ScheduleRun extends Model
{
    protected $fillable = [
        'semester_id', 'created_by', 'status', 'scope', 'preservation', 'constraint_snapshot',
        'strategy', 'candidate_count', 'input_revision', 'algorithm_version', 'random_seed',
        'progress_stage', 'progress_percent', 'error_code', 'error_message', 'diagnostics',
        'started_at', 'completed_at',
    ];

    protected function casts(): array
    {
        return [
            'status' => ScheduleRunStatus::class,
            'scope' => 'array',
            'preservation' => 'array',
            'constraint_snapshot' => 'array',
            'strategy' => 'array',
            'diagnostics' => 'array',
            'candidate_count' => 'integer',
            'input_revision' => 'integer',
            'random_seed' => 'integer',
            'progress_percent' => 'integer',
            'started_at' => 'datetime',
            'completed_at' => 'datetime',
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

    /** @return HasMany<ScheduleCandidate, $this> */
    public function candidates(): HasMany
    {
        return $this->hasMany(ScheduleCandidate::class);
    }
}
