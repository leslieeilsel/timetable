<?php

namespace App\Modules\TeachingAssignment\Models;

use App\Enums\AssignmentStatus;
use App\Enums\RoomMode;
use App\Enums\WeekPattern;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\Course;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use App\Modules\Scheduling\Models\FixedPlacement;
use App\Modules\Timetable\Models\TimetableEntry;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property int $id
 * @property int $semester_id
 * @property int $academic_year_id
 * @property int|null $school_class_id
 * @property int|null $teaching_group_id
 * @property int $course_id
 * @property int $teacher_id
 * @property int $weekly_items
 * @property int $items_per_session
 * @property WeekPattern $week_pattern
 * @property array<int, int>|null $active_weeks
 * @property RoomMode $room_mode
 * @property int|null $specified_room_id
 * @property AssignmentStatus $status
 * @property int $entries_count
 * @property-read Semester $semester
 * @property-read SchoolClass|null $schoolClass
 * @property-read TeachingGroup|null $teachingGroup
 * @property-read Course $course
 * @property-read Teacher $teacher
 * @property-read Room|null $specifiedRoom
 * @property-read Collection<int, TimetableEntry> $entries
 * @property-read Collection<int, Teacher> $collaborators
 * @property-read Collection<int, FixedPlacement> $fixedPlacements
 */
class TeachingAssignment extends Model
{
    protected $fillable = [
        'semester_id', 'academic_year_id', 'school_class_id', 'teaching_group_id', 'course_id',
        'teacher_id', 'weekly_items', 'items_per_session', 'week_pattern', 'active_weeks',
        'room_mode', 'specified_room_id', 'allows_substitution', 'status',
    ];

    protected function casts(): array
    {
        return [
            'weekly_items' => 'integer',
            'items_per_session' => 'integer',
            'week_pattern' => WeekPattern::class,
            'active_weeks' => 'array',
            'allows_substitution' => 'boolean',
            'room_mode' => RoomMode::class,
            'status' => AssignmentStatus::class,
        ];
    }

    /** @return BelongsTo<Semester, $this> */
    public function semester(): BelongsTo
    {
        return $this->belongsTo(Semester::class);
    }

    /** @return BelongsTo<SchoolClass, $this> */
    public function schoolClass(): BelongsTo
    {
        return $this->belongsTo(SchoolClass::class);
    }

    /** @return BelongsTo<TeachingGroup, $this> */
    public function teachingGroup(): BelongsTo
    {
        return $this->belongsTo(TeachingGroup::class);
    }

    /** @return BelongsTo<Course, $this> */
    public function course(): BelongsTo
    {
        return $this->belongsTo(Course::class);
    }

    /** @return BelongsTo<Teacher, $this> */
    public function teacher(): BelongsTo
    {
        return $this->belongsTo(Teacher::class);
    }

    /** @return BelongsTo<Room, $this> */
    public function specifiedRoom(): BelongsTo
    {
        return $this->belongsTo(Room::class, 'specified_room_id');
    }

    /** @return HasMany<TimetableEntry, $this> */
    public function entries(): HasMany
    {
        return $this->hasMany(TimetableEntry::class);
    }

    /** @return BelongsToMany<Teacher, $this> */
    public function collaborators(): BelongsToMany
    {
        return $this->belongsToMany(Teacher::class, 'teaching_assignment_collaborators')
            ->withPivot('role');
    }

    /** @return HasMany<FixedPlacement, $this> */
    public function fixedPlacements(): HasMany
    {
        return $this->hasMany(FixedPlacement::class);
    }
}
