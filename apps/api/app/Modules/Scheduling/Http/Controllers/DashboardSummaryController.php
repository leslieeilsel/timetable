<?php

namespace App\Modules\Scheduling\Http\Controllers;

use App\Enums\AssignmentStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Modules\Timetable\Services\TimetableVersionService;
use App\Support\EtagService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardSummaryController
{
    public function __construct(
        private readonly TimetableVersionService $versions,
        private readonly EtagService $etags,
    ) {}

    public function __invoke(Request $request, Semester $semester): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $version = $this->versions->resolveForRead(
            $semester,
            null,
            $request->user()->role->canEdit(),
        );
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
        ]])->header('ETag', $this->etags->semester($semester, $settings));
    }
}
