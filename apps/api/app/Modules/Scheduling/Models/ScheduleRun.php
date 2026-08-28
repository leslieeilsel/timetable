<?php

namespace App\Modules\Scheduling\Models;

use App\Enums\ScheduleRunStatus;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Timetable\Models\TimetableVersion;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

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
 * @property int|null $catalog_revision
 * @property int|null $timetable_revision
 * @property int|null $assignment_revision
 * @property int|null $constraint_revision
 * @property int|null $base_version_id
 * @property string|null $base_version_fingerprint
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
        'strategy', 'candidate_count', 'input_revision', 'catalog_revision', 'timetable_revision',
        'assignment_revision', 'constraint_revision', 'base_version_id', 'base_version_fingerprint',
        'algorithm_version', 'random_seed', 'progress_stage', 'progress_percent', 'error_code',
        'error_message', 'diagnostics', 'started_at', 'completed_at',
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
            'catalog_revision' => 'integer',
            'timetable_revision' => 'integer',
            'assignment_revision' => 'integer',
            'constraint_revision' => 'integer',
            'base_version_id' => 'integer',
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

    /** @return BelongsTo<TimetableVersion, $this> */
    public function baseVersion(): BelongsTo
    {
        return $this->belongsTo(TimetableVersion::class, 'base_version_id');
    }

    /** @return HasMany<ScheduleCandidate, $this> */
    public function candidates(): HasMany
    {
        return $this->hasMany(ScheduleCandidate::class);
    }

    public function isTerminal(): bool
    {
        return in_array($this->status, [
            ScheduleRunStatus::Completed,
            ScheduleRunStatus::Failed,
            ScheduleRunStatus::Cancelled,
        ], true);
    }

    public function hasCompleteInputSnapshot(): bool
    {
        $snapshot = $this->constraint_snapshot;
        if (! is_array($snapshot['constraints'] ?? null)) {
            return false;
        }
        $revisionAttributes = [
            'input_revision',
            'catalog_revision',
            'timetable_revision',
            'assignment_revision',
            'constraint_revision',
        ];
        foreach ($revisionAttributes as $attribute) {
            $value = $this->getAttribute($attribute);
            if ($value === null || ! array_key_exists($attribute, $snapshot)
                || (int) $snapshot[$attribute] !== (int) $value) {
                return false;
            }
        }
        if (! array_key_exists('base_version_id', $snapshot)
            || ! array_key_exists('base_version_fingerprint', $snapshot)
            || ! array_key_exists('base_version_id', $this->preservation)) {
            return false;
        }
        $snapshotBaseVersionId = $snapshot['base_version_id'] === null
            ? null
            : (int) $snapshot['base_version_id'];
        $preservedBaseVersionId = $this->preservation['base_version_id'] === null
            ? null
            : (int) $this->preservation['base_version_id'];
        if ($snapshotBaseVersionId !== $this->base_version_id || $preservedBaseVersionId !== $this->base_version_id
            || $snapshot['base_version_fingerprint'] !== $this->base_version_fingerprint) {
            return false;
        }
        if ($this->base_version_id === null) {
            if ($this->base_version_fingerprint !== null) {
                return false;
            }
        } elseif (! is_string($this->base_version_fingerprint)
            || preg_match('/^[a-f0-9]{64}$/', $this->base_version_fingerprint) !== 1) {
            return false;
        }
        $constraintKeys = [
            'id', 'semester_id', 'name', 'kind', 'category', 'target_type', 'target_id', 'scope',
            'condition', 'requirement', 'weight', 'source', 'status', 'explanation', 'created_at', 'updated_at',
        ];
        foreach ($snapshot['constraints'] as $constraint) {
            if (! is_array($constraint) || array_diff($constraintKeys, array_keys($constraint)) !== []) {
                return false;
            }
        }

        return true;
    }

    /** @return array<string, int> */
    public function revisionDifferences(Semester $semester, AppSetting $settings): array
    {
        $differences = [];
        $pairs = [
            'input_revision' => (int) $semester->getRawOriginal('input_revision'),
            'catalog_revision' => (int) $settings->getRawOriginal('catalog_revision'),
            'timetable_revision' => (int) $semester->getRawOriginal('timetable_revision'),
            'assignment_revision' => (int) $semester->getRawOriginal('assignment_revision'),
            'constraint_revision' => (int) $semester->getRawOriginal('constraint_revision'),
        ];
        foreach ($pairs as $attribute => $current) {
            $expected = $this->getAttribute($attribute);
            if ($expected === null || (int) $expected === $current) {
                continue;
            }
            $prefix = $attribute === 'catalog_revision' ? 'catalog' : str_replace('_revision', '', $attribute);
            $differences["run_{$prefix}_revision"] = (int) $expected;
            $differences["current_{$prefix}_revision"] = $current;
        }

        return $differences;
    }

    public function baselineMatches(bool $lockForUpdate = false): bool
    {
        if ($this->base_version_id === null) {
            return $this->base_version_fingerprint === null;
        }
        if ($this->base_version_fingerprint === null
            || ! DB::table('timetable_versions')->where('id', $this->base_version_id)->exists()) {
            return false;
        }
        $current = self::fingerprintTimetableVersion($this->base_version_id, $lockForUpdate);

        return $current !== null && hash_equals($this->base_version_fingerprint, $current);
    }

    public static function fingerprintTimetableVersion(?int $versionId, bool $lockForUpdate = false): ?string
    {
        if ($versionId === null) {
            return null;
        }
        $entriesQuery = DB::table('timetable_entries')
            ->where('timetable_version_id', $versionId)
            ->orderBy('id');
        $classesQuery = DB::table('timetable_entry_classes')
            ->where('timetable_version_id', $versionId)
            ->orderBy('timetable_entry_id')
            ->orderBy('school_class_id');
        $teachersQuery = DB::table('timetable_entry_teachers')
            ->where('timetable_version_id', $versionId)
            ->orderBy('timetable_entry_id')
            ->orderBy('teacher_id');
        if ($lockForUpdate) {
            $entriesQuery->lockForUpdate();
            $classesQuery->lockForUpdate();
            $teachersQuery->lockForUpdate();
        }
        $entries = $entriesQuery->get([
            'id', 'teaching_assignment_id', 'school_class_id', 'teaching_group_id', 'teacher_id',
            'course_id', 'actual_room_id', 'week_pattern', 'active_weeks', 'weekday', 'item_id', 'is_locked',
        ])->map(static fn (object $entry): array => [
            'id' => (int) $entry->id,
            'teaching_assignment_id' => (int) $entry->teaching_assignment_id,
            'school_class_id' => $entry->school_class_id === null ? null : (int) $entry->school_class_id,
            'teaching_group_id' => $entry->teaching_group_id === null ? null : (int) $entry->teaching_group_id,
            'teacher_id' => (int) $entry->teacher_id,
            'course_id' => (int) $entry->course_id,
            'actual_room_id' => (int) $entry->actual_room_id,
            'week_pattern' => (string) $entry->week_pattern,
            'active_weeks' => self::normalizeJsonList($entry->active_weeks),
            'weekday' => (int) $entry->weekday,
            'item_id' => (int) $entry->item_id,
            'is_locked' => (bool) $entry->is_locked,
        ])->all();
        $classes = $classesQuery->get([
            'timetable_entry_id', 'school_class_id', 'week_pattern', 'weekday', 'item_id',
        ])->map(static fn (object $row): array => [
            'timetable_entry_id' => (int) $row->timetable_entry_id,
            'school_class_id' => (int) $row->school_class_id,
            'week_pattern' => (string) $row->week_pattern,
            'weekday' => (int) $row->weekday,
            'item_id' => (int) $row->item_id,
        ])->all();
        $teachers = $teachersQuery->get([
            'timetable_entry_id', 'teacher_id', 'week_pattern', 'weekday', 'item_id',
        ])->map(static fn (object $row): array => [
            'timetable_entry_id' => (int) $row->timetable_entry_id,
            'teacher_id' => (int) $row->teacher_id,
            'week_pattern' => (string) $row->week_pattern,
            'weekday' => (int) $row->weekday,
            'item_id' => (int) $row->item_id,
        ])->all();

        return hash('sha256', json_encode([
            'version_id' => $versionId,
            'entries' => $entries,
            'classes' => $classes,
            'teachers' => $teachers,
        ], JSON_THROW_ON_ERROR));
    }

    /** @return list<mixed>|null */
    private static function normalizeJsonList(mixed $value): ?array
    {
        if ($value === null) {
            return null;
        }
        $decoded = is_string($value) ? json_decode($value, true, 512, JSON_THROW_ON_ERROR) : $value;

        return is_array($decoded) ? array_values($decoded) : null;
    }
}
