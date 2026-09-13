<?php

namespace App\Modules\Timetable\Services;

use App\Enums\TimetableVersionStatus;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\DailyOperations\Models\CalendarException;
use App\Modules\DailyOperations\Models\Substitution;
use App\Modules\DailyOperations\Models\TeacherLeave;
use App\Modules\DailyOperations\Services\DailyTimetableService;
use App\Modules\Timetable\Models\LongTermChange;
use App\Modules\Timetable\Models\TimetableEffectivePeriod;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Support\ApiProblemException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class LongTermChangeService
{
    public const RELATIONS = ['schoolClass:id,name', 'teachingGroup:id,name', 'schoolClasses:id,name',
        'teacher:id,name', 'teachers:id,name', 'course:id,name,short_name',
        'actualRoom:id,name', 'item:id,name,start_time,end_time,sort_order'];

    private const FIELDS = ['weekday', 'item_id', 'teacher_id', 'actual_room_id'];

    public function __construct(
        private readonly TimetableEffectivePeriodService $periods,
        private readonly TimetableVersionService $versions,
        private readonly DailyTimetableService $daily,
    ) {}

    /** @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function publish(Semester $semester, User $actor, array $data): array
    {
        $this->assertRange($semester, $data['effective_from'], $data['effective_to']);
        $base = $this->periods->versionForDate($semester, $data['effective_from']);
        if ($base === null || $base->id !== (int) $data['source_version_id']) {
            throw new ApiProblemException('LONG_TERM_SOURCE_CHANGED', '开始日期对应的课表已变化，请重新载入课程', 409);
        }
        $patches = [];
        $entries = $base->entries()->with(self::RELATIONS)->get()->keyBy('id');
        foreach ($data['changes'] as $input) {
            $entry = $entries->get($input['entry_id']);
            if ($entry === null || $entry->entry_key === null) {
                throw new ApiProblemException('LONG_TERM_ENTRY_INVALID', '选择的课程不属于开始日期对应的课表，请重新选择', 422);
            }
            $before = $this->state($entry);
            $after = $before;
            foreach (self::FIELDS as $field) {
                if (isset($input[$field])) {
                    $after[$field] = (int) $input[$field];
                }
            }
            if ($before === $after) {
                continue;
            }
            if ($entry->is_locked) {
                throw new ApiProblemException('LONG_TERM_ENTRY_LOCKED', '所选课程已锁定，请先在课表工作台解锁', 409);
            }
            $patches[] = ['key' => $entry->entry_key, 'before' => $before, 'after' => $after];
        }
        if ($patches === []) {
            throw new ApiProblemException('LONG_TERM_EMPTY', '请至少调整一节课的时间、老师或教室', 422);
        }

        $result = $this->apply($semester, $actor, $data['effective_from'], $data['effective_to'], $patches, $data['reason']);
        $record = LongTermChange::query()->create([
            'semester_id' => $semester->id, 'effective_from' => $data['effective_from'],
            'effective_to' => $data['effective_to'], 'reason' => $data['reason'],
            'changes' => $result['changes'], 'segments' => $result['segments'], 'created_by' => $actor->id,
            'search_text' => $this->searchableText($result['changes'], $data['reason']),
        ]);
        if ($data['notify_teachers'] ?? true) {
            $this->messages($record, $result['changes'], 'published');
        }

        return [...$result, 'record' => $record->load('creator:id,name')];
    }

    /** @return array<string, mixed> */
    public function restore(Semester $semester, User $actor, LongTermChange $record, string $from): array
    {
        if ($record->semester_id !== $semester->id) {
            abort(404);
        }
        if ($record->restored_from !== null) {
            throw new ApiProblemException('LONG_TERM_ALREADY_RESTORED', '这次调整已经安排恢复，请刷新记录', 409);
        }
        $this->assertRange($semester, $from, $record->effective_to->toDateString());
        if ($from < $record->effective_from->toDateString()) {
            throw new ApiProblemException('LONG_TERM_RESTORE_RANGE', '恢复日期不能早于调整开始日期', 422);
        }
        $changes = [];
        $affectedDates = [];
        foreach ($record->segments as $segment) {
            $start = max($from, $segment['from']);
            $end = min($record->effective_to->toDateString(), $segment['to']);
            if ($start > $end) {
                continue;
            }
            $patches = array_map(fn (array $patch): array => [
                'key' => $patch['key'], 'before' => $patch['after'], 'after' => $patch['before'],
            ], $segment['patches']);
            $result = $this->apply($semester, $actor, $start, $end, $patches, '恢复安排：'.$record->reason, false);
            $changes = [...$changes, ...$result['changes']];
            $affectedDates = [...$affectedDates, ...$result['affected_dates']];
        }
        $this->validateActual($semester, $from, $record->effective_to->toDateString(), $affectedDates);
        $record->restored_from = Carbon::parse($from);
        $record->save();
        if (DB::table('timetable_change_messages')->where('long_term_change_id', $record->id)->where('event', 'published')->exists()) {
            $this->messages($record, $changes, 'cancelled');
        }

        return ['changes' => $changes, 'record' => $record->load('creator:id,name')];
    }

    /** Apply only modified fields to every intersecting period; never replace
     * another period with a stale whole-school snapshot.
     *
     * @param  list<array<string, mixed>>  $patches
     * @return array<string, mixed>
     */
    private function apply(Semester $semester, User $actor, string $from, string $to, array $patches, string $reason, bool $validate = true): array
    {
        $this->periods->ensureCurrentCoverage($semester, $actor);
        $existing = TimetableEffectivePeriod::query()->where('semester_id', $semester->id)->where('status', 'active')
            ->whereDate('effective_from', '<=', $to)->whereDate('effective_to', '>=', $from)
            ->with('timetableVersion')->orderBy('effective_from')->lockForUpdate()->get();
        $cursor = $from;
        foreach ($existing as $period) {
            if (max($from, $period->effective_from->toDateString()) !== $cursor) {
                throw new ApiProblemException('LONG_TERM_COVERAGE_GAP', '生效区间内的基础课表不连续，请先补齐课表', 409);
            }
            $cursor = Carbon::parse(min($to, $period->effective_to->toDateString()))->addDay()->toDateString();
        }
        if ($cursor !== Carbon::parse($to)->addDay()->toDateString()) {
            throw new ApiProblemException('LONG_TERM_COVERAGE_GAP', '生效区间内尚无完整的正式课表', 409);
        }
        $changes = [];
        $segments = [];
        $affectedDates = [];
        $exceptionCount = 0;
        foreach ($existing as $period) {
            $start = max($from, $period->effective_from->toDateString());
            $end = min($to, $period->effective_to->toDateString());
            $version = $this->versions->createDraft($semester, $actor, $period->timetableVersion, '长期调整 · '.$start);
            $entries = $version->entries()->with(self::RELATIONS)->get()->keyBy('entry_key');
            $segmentPatches = [];
            $pending = [];
            foreach ($patches as $patch) {
                $entry = $entries->get($patch['key']);
                if ($entry === null) {
                    throw new ApiProblemException('LONG_TERM_ENTRY_MISSING', $start.' 起的课表已移除所选课程，请缩短生效范围或重新选择', 409);
                }
                $before = $this->state($entry);
                $after = $before;
                foreach (self::FIELDS as $field) {
                    if ($patch['before'][$field] === $patch['after'][$field]) {
                        continue;
                    }
                    if ($before[$field] !== $patch['before'][$field]) {
                        throw new ApiProblemException('LONG_TERM_FUTURE_CONFLICT', $start.' 起，'.$entry->course->name.'已有其他调整涉及同一项安排，请缩短日期范围或先处理该调整', 409,
                            ['date' => $start, 'entry_key' => $patch['key'], 'field' => $field]);
                    }
                    $after[$field] = $patch['after'][$field];
                }
                if ($entry->is_locked) {
                    throw new ApiProblemException('LONG_TERM_ENTRY_LOCKED', $start.' 起的所选课程已锁定，不能直接调整', 409);
                }
                if ($entry->weekday !== $after['weekday']) {
                    $this->assertDependencyDates($semester, $entry, $start, $end, $after['weekday']);
                }
                $beforeSnapshot = $this->snapshot($entry, $start, $end);
                $oldTeacherId = $entry->teacher_id;
                $teacherIds = $entry->teachers->pluck('id')->map(fn ($id): int => (int) $id)->all();
                if ($oldTeacherId !== $after['teacher_id'] && in_array($after['teacher_id'], $teacherIds, true)) {
                    throw new ApiProblemException('LONG_TERM_COLLABORATOR_DUPLICATE', '所选老师已经参与这节合上课程，请选择其他老师', 422);
                }
                $pending[$entry->id] = ['entry' => $entry, 'after' => $after, 'before_snapshot' => $beforeSnapshot,
                    'teacher_ids' => array_map(fn (int $id): int => $id === $oldTeacherId ? $after['teacher_id'] : $id, $teacherIds)];
                $segmentPatches[] = ['key' => $patch['key'], 'before' => $before, 'after' => $after];
            }
            $slots = [];
            foreach ($entries as $entry) {
                $final = $pending[$entry->id]['after'] ?? $this->state($entry);
                $slot = implode(':', [$entry->teaching_assignment_id, $entry->week_pattern->value, $final['weekday'], $final['item_id']]);
                if (isset($slots[$slot])) {
                    throw new ApiProblemException('VERSION_HAS_HARD_CONFLICTS', $start.' 起，'.$entry->course->name.'的两个课节落在同一位置，请选择空位置或同时互换', 409);
                }
                $slots[$slot] = true;
            }
            // These entries belong to a newly cloned, unpublished version. Replace
            // the whole edited set together so cyclic swaps never hit a transient
            // unique-slot violation; stable entry keys preserve daily references.
            $version->entries()->whereIn('id', array_keys($pending))->delete();
            foreach ($pending as $replacement) {
                $original = $replacement['entry'];
                $entry = $original->replicate()->forceFill($replacement['after']);
                $entry->save();
                $pivot = ['timetable_version_id' => $version->id, 'week_pattern' => $entry->week_pattern->value,
                    'weekday' => $entry->weekday, 'item_id' => $entry->item_id];
                $entry->schoolClasses()->sync(array_fill_keys($original->schoolClasses->pluck('id')->all(), $pivot));
                $entry->teachers()->sync(array_fill_keys($replacement['teacher_ids'], $pivot));
                $entry->unsetRelations()->load(self::RELATIONS);
                $changes[] = ['before' => $replacement['before_snapshot'], 'after' => $this->snapshot($entry, $start, $end)];
            }
            try {
                $version->refresh();
                $this->versions->assertActivatable($semester, $version);
            } catch (ApiProblemException $error) {
                throw new ApiProblemException($error->problemCode, $start.' 起的安排未通过检查：'.$error->getMessage(), $error->status, $error->details);
            }
            // Keep the general current pointer unchanged for scheduled future work.
            $version->forceFill(['status' => TimetableVersionStatus::Historical, 'activated_at' => now()])->save();
            $publication = $this->periods->publish($semester, $version, $start, $end, $actor, $reason);
            $affectedDates = [...$affectedDates, ...$publication['affected_dates']];
            $exceptionCount += $publication['rebased_exceptions'] + $publication['rebased_substitutions'];
            $segments[] = ['from' => $start, 'to' => $end, 'patches' => $segmentPatches];
        }
        if ($validate) {
            $this->validateActual($semester, $from, $to, $affectedDates);
        }
        $semester->increment('timetable_revision');
        $semester->refresh();
        $afterDate = Carbon::parse($to)->addDay()->toDateString();
        $following = [];
        if ($afterDate <= $semester->end_date->toDateString()) {
            $followingVersion = $this->periods->versionForDate($semester, $afterDate);
            $followingEnd = TimetableEffectivePeriod::query()->where('semester_id', $semester->id)->where('status', 'active')
                ->whereDate('effective_from', '<=', $afterDate)->whereDate('effective_to', '>=', $afterDate)->first()?->effective_to->toDateString() ?? $semester->end_date->toDateString();
            $following = $followingVersion?->entries()->whereIn('entry_key', array_column($patches, 'key'))->with(self::RELATIONS)->get()
                ->map(fn (TimetableEntry $entry): array => $this->snapshot($entry, $afterDate, $followingEnd))->all() ?? [];
        }

        return ['changes' => $changes, 'segments' => $segments, 'checked_temporary_count' => $exceptionCount,
            'following' => $following, 'effective_from' => $from, 'effective_to' => $to, 'affected_dates' => $affectedDates];
    }

    /** @param list<string> $affectedDates */
    private function validateActual(Semester $semester, string $from, string $to, array $affectedDates): void
    {
        // Validate actual exceptions after all segments have been installed, including
        // swaps whose other end lies outside this long-term change.
        $leaves = TeacherLeave::query()->where('semester_id', $semester->id)->where('status', 'active')
            ->where('starts_at', '<=', $to.' 23:59:59')->where('ends_at', '>=', $from.' 00:00:00')->with('teacher:id,name')->get();
        foreach ($leaves as $leave) {
            $day = Carbon::parse(max($from, $leave->starts_at->toDateString()));
            $last = min($to, $leave->ends_at->toDateString());
            while ($day->toDateString() <= $last) {
                $affectedDates[] = $day->toDateString();
                $day->addDay();
            }
        }
        foreach (array_unique($affectedDates) as $date) {
            $rows = $this->daily->forDate($semester, $date)['rows'];
            $this->daily->assertActualRowsConflictFree($rows, $date);
            foreach ($rows as $row) {
                if ($row['is_cancelled']) {
                    continue;
                }
                foreach ($leaves as $leave) {
                    if (in_array($leave->teacher_id, $row['teacher_ids'], true)
                        && $leave->starts_at->lessThan(Carbon::parse($date.' '.$row['end_time']))
                        && $leave->ends_at->greaterThan(Carbon::parse($date.' '.$row['start_time']))) {
                        throw new ApiProblemException('LONG_TERM_TEACHER_LEAVE', $date.' '.$row['item_name'].'，'.$leave->teacher->name.'正在请假，请先安排代课或更改生效时间', 409);
                    }
                }
            }
        }
    }

    private function assertDependencyDates(Semester $semester, TimetableEntry $entry, string $from, string $to, int $weekday): void
    {
        $exceptions = CalendarException::query()->where('semester_id', $semester->id)->where('status', 'active')
            ->where(fn ($query) => $query->whereHas('originalEntry', fn ($query) => $query->where('entry_key', $entry->entry_key))
                ->orWhereHas('relatedEntry', fn ($query) => $query->where('entry_key', $entry->entry_key)))
            ->with(['originalEntry', 'relatedEntry'])->get();
        foreach ($exceptions as $exception) {
            $dates = [];
            if ($exception->originalEntry?->entry_key === $entry->entry_key) {
                $dates[] = $exception->effective_date->toDateString();
            }
            if ($exception->relatedEntry?->entry_key === $entry->entry_key) {
                $dates[] = ($exception->replacement_date ?? $exception->effective_date)->toDateString();
            }
            foreach ($dates as $date) {
                if ($date >= $from && $date <= $to && Carbon::parse($date)->dayOfWeekIso !== $weekday) {
                    throw new ApiProblemException('LONG_TERM_TEMPORARY_DEPENDENCY', $date.' 的临时调整引用了这节'.$entry->course->name.'，改变星期会使原课不再存在。请先处理该临时调整或缩短日期范围', 409,
                        ['exception_id' => $exception->id, 'date' => $date]);
                }
            }
        }
        $substitutions = Substitution::query()->where('status', 'active')->whereBetween('effective_date', [$from, $to])
            ->whereHas('originalEntry', fn ($query) => $query->where('semester_id', $semester->id)->where('entry_key', $entry->entry_key))->get();
        foreach ($substitutions as $substitution) {
            if ($substitution->effective_date->dayOfWeekIso !== $weekday) {
                throw new ApiProblemException('LONG_TERM_TEMPORARY_DEPENDENCY', $substitution->effective_date->toDateString().' 已安排代课，改变星期会使原课不再存在。请先处理代课', 409);
            }
        }
    }

    private function assertRange(Semester $semester, string $from, string $to): void
    {
        if ($from < max(today()->toDateString(), $semester->start_date->toDateString())
            || $to > $semester->end_date->toDateString() || $from > $to) {
            throw new ApiProblemException('LONG_TERM_DATE_INVALID', '生效日期须在本学期内且不能早于今天，历史课表保持原样', 422);
        }
    }

    /** @return array<string, int> */
    private function state(TimetableEntry $entry): array
    {
        return ['weekday' => $entry->weekday, 'item_id' => $entry->item_id,
            'teacher_id' => $entry->teacher_id, 'actual_room_id' => $entry->actual_room_id];
    }

    /** @return array<string, mixed> */
    public function snapshot(TimetableEntry $entry, string $from, string $to): array
    {
        $entry->loadMissing(self::RELATIONS);
        $week = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][$entry->weekday];
        $pattern = match ($entry->week_pattern->value) {
            'a' => '单周', 'b' => '双周', 'specified' => '第 '.implode('、', $entry->active_weeks ?? []).' 周', default => '每周',
        };

        return [
            'entry_key' => $entry->entry_key, 'date' => $from, 'effective_from' => $from, 'effective_to' => $to,
            'recurrence_label' => $pattern.' · '.$week, 'weekday' => $entry->weekday,
            'item_id' => $entry->item_id, 'item_name' => $entry->item->name,
            'start_time' => $entry->item->start_time, 'end_time' => $entry->item->end_time,
            'course_id' => $entry->course_id, 'course_name' => $entry->course->name,
            'target_name' => $entry->schoolClasses->pluck('name')->implode('、'),
            'class_ids' => $entry->schoolClasses->pluck('id')->all(),
            'teacher_id' => $entry->teacher_id, 'teacher_ids' => $entry->teachers->pluck('id')->all(),
            'teacher_names' => $entry->teachers->pluck('name')->all(),
            'room_id' => $entry->actual_room_id, 'room_name' => $entry->actualRoom->name,
        ];
    }

    /** @param list<array<string, mixed>> $changes */
    private function searchableText(array $changes, string $reason): string
    {
        $parts = [$reason];
        foreach ($changes as $change) {
            $parts = [...$parts, $change['before']['target_name'], $change['before']['course_name'],
                ...$change['before']['teacher_names'], ...$change['after']['teacher_names'],
                $change['before']['room_name'], $change['after']['room_name']];
        }

        return implode(' ', array_unique($parts));
    }

    /** @param list<array<string, mixed>> $changes */
    private function messages(LongTermChange $record, array $changes, string $event): void
    {
        $teacherIds = collect($changes)->flatMap(fn (array $change): array => [
            ...$change['before']['teacher_ids'], ...$change['after']['teacher_ids'],
        ])->unique();
        foreach ($teacherIds as $teacherId) {
            $personal = array_values(array_filter($changes, fn (array $change): bool => in_array($teacherId, $change['before']['teacher_ids'], true)
                || in_array($teacherId, $change['after']['teacher_ids'], true)));
            DB::table('timetable_change_messages')->insert([
                'long_term_change_id' => $record->id, 'teacher_id' => $teacherId, 'event' => $event,
                'changes' => json_encode($personal, JSON_THROW_ON_ERROR), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }
}
