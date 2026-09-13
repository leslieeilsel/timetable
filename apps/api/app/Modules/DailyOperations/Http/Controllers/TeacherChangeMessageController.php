<?php

namespace App\Modules\DailyOperations\Http\Controllers;

use App\Modules\AcademicCalendar\Models\AppSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TeacherChangeMessageController
{
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);
        $teacherId = $request->user()->teacher->id;
        $query = DB::table('timetable_change_messages as messages')
            ->leftJoin('calendar_exceptions as exceptions', 'exceptions.id', '=', 'messages.calendar_exception_id')
            ->leftJoin('long_term_changes as long_changes', 'long_changes.id', '=', 'messages.long_term_change_id')
            ->where('messages.teacher_id', $teacherId)
            ->whereRaw('COALESCE(exceptions.semester_id, long_changes.semester_id) = ?', [AppSetting::query()->findOrFail(1)->current_semester_id]);
        $unread = (clone $query)->whereNull('messages.read_at')->count();
        $page = $query->orderByDesc('messages.id')->paginate(20, [
            'messages.*', DB::raw('COALESCE(exceptions.reason, long_changes.reason) as reason'),
            DB::raw("COALESCE(exceptions.type, 'long_term') as type"),
            DB::raw("COALESCE(exceptions.status, CASE WHEN long_changes.restored_from IS NULL THEN 'active' ELSE 'cancelled' END) as exception_status"),
            'long_changes.effective_from', 'long_changes.effective_to', 'long_changes.restored_from',
        ], 'page', (int) ($data['page'] ?? 1));

        return response()->json(['data' => [
            'unread' => $unread, 'page' => $page->currentPage(), 'last_page' => $page->lastPage(),
            'messages' => collect($page->items())->map(fn (object $message): array => [
                ...(array) $message, 'changes' => json_decode($message->changes, true, 512, JSON_THROW_ON_ERROR),
            ])->all(),
        ]]);
    }

    public function read(Request $request, int $message): JsonResponse
    {
        $query = DB::table('timetable_change_messages')->where('id', $message)->where('teacher_id', $request->user()->teacher->id);
        abort_unless((clone $query)->exists(), 404);
        (clone $query)->whereNull('read_at')->update(['read_at' => now(), 'updated_at' => now()]);

        return response()->json(['data' => ['id' => $message, 'read_at' => $query->value('read_at')]]);
    }
}
