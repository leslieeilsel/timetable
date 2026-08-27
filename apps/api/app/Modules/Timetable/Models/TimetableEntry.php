<?php

namespace App\Modules\Timetable\Models;

use App\Enums\WeekPattern;
use App\Modules\Resources\Models\Course;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use App\Modules\ScheduleTemplate\Models\Item;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\TeachingAssignment\Models\TeachingGroup;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * @property int $id
 * @property int $semester_id
 * @property int $timetable_version_id
 * @property int $teaching_assignment_id
 * @property int|null $school_class_id
 * @property int|null $teaching_group_id
 * @property int $teacher_id
 * @property int $course_id
 * @property int $actual_room_id
 * @property WeekPattern $week_pattern
 * @property array<int, int>|null $active_weeks
 * @property int $weekday
 * @property int $item_id
 * @property string $source
 * @property bool $is_locked
 * @property-read TeachingAssignment $teachingAssignment
 * @property-read TimetableVersion $timetableVersion
 * @property-read SchoolClass|null $schoolClass
 * @property-read TeachingGroup|null $teachingGroup
 * @property-read Collection<int, SchoolClass> $schoolClasses
 * @property-read Teacher $teacher
 * @property-read Collection<int, Teacher> $teachers
 * @property-read Course $course
 * @property-read Room $actualRoom
 * @property-read Item $item
 */
class TimetableEntry extends Model
{
    protected $fillable = [
        'semester_id', 'timetable_version_id', 'teaching_assignment_id', 'school_class_id', 'teaching_group_id',
        'teacher_id', 'course_id', 'actual_room_id', 'week_pattern', 'active_weeks', 'weekday', 'item_id',
        'source', 'is_locked',
    ];

    protected function casts(): array
    {
        return [
            'week_pattern' => WeekPattern::class,
            'active_weeks' => 'array',
            'weekday' => 'integer',
            'is_locked' => 'boolean',
        ];
    }

    /** @return BelongsTo<TimetableVersion, $this> */
    public function timetableVersion(): BelongsTo
    {
        return $this->belongsTo(TimetableVersion::class);
    }

    /** @return BelongsTo<TeachingAssignment, $this> */
    public function teachingAssignment(): BelongsTo
    {
        return $this->belongsTo(TeachingAssignment::class);
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

    /** @return BelongsToMany<SchoolClass, $this> */
    public function schoolClasses(): BelongsToMany
    {
        return $this->belongsToMany(SchoolClass::class, 'timetable_entry_classes')
            ->withPivot(['timetable_version_id', 'week_pattern', 'weekday', 'item_id']);
    }

    /** @return BelongsTo<Teacher, $this> */
    public function teacher(): BelongsTo
    {
        return $this->belongsTo(Teacher::class);
    }

    /** @return BelongsToMany<Teacher, $this> */
    public function teachers(): BelongsToMany
    {
        return $this->belongsToMany(Teacher::class, 'timetable_entry_teachers')
            ->withPivot(['timetable_version_id', 'week_pattern', 'weekday', 'item_id']);
    }

    /** @return BelongsTo<Course, $this> */
    public function course(): BelongsTo
    {
        return $this->belongsTo(Course::class);
    }

    /** @return BelongsTo<Room, $this> */
    public function actualRoom(): BelongsTo
    {
        return $this->belongsTo(Room::class, 'actual_room_id');
    }

    /** @return BelongsTo<Item, $this> */
    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }
}
