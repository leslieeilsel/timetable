<?php

namespace App\Modules\DailyOperations\Models;

use App\Enums\OperationalStatus;
use App\Models\User;
use App\Modules\Resources\Models\Teacher;
use App\Modules\Timetable\Models\TimetableEntry;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int|null $teacher_leave_id
 * @property int|null $calendar_exception_id
 * @property int $original_entry_id
 * @property Carbon $effective_date
 * @property int $replacement_teacher_id
 * @property OperationalStatus $status
 * @property string|null $reason
 * @property int $created_by
 * @property-read TeacherLeave|null $teacherLeave
 * @property-read CalendarException|null $calendarException
 * @property-read TimetableEntry $originalEntry
 * @property-read Teacher $replacementTeacher
 * @property-read User $creator
 */
class Substitution extends Model
{
    protected $fillable = [
        'teacher_leave_id', 'calendar_exception_id', 'original_entry_id', 'effective_date',
        'replacement_teacher_id', 'status', 'reason', 'created_by',
    ];

    protected function casts(): array
    {
        return ['effective_date' => 'date:Y-m-d', 'status' => OperationalStatus::class];
    }

    /** @return BelongsTo<TeacherLeave, $this> */
    public function teacherLeave(): BelongsTo
    {
        return $this->belongsTo(TeacherLeave::class);
    }

    /** @return BelongsTo<CalendarException, $this> */
    public function calendarException(): BelongsTo
    {
        return $this->belongsTo(CalendarException::class);
    }

    /** @return BelongsTo<TimetableEntry, $this> */
    public function originalEntry(): BelongsTo
    {
        return $this->belongsTo(TimetableEntry::class, 'original_entry_id');
    }

    /** @return BelongsTo<Teacher, $this> */
    public function replacementTeacher(): BelongsTo
    {
        return $this->belongsTo(Teacher::class, 'replacement_teacher_id');
    }

    /** @return BelongsTo<User, $this> */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
