<?php

namespace App\Modules\Timetable\Services;

use App\Enums\CalendarExceptionType;
use App\Enums\OperationalStatus;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\DailyOperations\Models\CalendarException;
use App\Modules\DailyOperations\Models\Substitution;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Models\TimetableVersion;
use Illuminate\Support\Carbon;

class OperationalAdjustmentRebaseService
{
    public function __construct(private readonly LessonIdentityService $lessonIdentities) {}

    /**
     * @return array{
     *   preserved: int,
     *   recomputed: int,
     *   needs_review: int,
     *   orphaned: int,
     *   blocked: bool,
     *   items: list<array<string, mixed>>
     * }
     */
    public function preview(
        Semester $semester,
        TimetableVersion $target,
        string $effectiveFrom,
        string $effectiveTo,
    ): array {
        $items = [];
        $from = Carbon::parse($effectiveFrom)->toDateString();
        $to = Carbon::parse($effectiveTo)->toDateString();

        $exceptions = CalendarException::query()
            ->where('semester_id', $semester->id)
            ->where('status', OperationalStatus::Active->value)
            ->where(function ($query) use ($from, $to): void {
                $query->whereBetween('effective_date', [$from, $to])
                    ->orWhereBetween('replacement_date', [$from, $to]);
            })
            ->with([
                'originalEntry.course:id,name',
                'originalEntry.item:id,name',
                'relatedEntry.course:id,name',
                'relatedEntry.item:id,name',
            ])
            ->orderBy('effective_date')
            ->orderBy('id')
            ->get();

        foreach ($exceptions as $exception) {
            $checks = [];
            $effectiveDate = $exception->effective_date->toDateString();
            $replacementDate = $exception->replacement_date?->toDateString();
            if ($effectiveDate >= $from && $effectiveDate <= $to && $exception->original_entry_id !== null) {
                $checks[] = $this->endpoint(
                    $target,
                    $exception->original_entry_id,
                    $effectiveDate,
                    'original',
                );
            }
            $relatedDate = $replacementDate ?? $effectiveDate;
            $relatedInside = $relatedDate >= $from && $relatedDate <= $to;
            if ($exception->type === CalendarExceptionType::Swap
                && $relatedInside
                && $exception->related_entry_id !== null) {
                $checks[] = $this->endpoint(
                    $target,
                    $exception->related_entry_id,
                    $relatedDate,
                    'related',
                );
            }
            $status = $this->statusForChecks($checks);
            $items[] = [
                'kind' => 'calendar_exception',
                'id' => $exception->id,
                'status' => $status,
                'type' => $exception->type->value,
                'effective_date' => $effectiveDate,
                'replacement_date' => $replacementDate,
                'summary' => $this->exceptionSummary($exception),
                'reason' => $this->reasonForStatus($status, $checks),
                'endpoints' => $checks,
            ];
        }

        $substitutions = Substitution::query()
            ->where('status', OperationalStatus::Active->value)
            ->whereBetween('effective_date', [$from, $to])
            ->whereHas('originalEntry', fn ($query) => $query->where('semester_id', $semester->id))
            ->with(['originalEntry.course:id,name', 'replacementTeacher:id,name', 'replacedTeacher:id,name'])
            ->orderBy('effective_date')
            ->orderBy('id')
            ->get();
        foreach ($substitutions as $substitution) {
            $date = $substitution->effective_date->toDateString();
            $endpoint = $this->endpoint($target, $substitution->original_entry_id, $date, 'original');
            $status = $endpoint['status'];
            if ($status === 'preserved' && $endpoint['mapped_entry_id'] !== null) {
                $targetEntry = TimetableEntry::query()
                    ->with('teachers:id')
                    ->find($endpoint['mapped_entry_id']);
                $teacherIds = $targetEntry?->teachers->pluck('id')->map(fn ($id): int => (int) $id)->all() ?? [];
                if ($targetEntry !== null && ! in_array((int) $substitution->replaced_teacher_id, $teacherIds, true)) {
                    $status = 'needs_review';
                    $endpoint['status'] = 'needs_review';
                    $endpoint['reason'] = '新课表中这节课已不再由原请假教师承担，原代课安排需要重新确认';
                }
            }
            $items[] = [
                'kind' => 'substitution',
                'id' => $substitution->id,
                'status' => $status,
                'effective_date' => $date,
                'summary' => $substitution->originalEntry->course->name.' · 代课',
                'reason' => $endpoint['reason'],
                'endpoints' => [$endpoint],
            ];
        }

        $counts = ['preserved' => 0, 'recomputed' => 0, 'needs_review' => 0, 'orphaned' => 0];
        foreach ($items as $item) {
            $counts[$item['status']]++;
        }

        return [
            ...$counts,
            'blocked' => $counts['needs_review'] > 0 || $counts['orphaned'] > 0,
            'items' => $items,
        ];
    }

    /** @return array<string, mixed> */
    private function endpoint(
        TimetableVersion $target,
        int $sourceEntryId,
        string $date,
        string $role,
    ): array {
        $source = TimetableEntry::query()->with(['course:id,name', 'item:id,name'])->find($sourceEntryId);
        if ($source === null) {
            return [
                'role' => $role,
                'source_entry_id' => $sourceEntryId,
                'lesson_instance_id' => null,
                'mapped_entry_id' => null,
                'status' => 'orphaned',
                'reason' => '原课次已不存在，无法迁移到新课表',
            ];
        }
        if ($source->lesson_instance_id === null) {
            $this->lessonIdentities->ensureEntryIdentity($source);
            $source->refresh();
        }
        $mappedId = $this->lessonIdentities->mappedEntryId($target, $source->id);
        if ($mappedId === null) {
            return [
                'role' => $role,
                'source_entry_id' => $sourceEntryId,
                'lesson_instance_id' => $source->lesson_instance_id,
                'mapped_entry_id' => null,
                'status' => 'orphaned',
                'reason' => '新课表中已没有这节业务课次',
            ];
        }
        $mapped = TimetableEntry::query()->with(['course:id,name', 'item:id,name'])->findOrFail($mappedId);
        if ($mapped->weekday !== Carbon::parse($date)->dayOfWeekIso) {
            return [
                'role' => $role,
                'source_entry_id' => $sourceEntryId,
                'lesson_instance_id' => $source->lesson_instance_id,
                'mapped_entry_id' => $mappedId,
                'status' => 'needs_review',
                'reason' => '这节课在新课表中已改到其他星期，原日期上的临时安排不能直接沿用',
                'mapped_weekday' => $mapped->weekday,
                'mapped_item_id' => $mapped->item_id,
            ];
        }

        return [
            'role' => $role,
            'source_entry_id' => $sourceEntryId,
            'lesson_instance_id' => $source->lesson_instance_id,
            'mapped_entry_id' => $mappedId,
            'status' => 'preserved',
            'reason' => '同一业务课次仍存在，可自动迁移',
            'mapped_weekday' => $mapped->weekday,
            'mapped_item_id' => $mapped->item_id,
        ];
    }

    /** @param list<array<string, mixed>> $checks */
    private function statusForChecks(array $checks): string
    {
        if (collect($checks)->contains(fn (array $check): bool => $check['status'] === 'orphaned')) {
            return 'orphaned';
        }
        if (collect($checks)->contains(fn (array $check): bool => $check['status'] === 'needs_review')) {
            return 'needs_review';
        }

        return 'preserved';
    }

    /** @param list<array<string, mixed>> $checks */
    private function reasonForStatus(string $status, array $checks): string
    {
        if ($status === 'preserved') {
            return '引用的课次在新课表中仍存在，发布时会自动迁移';
        }

        return (string) (collect($checks)->firstWhere('status', $status)['reason'] ?? '需要人工确认');
    }

    private function exceptionSummary(CalendarException $exception): string
    {
        $course = $exception->originalEntry?->course->name ?? '课程';
        $label = match ($exception->type) {
            CalendarExceptionType::Swap => '临时换课',
            CalendarExceptionType::Move => '临时移课',
            CalendarExceptionType::TeacherChange => '临时代课教师',
            CalendarExceptionType::RoomChange => '临时教室',
            CalendarExceptionType::Cancel => '临时停课',
            CalendarExceptionType::Makeup => '临时补课',
            CalendarExceptionType::Activity => '临时活动',
        };

        return $course.' · '.$label;
    }
}
