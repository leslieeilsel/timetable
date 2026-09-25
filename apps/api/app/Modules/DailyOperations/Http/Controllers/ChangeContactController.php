<?php

namespace App\Modules\DailyOperations\Http\Controllers;

use App\Modules\Audit\Services\AuditLogger;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ChangeContactController
{
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'calendar_exception_id' => ['required_without:long_term_change_id', 'prohibits:long_term_change_id', 'integer', 'exists:calendar_exceptions,id'],
            'long_term_change_id' => ['required_without:calendar_exception_id', 'prohibits:calendar_exception_id', 'integer', 'exists:long_term_changes,id'],
        ]);
        $field = isset($data['calendar_exception_id']) ? 'calendar_exception_id' : 'long_term_change_id';
        $rows = DB::table('timetable_change_messages as m')
            ->join('teachers as t', 't.id', '=', 'm.teacher_id')
            ->leftJoin('users as u', 'u.id', '=', 'm.contacted_by')
            ->where('m.'.$field, $data[$field])->orderByDesc('m.id')
            ->get(['m.id', 'm.teacher_id', 't.name', 'm.event', 'm.read_at', 'm.created_at', 'm.contacted_at', 'm.contact_note', 'u.name as contacted_by_name']);

        return response()->json(['data' => $rows]);
    }

    public function contact(Request $request, int $message): JsonResponse
    {
        $actor = app(WriteGuard::class)->actor($request);
        $data = $request->validate(['note' => ['required', 'string', 'min:2', 'max:500']]);

        return DB::transaction(function () use ($request, $message, $actor, $data): JsonResponse {
            $row = DB::table('timetable_change_messages')->where('id', $message)->lockForUpdate()->first();
            abort_unless($row !== null, 404);
            if ($row->contacted_at === null) {
                $fields = ['contacted_at' => now(), 'contacted_by' => $actor->id, 'contact_note' => $data['note']];
                DB::table('timetable_change_messages')->where('id', $message)->update($fields);
                app(AuditLogger::class)->record($request, $actor, 'manual_contact', 'timetable_change_message', $message, null, $fields);
            }

            return response()->json(['data' => DB::table('timetable_change_messages')->where('id', $message)->first(['id', 'contacted_at', 'contact_note', 'read_at'])]);
        }, 3);
    }
}
