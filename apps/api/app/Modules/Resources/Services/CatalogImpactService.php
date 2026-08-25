<?php

namespace App\Modules\Resources\Services;

use App\Enums\LifecycleStatus;
use App\Enums\RoomMode;
use App\Enums\TaskStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\SemesterClassSetting\Models\SemesterClassSetting;
use App\Modules\TeachingTask\Models\TeachingTask;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Support\ApiProblemException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

class CatalogImpactService
{
    public function assertCanDeactivate(Request $request, string $type, int $id, AppSetting $settings): void
    {
        $impacts = $this->impacts($type, $id);
        if ($impacts === []) {
            return;
        }

        $hash = $request->input('impact_hash');
        $confirmed = $request->boolean('confirm_open_impact')
            && is_string($hash)
            && $this->validHash($hash, $type, $id, $settings, $impacts);
        if (! $confirmed) {
            throw new ApiProblemException('ACTIVE_RESOURCE_IN_USE', '该资料正在开放学期中使用，确认影响后才能停用', 409, [
                'resource_type' => $type,
                'resource_id' => $id,
                'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
                'impacts' => $impacts,
                'impact_hash' => $this->makeHash($type, $id, $settings, $impacts),
            ]);
        }
    }

    /** @return list<array<string, int|string>> */
    private function impacts(string $type, int $id): array
    {
        $semesters = Semester::query()->where('status', LifecycleStatus::Open->value)
            ->orderBy('id')->get(['id', 'name', 'academic_year_id', 'timetable_revision']);
        $result = [];
        foreach ($semesters as $semester) {
            $classIds = $this->classIds($type, $id, $semester->academic_year_id);
            $settingIds = $this->settingIds($type, $id, $semester->id, $classIds);
            $taskIds = $this->taskIds($type, $id, $semester->id, $classIds, $settingIds);
            $entryCount = $this->entryCount($type, $id, $semester->id, $classIds, $taskIds);
            $tasks = TeachingTask::query()->whereIn('id', $taskIds)
                ->where('status', TaskStatus::Confirmed->value)->withCount('entries')->get();
            $unplaced = (int) $tasks->sum(fn (TeachingTask $task): int => max(0, $task->weekly_items - $task->entries_count));
            if ($classIds->isEmpty() && $settingIds->isEmpty() && $taskIds->isEmpty() && $entryCount === 0) {
                continue;
            }
            $result[] = [
                'semester_id' => $semester->id,
                'semester_name' => $semester->name,
                'timetable_revision' => (string) $semester->getRawOriginal('timetable_revision'),
                'classes' => $classIds->count(),
                'class_settings' => $settingIds->count(),
                'confirmed_tasks' => $tasks->count(),
                'unplaced_items' => $unplaced,
                'timetable_entries' => $entryCount,
            ];
        }

        return $result;
    }

    /** @return Collection<int, int> */
    private function classIds(string $type, int $id, int $academicYearId): Collection
    {
        $query = SchoolClass::query()->where('academic_year_id', $academicYearId);
        if ($type === 'grade') {
            return $query->where('grade_id', $id)->pluck('id');
        }
        if ($type === 'school_class') {
            return $query->whereKey($id)->pluck('id');
        }

        return collect();
    }

    /** @param Collection<int, int> $classIds
     * @return Collection<int, int>
     */
    private function settingIds(string $type, int $id, int $semesterId, Collection $classIds): Collection
    {
        $query = SemesterClassSetting::query()->where('semester_id', $semesterId);
        if ($classIds->isNotEmpty()) {
            $query->whereIn('school_class_id', $classIds);
        } elseif ($type === 'teacher') {
            $query->where('homeroom_teacher_id', $id);
        } elseif ($type === 'room') {
            $query->where('fixed_room_id', $id);
        } else {
            return collect();
        }

        return $query->pluck('id');
    }

    /** @param Collection<int, int> $classIds
     * @param  Collection<int, int>  $settingIds
     * @return Collection<int, int>
     */
    private function taskIds(string $type, int $id, int $semesterId, Collection $classIds, Collection $settingIds): Collection
    {
        $query = TeachingTask::query()->where('semester_id', $semesterId);
        if ($classIds->isNotEmpty()) {
            $query->whereIn('school_class_id', $classIds);
        } elseif ($type === 'teacher') {
            $query->where('teacher_id', $id);
        } elseif ($type === 'course') {
            $query->where('course_id', $id);
        } elseif ($type === 'room') {
            $classSettingIds = $settingIds;
            $query->where(function ($inner) use ($id, $classSettingIds): void {
                $inner->where(function ($specified) use ($id): void {
                    $specified->where('room_mode', RoomMode::Specified->value)
                        ->where('specified_room_id', $id);
                });
                if ($classSettingIds->isNotEmpty()) {
                    $classIdsForRoom = SemesterClassSetting::query()->whereIn('id', $classSettingIds)->pluck('school_class_id');
                    $inner->orWhere(function ($defaults) use ($classIdsForRoom): void {
                        $defaults->where('room_mode', RoomMode::ClassDefault->value)
                            ->whereIn('school_class_id', $classIdsForRoom);
                    });
                }
            });
        } else {
            return collect();
        }

        return $query->pluck('id');
    }

    /** @param Collection<int, int> $classIds
     * @param  Collection<int, int>  $taskIds
     */
    private function entryCount(string $type, int $id, int $semesterId, Collection $classIds, Collection $taskIds): int
    {
        $query = TimetableEntry::query()->where('semester_id', $semesterId);
        if ($classIds->isNotEmpty()) {
            $query->whereIn('school_class_id', $classIds);
        } elseif ($type === 'teacher') {
            $query->where('teacher_id', $id);
        } elseif ($type === 'course') {
            $query->where('course_id', $id);
        } elseif ($type === 'room') {
            $query->where(function ($inner) use ($id, $taskIds): void {
                $inner->where('actual_room_id', $id);
                if ($taskIds->isNotEmpty()) {
                    $inner->orWhereIn('teaching_task_id', $taskIds);
                }
            });
        } else {
            return 0;
        }

        return $query->count();
    }

    /** @param list<array<string, int|string>> $impacts */
    private function makeHash(string $type, int $id, AppSetting $settings, array $impacts): string
    {
        $payload = [
            'resource_type' => $type,
            'resource_id' => $id,
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
            'impacts_hash' => $this->impactsHash($impacts),
            'expires_at' => now()->addMinutes(5)->getTimestamp(),
        ];
        $encoded = $this->base64UrlEncode(json_encode($payload, JSON_THROW_ON_ERROR));

        return $encoded.'.'.hash_hmac('sha256', $encoded, (string) config('app.key'));
    }

    /** @param list<array<string, int|string>> $impacts */
    private function validHash(string $hash, string $type, int $id, AppSetting $settings, array $impacts): bool
    {
        $parts = explode('.', $hash, 2);
        if (count($parts) !== 2 || ! hash_equals(hash_hmac('sha256', $parts[0], (string) config('app.key')), $parts[1])) {
            return false;
        }
        $decoded = $this->base64UrlDecode($parts[0]);
        if ($decoded === null) {
            return false;
        }
        try {
            $payload = json_decode($decoded, true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return false;
        }

        return is_array($payload)
            && ($payload['resource_type'] ?? null) === $type
            && ($payload['resource_id'] ?? null) === $id
            && ($payload['catalog_revision'] ?? null) === (string) $settings->getRawOriginal('catalog_revision')
            && ($payload['impacts_hash'] ?? null) === $this->impactsHash($impacts)
            && is_int($payload['expires_at'] ?? null)
            && $payload['expires_at'] >= now()->getTimestamp();
    }

    /** @param list<array<string, int|string>> $impacts */
    private function impactsHash(array $impacts): string
    {
        return hash('sha256', json_encode($impacts, JSON_THROW_ON_ERROR));
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $value): ?string
    {
        $padding = (4 - strlen($value) % 4) % 4;
        $decoded = base64_decode(strtr($value.str_repeat('=', $padding), '-_', '+/'), true);

        return $decoded === false ? null : $decoded;
    }
}
