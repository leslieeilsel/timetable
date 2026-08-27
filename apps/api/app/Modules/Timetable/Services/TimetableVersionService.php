<?php

namespace App\Modules\Timetable\Services;

use App\Enums\AssignmentStatus;
use App\Enums\ScheduleRunStatus;
use App\Enums\TimetableVersionSource;
use App\Enums\TimetableVersionStatus;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Scheduling\Models\ScheduleCandidate;
use App\Modules\Scheduling\Services\WeekPatternService;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Models\TimetableVersion;
use App\Support\ApiProblemException;
use Illuminate\Support\Facades\DB;

class TimetableVersionService
{
    public function __construct(private readonly WeekPatternService $weekPatterns) {}

    public function resolveForRead(Semester $semester, ?int $versionId = null): ?TimetableVersion
    {
        if ($versionId !== null) {
            return $this->findForSemester($semester, $versionId);
        }

        $draft = $semester->timetableVersions()
            ->where('status', TimetableVersionStatus::Draft->value)
            ->latest('version_no')
            ->first();
        if ($draft !== null) {
            return $draft;
        }

        if ($semester->current_timetable_version_id !== null) {
            return $semester->currentTimetableVersion()->first();
        }

        return $semester->timetableVersions()->latest('version_no')->first();
    }

    public function ensureWorkingDraft(Semester $semester, User $actor, ?int $versionId = null): TimetableVersion
    {
        if ($versionId !== null) {
            $version = $this->findForSemester($semester, $versionId);
            $this->assertDraft($version);

            return $version;
        }

        $draft = $semester->timetableVersions()
            ->where('status', TimetableVersionStatus::Draft->value)
            ->latest('version_no')
            ->lockForUpdate()
            ->first();
        if ($draft !== null) {
            return $draft;
        }

        $base = $semester->current_timetable_version_id === null
            ? null
            : $semester->currentTimetableVersion()->lockForUpdate()->first();

        return $this->createDraft($semester, $actor, $base);
    }

    public function createDraft(
        Semester $semester,
        User $actor,
        ?TimetableVersion $base = null,
        ?string $name = null,
    ): TimetableVersion {
        if ($base !== null && $base->semester_id !== $semester->id) {
            throw new ApiProblemException('VERSION_SEMESTER_MISMATCH', '基础课表版本不属于该学期', 404);
        }

        $versionNo = ((int) $semester->timetableVersions()->lockForUpdate()->max('version_no')) + 1;
        $version = TimetableVersion::query()->create([
            'semester_id' => $semester->id,
            'version_no' => $versionNo,
            'name' => $name ?? "编辑草稿 v{$versionNo}",
            'status' => TimetableVersionStatus::Draft,
            'source' => TimetableVersionSource::Manual,
            'base_version_id' => $base?->id,
            'created_by' => $actor->id,
            'input_revision' => (int) $semester->getRawOriginal('input_revision'),
        ]);

        if ($base !== null) {
            $this->copyEntries($base, $version, 'manual');
        }

        return $version;
    }

    public function createFromCandidate(
        Semester $semester,
        User $actor,
        ScheduleCandidate $candidate,
        ?string $name = null,
    ): TimetableVersion {
        $candidate->loadMissing([
            'run',
            'entries.teachingAssignment.schoolClass',
            'entries.teachingAssignment.teachingGroup.schoolClasses',
            'entries.teachingAssignment.collaborators',
        ]);
        if ($candidate->semester_id !== $semester->id || $candidate->run->semester_id !== $semester->id) {
            throw new ApiProblemException('CANDIDATE_SEMESTER_MISMATCH', '候选方案不属于该学期', 404);
        }
        if ($candidate->run->status !== ScheduleRunStatus::Completed) {
            throw new ApiProblemException('CANDIDATE_NOT_READY', '只有完整生成的候选方案可以采用', 409);
        }
        if ($candidate->run->input_revision !== (int) $semester->getRawOriginal('input_revision')) {
            throw new ApiProblemException('CANDIDATE_INPUT_STALE', '排课输入已变化，该候选方案只能查看，不能采用', 409, [
                'candidate_input_revision' => $candidate->run->input_revision,
                'current_input_revision' => (int) $semester->getRawOriginal('input_revision'),
            ]);
        }
        if ($candidate->hard_conflict_count !== 0 || $candidate->unscheduled_count !== 0) {
            throw new ApiProblemException('CANDIDATE_NOT_FEASIBLE', '候选方案存在硬冲突或未排课程，不能采用', 409, [
                'hard_conflict_count' => $candidate->hard_conflict_count,
                'unscheduled_count' => $candidate->unscheduled_count,
            ]);
        }
        $existing = TimetableVersion::query()->where('source_candidate_id', $candidate->id)->first();
        if ($existing !== null) {
            throw new ApiProblemException('CANDIDATE_ALREADY_ADOPTED', '该候选方案已经创建过课表版本', 409, [
                'version_id' => $existing->id,
                'version_status' => $existing->status->value,
            ]);
        }

        $this->assertCandidateCompleteAndConflictFree($semester, $candidate);
        $versionNo = ((int) $semester->timetableVersions()->lockForUpdate()->max('version_no')) + 1;
        $version = TimetableVersion::query()->create([
            'semester_id' => $semester->id,
            'version_no' => $versionNo,
            'name' => $name ?? "{$candidate->name} · v{$versionNo}",
            'status' => TimetableVersionStatus::Draft,
            'source' => TimetableVersionSource::Candidate,
            'source_candidate_id' => $candidate->id,
            'base_version_id' => $semester->current_timetable_version_id,
            'created_by' => $actor->id,
            'input_revision' => $candidate->run->input_revision,
            'quality_score' => $candidate->quality_score,
            'score_breakdown' => $candidate->score_breakdown,
            'hard_conflict_count' => $candidate->hard_conflict_count,
            'soft_warning_count' => $candidate->soft_warning_count,
        ]);

        $classRows = [];
        $teacherRows = [];
        $timestamp = now();
        foreach ($candidate->entries->sortBy('id') as $candidateEntry) {
            $assignment = $candidateEntry->teachingAssignment;
            $entryId = (int) DB::table('timetable_entries')->insertGetId([
                'semester_id' => $semester->id,
                'timetable_version_id' => $version->id,
                'teaching_assignment_id' => $assignment->id,
                'school_class_id' => $assignment->school_class_id,
                'teaching_group_id' => $assignment->teaching_group_id,
                'teacher_id' => $assignment->teacher_id,
                'course_id' => $assignment->course_id,
                'actual_room_id' => $candidateEntry->actual_room_id,
                'week_pattern' => $candidateEntry->week_pattern->value,
                'active_weeks' => $candidateEntry->active_weeks === null
                    ? null
                    : json_encode($candidateEntry->active_weeks, JSON_THROW_ON_ERROR),
                'weekday' => $candidateEntry->weekday,
                'item_id' => $candidateEntry->item_id,
                'source' => 'automatic',
                'is_locked' => $candidateEntry->is_locked,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
            $pivot = [
                'timetable_entry_id' => $entryId,
                'timetable_version_id' => $version->id,
                'week_pattern' => $candidateEntry->week_pattern->value,
                'weekday' => $candidateEntry->weekday,
                'item_id' => $candidateEntry->item_id,
            ];
            $classIds = $assignment->school_class_id === null
                ? $assignment->teachingGroup?->schoolClasses->pluck('id')->all() ?? []
                : [$assignment->school_class_id];
            $teacherIds = [
                $assignment->teacher_id,
                ...$assignment->collaborators->pluck('id')->all(),
            ];
            foreach (array_unique($classIds) as $classId) {
                $classRows[] = [...$pivot, 'school_class_id' => $classId];
            }
            foreach (array_unique($teacherIds) as $teacherId) {
                $teacherRows[] = [...$pivot, 'teacher_id' => $teacherId];
            }
        }
        foreach (array_chunk($classRows, 500) as $rows) {
            DB::table('timetable_entry_classes')->insert($rows);
        }
        foreach (array_chunk($teacherRows, 500) as $rows) {
            DB::table('timetable_entry_teachers')->insert($rows);
        }

        return $version;
    }

    public function activate(Semester $semester, TimetableVersion $version): ?TimetableVersion
    {
        if ($version->semester_id !== $semester->id) {
            throw new ApiProblemException('VERSION_SEMESTER_MISMATCH', '课表版本不属于该学期', 404);
        }
        $this->assertDraft($version);
        $this->assertActivatable($semester, $version);

        $previous = $semester->current_timetable_version_id === null
            ? null
            : TimetableVersion::query()->lockForUpdate()->find($semester->current_timetable_version_id);
        if ($previous !== null) {
            $previous->forceFill(['status' => TimetableVersionStatus::Historical])->save();
        }
        $version->forceFill([
            'status' => TimetableVersionStatus::Active,
            'activated_at' => now(),
        ])->save();
        $semester->current_timetable_version_id = $version->id;
        $semester->increment('timetable_revision');
        $semester->save();
        $semester->refresh();

        return $previous;
    }

    public function assertActivatable(Semester $semester, TimetableVersion $version): void
    {
        if ($version->input_revision !== (int) $semester->getRawOriginal('input_revision')) {
            throw new ApiProblemException('VERSION_INPUT_STALE', '排课输入已变化，请重新校验或生成新草稿', 409, [
                'version_input_revision' => $version->input_revision,
                'current_input_revision' => (int) $semester->getRawOriginal('input_revision'),
            ]);
        }
        if ($version->hard_conflict_count !== 0) {
            throw new ApiProblemException('VERSION_HAS_HARD_CONFLICTS', '存在硬冲突的课表版本不能设为当前课表', 409, [
                'hard_conflict_count' => $version->hard_conflict_count,
            ]);
        }

        $incomplete = $semester->teachingAssignments()
            ->where('status', AssignmentStatus::Confirmed->value)
            ->withCount(['entries' => fn ($query) => $query->where('timetable_version_id', $version->id)])
            ->get()
            ->filter(fn (TeachingAssignment $assignment) => $assignment->entries_count !== $assignment->weekly_items)
            ->map(fn (TeachingAssignment $assignment): array => [
                'assignment_id' => $assignment->id,
                'required' => $assignment->weekly_items,
                'scheduled' => $assignment->entries_count,
            ])->values();
        if ($incomplete->isNotEmpty()) {
            throw new ApiProblemException('VERSION_INCOMPLETE', '课时未完整安排，不能设为当前课表', 409, [
                'incomplete_count' => $incomplete->count(),
                'incomplete_assignments' => $incomplete->take(50)->all(),
            ]);
        }
    }

    public function findForSemester(Semester $semester, int $versionId): TimetableVersion
    {
        $version = TimetableVersion::query()->find($versionId);
        if ($version === null || $version->semester_id !== $semester->id) {
            throw new ApiProblemException('VERSION_SEMESTER_MISMATCH', '课表版本不属于该学期', 404);
        }

        return $version;
    }

    public function assertDraft(TimetableVersion $version): void
    {
        if ($version->status !== TimetableVersionStatus::Draft) {
            throw new ApiProblemException('VERSION_READ_ONLY', '当前课表和历史版本不可直接修改，请先创建编辑草稿', 409);
        }
    }

    public function copyEntries(TimetableVersion $source, TimetableVersion $target, string $entrySource): void
    {
        if ($source->semester_id !== $target->semester_id) {
            throw new ApiProblemException('VERSION_SEMESTER_MISMATCH', '课表版本不属于同一学期', 409);
        }

        TimetableEntry::query()
            ->where('timetable_version_id', $source->id)
            ->orderBy('id')
            ->chunkById(500, function ($entries) use ($target, $entrySource): void {
                $timestamp = now();
                foreach ($entries as $entry) {
                    $newEntryId = (int) DB::table('timetable_entries')->insertGetId([
                        'semester_id' => $entry->semester_id,
                        'timetable_version_id' => $target->id,
                        'teaching_assignment_id' => $entry->teaching_assignment_id,
                        'school_class_id' => $entry->school_class_id,
                        'teaching_group_id' => $entry->teaching_group_id,
                        'teacher_id' => $entry->teacher_id,
                        'course_id' => $entry->course_id,
                        'actual_room_id' => $entry->actual_room_id,
                        'week_pattern' => $entry->week_pattern->value,
                        'active_weeks' => $entry->active_weeks === null
                            ? null
                            : json_encode($entry->active_weeks, JSON_THROW_ON_ERROR),
                        'weekday' => $entry->weekday,
                        'item_id' => $entry->item_id,
                        'source' => $entrySource,
                        'is_locked' => $entry->is_locked,
                        'created_at' => $timestamp,
                        'updated_at' => $timestamp,
                    ]);
                    $pivot = [
                        'timetable_entry_id' => $newEntryId,
                        'timetable_version_id' => $target->id,
                        'week_pattern' => $entry->week_pattern->value,
                        'weekday' => $entry->weekday,
                        'item_id' => $entry->item_id,
                    ];
                    $classRows = DB::table('timetable_entry_classes')->where('timetable_entry_id', $entry->id)
                        ->pluck('school_class_id')->map(fn ($classId): array => [...$pivot, 'school_class_id' => $classId])->all();
                    $teacherRows = DB::table('timetable_entry_teachers')->where('timetable_entry_id', $entry->id)
                        ->pluck('teacher_id')->map(fn ($teacherId): array => [...$pivot, 'teacher_id' => $teacherId])->all();
                    if ($classRows !== []) {
                        DB::table('timetable_entry_classes')->insert($classRows);
                    }
                    if ($teacherRows !== []) {
                        DB::table('timetable_entry_teachers')->insert($teacherRows);
                    }
                }
            });
    }

    private function assertCandidateCompleteAndConflictFree(Semester $semester, ScheduleCandidate $candidate): void
    {
        $required = $semester->teachingAssignments()
            ->where('status', AssignmentStatus::Confirmed->value)
            ->pluck('weekly_items', 'id');
        $actual = $candidate->entries->countBy('teaching_assignment_id');
        $incomplete = [];
        foreach ($required as $assignmentId => $requiredCount) {
            $actualCount = (int) ($actual[$assignmentId] ?? 0);
            if ($actualCount !== (int) $requiredCount) {
                $incomplete[] = [
                    'assignment_id' => $assignmentId,
                    'required' => (int) $requiredCount,
                    'scheduled' => $actualCount,
                ];
            }
        }
        if ($incomplete !== [] || $candidate->entries->count() !== (int) $required->sum()) {
            throw new ApiProblemException('CANDIDATE_INCOMPLETE', '候选方案课时不完整，不能采用', 409, [
                'incomplete_count' => count($incomplete),
                'incomplete_assignments' => array_slice($incomplete, 0, 50),
            ]);
        }

        $occupancy = [];
        foreach ($candidate->entries as $entry) {
            $assignment = $entry->teachingAssignment;
            if ($assignment->semester_id !== $semester->id || $assignment->status !== AssignmentStatus::Confirmed) {
                throw new ApiProblemException('CANDIDATE_ASSIGNMENT_INVALID', '候选方案引用了无效任课关系', 409, [
                    'candidate_entry_id' => $entry->id,
                    'assignment_id' => $assignment->id,
                ]);
            }
            $classIds = $assignment->school_class_id === null
                ? $assignment->teachingGroup?->schoolClasses->pluck('id')->all() ?? []
                : [$assignment->school_class_id];
            $teacherIds = [
                $assignment->teacher_id,
                ...$assignment->collaborators->pluck('id')->all(),
            ];
            $resources = ["room:{$entry->actual_room_id}"];
            foreach (array_unique($classIds) as $classId) {
                $resources[] = "school_class:{$classId}";
            }
            foreach (array_unique($teacherIds) as $teacherId) {
                $resources[] = "teacher:{$teacherId}";
            }
            $weekMask = $this->weekPatterns->mask($semester, $entry->week_pattern, $entry->active_weeks);
            foreach ($resources as $resource) {
                $key = "{$resource}:{$entry->weekday}:{$entry->item_id}";
                if ((($occupancy[$key] ?? 0) & $weekMask) !== 0) {
                    throw new ApiProblemException('CANDIDATE_RESOURCE_CONFLICT', '候选方案包含班级、教师或教室硬冲突', 409, [
                        'candidate_entry_id' => $entry->id,
                        'resource' => $resource,
                        'weekday' => $entry->weekday,
                        'item_id' => $entry->item_id,
                    ]);
                }
                $occupancy[$key] = ($occupancy[$key] ?? 0) | $weekMask;
            }
        }
    }
}
