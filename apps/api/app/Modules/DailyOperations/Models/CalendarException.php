<?php

namespace App\Modules\DailyOperations\Models;

use App\Enums\CalendarExceptionType;
use App\Enums\OperationalStatus;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\Teacher;
use App\Modules\ScheduleTemplate\Models\Item;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Models\TimetableVersion;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $semester_id
 * @property int $timetable_version_id
 * @property Carbon $effective_date
 * @property Carbon|null $replacement_date
 * @property CalendarExceptionType $type
 * @property int|null $original_entry_id
 * @property int|null $related_entry_id
 * @property int|null $replacement_assignment_id
 * @property int|null $replacement_teacher_id
 * @property int|null $replacement_room_id
 * @property int|null $replacement_item_id
 * @property string|null $title
 * @property OperationalStatus $status
 * @property string $reason
 * @property int $created_by
 * @property-read Semester $semester
 * @property-read TimetableVersion $timetableVersion
 * @property-read TimetableEntry|null $originalEntry
 * @property-read TimetableEntry|null $relatedEntry
 * @property-read TeachingAssignment|null $replacementAssignment
 * @property-read Teacher|null $replacementTeacher
 * @property-read Room|null $replacementRoom
 * @property-read Item|null $replacementItem
 * @property-read User $creator
 */
class CalendarException extends Model
{
    protected $fillable = [
        'semester_id', 'timetable_version_id', 'effective_date', 'type', 'original_entry_id',
        'replacement_date', 'related_entry_id', 'replacement_assignment_id', 'replacement_teacher_id',
        'replacement_room_id', 'replacement_item_id', 'title', 'status', 'reason', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'effective_date' => 'date:Y-m-d',
            'replacement_date' => 'date:Y-m-d',
            'type' => CalendarExceptionType::class,
            'status' => OperationalStatus::class,
        ];
    }

    /** @return BelongsTo<Semester, $this> */
    public function semester(): BelongsTo
    {
        return $this->belongsTo(Semester::class);
    }

    /** @return BelongsTo<TimetableVersion, $this> */
    public function timetableVersion(): BelongsTo
    {
        return $this->belongsTo(TimetableVersion::class);
    }

    /** @return BelongsTo<TimetableEntry, $this> */
    public function originalEntry(): BelongsTo
    {
        return $this->belongsTo(TimetableEntry::class, 'original_entry_id');
    }

    /** @return BelongsTo<TimetableEntry, $this> */
    public function relatedEntry(): BelongsTo
    {
        return $this->belongsTo(TimetableEntry::class, 'related_entry_id');
    }

    /** @return BelongsTo<TeachingAssignment, $this> */
    public function replacementAssignment(): BelongsTo
    {
        return $this->belongsTo(TeachingAssignment::class, 'replacement_assignment_id');
    }

    /** @return BelongsTo<Teacher, $this> */
    public function replacementTeacher(): BelongsTo
    {
        return $this->belongsTo(Teacher::class, 'replacement_teacher_id');
    }

    /** @return BelongsTo<Room, $this> */
    public function replacementRoom(): BelongsTo
    {
        return $this->belongsTo(Room::class, 'replacement_room_id');
    }

    /** @return BelongsTo<Item, $this> */
    public function replacementItem(): BelongsTo
    {
        return $this->belongsTo(Item::class, 'replacement_item_id');
    }

    /** @return BelongsTo<User, $this> */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
