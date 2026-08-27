<?php

namespace App\Modules\Scheduling\Http\Controllers;

use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Scheduling\Services\PreparationCheckService;
use App\Support\EtagService;
use Illuminate\Http\JsonResponse;

class PreparationCheckController
{
    public function __construct(
        private readonly PreparationCheckService $checks,
        private readonly EtagService $etags,
    ) {}

    public function __invoke(Semester $semester): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $recentRuns = $semester->scheduleRuns()
            ->latest('id')
            ->limit(5)
            ->get(['id', 'status', 'progress_stage', 'progress_percent', 'input_revision', 'created_at', 'completed_at']);

        return response()->json([
            'data' => [
                ...$this->checks->inspect($semester),
                'recent_runs' => $recentRuns,
            ],
            'meta' => [
                'semester_id' => $semester->id,
                'input_revision' => (string) $semester->getRawOriginal('input_revision'),
                'timetable_revision' => (string) $semester->getRawOriginal('timetable_revision'),
                'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
            ],
        ])->header('ETag', $this->etags->semester($semester, $settings));
    }
}
