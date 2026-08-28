<?php

namespace App\Modules\DailyOperations\Services;

use App\Enums\CalendarExceptionType;
use App\Enums\OperationalStatus;
use App\Enums\WeekPattern;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\DailyOperations\Models\CalendarException;
use App\Modules\DailyOperations\Models\Substitution;
use App\Modules\DailyOperations\Models\TeacherLeave;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\Teacher;
use App\Modules\ScheduleTemplate\Models\Item;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Models\TimetableVersion;
use App\Modules\Timetable\Services\RoomResolver;
use App\Support\ApiProblemException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class DailyTimetableService
{
    public function __construct(private readonly RoomResolver $rooms) {}

    /**
     * @return array{
     *   date: string,
     *   weekday: int,
     *   week_number: int,
     *   version: TimetableVersion,
     *   rows: list<array<string, mixed>>,
     *   summary: array{total: int, temporary: int, cancelled: int, substitutions: int}
     * }
     */
    public function forDate(
        Semester $semester,
        string $date,
        ?int $ignoreSubstitutionsForTeacherId = null,
    ): array {
        $context = $this->dateContext($semester, $date);
        $version = $this->currentVersion($semester);
        $entries = TimetableEntry::query()
            ->where('timetable_version_id', $version->id)
            ->where('weekday', $context['weekday'])
            ->with($this->entryRelations())
            ->orderBy('item_id')
            ->get()
            ->filter(fn (TimetableEntry $entry): bool => $this->activeInWeek($entry, $context['week_number']))
            ->values();
        $rows = $entries
            ->map(fn (TimetableEntry $entry): array => $this->entryRow($entry, $context['date'], $context['week_number']))
            ->all();
        $exceptions = CalendarException::query()
            ->where('semester_id', $semester->id)
            ->where('timetable_version_id', $version->id)
            ->where('status', OperationalStatus::Active->value)
            ->where(function ($query) use ($context): void {
                $query->whereDate('effective_date', $context['date'])
                    ->orWhereDate('replacement_date', $context['date']);
            })
            ->with([
                'originalEntry' => fn ($query) => $query->with($this->entryRelations()),
                'relatedEntry' => fn ($query) => $query->with($this->entryRelations()),
                'replacementAssignment' => fn ($query) => $query->with($this->assignmentRelations()),
                'replacementTeacher:id,name,employee_no',
                'replacementRoom:id,name',
                'replacementItem:id,name,start_time,end_time,sort_order',
            ])
            ->orderBy('id')
            ->get();
        $items = $semester->scheduleTemplate()->firstOrFail()->items()
            ->get(['id', 'name', 'start_time', 'end_time', 'sort_order'])
            ->keyBy('id');

        foreach ($exceptions as $exception) {
            $effective = $exception->effective_date->toDateString() === $context['date'];
            $replacementDate = $exception->replacement_date?->toDateString()
                ?? $exception->effective_date->toDateString();
            if ($effective) {
                $this->applyEffectiveException($rows, $exception, $items, $context);
            }
            if ($replacementDate === $context['date']
                && in_array($exception->type, [CalendarExceptionType::Move, CalendarExceptionType::Makeup], true)) {
                $this->appendReplacementRow($rows, $exception, $context);
            }
        }

        $substitutions = Substitution::query()
            ->whereDate('effective_date', $context['date'])
            ->where('status', OperationalStatus::Active->value)
            ->whereHas('originalEntry', fn ($query) => $query->where('timetable_version_id', $version->id))
            ->with(['replacementTeacher:id,name,employee_no', 'teacherLeave:id,teacher_id'])
            ->orderBy('id')
            ->get();
        foreach ($substitutions as $substitution) {
            $replacedTeacherId = $substitution->replaced_teacher_id
                ?? $substitution->teacherLeave?->teacher_id;
            if ($replacedTeacherId === $ignoreSubstitutionsForTeacherId) {
                continue;
            }
            foreach ($rows as &$row) {
                if ($row['original_entry_id'] !== $substitution->original_entry_id || $row['is_cancelled']) {
                    continue;
                }
                $this->replaceTeacher(
                    $row,
                    $replacedTeacherId ?? $row['primary_teacher_id'],
                    $substitution->replacement_teacher_id,
                    $substitution->replacementTeacher->name,
                );
                $row['substitution_id'] = $substitution->id;
                $row['substitution_ids'][] = $substitution->id;
                $row['substitution_notes'][] = $substitution->reason;
                $row['status'] = 'substitution';
                $row['note'] = $substitution->reason;
            }
            unset($row);
        }

        usort($rows, fn (array $left, array $right): int => $left['item_sort_order'] <=> $right['item_sort_order']
            ?: strcmp($left['target_name'], $right['target_name'])
            ?: $left['original_entry_id'] <=> $right['original_entry_id']);

        return [
            'date' => $context['date'],
            'weekday' => $context['weekday'],
            'week_number' => $context['week_number'],
            'version' => $version,
            'rows' => $rows,
            'summary' => [
                'total' => count($rows),
                'temporary' => count(array_filter($rows, fn (array $row): bool => $row['status'] !== 'base')),
                'cancelled' => count(array_filter($rows, fn (array $row): bool => $row['is_cancelled'])),
                'substitutions' => count(array_filter($rows, fn (array $row): bool => $row['substitution_id'] !== null)),
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function previewException(Semester $semester, array $data): array
    {
        $type = $data['type'] instanceof CalendarExceptionType
            ? $data['type']
            : CalendarExceptionType::from($data['type']);
        $version = $this->currentVersion($semester);
        $effective = $this->dateContext($semester, (string) $data['effective_date']);
        $targetDate = (string) ($data['replacement_date'] ?? $data['effective_date']);
        $target = $this->dateContext($semester, $targetDate);
        $original = isset($data['original_entry_id'])
            ? $this->entryForVersion($version, (int) $data['original_entry_id'])
            : null;
        $related = isset($data['related_entry_id'])
            ? $this->entryForVersion($version, (int) $data['related_entry_id'])
            : null;
        $assignment = isset($data['replacement_assignment_id'])
            ? TeachingAssignment::query()->with($this->assignmentRelations())
                ->where('semester_id', $semester->id)->findOrFail((int) $data['replacement_assignment_id'])
            : null;
        $this->assertPayloadForType($type, $original, $related, $assignment, $data);
        if (isset($data['replacement_teacher_id'])) {
            $courseId = $original->course_id ?? $assignment?->course_id;
            if ($courseId === null) {
                throw new ApiProblemException('DAILY_REPLACEMENT_COURSE_REQUIRED', '无法确认临时教师对应的课程', 422);
            }
            $qualified = Teacher::query()
                ->whereKey((int) $data['replacement_teacher_id'])
                ->where('is_active', true)
                ->whereHas('courses', fn ($query) => $query->whereKey($courseId))
                ->exists();
            if (! $qualified) {
                throw new ApiProblemException(
                    'DAILY_TEACHER_NOT_QUALIFIED',
                    '所选教师不具备该课程的授课资格，请选择同课程教师',
                    422,
                );
            }
        }
        foreach (array_filter([$original, $related]) as $activeEntry) {
            $actualEntry = collect($this->forDate($semester, $effective['date'])['rows'])
                ->first(fn (array $row): bool => $row['original_entry_id'] === $activeEntry->id && ! $row['is_cancelled']);
            if (! is_array($actualEntry)) {
                throw new ApiProblemException('DAILY_ORIGINAL_NOT_ACTIVE', '所选课程在该日期并未实际发生', 422, [
                    'entry_id' => $activeEntry->id,
                ]);
            }
        }
        $entryIds = array_values(array_filter([
            $original?->id,
            $related?->id,
        ], fn (?int $id): bool => $id !== null));
        if ($entryIds !== []) {
            $existingException = CalendarException::query()
                ->where('semester_id', $semester->id)
                ->where('timetable_version_id', $version->id)
                ->where('status', OperationalStatus::Active->value)
                ->whereDate('effective_date', $effective['date'])
                ->where(function ($query) use ($entryIds): void {
                    $query->whereIn('original_entry_id', $entryIds)
                        ->orWhereIn('related_entry_id', $entryIds);
                })
                ->first();
            if ($existingException !== null) {
                throw new ApiProblemException('DAILY_EXCEPTION_ALREADY_EXISTS', '所选课程在该日期已有临时调整，请先取消原调整', 409, [
                    'exception_id' => $existingException->id,
                ]);
            }
        }

        $conflicts = [];
        $affected = [];
        if ($original !== null) {
            $affected[] = $this->entryImpact($original, $effective['date']);
        }
        if ($related !== null) {
            if ($related->id === $original?->id) {
                throw new ApiProblemException('DAILY_RELATED_ENTRY_INVALID', '交换目标不能与原课程相同', 422);
            }
            $affected[] = $this->entryImpact($related, $effective['date']);
        }
        if ($type === CalendarExceptionType::Move && $original !== null) {
            $item = $this->targetItem($semester, (int) $data['replacement_item_id']);
            $candidate = $this->candidateFromEntry($original, $data);
            $conflicts = $this->candidateConflicts(
                $semester,
                $target['date'],
                $item,
                $candidate,
                [$original->id],
            );
        } elseif ($type === CalendarExceptionType::Swap && $original !== null && $related !== null) {
            if ($original->weekday !== $related->weekday) {
                throw new ApiProblemException('DAILY_SWAP_DATE_MISMATCH', '当前仅支持同一天内两节课程交换', 422);
            }
            $firstItem = $this->targetItem($semester, $related->item_id);
            $secondItem = $this->targetItem($semester, $original->item_id);
            $conflicts = [
                ...$this->candidateConflicts(
                    $semester,
                    $effective['date'],
                    $firstItem,
                    $this->candidateFromEntry($original, $data),
                    [$original->id, $related->id],
                ),
                ...$this->candidateConflicts(
                    $semester,
                    $effective['date'],
                    $secondItem,
                    $this->candidateFromEntry($related, []),
                    [$original->id, $related->id],
                ),
            ];
        } elseif (in_array($type, [CalendarExceptionType::TeacherChange, CalendarExceptionType::RoomChange], true)
            && $original !== null) {
            $item = $this->targetItem($semester, $original->item_id);
            $conflicts = $this->candidateConflicts(
                $semester,
                $effective['date'],
                $item,
                $this->candidateFromEntry($original, $data),
                [$original->id],
            );
        } elseif ($type === CalendarExceptionType::Makeup && $assignment !== null) {
            $item = $this->targetItem($semester, (int) $data['replacement_item_id']);
            $conflicts = $this->candidateConflicts(
                $semester,
                $target['date'],
                $item,
                $this->candidateFromAssignment($assignment, $data),
                [],
            );
            $affected[] = [
                'entry_id' => null,
                'date' => $target['date'],
                'target' => $assignment->school_class_id !== null
                    ? $assignment->schoolClass->name
                    : $assignment->teachingGroup->name,
                'course' => $assignment->course->name,
                'teacher' => $assignment->teacher->name,
            ];
        }
        $conflicts = collect($conflicts)
            ->unique(fn (array $conflict): string => $conflict['type'].':'.$conflict['message'])
            ->values()
            ->all();
        $notifications = collect($affected)
            ->flatMap(fn (array $item): array => array_filter([
                $item['target'] ?? null,
                $item['teacher'] ?? null,
            ]))
            ->unique()
            ->values()
            ->all();
        $allowed = $conflicts === [];

        return [
            'allowed' => $allowed,
            'summary' => $allowed
                ? '可以保存：基础周课表不会被修改，临时安排仅在指定日期生效。'
                : '暂不能保存：目标日期存在资源冲突。',
            'type' => $type->value,
            'effective_date' => $effective['date'],
            'replacement_date' => $target['date'],
            'conflicts' => $conflicts,
            'affected' => $affected,
            'notifications' => $notifications,
            'version_id' => $version->id,
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function affectedByLeave(
        Semester $semester,
        int $teacherId,
        Carbon $startsAt,
        Carbon $endsAt,
    ): array {
        $teacher = Teacher::query()->where('is_active', true)->findOrFail($teacherId);
        $affected = [];
        $date = $startsAt->copy()->startOfDay();
        $last = $endsAt->copy()->startOfDay();
        while ($date->lessThanOrEqualTo($last)) {
            if ($date->betweenIncluded($semester->start_date, $semester->end_date)) {
                $daily = $this->forDate($semester, $date->toDateString(), $teacher->id);
                foreach ($daily['rows'] as $row) {
                    if ($row['is_cancelled'] || ! in_array($teacher->id, $row['teacher_ids'], true)) {
                        continue;
                    }
                    $itemStart = Carbon::parse($row['date'].' '.$row['start_time']);
                    $itemEnd = Carbon::parse($row['date'].' '.$row['end_time']);
                    if ($itemStart->lessThan($endsAt) && $itemEnd->greaterThan($startsAt)) {
                        $affected[] = $row;
                    }
                }
            }
            $date->addDay();
        }

        return $affected;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function substitutionRecommendations(
        Semester $semester,
        TimetableEntry $entry,
        string $date,
        ?int $excludedTeacherId = null,
    ): array {
        $dateContext = $this->dateContext($semester, $date);
        $version = $this->currentVersion($semester);
        $entry->loadMissing($this->entryRelations());
        $item = $entry->item;
        $itemStart = Carbon::parse($date.' '.$item->start_time);
        $itemEnd = Carbon::parse($date.' '.$item->end_time);
        $dailyRows = collect($this->forDate($semester, $date)['rows']);
        $gradeIds = $entry->schoolClasses->pluck('grade_id')->map(fn ($id): int => (int) $id)->unique()->values()->all();
        $teachers = Teacher::query()
            ->where('is_active', true)
            ->whereKeyNot($excludedTeacherId ?? $entry->teacher_id)
            ->whereHas('courses', fn ($query) => $query->whereKey($entry->course_id))
            ->with('courses:id,name')
            ->orderBy('name')
            ->get();
        $recommendations = [];
        foreach ($teachers as $teacher) {
            $onLeave = TeacherLeave::query()
                ->where('teacher_id', $teacher->id)
                ->where('status', OperationalStatus::Active->value)
                ->where('starts_at', '<', $itemEnd)
                ->where('ends_at', '>', $itemStart)
                ->exists();
            if ($onLeave) {
                continue;
            }
            $occupied = $dailyRows->contains(fn (array $row): bool => ! $row['is_cancelled'] && $row['item_id'] === $entry->item_id
                && in_array($teacher->id, $row['teacher_ids'], true));
            if ($occupied) {
                continue;
            }
            $dailyLoad = $dailyRows->filter(fn (array $row): bool => ! $row['is_cancelled'] && in_array($teacher->id, $row['teacher_ids'], true))->count();
            $weeklyLoad = TimetableEntry::query()
                ->where('timetable_version_id', $version->id)
                ->whereHas('teachers', fn ($query) => $query->whereKey($teacher->id))
                ->get()
                ->filter(fn (TimetableEntry $candidate): bool => $this->activeInWeek($candidate, $dateContext['week_number']))
                ->count();
            $itemOrders = $dailyRows
                ->filter(fn (array $row): bool => ! $row['is_cancelled'] && in_array($teacher->id, $row['teacher_ids'], true))
                ->pluck('item_sort_order')
                ->map(fn ($order): int => (int) $order)
                ->all();
            $consecutiveLoad = $this->consecutiveLoadAfterAdding($itemOrders, $item->sort_order);
            $sameGradeExperience = TeachingAssignment::query()
                ->where('semester_id', $semester->id)
                ->where('teacher_id', $teacher->id)
                ->whereHas('schoolClass', fn ($query) => $query->whereIn('grade_id', $gradeIds))
                ->exists();
            $historyCount = Substitution::query()
                ->where('replacement_teacher_id', $teacher->id)
                ->where('status', OperationalStatus::Active->value)
                ->count();
            $score = 45 + max(0, 18 - $dailyLoad * 3)
                + max(0, 12 - intdiv($weeklyLoad, 2))
                + ($sameGradeExperience ? 10 : 0)
                + max(0, 10 - min(10, $historyCount))
                + ($consecutiveLoad <= 2 ? 5 : ($consecutiveLoad === 3 ? 1 : -8));
            $reasons = ['具备'.$entry->course->name.'授课资格', '目标课节无课程且未请假'];
            $reasons[] = $dailyLoad === 0 ? '当天尚无授课，负荷最轻' : "当天已有 {$dailyLoad} 节课";
            $reasons[] = "本周基础课表共 {$weeklyLoad} 节课";
            $reasons[] = $consecutiveLoad <= 2
                ? "代课后最多连续 {$consecutiveLoad} 节，节奏较宽松"
                : "代课后将连续 {$consecutiveLoad} 节，请关注教师负荷";
            if ($sameGradeExperience) {
                $reasons[] = '有同年级任课经验';
            }
            $reasons[] = $historyCount === 0 ? '近期未安排过代课' : "历史代课 {$historyCount} 次";
            $recommendations[] = [
                'teacher' => $teacher,
                'score' => min(100, $score),
                'daily_load' => $dailyLoad,
                'weekly_load' => $weeklyLoad,
                'consecutive_load' => $consecutiveLoad,
                'historical_substitutions' => $historyCount,
                'reasons' => $reasons,
            ];
        }
        usort($recommendations, fn (array $left, array $right): int => $right['score'] <=> $left['score']
            ?: $left['daily_load'] <=> $right['daily_load']
            ?: strcmp($left['teacher']->name, $right['teacher']->name));

        return array_slice($recommendations, 0, 12);
    }

    /** @param list<int> $occupiedOrders */
    private function consecutiveLoadAfterAdding(array $occupiedOrders, int $targetOrder): int
    {
        $orders = array_values(array_unique([$targetOrder, ...$occupiedOrders]));
        sort($orders);
        $longest = 0;
        $current = 0;
        $previous = null;
        foreach ($orders as $order) {
            $current = $previous !== null && $order === $previous + 1 ? $current + 1 : 1;
            $longest = max($longest, $current);
            $previous = $order;
        }

        return $longest;
    }

    public function currentVersion(Semester $semester): TimetableVersion
    {
        if ($semester->current_timetable_version_id === null) {
            throw new ApiProblemException('CURRENT_TIMETABLE_REQUIRED', '请先将一个完整课表版本设为当前课表', 409);
        }

        return TimetableVersion::query()
            ->where('semester_id', $semester->id)
            ->findOrFail($semester->current_timetable_version_id);
    }

    /** @return array{date: string, weekday: int, week_number: int} */
    private function dateContext(Semester $semester, string $date): array
    {
        try {
            $value = Carbon::parse($date)->startOfDay();
        } catch (\Throwable) {
            throw new ApiProblemException('DAILY_DATE_INVALID', '日期格式无效', 422);
        }
        if ($value->lessThan($semester->start_date) || $value->greaterThan($semester->end_date)) {
            throw new ApiProblemException('DAILY_DATE_OUTSIDE_SEMESTER', '日期不在当前学期范围内', 422);
        }
        $days = (int) $semester->start_date->copy()->startOfDay()->diffInDays($value);

        return [
            'date' => $value->toDateString(),
            'weekday' => $value->dayOfWeekIso,
            'week_number' => intdiv($days, 7) + 1,
        ];
    }

    private function activeInWeek(TimetableEntry $entry, int $weekNumber): bool
    {
        return match ($entry->week_pattern) {
            WeekPattern::All => true,
            WeekPattern::A => $weekNumber % 2 === 1,
            WeekPattern::B => $weekNumber % 2 === 0,
            WeekPattern::Specified => in_array($weekNumber, $entry->active_weeks ?? [], true),
        };
    }

    /** @return list<string> */
    private function entryRelations(): array
    {
        return [
            'schoolClass:id,name,grade_id',
            'teachingGroup:id,name',
            'schoolClasses:id,name,grade_id',
            'teacher:id,name,employee_no',
            'teachers:id,name,employee_no',
            'course:id,name,short_name',
            'actualRoom:id,name',
            'item:id,name,start_time,end_time,sort_order',
            'teachingAssignment.collaborators:id,name',
        ];
    }

    /** @return list<string> */
    private function assignmentRelations(): array
    {
        return [
            'semester', 'schoolClass:id,name,grade_id', 'teachingGroup.schoolClasses:id,name,grade_id',
            'teacher:id,name,employee_no', 'collaborators:id,name,employee_no',
            'course:id,name,short_name', 'specifiedRoom:id,name',
        ];
    }

    /** @return array<string, mixed> */
    private function entryRow(TimetableEntry $entry, string $date, int $weekNumber): array
    {
        return [
            'key' => 'base-'.$entry->id,
            'date' => $date,
            'week_number' => $weekNumber,
            'original_entry_id' => $entry->id,
            'exception_id' => null,
            'substitution_id' => null,
            'substitution_ids' => [],
            'substitution_notes' => [],
            'item_id' => $entry->item_id,
            'item_name' => $entry->item->name,
            'item_sort_order' => $entry->item->sort_order,
            'start_time' => $entry->item->start_time,
            'end_time' => $entry->item->end_time,
            'course_id' => $entry->course_id,
            'course_name' => $entry->course->name,
            'target_name' => $entry->school_class_id !== null
                ? $entry->schoolClass->name
                : $entry->teachingGroup->name,
            'class_ids' => $entry->schoolClasses->pluck('id')->map(fn ($id): int => (int) $id)->all(),
            'class_names' => $entry->schoolClasses->pluck('name')->all(),
            'primary_teacher_id' => $entry->teacher_id,
            'teacher_id' => $entry->teacher_id,
            'teacher_name' => $entry->teacher->name,
            'teacher_ids' => $entry->teachers->pluck('id')->map(fn ($id): int => (int) $id)->all(),
            'teacher_names' => $entry->teachers->pluck('name')->all(),
            'room_id' => $entry->actual_room_id,
            'room_name' => $entry->actualRoom->name,
            'week_pattern' => $entry->week_pattern->value,
            'status' => 'base',
            'exception_type' => null,
            'title' => null,
            'note' => null,
            'is_cancelled' => false,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @param  Collection<int, Item>  $items
     * @param  array{date: string, weekday: int, week_number: int}  $context
     */
    private function applyEffectiveException(
        array &$rows,
        CalendarException $exception,
        Collection $items,
        array $context,
    ): void {
        $index = $this->rowIndex($rows, $exception->original_entry_id);
        if (in_array($exception->type, [CalendarExceptionType::Cancel, CalendarExceptionType::Activity], true)
            && $index !== null) {
            $rows[$index]['status'] = $exception->type->value;
            $rows[$index]['exception_type'] = $exception->type->value;
            $rows[$index]['exception_id'] = $exception->id;
            $rows[$index]['title'] = $exception->title;
            $rows[$index]['note'] = $exception->reason;
            $rows[$index]['is_cancelled'] = true;
        } elseif ($exception->type === CalendarExceptionType::Move && $index !== null) {
            $rows[$index]['status'] = 'moved_out';
            $rows[$index]['exception_type'] = 'move';
            $rows[$index]['exception_id'] = $exception->id;
            $rows[$index]['note'] = $exception->reason;
            $rows[$index]['is_cancelled'] = true;
        } elseif ($exception->type === CalendarExceptionType::TeacherChange && $index !== null
            && $exception->replacementTeacher !== null) {
            $this->replacePrimaryTeacher(
                $rows[$index],
                $exception->replacement_teacher_id,
                $exception->replacementTeacher->name,
            );
            $rows[$index]['status'] = 'teacher_change';
            $rows[$index]['exception_type'] = 'teacher_change';
            $rows[$index]['exception_id'] = $exception->id;
            $rows[$index]['note'] = $exception->reason;
        } elseif ($exception->type === CalendarExceptionType::RoomChange && $index !== null
            && $exception->replacementRoom !== null) {
            $rows[$index]['room_id'] = $exception->replacement_room_id;
            $rows[$index]['room_name'] = $exception->replacementRoom->name;
            $rows[$index]['status'] = 'room_change';
            $rows[$index]['exception_type'] = 'room_change';
            $rows[$index]['exception_id'] = $exception->id;
            $rows[$index]['note'] = $exception->reason;
        } elseif ($exception->type === CalendarExceptionType::Swap
            && $exception->original_entry_id !== null && $exception->related_entry_id !== null) {
            $first = $this->rowIndex($rows, $exception->original_entry_id);
            $second = $this->rowIndex($rows, $exception->related_entry_id);
            if ($first !== null && $second !== null) {
                $firstItem = $items->get($rows[$first]['item_id']);
                $secondItem = $items->get($rows[$second]['item_id']);
                if ($firstItem instanceof Item && $secondItem instanceof Item) {
                    $this->setRowItem($rows[$first], $secondItem);
                    $this->setRowItem($rows[$second], $firstItem);
                    foreach ([$first, $second] as $rowIndex) {
                        $rows[$rowIndex]['status'] = 'swap';
                        $rows[$rowIndex]['exception_type'] = 'swap';
                        $rows[$rowIndex]['exception_id'] = $exception->id;
                        $rows[$rowIndex]['note'] = $exception->reason;
                    }
                }
            }
        }
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @param  array{date: string, weekday: int, week_number: int}  $context
     */
    private function appendReplacementRow(array &$rows, CalendarException $exception, array $context): void
    {
        if ($exception->type === CalendarExceptionType::Move
            && $exception->originalEntry !== null && $exception->replacementItem !== null) {
            $row = $this->entryRow($exception->originalEntry, $context['date'], $context['week_number']);
            $this->setRowItem($row, $exception->replacementItem);
            if ($exception->replacementTeacher !== null) {
                $this->replacePrimaryTeacher($row, $exception->replacement_teacher_id, $exception->replacementTeacher->name);
            }
            if ($exception->replacementRoom !== null) {
                $row['room_id'] = $exception->replacement_room_id;
                $row['room_name'] = $exception->replacementRoom->name;
            }
            $row['key'] = 'exception-'.$exception->id.'-move';
            $row['status'] = 'moved_in';
            $row['exception_type'] = 'move';
            $row['exception_id'] = $exception->id;
            $row['note'] = $exception->reason;
            $rows[] = $row;
        } elseif ($exception->type === CalendarExceptionType::Makeup
            && $exception->replacementAssignment !== null && $exception->replacementItem !== null) {
            $row = $this->assignmentRow(
                $exception->replacementAssignment,
                $exception->replacementItem,
                $context,
            );
            $row['key'] = 'exception-'.$exception->id.'-makeup';
            $row['status'] = 'makeup';
            $row['exception_type'] = 'makeup';
            $row['exception_id'] = $exception->id;
            $row['note'] = $exception->reason;
            $rows[] = $row;
        }
    }

    /**
     * @param  array{date: string, weekday: int, week_number: int}  $context
     * @return array<string, mixed>
     */
    private function assignmentRow(TeachingAssignment $assignment, Item $item, array $context): array
    {
        $assignment->loadMissing($this->assignmentRelations());
        $classIds = $assignment->school_class_id !== null
            ? [$assignment->school_class_id]
            : $assignment->teachingGroup?->schoolClasses->pluck('id')->map(fn ($id): int => (int) $id)->all() ?? [];
        $classNames = $assignment->school_class_id !== null
            ? [$assignment->schoolClass->name]
            : $assignment->teachingGroup?->schoolClasses->pluck('name')->all() ?? [];
        $teacherPairs = $this->uniqueTeacherPairs([
            ['id' => $assignment->teacher_id, 'name' => $assignment->teacher->name],
            ...$assignment->collaborators
                ->map(fn (Teacher $teacher): array => ['id' => $teacher->id, 'name' => $teacher->name])
                ->all(),
        ]);
        $teacherIds = array_column($teacherPairs, 'id');
        $teacherNames = array_column($teacherPairs, 'name');
        $roomId = $this->rooms->resolve($assignment);
        $roomName = Room::query()->whereKey($roomId)->value('name') ?? "教室 #{$roomId}";

        return [
            'key' => 'assignment-'.$assignment->id.'-'.$context['date'].'-'.$item->id,
            'date' => $context['date'],
            'week_number' => $context['week_number'],
            'original_entry_id' => null,
            'exception_id' => null,
            'substitution_id' => null,
            'substitution_ids' => [],
            'substitution_notes' => [],
            'item_id' => $item->id,
            'item_name' => $item->name,
            'item_sort_order' => $item->sort_order,
            'start_time' => $item->start_time,
            'end_time' => $item->end_time,
            'course_id' => $assignment->course_id,
            'course_name' => $assignment->course->name,
            'target_name' => $assignment->school_class_id !== null
                ? $assignment->schoolClass->name
                : $assignment->teachingGroup->name,
            'class_ids' => $classIds,
            'class_names' => $classNames,
            'primary_teacher_id' => $assignment->teacher_id,
            'teacher_id' => $assignment->teacher_id,
            'teacher_name' => $assignment->teacher->name,
            'teacher_ids' => $teacherIds,
            'teacher_names' => $teacherNames,
            'room_id' => $roomId,
            'room_name' => $roomName,
            'week_pattern' => $assignment->week_pattern->value,
            'status' => 'base',
            'exception_type' => null,
            'title' => null,
            'note' => null,
            'is_cancelled' => false,
        ];
    }

    /** @param array<string, mixed> $row */
    private function replacePrimaryTeacher(array &$row, int $teacherId, string $teacherName): void
    {
        $teacherPairs = [
            ['id' => $teacherId, 'name' => $teacherName],
            ...array_values(array_filter(
                $this->teacherPairs($row),
                fn (array $teacher): bool => $teacher['id'] !== $row['primary_teacher_id'],
            )),
        ];
        $row['teacher_id'] = $teacherId;
        $row['teacher_name'] = $teacherName;
        $this->setTeacherPairs($row, $teacherPairs);
    }

    /** @param array<string, mixed> $row */
    private function replaceTeacher(
        array &$row,
        int $replacedTeacherId,
        int $replacementTeacherId,
        string $replacementTeacherName,
    ): void {
        if ($replacedTeacherId === $row['primary_teacher_id']) {
            $this->replacePrimaryTeacher($row, $replacementTeacherId, $replacementTeacherName);

            return;
        }
        $teacherPairs = $this->teacherPairs($row);
        $replaced = false;
        foreach ($teacherPairs as &$teacher) {
            if ($teacher['id'] !== $replacedTeacherId) {
                continue;
            }
            $teacher = ['id' => $replacementTeacherId, 'name' => $replacementTeacherName];
            $replaced = true;
            break;
        }
        unset($teacher);
        if (! $replaced) {
            return;
        }
        $this->setTeacherPairs($row, $teacherPairs);
    }

    /**
     * @param  array<string, mixed>  $row
     * @return list<array{id: int, name: string}>
     */
    private function teacherPairs(array $row): array
    {
        $pairs = [];
        foreach ($row['teacher_ids'] as $index => $teacherId) {
            $pairs[] = [
                'id' => (int) $teacherId,
                'name' => (string) ($row['teacher_names'][$index] ?? ''),
            ];
        }

        return $pairs;
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  list<array{id: int, name: string}>  $teacherPairs
     */
    private function setTeacherPairs(array &$row, array $teacherPairs): void
    {
        $teacherPairs = $this->uniqueTeacherPairs($teacherPairs);
        $row['teacher_ids'] = array_column($teacherPairs, 'id');
        $row['teacher_names'] = array_column($teacherPairs, 'name');
    }

    /**
     * @param  list<array{id: int, name: string}>  $teacherPairs
     * @return list<array{id: int, name: string}>
     */
    private function uniqueTeacherPairs(array $teacherPairs): array
    {
        $unique = [];
        foreach ($teacherPairs as $teacher) {
            if (array_key_exists($teacher['id'], $unique)) {
                continue;
            }
            $unique[$teacher['id']] = $teacher;
        }

        return array_values($unique);
    }

    /** @param array<string, mixed> $row */
    private function setRowItem(array &$row, Item $item): void
    {
        $row['item_id'] = $item->id;
        $row['item_name'] = $item->name;
        $row['item_sort_order'] = $item->sort_order;
        $row['start_time'] = $item->start_time;
        $row['end_time'] = $item->end_time;
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    private function rowIndex(array $rows, ?int $entryId): ?int
    {
        if ($entryId === null) {
            return null;
        }
        foreach ($rows as $index => $row) {
            if ($row['original_entry_id'] === $entryId && ! $row['is_cancelled']) {
                return $index;
            }
        }

        return null;
    }

    private function entryForVersion(TimetableVersion $version, int $entryId): TimetableEntry
    {
        return TimetableEntry::query()->with($this->entryRelations())
            ->where('timetable_version_id', $version->id)
            ->findOrFail($entryId);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function assertPayloadForType(
        CalendarExceptionType $type,
        ?TimetableEntry $original,
        ?TimetableEntry $related,
        ?TeachingAssignment $assignment,
        array $data,
    ): void {
        $requiresOriginal = in_array($type, [
            CalendarExceptionType::Move, CalendarExceptionType::Swap,
            CalendarExceptionType::TeacherChange, CalendarExceptionType::RoomChange,
            CalendarExceptionType::Cancel, CalendarExceptionType::Activity,
        ], true);
        if ($requiresOriginal && $original === null) {
            throw new ApiProblemException('DAILY_ORIGINAL_REQUIRED', '该调整类型必须选择原课程', 422);
        }
        if ($type === CalendarExceptionType::Swap && $related === null) {
            throw new ApiProblemException('DAILY_RELATED_ENTRY_REQUIRED', '交换课程必须选择另一节课', 422);
        }
        if ($type === CalendarExceptionType::Makeup && $assignment === null) {
            throw new ApiProblemException('DAILY_ASSIGNMENT_REQUIRED', '补课必须选择任课关系', 422);
        }
        if (in_array($type, [CalendarExceptionType::Move, CalendarExceptionType::Makeup], true)
            && empty($data['replacement_item_id'])) {
            throw new ApiProblemException('DAILY_REPLACEMENT_ITEM_REQUIRED', '移动或补课必须选择目标课节', 422);
        }
        if ($type === CalendarExceptionType::TeacherChange && empty($data['replacement_teacher_id'])) {
            throw new ApiProblemException('DAILY_REPLACEMENT_TEACHER_REQUIRED', '临时换教师必须选择教师', 422);
        }
        if ($type === CalendarExceptionType::RoomChange && empty($data['replacement_room_id'])) {
            throw new ApiProblemException('DAILY_REPLACEMENT_ROOM_REQUIRED', '临时换教室必须选择教室', 422);
        }
        if ($type === CalendarExceptionType::Activity && empty($data['title'])) {
            throw new ApiProblemException('DAILY_ACTIVITY_TITLE_REQUIRED', '临时活动必须填写活动名称', 422);
        }
    }

    private function targetItem(Semester $semester, int $itemId): Item
    {
        $item = Item::query()->where('semester_id', $semester->id)->find($itemId);
        if ($item === null || ! $item->is_active || ! $item->allows_course) {
            throw new ApiProblemException('DAILY_ITEM_INVALID', '目标课节不可安排课程', 422);
        }

        return $item;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{class_ids: list<int>, teacher_ids: list<int>, room_id: int}
     */
    private function candidateFromEntry(TimetableEntry $entry, array $data): array
    {
        $teacherIds = $entry->teachers->pluck('id')->map(fn ($id): int => (int) $id)->all();
        if (isset($data['replacement_teacher_id'])) {
            $teacherIds = array_values(array_unique([
                (int) $data['replacement_teacher_id'],
                ...array_values(array_filter($teacherIds, fn (int $id): bool => $id !== $entry->teacher_id)),
            ]));
        }

        return [
            'class_ids' => $entry->schoolClasses->pluck('id')->map(fn ($id): int => (int) $id)->all(),
            'teacher_ids' => $teacherIds,
            'room_id' => isset($data['replacement_room_id'])
                ? (int) $data['replacement_room_id']
                : $entry->actual_room_id,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{class_ids: list<int>, teacher_ids: list<int>, room_id: int}
     */
    private function candidateFromAssignment(TeachingAssignment $assignment, array $data): array
    {
        $classIds = $assignment->school_class_id !== null
            ? [$assignment->school_class_id]
            : $assignment->teachingGroup?->schoolClasses->pluck('id')->map(fn ($id): int => (int) $id)->all() ?? [];
        $teacherIds = [
            isset($data['replacement_teacher_id']) ? (int) $data['replacement_teacher_id'] : $assignment->teacher_id,
            ...$assignment->collaborators->pluck('id')->map(fn ($id): int => (int) $id)->all(),
        ];

        return [
            'class_ids' => array_values(array_unique($classIds)),
            'teacher_ids' => array_values(array_unique($teacherIds)),
            'room_id' => isset($data['replacement_room_id'])
                ? (int) $data['replacement_room_id']
                : $this->rooms->resolve($assignment),
        ];
    }

    /**
     * @param  array{class_ids: list<int>, teacher_ids: list<int>, room_id: int}  $candidate
     * @param  list<int>  $excludedEntryIds
     * @return list<array{type: string, message: string, existing_entry_id?: int}>
     */
    private function candidateConflicts(
        Semester $semester,
        string $date,
        Item $item,
        array $candidate,
        array $excludedEntryIds,
    ): array {
        $conflicts = [];
        $rows = $this->forDate($semester, $date)['rows'];
        foreach ($rows as $row) {
            if ($row['is_cancelled'] || $row['item_id'] !== $item->id
                || in_array($row['original_entry_id'], $excludedEntryIds, true)) {
                continue;
            }
            if (array_intersect($candidate['class_ids'], $row['class_ids']) !== []) {
                $conflicts[] = [
                    'type' => 'class',
                    'existing_entry_id' => $row['original_entry_id'],
                    'message' => $row['target_name'].'在该课节已有安排。',
                ];
            }
            if (array_intersect($candidate['teacher_ids'], $row['teacher_ids']) !== []) {
                $conflicts[] = [
                    'type' => 'teacher',
                    'existing_entry_id' => $row['original_entry_id'],
                    'message' => implode('、', $row['teacher_names']).'在该课节已有安排。',
                ];
            }
            if ($candidate['room_id'] === $row['room_id']) {
                $conflicts[] = [
                    'type' => 'room',
                    'existing_entry_id' => $row['original_entry_id'],
                    'message' => $row['room_name'].'在该课节已被占用。',
                ];
            }
        }
        $start = Carbon::parse($date.' '.$item->start_time);
        $end = Carbon::parse($date.' '.$item->end_time);
        foreach ($candidate['teacher_ids'] as $teacherId) {
            $leave = TeacherLeave::query()
                ->where('teacher_id', $teacherId)
                ->where('status', OperationalStatus::Active->value)
                ->where('starts_at', '<', $end)
                ->where('ends_at', '>', $start)
                ->with('teacher:id,name')
                ->first();
            if ($leave !== null) {
                $conflicts[] = [
                    'type' => 'teacher_leave',
                    'message' => $leave->teacher->name.'在目标时间处于请假状态。',
                ];
            }
        }

        return $conflicts;
    }

    /** @return array<string, mixed> */
    private function entryImpact(TimetableEntry $entry, string $date): array
    {
        return [
            'entry_id' => $entry->id,
            'date' => $date,
            'target' => $entry->school_class_id !== null
                ? $entry->schoolClass->name
                : $entry->teachingGroup->name,
            'course' => $entry->course->name,
            'teacher' => $entry->teacher->name,
            'room' => $entry->actualRoom->name,
            'item' => $entry->item->name,
        ];
    }
}
