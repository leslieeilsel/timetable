<?php

namespace App\Modules\DailyOperations\Services;

use App\Modules\DailyOperations\Models\CalendarException;
use Illuminate\Support\Facades\DB;

class TimetableChangeMessages
{
    /** @param list<array<string, mixed>> $changes */
    public function publish(CalendarException $exception, array $changes): void
    {
        $this->write($exception, $changes, 'published');
    }

    /** @param list<array<string, mixed>> $changes */
    private function write(CalendarException $exception, array $changes, string $event): void
    {
        $teacherIds = collect($changes)->flatMap(fn (array $change): array => [
            ...($change['before']['teacher_ids'] ?? []), ...($change['after']['teacher_ids'] ?? []),
        ])->unique();
        foreach ($teacherIds as $teacherId) {
            $personal = array_values(array_filter($changes, fn (array $change): bool => in_array($teacherId, $change['before']['teacher_ids'] ?? [], true)
                || in_array($teacherId, $change['after']['teacher_ids'] ?? [], true)));
            DB::table('timetable_change_messages')->insert([
                'calendar_exception_id' => $exception->id, 'teacher_id' => $teacherId,
                'event' => $event, 'changes' => json_encode($personal, JSON_THROW_ON_ERROR),
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    /** @param list<array<string, mixed>> $changes */
    public function cancel(CalendarException $exception, array $changes): void
    {
        if (DB::table('timetable_change_messages')->where('calendar_exception_id', $exception->id)->where('event', 'published')->exists()) {
            // Long-term publication may have rebound entries since the first message.
            $this->write($exception, $changes, 'cancelled');
        }
    }

    /** @return list<array<string, mixed>> */
    public function receipts(int $exceptionId): array
    {
        return DB::table('timetable_change_messages as messages')->join('teachers', 'teachers.id', '=', 'messages.teacher_id')
            ->where('calendar_exception_id', $exceptionId)->orderBy('messages.id')
            ->get(['messages.id', 'messages.teacher_id', 'teachers.name', 'messages.event', 'messages.read_at', 'messages.created_at'])
            ->map(fn (object $message): array => (array) $message)->all();
    }
}
