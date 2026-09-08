<?php

namespace App\Modules\Timetable\Http\Controllers;

use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\DailyOperations\Services\DailyTimetableService;
use App\Modules\Resources\Models\SchoolClass;
use App\Support\ApiProblemException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class MyTimetableController
{
    public function __construct(private readonly DailyTimetableService $daily) {}

    public function __invoke(Request $request): JsonResponse
    {
        [$settings, $semester] = $this->context();
        [$from, $to] = $this->range($request, $semester, $settings->timezone);

        $teacher = $request->user()->teacher;
        $days = [];
        $cursor = $from->copy();
        while ($cursor->lessThanOrEqualTo($to)) {
            $resolved = $this->daily->forDate($semester, $cursor->toDateString());
            $rows = collect($resolved['rows'])
                ->filter(fn (array $row): bool => in_array($teacher->id, $row['teacher_ids'], true)
                    || in_array($teacher->id, $row['original_teacher_ids'] ?? [], true))
                ->map(function (array $row) use ($teacher): array {
                    $wasOriginal = in_array($teacher->id, $row['original_teacher_ids'] ?? [], true);
                    $isActual = in_array($teacher->id, $row['teacher_ids'], true);
                    $row['duty_status'] = $isActual ? ($wasOriginal ? 'assigned' : 'added') : 'removed';

                    return $row;
                })
                ->values()
                ->all();
            $days[] = [
                'date' => $resolved['date'],
                'weekday' => $resolved['weekday'],
                'week_number' => $resolved['week_number'],
                'version' => [
                    'id' => $resolved['version']->id,
                    'version_no' => $resolved['version']->version_no,
                    'name' => $resolved['version']->name,
                ],
                'rows' => $rows,
            ];
            $cursor->addDay();
        }

        return response()->json(['data' => [
            ...$this->header($teacher, $semester, $settings->timezone),
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'days' => $days,
        ]]);
    }

    public function classes(Request $request): JsonResponse
    {
        [$settings, $semester] = $this->context();
        [$from, $to] = $this->range($request, $semester, $settings->timezone);
        $teacher = $request->user()->teacher;
        $permissions = $this->classPermissions($semester, $teacher->id, $from, $to);
        $datesByClass = [];
        foreach ($permissions as $date => $classIds) {
            foreach ($classIds as $classId) {
                $datesByClass[$classId][] = $date;
            }
        }
        $classes = SchoolClass::query()
            ->with('grade:id,name')
            ->whereIn('id', array_keys($datesByClass))
            ->orderBy('name')
            ->get()
            ->map(fn (SchoolClass $class): array => [
                'id' => $class->id,
                'name' => $class->name,
                'code' => $class->code,
                'grade' => $class->grade->only(['id', 'name']),
                'accessible_dates' => $datesByClass[$class->id],
            ])
            ->values();

        return response()->json(['data' => [
            ...$this->header($teacher, $semester, $settings->timezone),
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'classes' => $classes,
        ]]);
    }

    public function classTimetable(Request $request, SchoolClass $schoolClass): JsonResponse
    {
        [$settings, $semester] = $this->context();
        [$from, $to] = $this->range($request, $semester, $settings->timezone);
        $teacher = $request->user()->teacher;
        $permissions = $this->classPermissions($semester, $teacher->id, $from, $to);
        $authorized = collect($permissions)->contains(
            fn (array $classIds): bool => in_array($schoolClass->id, $classIds, true),
        );
        if (! $authorized) {
            throw new ApiProblemException('TEACHER_CLASS_FORBIDDEN', '当前日期范围内无权查看该班级课表', 403);
        }

        $schoolClass->load('grade:id,name');
        $days = [];
        $cursor = $from->copy();
        while ($cursor->lessThanOrEqualTo($to)) {
            $date = $cursor->toDateString();
            $accessible = in_array($schoolClass->id, $permissions[$date] ?? [], true);
            $resolved = $this->daily->forDate($semester, $date);
            $rows = $accessible
                ? collect($resolved['rows'])
                    ->filter(fn (array $row): bool => in_array($schoolClass->id, $row['class_ids'], true))
                    ->values()
                    ->all()
                : [];
            $days[] = [
                'date' => $resolved['date'],
                'weekday' => $resolved['weekday'],
                'week_number' => $resolved['week_number'],
                'accessible' => $accessible,
                'version' => [
                    'id' => $resolved['version']->id,
                    'version_no' => $resolved['version']->version_no,
                    'name' => $resolved['version']->name,
                ],
                'rows' => $rows,
            ];
            $cursor->addDay();
        }

        return response()->json(['data' => [
            ...$this->header($teacher, $semester, $settings->timezone),
            'school_class' => [
                'id' => $schoolClass->id,
                'name' => $schoolClass->name,
                'code' => $schoolClass->code,
                'grade' => $schoolClass->grade->only(['id', 'name']),
            ],
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'days' => $days,
        ]]);
    }

    /** @return array{AppSetting, Semester} */
    private function context(): array
    {
        $settings = AppSetting::query()->with('currentSemester.academicYear')->findOrFail(1);
        $semester = $settings->currentSemester;
        if (! $semester instanceof Semester) {
            throw new ApiProblemException('CURRENT_SEMESTER_REQUIRED', '学校尚未设置当前学期', 409);
        }

        return [$settings, $semester];
    }

    /** @return array{Carbon, Carbon} */
    private function range(Request $request, Semester $semester, string $timezone): array
    {
        $data = $request->validate([
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d'],
        ]);
        $today = Carbon::now($timezone)->startOfDay();
        $defaultFrom = $today->lessThan($semester->start_date)
            ? $semester->start_date->copy()
            : ($today->greaterThan($semester->end_date) ? $semester->end_date->copy() : $today);
        $from = Carbon::parse($data['from'] ?? $defaultFrom->toDateString())->startOfDay();
        $defaultTo = $from->copy()->addDays(6)->min($semester->end_date);
        $to = Carbon::parse($data['to'] ?? $defaultTo->toDateString())->startOfDay();
        if ($from->greaterThan($to)) {
            throw new ApiProblemException('TEACHER_TIMETABLE_RANGE_INVALID', '开始日期不能晚于结束日期', 422);
        }
        if ($from->diffInDays($to) > 13) {
            throw new ApiProblemException('TEACHER_TIMETABLE_RANGE_TOO_LONG', '教师课表单次最多查询 14 天', 422);
        }
        if ($from->lessThan($semester->start_date) || $to->greaterThan($semester->end_date)) {
            throw new ApiProblemException('TEACHER_TIMETABLE_OUTSIDE_SEMESTER', '查询日期必须位于当前学期内', 422);
        }

        return [$from, $to];
    }

    /**
     * Permissions come only from the date-effective base timetable. Daily substitutions and
     * temporary teacher changes never mutate these pivots and therefore grant no class access.
     *
     * @return array<string, list<int>>
     */
    private function classPermissions(Semester $semester, int $teacherId, Carbon $from, Carbon $to): array
    {
        $classIdsByVersion = [];
        $permissions = [];
        $cursor = $from->copy();
        while ($cursor->lessThanOrEqualTo($to)) {
            $date = $cursor->toDateString();
            $version = $this->daily->versionForDate($semester, $date);
            if (! array_key_exists($version->id, $classIdsByVersion)) {
                $classIdsByVersion[$version->id] = DB::table('timetable_entry_classes as classes')
                    ->join('timetable_entries as entries', 'entries.id', '=', 'classes.timetable_entry_id')
                    ->join('timetable_entry_teachers as teachers', function ($join): void {
                        $join->on('teachers.timetable_entry_id', '=', 'entries.id')
                            ->on('teachers.timetable_version_id', '=', 'entries.timetable_version_id');
                    })
                    ->where('entries.timetable_version_id', $version->id)
                    ->where('teachers.teacher_id', $teacherId)
                    ->distinct()
                    ->orderBy('classes.school_class_id')
                    ->pluck('classes.school_class_id')
                    ->map(fn ($id): int => (int) $id)
                    ->all();
            }
            $permissions[$date] = $classIdsByVersion[$version->id];
            $cursor->addDay();
        }

        return $permissions;
    }

    /** @return array<string, mixed> */
    private function header(mixed $teacher, Semester $semester, string $timezone): array
    {
        return [
            'teacher' => $teacher->only(['id', 'name', 'employee_no']),
            'semester' => [
                'id' => $semester->id,
                'name' => $semester->name,
                'start_date' => $semester->start_date->toDateString(),
                'end_date' => $semester->end_date->toDateString(),
                'academic_year' => $semester->academicYear->only(['id', 'name']),
            ],
            'timezone' => $timezone,
        ];
    }
}
