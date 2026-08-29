<?php

namespace App\Modules\Scheduling\Http\Controllers;

use App\Enums\AssignmentStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Support\EtagService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardSummaryController
{
    public function __construct(
        private readonly EtagService $etags,
    ) {}

    public function __invoke(Request $request, Semester $semester): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $version = $semester->current_timetable_version_id === null
            ? null
            : $semester->currentTimetableVersion()->first();
        $workingDraft = $request->user()->role->canEdit()
            ? $semester->timetableVersions()->where('status', 'draft')->latest('version_no')->first()
            : null;
        $isStale = fn ($item): bool => $item !== null
            && ($item->input_revision !== (int) $semester->getRawOriginal('input_revision')
                || $item->catalog_revision === null
                || $item->catalog_revision !== (int) $settings->getRawOriginal('catalog_revision'));
        $confirmed = AssignmentStatus::Confirmed->value;
        $assignmentCount = $semester->teachingAssignments()->count();
        $confirmedCount = $semester->teachingAssignments()->where('status', $confirmed)->count();
        $required = (int) $semester->teachingAssignments()
            ->where('status', $confirmed)
            ->sum('weekly_items');
        $scheduled = $version === null
            ? 0
            : TimetableEntry::query()
                ->where('semester_id', $semester->id)
                ->where('timetable_version_id', $version->id)
                ->whereHas('teachingAssignment', fn ($query) => $query->where('status', $confirmed))
                ->count();

        return response()->json(['data' => [
            'class_count' => $semester->classSettings()->count(),
            'template_ready' => $semester->scheduleTemplate()->exists(),
            'assignment_count' => $assignmentCount,
            'confirmed_count' => $confirmedCount,
            'scheduled' => $scheduled,
            'required' => $required,
            'remaining' => max(0, $required - $scheduled),
            'current_version_id' => $version?->id,
            'current_version_name' => $version?->name,
            'current_version_status' => $version?->status->value,
            'current_version_is_stale' => $isStale($version),
            'current_version_quality_score' => $version?->quality_score,
            'current_version_hard_conflict_count' => $version === null ? 0 : $version->hard_conflict_count,
            'current_version_soft_warning_count' => $version === null ? 0 : $version->soft_warning_count,
            'working_draft_id' => $workingDraft?->id,
            'working_draft_name' => $workingDraft?->name,
            'working_draft_is_stale' => $isStale($workingDraft),
        ]])->header('ETag', $this->etags->semester($semester, $settings));
    }
}
