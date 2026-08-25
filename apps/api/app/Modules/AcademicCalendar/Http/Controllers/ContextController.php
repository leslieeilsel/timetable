<?php

namespace App\Modules\AcademicCalendar\Http\Controllers;

use App\Enums\LifecycleStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Support\ApiProblemException;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ContextController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly AuditLogger $audit,
    ) {}

    public function show(): JsonResponse
    {
        $settings = AppSetting::query()->with('currentSemester.academicYear')->findOrFail(1);
        $semester = $settings->currentSemester;

        return response()->json(['data' => [
            'timezone' => $settings->timezone,
            'current_semester' => $semester === null ? null : [
                'id' => $semester->id,
                'name' => $semester->name,
                'status' => $semester->status->value,
                'academic_year' => [
                    'id' => $semester->academicYear->id,
                    'name' => $semester->academicYear->name,
                ],
            ],
        ]]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate(['semester_id' => ['nullable', 'integer', 'exists:semesters,id']]);

        DB::transaction(function () use ($request, $data): void {
            $actor = $this->guard->actor($request);
            $settings = AppSetting::query()->lockForUpdate()->findOrFail(1);
            $before = $settings->current_semester_id;
            $target = isset($data['semester_id']) ? Semester::query()->lockForUpdate()->findOrFail($data['semester_id']) : null;
            if ($target !== null && $target->status !== LifecycleStatus::Open) {
                throw new ApiProblemException('CURRENT_SEMESTER_MUST_BE_OPEN', '当前学期必须处于开放状态', 409);
            }
            $settings->current_semester_id = $target?->id;
            if ($settings->isDirty()) {
                $settings->save();
                $this->audit->record($request, $actor, 'set_current_semester', 'app_setting', 1, ['semester_id' => $before], ['semester_id' => $target?->id]);
            }
        }, 3);

        return $this->show();
    }
}
