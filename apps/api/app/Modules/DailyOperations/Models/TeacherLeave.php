<?php

namespace App\Modules\DailyOperations\Models;

use App\Enums\OperationalStatus;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\Teacher;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $semester_id
 * @property int $teacher_id
 * @property Carbon $starts_at
 * @property Carbon $ends_at
 * @property string $type
 * @property OperationalStatus $status
 * @property string|null $reason
 * @property bool $includes_non_course_items
 * @property int $created_by
 * @property-read Semester $semester
 * @property-read Teacher $teacher
 * @property-read User $creator
 * @property-read Collection<int, Substitution> $substitutions
 */
class TeacherLeave extends Model
{
    protected $fillable = [
        'semester_id', 'teacher_id', 'starts_at', 'ends_at', 'type', 'status', 'reason',
        'includes_non_course_items', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'status' => OperationalStatus::class,
            'includes_non_course_items' => 'boolean',
        ];
    }

    /** @return BelongsTo<Semester, $this> */
    public function semester(): BelongsTo
    {
        return $this->belongsTo(Semester::class);
    }

    /** @return BelongsTo<Teacher, $this> */
    public function teacher(): BelongsTo
    {
        return $this->belongsTo(Teacher::class);
    }

    /** @return BelongsTo<User, $this> */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** @return HasMany<Substitution, $this> */
    public function substitutions(): HasMany
    {
        return $this->hasMany(Substitution::class);
    }
}
