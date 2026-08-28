<?php

namespace App\Modules\Timetable\Services;

use App\Enums\ConstraintKind;
use App\Enums\ConstraintStatus;
use App\Enums\ConstraintTargetType;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Scheduling\Models\SchedulingConstraint;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Models\TimetableVersion;
use App\Support\ApiProblemException;

class TimetableSynchronizationService
{
    /**
     * Resolve the transitive component of active hard synchronization rules.
     *
     * @return list<int>
     */
    public function assignmentIds(Semester $semester, int $assignmentId): array
    {
        $links = $this->links($semester);
        if (! isset($links[$assignmentId])) {
            return [$assignmentId];
        }

        $component = [];
        $pending = [$assignmentId];
        while ($pending !== []) {
            $currentId = array_pop($pending);
            if (isset($component[$currentId])) {
                continue;
            }
            $component[$currentId] = true;
            foreach (array_keys($links[$currentId] ?? []) as $relatedId) {
                $pending[] = (int) $relatedId;
            }
        }
        $ids = array_map('intval', array_keys($component));
        sort($ids);

        return $ids;
    }

    /**
     * @param  list<int>|null  $additionalAssignmentIds
     * @return list<array<string, mixed>>
     */
    public function versionAlignmentIssues(
        Semester $semester,
        TimetableVersion $version,
        ?array $additionalAssignmentIds = null,
        ?int $excludingConstraintId = null,
    ): array {
        if ($version->semester_id !== $semester->id) {
            throw new ApiProblemException('VERSION_SEMESTER_MISMATCH', '课表版本不属于该学期', 404);
        }
        $components = $this->components($this->links($semester, $additionalAssignmentIds, $excludingConstraintId));
        if ($components === []) {
            return [];
        }
        $assignmentIds = array_values(array_unique(array_merge(...$components)));
        $entries = TimetableEntry::query()
            ->where('semester_id', $semester->id)
            ->where('timetable_version_id', $version->id)
            ->whereIn('teaching_assignment_id', $assignmentIds)
            ->get(['id', 'teaching_assignment_id', 'weekday', 'item_id', 'week_pattern', 'active_weeks']);
        $issues = [];
        foreach ($components as $component) {
            $signaturesByAssignment = [];
            foreach ($component as $assignmentId) {
                $signatures = $entries->where('teaching_assignment_id', $assignmentId)
                    ->map(fn (TimetableEntry $entry): string => $this->entrySignature($entry))
                    ->values()
                    ->all();
                sort($signatures);
                $signaturesByAssignment[$assignmentId] = $signatures;
            }
            $baseline = $signaturesByAssignment[$component[0]];
            if (collect($signaturesByAssignment)->every(fn (array $signatures): bool => $signatures === $baseline)) {
                continue;
            }
            $issues[] = [
                'version_id' => $version->id,
                'version_name' => $version->name,
                'assignment_ids' => $component,
                'scheduled_counts' => array_map('count', $signaturesByAssignment),
                'positions' => $signaturesByAssignment,
            ];
        }

        return $issues;
    }

    /** @param list<int>|null $additionalAssignmentIds */
    public function assertVersionAligned(
        Semester $semester,
        TimetableVersion $version,
        ?array $additionalAssignmentIds = null,
        ?int $excludingConstraintId = null,
    ): void {
        $issues = $this->versionAlignmentIssues(
            $semester,
            $version,
            $additionalAssignmentIds,
            $excludingConstraintId,
        );
        if ($issues !== []) {
            throw new ApiProblemException(
                'TIMETABLE_SYNCHRONIZATION_MISALIGNED',
                '同步组在该课表版本中的课时数量、周型或位置不一致',
                409,
                ['synchronization_issues' => $issues],
            );
        }
    }

    /**
     * A newly activated/edited rule must not make a writable or current version
     * invalid. Historical versions remain immutable snapshots of their old rules.
     *
     * @param  list<int>  $additionalAssignmentIds
     */
    public function assertCurrentVersionsAligned(
        Semester $semester,
        array $additionalAssignmentIds,
        ?int $excludingConstraintId = null,
    ): void {
        $versions = $semester->timetableVersions()
            ->whereIn('status', ['draft', 'active'])
            ->get();
        $issues = [];
        foreach ($versions as $version) {
            $issues = [
                ...$issues,
                ...$this->versionAlignmentIssues($semester, $version, $additionalAssignmentIds, $excludingConstraintId),
            ];
        }
        if ($issues !== []) {
            throw new ApiProblemException(
                'TIMETABLE_SYNCHRONIZATION_MISALIGNED',
                '现有课表版本中的同步组尚未对齐，不能启用或修改该规则',
                409,
                ['synchronization_issues' => $issues],
            );
        }
    }

    /**
     * @param  list<int>|null  $additionalAssignmentIds
     * @return array<int, array<int, true>>
     */
    private function links(
        Semester $semester,
        ?array $additionalAssignmentIds = null,
        ?int $excludingConstraintId = null,
    ): array {
        $links = [];
        $constraints = $semester->schedulingConstraints()
            ->where('status', ConstraintStatus::Active->value)
            ->where('kind', ConstraintKind::Hard->value)
            ->where('category', 'synchronization')
            ->when($excludingConstraintId !== null, fn ($query) => $query->whereKeyNot($excludingConstraintId))
            ->get();
        foreach ($constraints as $constraint) {
            $this->appendLinks($links, $this->constraintAssignmentIds($constraint));
        }
        if ($additionalAssignmentIds !== null) {
            $this->appendLinks($links, $additionalAssignmentIds);
        }

        return $links;
    }

    /**
     * @param  array<int, array<int, true>>  $links
     * @param  list<int>  $ids
     */
    private function appendLinks(array &$links, array $ids): void
    {
        $ids = array_values(array_unique(array_filter($ids, fn (int $id): bool => $id > 0)));
        foreach ($ids as $id) {
            foreach ($ids as $relatedId) {
                if ($id !== $relatedId) {
                    $links[$id][$relatedId] = true;
                }
            }
        }
    }

    /**
     * @param  array<int, array<int, true>>  $links
     * @return list<list<int>>
     */
    private function components(array $links): array
    {
        $components = [];
        $visited = [];
        foreach (array_keys($links) as $assignmentId) {
            if (isset($visited[$assignmentId])) {
                continue;
            }
            $component = [];
            $pending = [(int) $assignmentId];
            while ($pending !== []) {
                $currentId = array_pop($pending);
                if (isset($visited[$currentId])) {
                    continue;
                }
                $visited[$currentId] = true;
                $component[] = $currentId;
                foreach (array_keys($links[$currentId] ?? []) as $relatedId) {
                    $pending[] = (int) $relatedId;
                }
            }
            sort($component);
            if (count($component) > 1) {
                $components[] = $component;
            }
        }

        return $components;
    }

    private function entrySignature(TimetableEntry $entry): string
    {
        $weeks = array_map('intval', $entry->active_weeks ?? []);
        sort($weeks);

        return implode(':', [
            $entry->weekday,
            $entry->item_id,
            $entry->week_pattern->value,
            json_encode(array_values(array_unique($weeks)), JSON_THROW_ON_ERROR),
        ]);
    }

    /** @return list<int> */
    private function constraintAssignmentIds(SchedulingConstraint $constraint): array
    {
        $ids = $constraint->requirement['with_assignment_ids'] ?? [];
        if (! is_array($ids)) {
            return [];
        }
        $ids = array_values(array_filter($ids, fn (mixed $id): bool => is_int($id) && $id > 0));
        if ($constraint->target_type === ConstraintTargetType::TeachingAssignment && $constraint->target_id !== null) {
            $ids[] = $constraint->target_id;
        }

        return array_values(array_unique($ids));
    }
}
