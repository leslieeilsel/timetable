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
use App\Modules\Timetable\Services\TimetableEffectivePeriodService;
use App\Support\ApiProblemException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class DailyTimetableService
{
    public function __construct(
        private readonly RoomResolver $rooms,
        private readonly TimetableEffectivePeriodService $periods,
    ) {}

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
        $version = $this->versionForDate($semester, $context['date']);
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
            if ($exception->type === CalendarExceptionType::Swap && $replacementDate !== $exception->effective_date->toDateString()) {
                $this->applyCrossDateSwap($rows, $exception, $context, $version);

                continue;
            }
            if ($effective && $exception->timetable_version_id === $version->id) {
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
            ->whereIn('original_entry_id', collect($rows)->pluck('original_entry_id')->filter()->unique()->all())
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
     * @param  array<string, array{rows: list<array<string, mixed>>}>  $timetables
     * @return array<string, mixed>
     */
    public function previewException(Semester $semester, array $data, array $timetables = []): array
    {
        $type = $data['type'] instanceof CalendarExceptionType
            ? $data['type']
            : CalendarExceptionType::from($data['type']);
        $data['type'] = $type->value;
        $effective = $this->dateContext($semester, (string) $data['effective_date']);
        $version = $this->versionForDate($semester, $effective['date']);
        $targetDate = (string) ($data['replacement_date'] ?? $data['effective_date']);
        $target = $this->dateContext($semester, $targetDate);
        $targetVersion = $this->versionForDate($semester, $targetDate);
        $original = isset($data['original_entry_id'])
            ? $this->entryForVersion($version, (int) $data['original_entry_id'])
            : null;
        $related = isset($data['related_entry_id'])
            ? $this->entryForVersion($targetVersion, (int) $data['related_entry_id'])
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
        $timetables[$effective['date']] ??= $this->forDate($semester, $effective['date']);
        $timetables[$target['date']] ??= $this->forDate($semester, $target['date']);
        foreach ([[$original, $effective['date']], [$related, $target['date']]] as [$activeEntry, $entryDate]) {
            if ($activeEntry === null) {
                continue;
            }
            $actualEntry = collect($timetables[$entryDate]['rows'])
                ->first(fn (array $row): bool => $row['original_entry_id'] === $activeEntry->id && ! $row['is_cancelled']);
            if (! is_array($actualEntry)) {
                throw new ApiProblemException('DAILY_ORIGINAL_NOT_ACTIVE', '所选课程在该日期并未实际发生', 422, [
                    'entry_id' => $activeEntry->id,
                ]);
            }
            if ($actualEntry['exception_id'] !== null || $actualEntry['substitution_id'] !== null) {
                throw new ApiProblemException('DAILY_EXCEPTION_ALREADY_EXISTS', '所选课程在该日期已有临时调整，请先取消原调整', 409, [
                    'exception_id' => $actualEntry['exception_id'],
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
            $affected[] = $this->entryImpact($related, $target['date']);
        }
        if ($type === CalendarExceptionType::Move && $original !== null) {
            $item = $this->targetItem($semester, (int) $data['replacement_item_id']);
            $candidate = $this->candidateFromEntry($original, $data);
            $conflicts = $this->candidateConflicts(
                $semester,
                $target['date'],
                $item,
                $candidate,
                $effective['date'] === $target['date'] ? [$original->id] : [],
                $timetables[$target['date']]['rows'],
            );
            if ($effective['date'] === $target['date'] && $original->item_id === $item->id) {
                $conflicts[] = ['type' => 'unchanged', 'message' => '目标与原上课时间相同，请选择其他课节。'];
            }
        } elseif ($type === CalendarExceptionType::Swap && $original !== null && $related !== null) {
            $firstItem = $this->targetItem($semester, $related->item_id);
            $secondItem = $this->targetItem($semester, $original->item_id);
            $conflicts = [
                ...$this->candidateConflicts(
                    $semester,
                    $target['date'],
                    $firstItem,
                    $this->candidateFromEntry($original, $data),
                    $effective['date'] === $target['date'] ? [$original->id, $related->id] : [$related->id],
                    $timetables[$target['date']]['rows'],
                ),
                ...$this->candidateConflicts(
                    $semester,
                    $effective['date'],
                    $secondItem,
                    $this->candidateFromEntry($related, []),
                    $effective['date'] === $target['date'] ? [$original->id, $related->id] : [$original->id],
                    $timetables[$effective['date']]['rows'],
                ),
            ];
            if ($effective['date'] === $target['date'] && $original->item_id === $related->item_id) {
                $conflicts[] = ['type' => 'unchanged', 'message' => '两节课的上课时间相同，无需交换。'];
            }
        } elseif (in_array($type, [CalendarExceptionType::TeacherChange, CalendarExceptionType::RoomChange], true)
            && $original !== null) {
            $item = $this->targetItem($semester, $original->item_id);
            $conflicts = $this->candidateConflicts(
                $semester,
                $effective['date'],
                $item,
                $this->candidateFromEntry($original, $data),
                [$original->id],
                $timetables[$effective['date']]['rows'],
            );
        } elseif ($type === CalendarExceptionType::Makeup && $assignment !== null) {
            $item = $this->targetItem($semester, (int) $data['replacement_item_id']);
            $conflicts = $this->candidateConflicts(
                $semester,
                $target['date'],
                $item,
                $this->candidateFromAssignment($assignment, $data),
                [],
                $timetables[$target['date']]['rows'],
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
        $changes = $this->exceptionChanges($original, $related, $assignment, $semester, $data);
        $teacherIds = collect($changes)->flatMap(fn (array $change): array => [
            ...($change['before']['teacher_ids'] ?? []), ...($change['after']['teacher_ids'] ?? []),
        ])->unique()->values()->all();

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
            'changes' => $changes,
            'recipients' => Teacher::query()->whereIn('id', $teacherIds)->get(['id', 'name', 'employee_no'])->toArray(),
        ];
    }

    /**
     * A bounded, independent target scope. Preview and publish use the same conflict rules.
     *
     * @param  array<string, mixed>  $data
     * @return array{data: list<array<string, mixed>>, meta: array<string, mixed>}
     */
    public function options(Semester $semester, array $data): array
    {
        $source = $this->forDate($semester, $data['effective_date']);
        $original = collect($source['rows'])->firstWhere('original_entry_id', (int) $data['original_entry_id']);
        if (! is_array($original) || $original['is_cancelled']) {
            throw new ApiProblemException('DAILY_ORIGINAL_NOT_ACTIVE', '原课程已变动，请刷新课表后重新选择', 422);
        }
        $from = Carbon::parse($data['from']);
        $to = Carbon::parse($data['to']);
        if ($from->greaterThan($to) || $from->diffInDays($to) > 6) {
            throw new ApiProblemException('DAILY_OPTIONS_RANGE_INVALID', '每次查找最多 7 天，请切换周次继续查找', 422);
        }
        $timetables = [$data['effective_date'] => $source];
        $payloads = [];
        $base = ['type' => $data['type'], 'effective_date' => $data['effective_date'], 'original_entry_id' => $data['original_entry_id'], 'reason' => '候选方案检查'];
        if ($data['type'] === 'teacher_change') {
            foreach (Teacher::query()->where('is_active', true)->whereKeyNot($original['primary_teacher_id'])
                ->whereHas('courses', fn ($query) => $query->whereKey($original['course_id']))->orderBy('name')->get(['id', 'name']) as $teacher) {
                $payloads[] = ['payload' => [...$base, 'replacement_teacher_id' => $teacher->id], 'teacher' => $teacher->toArray(), 'date' => $data['effective_date'], 'reasons' => ['具备'.$original['course_name'].'授课资格']];
            }
        } else {
            $items = $semester->scheduleTemplate()->firstOrFail()->items()->where('is_active', true)->where('allows_course', true)->orderBy('sort_order')->get();
            for ($cursor = $from->copy(); $cursor->lessThanOrEqualTo($to); $cursor->addDay()) {
                $date = $cursor->toDateString();
                $timetables[$date] ??= $this->forDate($semester, $date);
                if ($data['type'] === 'swap') {
                    foreach ($timetables[$date]['rows'] as $row) {
                        if ($row['is_cancelled'] || $row['original_entry_id'] === null || $row['original_entry_id'] === $original['original_entry_id']) {
                            continue;
                        }
                        $sameClass = array_intersect($row['class_ids'], $original['class_ids']) !== [];
                        if (isset($data['target_class_id'])
                            ? ! in_array((int) $data['target_class_id'], $row['class_ids'], true)
                            : (($data['scope'] ?? 'class') === 'class' && ! $sameClass)) {
                            continue;
                        }
                        $payloads[] = ['payload' => [...$base, 'replacement_date' => $date, 'related_entry_id' => $row['original_entry_id']], 'row' => $row, 'date' => $date, 'reasons' => array_values(array_filter([$sameClass ? '同班课程' : null, $row['room_id'] === $original['room_id'] ? '教室相同' : null]))];
                    }
                } else {
                    foreach ($items as $item) {
                        if ($date === $original['date'] && $item->id === $original['item_id']) {
                            continue;
                        }
                        $payloads[] = ['payload' => [...$base, 'replacement_date' => $date, 'replacement_item_id' => $item->id], 'item' => $item->only(['id', 'name', 'start_time', 'end_time']), 'date' => $date, 'reasons' => ['教师、班级与教室一起移动']];
                    }
                }
            }
        }
        // Search the complete scope before pagination so later dates remain reachable.
        $search = trim($data['q'] ?? '');
        if ($search !== '') {
            $payloads = array_values(array_filter($payloads, fn (array $candidate): bool => mb_stripos(implode(' ', [
                $candidate['row']['course_name'] ?? '', $candidate['row']['target_name'] ?? '',
                implode(' ', $candidate['row']['teacher_names'] ?? []), $candidate['row']['room_name'] ?? '',
                $candidate['teacher']['name'] ?? '', $candidate['row']['item_name'] ?? $candidate['item']['name'] ?? '', $candidate['date'],
            ]), $search) !== false));
        }
        if (isset($data['target_item_id'])) {
            $payloads = array_values(array_filter($payloads, fn (array $candidate): bool => (int) ($candidate['row']['item_id'] ?? $candidate['item']['id'] ?? 0) === (int) $data['target_item_id']));
        }
        // Keep lessons in timetable order, including conflicts, so a known target is easy to find.
        usort($payloads, fn (array $a, array $b): int => [$a['date'], $a['row']['start_time'] ?? $a['item']['start_time'] ?? '', $a['row']['target_name'] ?? $a['teacher']['name'] ?? '', $a['row']['original_entry_id'] ?? $a['item']['id'] ?? $a['teacher']['id']]
            <=> [$b['date'], $b['row']['start_time'] ?? $b['item']['start_time'] ?? '', $b['row']['target_name'] ?? $b['teacher']['name'] ?? '', $b['row']['original_entry_id'] ?? $b['item']['id'] ?? $b['teacher']['id']]);
        $total = count($payloads);
        $perPage = (int) ($data['per_page'] ?? 40);
        $lastPage = max(1, (int) ceil($total / $perPage));
        $page = min((int) ($data['page'] ?? 1), $lastPage);
        $options = [];
        foreach (array_slice($payloads, ($page - 1) * $perPage, $perPage) as $candidate) {
            try {
                $preview = $this->previewException($semester, $candidate['payload'], $timetables);
                $candidate['allowed'] = $preview['allowed'];
                $candidate['conflicts'] = $preview['conflicts'];
                if ($preview['allowed']) {
                    $candidate['reasons'][] = '班级、教师、教室及请假检查通过';
                }
            } catch (ApiProblemException $error) {
                $candidate['allowed'] = false;
                $candidate['conflicts'] = [['type' => $error->problemCode, 'message' => $error->getMessage()]];
            }
            $candidate['key'] = implode(':', [$data['type'], $candidate['date'], $candidate['payload']['related_entry_id'] ?? $candidate['payload']['replacement_item_id'] ?? $candidate['payload']['replacement_teacher_id']]);
            $options[] = $candidate;
        }

        return ['data' => $options, 'meta' => ['pagination' => [
            'page' => $page, 'per_page' => $perPage, 'total' => $total, 'last_page' => $lastPage,
        ]]];
    }

    /** @return list<array{before: array<string, mixed>|null, after: array<string, mixed>|null}> */
    public function withdrawalChanges(Semester $semester, CalendarException $exception): array
    {
        $exception->load([
            'originalEntry' => fn ($query) => $query->with($this->entryRelations()),
            'relatedEntry' => fn ($query) => $query->with($this->entryRelations()),
            'replacementAssignment' => fn ($query) => $query->with($this->assignmentRelations()),
        ]);
        $changes = $this->exceptionChanges($exception->originalEntry, $exception->relatedEntry, $exception->replacementAssignment, $semester, [
            ...$exception->toArray(),
            'effective_date' => $exception->effective_date->toDateString(),
            'replacement_date' => ($exception->replacement_date ?? $exception->effective_date)->toDateString(),
        ]);

        return array_map(fn (array $change): array => ['before' => $change['after'], 'after' => $change['before']], $changes);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return list<array{before: array<string, mixed>|null, after: array<string, mixed>|null}>
     */
    private function exceptionChanges(?TimetableEntry $original, ?TimetableEntry $related, ?TeachingAssignment $assignment, Semester $semester, array $data): array
    {
        $effective = $this->dateContext($semester, $data['effective_date']);
        $target = $this->dateContext($semester, $data['replacement_date'] ?? $data['effective_date']);
        $before = $original === null ? null : $this->entryRow($original, $effective['date'], $effective['week_number']);
        $after = $before;
        if ($data['type'] === 'makeup' && $assignment !== null) {
            $after = $this->assignmentRow($assignment, $this->targetItem($semester, (int) $data['replacement_item_id']), $target);
            $this->applyReplacementResources($after, isset($data['replacement_teacher_id']) ? Teacher::query()->findOrFail((int) $data['replacement_teacher_id']) : null, isset($data['replacement_room_id']) ? Room::query()->findOrFail((int) $data['replacement_room_id']) : null);

            return [['before' => null, 'after' => $after]];
        }
        if ($after === null) {
            return [];
        }
        if ($data['type'] === 'cancel') {
            $after = null;
        } elseif ($data['type'] === 'swap' && $related !== null) {
            $otherBefore = $this->entryRow($related, $target['date'], $target['week_number']);
            $otherAfter = $otherBefore;
            $after['date'] = $target['date'];
            $after['week_number'] = $target['week_number'];
            $this->setRowItem($after, $related->item);
            $otherAfter['date'] = $effective['date'];
            $otherAfter['week_number'] = $effective['week_number'];
            $this->setRowItem($otherAfter, $original->item);

            return [['before' => $before, 'after' => $after], ['before' => $otherBefore, 'after' => $otherAfter]];
        } elseif ($data['type'] === 'move') {
            $after['date'] = $target['date'];
            $after['week_number'] = $target['week_number'];
            $this->setRowItem($after, $this->targetItem($semester, (int) $data['replacement_item_id']));
            $this->applyReplacementResources($after, isset($data['replacement_teacher_id']) ? Teacher::query()->findOrFail((int) $data['replacement_teacher_id']) : null, isset($data['replacement_room_id']) ? Room::query()->findOrFail((int) $data['replacement_room_id']) : null);
        } elseif ($data['type'] === 'teacher_change') {
            $teacher = Teacher::query()->findOrFail((int) $data['replacement_teacher_id']);
            $this->replacePrimaryTeacher($after, $teacher->id, $teacher->name);
        } elseif ($data['type'] === 'room_change') {
            $room = Room::query()->findOrFail((int) $data['replacement_room_id']);
            $after['room_id'] = $room->id;
            $after['room_name'] = $room->name;
        } elseif ($data['type'] === 'activity') {
            $after['title'] = $data['title'];
            $after['is_cancelled'] = true;
        }

        return [['before' => $before, 'after' => $after]];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @param  array{date: string, weekday: int, week_number: int}  $context
     */
    private function applyCrossDateSwap(array &$rows, CalendarException $exception, array $context, TimetableVersion $version): void
    {
        $isSource = $exception->effective_date->toDateString() === $context['date'];
        $outgoing = $isSource ? $exception->originalEntry : $exception->relatedEntry;
        $incoming = $isSource ? $exception->relatedEntry : $exception->originalEntry;
        if ($outgoing === null || $incoming === null || $outgoing->timetable_version_id !== $version->id) {
            return;
        }
        $index = $this->rowIndex($rows, $outgoing->id);
        if ($index === null) {
            return;
        }
        $rows[$index]['is_cancelled'] = true;
        $rows[$index]['status'] = 'moved_out';
        $rows[$index]['exception_type'] = 'swap';
        $rows[$index]['exception_id'] = $exception->id;
        $rows[$index]['note'] = $exception->reason;
        $row = $this->entryRow($incoming, $context['date'], $context['week_number']);
        $this->setRowItem($row, $outgoing->item);
        $row['key'] = 'exception-'.$exception->id.'-swap-'.$incoming->id;
        $row['status'] = 'swap';
        $row['exception_type'] = 'swap';
        $row['exception_id'] = $exception->id;
        $row['note'] = $exception->reason;
        $rows[] = $row;
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

    /** @return array<string, mixed> */
    public function actualEntryRow(Semester $semester, int $entryId, string $date, ?int $ignoreTeacherId = null): array
    {
        $row = collect($this->forDate($semester, $date, $ignoreTeacherId)['rows'])
            ->first(fn (array $row): bool => $row['original_entry_id'] === $entryId && ! $row['is_cancelled']);
        if (! is_array($row)) {
            throw new ApiProblemException('SUBSTITUTION_ENTRY_NOT_AFFECTED', '所选课程在该日期没有实际授课安排', 422);
        }

        return $row;
    }

    /** @return list<array<string, mixed>> */
    public function substitutionRecommendations(
        Semester $semester,
        TimetableEntry $entry,
        string $date,
        ?int $excludedTeacherId = null,
    ): array {
        $dateContext = $this->dateContext($semester, $date);
        $version = $this->versionForDate($semester, $dateContext['date']);
        $entry->loadMissing($this->entryRelations());
        $actual = $this->actualEntryRow($semester, $entry->id, $date, $excludedTeacherId);
        $itemStart = Carbon::parse($date.' '.$actual['start_time']);
        $itemEnd = Carbon::parse($date.' '.$actual['end_time']);
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
            $occupied = $dailyRows->contains(fn (array $row): bool => ! $row['is_cancelled'] && $row['item_id'] === $actual['item_id']
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
            $consecutiveLoad = $this->consecutiveLoadAfterAdding($itemOrders, $actual['item_sort_order']);
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

    public function versionForDate(Semester $semester, string $date): TimetableVersion
    {
        $version = $this->periods->versionForDate($semester, $date);
        if ($version === null) {
            throw new ApiProblemException('CURRENT_TIMETABLE_REQUIRED', '请先将一个完整课表版本设为当前课表', 409);
        }

        return $version;
    }

    /** @param list<array<string, mixed>> $rows */
    public function assertActualRowsConflictFree(array $rows, string $date): void
    {
        $occupied = [];
        foreach ($rows as $row) {
            if ($row['is_cancelled']) {
                continue;
            }
            $resources = ['room:'.$row['room_id']];
            foreach ($row['class_ids'] as $classId) {
                $resources[] = 'class:'.$classId;
            }
            foreach ($row['teacher_ids'] as $teacherId) {
                $resources[] = 'teacher:'.$teacherId;
            }
            foreach ($resources as $resource) {
                $key = $row['item_id'].':'.$resource;
                if (array_key_exists($key, $occupied)) {
                    throw new ApiProblemException('DAILY_TIMETABLE_CONFLICT', '实际课表存在班级、教师或教室资源冲突', 409, [
                        'date' => $date,
                        'resource' => $resource,
                        'entry_ids' => [$occupied[$key], $row['original_entry_id']],
                    ]);
                }
                $occupied[$key] = $row['original_entry_id'];
            }
        }
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
            'original_teacher_ids' => $entry->teachers->pluck('id')->map(fn ($id): int => (int) $id)->all(),
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
            $this->applyReplacementResources($row, $exception->replacementTeacher, $exception->replacementRoom);
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
            $this->applyReplacementResources($row, $exception->replacementTeacher, $exception->replacementRoom);
            $row['key'] = 'exception-'.$exception->id.'-makeup';
            $row['status'] = 'makeup';
            $row['exception_type'] = 'makeup';
            $row['exception_id'] = $exception->id;
            $row['note'] = $exception->reason;
            $rows[] = $row;
        }
    }

    /** @param array<string, mixed> $row */
    private function applyReplacementResources(array &$row, ?Teacher $teacher, ?Room $room): void
    {
        if ($teacher !== null) {
            $this->replacePrimaryTeacher($row, $teacher->id, $teacher->name);
        }
        if ($room !== null) {
            $row['room_id'] = $room->id;
            $row['room_name'] = $room->name;
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
     * @param  list<array<string, mixed>>|null  $actualRows
     * @return list<array{type: string, message: string, existing_entry_id?: int}>
     */
    private function candidateConflicts(
        Semester $semester,
        string $date,
        Item $item,
        array $candidate,
        array $excludedEntryIds,
        ?array $actualRows = null,
    ): array {
        $conflicts = [];
        $rows = $actualRows ?? $this->forDate($semester, $date)['rows'];
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
