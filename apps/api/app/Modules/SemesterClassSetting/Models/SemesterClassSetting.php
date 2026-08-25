<?php

namespace App\Modules\SemesterClassSetting\Models;

use App\Enums\ResourceStatus;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $semester_id
 * @property int $academic_year_id
 * @property int $school_class_id
 * @property int|null $fixed_room_id
 * @property int|null $homeroom_teacher_id
 * @property ResourceStatus $status
 * @property-read Semester $semester
 * @property-read SchoolClass $schoolClass
 * @property-read Room|null $fixedRoom
 * @property-read Teacher|null $homeroomTeacher
 */
class SemesterClassSetting extends Model
{
    protected $fillable = [
        'semester_id',
        'academic_year_id',
        'school_class_id',
        'fixed_room_id',
        'homeroom_teacher_id',
        'status',
    ];

    protected function casts(): array
    {
        return ['status' => ResourceStatus::class];
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

    /** @return BelongsTo<Room, $this> */
    public function fixedRoom(): BelongsTo
    {
        return $this->belongsTo(Room::class, 'fixed_room_id');
    }

    /** @return BelongsTo<Teacher, $this> */
    public function homeroomTeacher(): BelongsTo
    {
        return $this->belongsTo(Teacher::class, 'homeroom_teacher_id');
    }
}
