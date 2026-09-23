<?php

namespace App\Modules\Timetable\Services;

use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Scheduling\Models\ScheduleCandidate;
use App\Modules\Scheduling\Models\ScheduleCandidateEntry;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\Timetable\Models\LessonInstance;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Models\TimetableVersion;
use Illuminate\Support\Collection;

class LessonIdentityService
{
    /**
     * Assign stable lesson identities to every entry of an automatically generated candidate.
     * Existing placements from the chosen baseline are kept when possible; moved lessons are
     * matched to the closest remaining occurrence of the same teaching assignment.
     *
     * @return array<int, int> candidate entry id => lesson instance id
     */
    public function mapCandidate(Semester $semester, ScheduleCandidate $candidate): array
    {
        $candidate->loadMissing(['run', 'entries.item']);
        $baselineId = $candidate->run->base_version_id ?? $semester->current_timetable_version_id;
        $mapping = [];

        foreach ($candidate->entries->groupBy('teaching_assignment_id') as $assignmentId => $targets) {
            $assignment = TeachingAssignment::query()->findOrFail((int) $assignmentId);
            $instances = $this->ensureInstances(
                $semester,
                $assignment,
                max((int) $assignment->weekly_items, $targets->count()),
            );
            $baseline = $baselineId === null
                ? collect()
                : TimetableEntry::query()
                    ->where('timetable_version_id', $baselineId)
                    ->where('teaching_assignment_id', $assignmentId)
                    ->with('item:id,sort_order')
                    ->orderBy('id')
                    ->get();
            foreach ($baseline as $entry) {
                if ($entry->lesson_instance_id === null) {
                    $this->ensureEntryIdentity($entry);
                    $entry->refresh();
                }
            }

            $mapping += $this->matchTargets($targets, $baseline, $instances);
        }

        return $mapping;
    }

    public function identityForNewEntry(
        Semester $semester,
        TeachingAssignment $assignment,
        TimetableVersion $version,
    ): LessonInstance {
        $used = TimetableEntry::query()
            ->where('timetable_version_id', $version->id)
            ->where('teaching_assignment_id', $assignment->id)
            ->whereNotNull('lesson_instance_id')
            ->pluck('lesson_instance_id')
            ->map(fn ($id): int => (int) $id)
            ->all();
        $instances = $this->ensureInstances(
            $semester,
            $assignment,
            max((int) $assignment->weekly_items, count($used) + 1),
        );

        $available = $instances->first(fn (LessonInstance $instance): bool => ! in_array($instance->id, $used, true));
        if ($available !== null) {
            return $available;
        }

        return $this->createNextInstance($semester, $assignment);
    }

    public function ensureEntryIdentity(TimetableEntry $entry): LessonInstance
    {
        if ($entry->lesson_instance_id !== null) {
            return LessonInstance::query()->findOrFail($entry->lesson_instance_id);
        }

        $entry->loadMissing(['teachingAssignment', 'timetableVersion']);
        $sameKey = $entry->entry_key === null
            ? null
            : TimetableEntry::query()
                ->where('id', '!=', $entry->id)
                ->where('entry_key', $entry->entry_key)
                ->whereNotNull('lesson_instance_id')
                ->first();
        if ($sameKey?->lesson_instance_id !== null
            && ! TimetableEntry::query()
                ->where('timetable_version_id', $entry->timetable_version_id)
                ->where('lesson_instance_id', $sameKey->lesson_instance_id)
                ->exists()) {
            $entry->lesson_instance_id = $sameKey->lesson_instance_id;
            $entry->save();

            return LessonInstance::query()->findOrFail($sameKey->lesson_instance_id);
        }

        $instance = $this->identityForNewEntry(
            $entry->timetableVersion->semester,
            $entry->teachingAssignment,
            $entry->timetableVersion,
        );
        $entry->lesson_instance_id = $instance->id;
        $entry->save();

        return $instance;
    }

    public function mappedEntryId(TimetableVersion $target, ?int $entryId): ?int
    {
        if ($entryId === null) {
            return null;
        }
        $entry = TimetableEntry::query()->find($entryId);
        if ($entry === null) {
            return null;
        }
        if ($entry->lesson_instance_id === null) {
            $this->ensureEntryIdentity($entry);
            $entry->refresh();
        }
        if ($entry->lesson_instance_id !== null) {
            $mapped = TimetableEntry::query()
                ->where('timetable_version_id', $target->id)
                ->where('lesson_instance_id', $entry->lesson_instance_id)
                ->value('id');
            if ($mapped !== null) {
                return (int) $mapped;
            }
        }
        if ($entry->entry_key !== null) {
            $mapped = TimetableEntry::query()
                ->where('timetable_version_id', $target->id)
                ->where('entry_key', $entry->entry_key)
                ->first();
            if ($mapped !== null) {
                if ($mapped->lesson_instance_id === null && $entry->lesson_instance_id !== null) {
                    $mapped->lesson_instance_id = $entry->lesson_instance_id;
                    $mapped->save();
                }

                return (int) $mapped->id;
            }
        }

        return null;
    }

    /** @return Collection<int, LessonInstance> */
    private function ensureInstances(
        Semester $semester,
        TeachingAssignment $assignment,
        int $required,
    ): Collection {
        $instances = LessonInstance::query()
            ->where('semester_id', $semester->id)
            ->where('teaching_assignment_id', $assignment->id)
            ->orderBy('occurrence_no')
            ->lockForUpdate()
            ->get();
        for ($occurrence = $instances->count() + 1; $occurrence <= $required; $occurrence++) {
            $instances->push(LessonInstance::query()->create([
                'semester_id' => $semester->id,
                'teaching_assignment_id' => $assignment->id,
                'occurrence_no' => $occurrence,
                'status' => 'active',
            ]));
        }

        return $instances;
    }

    private function createNextInstance(Semester $semester, TeachingAssignment $assignment): LessonInstance
    {
        $next = ((int) LessonInstance::query()
            ->where('semester_id', $semester->id)
            ->where('teaching_assignment_id', $assignment->id)
            ->lockForUpdate()
            ->max('occurrence_no')) + 1;

        return LessonInstance::query()->create([
            'semester_id' => $semester->id,
            'teaching_assignment_id' => $assignment->id,
            'occurrence_no' => $next,
            'status' => 'active',
        ]);
    }

    /**
     * @param  Collection<int, ScheduleCandidateEntry>  $targets
     * @param  Collection<int, TimetableEntry>  $baseline
     * @param  Collection<int, LessonInstance>  $instances
     * @return array<int, int>
     */
    private function matchTargets(Collection $targets, Collection $baseline, Collection $instances): array
    {
        $mapping = [];
        $usedInstances = [];
        $remainingBaseline = $baseline->values();
        $remainingTargets = $targets->sortBy([
            ['weekday', 'asc'], ['item_id', 'asc'], ['id', 'asc'],
        ])->values();

        foreach ($remainingTargets->all() as $target) {
            $exact = $remainingBaseline->first(fn (TimetableEntry $source): bool => $source->lesson_instance_id !== null
                && ! isset($usedInstances[$source->lesson_instance_id])
                && $source->week_pattern->value === $target->week_pattern->value
                && $source->weekday === $target->weekday
                && $source->item_id === $target->item_id
            );
            if ($exact === null) {
                continue;
            }
            $mapping[$target->id] = (int) $exact->lesson_instance_id;
            $usedInstances[$exact->lesson_instance_id] = true;
        }

        foreach ($remainingTargets as $target) {
            if (isset($mapping[$target->id])) {
                continue;
            }
            $closest = $remainingBaseline
                ->filter(fn (TimetableEntry $source): bool => $source->lesson_instance_id !== null && ! isset($usedInstances[$source->lesson_instance_id])
                )
                ->sortBy(fn (TimetableEntry $source): int => $this->distance($source, $target))
                ->first();
            if ($closest !== null) {
                $mapping[$target->id] = (int) $closest->lesson_instance_id;
                $usedInstances[$closest->lesson_instance_id] = true;

                continue;
            }
            $instance = $instances->first(fn (LessonInstance $candidate): bool => ! isset($usedInstances[$candidate->id]));
            if ($instance === null) {
                continue;
            }
            $mapping[$target->id] = $instance->id;
            $usedInstances[$instance->id] = true;
        }

        return $mapping;
    }

    private function distance(TimetableEntry $source, ScheduleCandidateEntry $target): int
    {
        $patternPenalty = $source->week_pattern->value === $target->week_pattern->value ? 0 : 1000;
        $sourceOrder = $source->item->sort_order;
        $targetOrder = $target->item->sort_order;

        return $patternPenalty
            + abs($source->weekday - $target->weekday) * 100
            + abs($sourceOrder - $targetOrder) * 10
            + ($source->actual_room_id === $target->actual_room_id ? 0 : 1);
    }
}
