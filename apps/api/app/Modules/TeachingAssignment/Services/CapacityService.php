<?php

namespace App\Modules\TeachingAssignment\Services;

use App\Enums\AssignmentStatus;
use App\Enums\RoomMode;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\Room;
use App\Modules\Scheduling\Services\WeekPatternService;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Modules\Timetable\Services\RoomResolver;
use App\Support\ApiProblemException;
use Illuminate\Support\Collection;

class CapacityService
{
    private const RELATIONS = ['schoolClass', 'teachingGroup.schoolClasses', 'teacher', 'collaborators', 'course'];

    public function __construct(
        private readonly RoomResolver $rooms,
        private readonly WeekPatternService $weekPatterns,
    ) {}

    /** @param Collection<int, TeachingAssignment> $additional */
    public function assertCanConfirm(Semester $semester, Collection $additional): void
    {
        $capacity = $this->weeklyCapacity($semester);
        if ($capacity <= 0) {
            throw new ApiProblemException('NO_SCHEDULE_CAPACITY', '请先在作息表中设置可以上课的日期和课节', 409);
        }

        $confirmed = $semester->teachingAssignments()->where('status', AssignmentStatus::Confirmed->value)
            ->with(self::RELATIONS)->get();
        $assignments = $confirmed->concat($additional)->unique('id')->values();
        foreach ($assignments as $assignment) {
            if ($assignment->weekly_items > $capacity) {
                throw new ApiProblemException('ASSIGNMENT_CAPACITY_EXCEEDED',
                    "这门课每个上课周需要安排 {$assignment->weekly_items} 节，作息表每周最多可排 {$capacity} 节，请减少节数或调整作息。", 409, [
                        'assignment_id' => $assignment->id,
                        'required' => $assignment->weekly_items,
                        'capacity' => $capacity,
                    ]);
            }
        }
        foreach ($this->resourceLoads($semester, $assignments) as $resource) {
            foreach ($resource['weeks'] as $week => $required) {
                if ($required > $capacity) {
                    $excess = $required - $capacity;
                    throw new ApiProblemException('RESOURCE_CAPACITY_EXCEEDED',
                        "{$resource['name']}在第 {$week} 教学周需排 {$required} 节，最多可排 {$capacity} 节，超出 {$excess} 节。请减少节数或调整作息。", 409, [
                            'resource_type' => $resource['type'], 'resource_id' => $resource['id'],
                            'required' => $required, 'capacity' => $capacity, 'week' => $week,
                        ]);
                }
            }
        }
    }

    /** @return array<string, mixed> */
    public function preview(Semester $semester, TeachingAssignment $candidate): array
    {
        $capacity = $this->weeklyCapacity($semester);
        // Replace the saved version of this assignment instead of counting it twice.
        $confirmed = $semester->teachingAssignments()->where('status', AssignmentStatus::Confirmed->value)
            ->when($candidate->id !== null, fn ($query) => $query->whereKeyNot($candidate->id))
            ->with(self::RELATIONS)->get();
        $resources = $this->resourceLoads($semester, collect([$candidate])->concat($confirmed), $candidate);
        $affected = array_values(array_filter($resources, fn ($resource) => $resource['is_current']));
        $overloadedWeeks = [];
        foreach ($affected as $resource) {
            foreach ($resource['weeks'] as $week => $required) {
                if ($required > $capacity) {
                    $overloadedWeeks[$week] = $week;
                }
            }
        }
        sort($overloadedWeeks, SORT_NUMERIC);
        $activeWeeks = $this->activeWeeks($semester, $candidate);

        return [
            'capacity' => $capacity,
            'week_count' => $this->weekPatterns->weekCount($semester),
            'active_weeks' => $activeWeeks,
            'overloaded_weeks' => $overloadedWeeks,
            'recommended_week' => $overloadedWeeks[0] ?? $activeWeeks[0] ?? 1,
            'resources' => array_map(function (array $resource) use ($capacity): array {
                $weeks = [];
                foreach ($resource['weeks'] as $week => $required) {
                    $weeks[] = ['week' => $week, 'required' => $required, 'excess' => max(0, $required - $capacity)];
                }
                $resource['weeks'] = $weeks;
                unset($resource['is_current']);

                return $resource;
            }, $affected),
        ];
    }

    private function weeklyCapacity(Semester $semester): int
    {
        $template = $semester->scheduleTemplate()->with(['days', 'items'])->first();

        return ($template?->days->where('is_enabled', true)->count() ?? 0)
            * ($template?->items->where('is_active', true)->where('allows_course', true)->count() ?? 0);
    }

    /** @return list<int> */
    private function activeWeeks(Semester $semester, TeachingAssignment $assignment): array
    {
        $mask = $this->weekPatterns->mask($semester, $assignment->week_pattern, $assignment->active_weeks);

        return array_values(array_filter(range(1, $this->weekPatterns->weekCount($semester)),
            fn (int $week) => ($mask & (1 << ($week - 1))) !== 0));
    }

    /**
     * Both preview and save use these totals, including teaching groups and co-teachers.
     *
     * @param  Collection<int, TeachingAssignment>  $assignments
     * @return array<string, array<string, mixed>>
     */
    private function resourceLoads(Semester $semester, Collection $assignments, ?TeachingAssignment $candidate = null): array
    {
        $assignments->each->loadMissing(self::RELATIONS);
        $fixedRooms = $semester->classSettings()->pluck('fixed_room_id', 'school_class_id');
        $roomNames = Room::query()->pluck('name', 'id');
        $weekCount = $this->weekPatterns->weekCount($semester);
        $resources = [];
        foreach ($assignments as $assignment) {
            $classes = $assignment->school_class_id !== null
                ? collect([$assignment->schoolClass])
                : $assignment->teachingGroup?->schoolClasses ?? collect();
            $teachers = collect([$assignment->teacher])->concat($assignment->collaborators)->unique('id');
            $roomId = $assignment->room_mode === RoomMode::Specified
                ? $assignment->specified_room_id
                : $fixedRooms->get($assignment->school_class_id);
            $roomId ??= $this->rooms->resolve($assignment);
            $targets = [];
            foreach ($classes as $schoolClass) {
                $targets[] = ['type' => 'class', 'id' => $schoolClass->id, 'name' => $schoolClass->name];
            }
            foreach ($teachers as $teacher) {
                $targets[] = ['type' => 'teacher', 'id' => $teacher->id, 'name' => $teacher->name.'老师'];
            }
            $targets[] = ['type' => 'room', 'id' => (int) $roomId, 'name' => $roomNames->get($roomId, '教室')];
            $weeks = $this->activeWeeks($semester, $assignment);
            foreach ($targets as $target) {
                $key = $target['type'].':'.$target['id'];
                $resources[$key] ??= [
                    ...$target,
                    'key' => $key,
                    'is_current' => false,
                    'weeks' => array_fill(1, $weekCount, 0),
                    'courses' => [],
                ];
                $resources[$key]['is_current'] = $resources[$key]['is_current'] || $assignment === $candidate;
                foreach ($weeks as $week) {
                    $resources[$key]['weeks'][$week] += $assignment->weekly_items;
                }
                $resources[$key]['courses'][] = [
                    'assignment_id' => $assignment->id,
                    'course_name' => $assignment->course->name,
                    'target_name' => $assignment->schoolClass?->name ?? $assignment->teachingGroup?->name,
                    'weekly_items' => $assignment->weekly_items,
                    'active_weeks' => $weeks,
                    'is_current' => $assignment === $candidate,
                ];
            }
        }

        return $resources;
    }
}
