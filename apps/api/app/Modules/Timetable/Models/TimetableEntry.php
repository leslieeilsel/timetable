<?php

namespace App\Modules\Timetable\Models;

use App\Modules\Resources\Models\Course;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use App\Modules\ScheduleTemplate\Models\Item;
use App\Modules\TeachingTask\Models\TeachingTask;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $semester_id
 * @property int $teaching_task_id
 * @property int $school_class_id
 * @property int $teacher_id
 * @property int $course_id
 * @property int $actual_room_id
 * @property int $weekday
 * @property int $item_id
 * @property string $source
 * @property bool $is_locked
 * @property-read TeachingTask $teachingTask
 * @property-read SchoolClass $schoolClass
 * @property-read Teacher $teacher
 * @property-read Course $course
 * @property-read Room $actualRoom
 * @property-read Item $item
 */
class TimetableEntry extends Model
{
    protected $fillable = [
        'semester_id', 'teaching_task_id', 'school_class_id', 'teacher_id', 'course_id',
        'actual_room_id', 'weekday', 'item_id', 'source', 'is_locked',
    ];

    protected function casts(): array
    {
        return ['weekday' => 'integer', 'is_locked' => 'boolean'];
    }

    /** @return BelongsTo<TeachingTask, $this> */
    public function teachingTask(): BelongsTo
    {
        return $this->belongsTo(TeachingTask::class);
    }

    /** @return BelongsTo<SchoolClass, $this> */
    public function schoolClass(): BelongsTo
    {
        return $this->belongsTo(SchoolClass::class);
    }

    /** @return BelongsTo<Teacher, $this> */
    public function teacher(): BelongsTo
    {
        return $this->belongsTo(Teacher::class);
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
