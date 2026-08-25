<?php

namespace App\Modules\TeachingTask\Models;

use App\Enums\RoomMode;
use App\Enums\TaskStatus;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\Course;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use App\Modules\Timetable\Models\TimetableEntry;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property int $id
 * @property int $semester_id
 * @property int $academic_year_id
 * @property int $school_class_id
 * @property int $course_id
 * @property int $teacher_id
 * @property int $weekly_items
 * @property RoomMode $room_mode
 * @property int|null $specified_room_id
 * @property TaskStatus $status
 * @property int $entries_count
 * @property-read Semester $semester
 * @property-read SchoolClass $schoolClass
 * @property-read Course $course
 * @property-read Teacher $teacher
 * @property-read Room|null $specifiedRoom
 * @property-read Collection<int, TimetableEntry> $entries
 */
class TeachingTask extends Model
{
    protected $fillable = [
        'semester_id', 'academic_year_id', 'school_class_id', 'course_id', 'teacher_id',
        'weekly_items', 'room_mode', 'specified_room_id', 'status',
    ];

    protected function casts(): array
    {
        return [
            'weekly_items' => 'integer',
            'room_mode' => RoomMode::class,
            'status' => TaskStatus::class,
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
}
