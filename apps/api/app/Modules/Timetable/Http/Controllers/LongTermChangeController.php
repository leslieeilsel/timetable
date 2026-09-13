<?php

namespace App\Modules\Timetable\Http\Controllers;

use App\Models\User;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Timetable\Models\LongTermChange;
use App\Modules\Timetable\Services\LongTermChangeService;
use App\Modules\Timetable\Services\TimetableEffectivePeriodService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class LongTermChangeController
{
    public function __construct(
        private readonly LongTermChangeService $changes,
        private readonly TimetableEffectivePeriodService $periods,
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
    ) {}

    public function index(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:100'], 'page' => ['sometimes', 'integer', 'min:1'],
            'status' => ['sometimes', Rule::in(['all', 'upcoming', 'active', 'ended', 'restored'])],
            'date_from' => ['nullable', 'date_format:Y-m-d'], 'date_to' => ['nullable', 'date_format:Y-m-d'],
        ]);
        $query = LongTermChange::query()->where('semester_id', $semester->id)->with('creator:id,name');
        if (($data['q'] ?? '') !== '') {
            $q = '%'.$data['q'].'%';
            $query->where('search_text', 'like', $q);
        }
        $today = today()->toDateString();
        $status = $data['status'] ?? 'all';
        if ($status === 'restored') {
            $query->whereNotNull('restored_from');
        } elseif ($status !== 'all') {
            $query->whereNull('restored_from');
            match ($status) {
                'upcoming' => $query->whereDate('effective_from', '>', $today),
                'active' => $query->whereDate('effective_from', '<=', $today)->whereDate('effective_to', '>=', $today),
                'ended' => $query->whereDate('effective_to', '<', $today),
                default => $query,
            };
        }
        if (! empty($data['date_from'])) {
            $query->whereDate('effective_to', '>=', $data['date_from']);
        }
        if (! empty($data['date_to'])) {
            $query->whereDate('effective_from', '<=', $data['date_to']);
        }
        $page = $query->orderByDesc('id')->paginate(20);

        $receipts = DB::table('timetable_change_messages as messages')
            ->join('teachers', 'teachers.id', '=', 'messages.teacher_id')
            ->whereIn('messages.long_term_change_id', collect($page->items())->pluck('id'))
            ->orderBy('messages.id')
            ->get(['messages.long_term_change_id', 'messages.id', 'messages.teacher_id', 'teachers.name', 'messages.event', 'messages.read_at', 'messages.created_at'])
            ->groupBy('long_term_change_id');
        $records = collect($page->items())->map(fn (LongTermChange $record): array => [
            ...$record->toArray(), 'messages' => $receipts->get($record->id, collect())->map(function ($receipt): array {
                $fields = (array) $receipt;
                unset($fields['long_term_change_id']);

                return $fields;
            })->all(),
        ])->all();

        return response()->json(['data' => $records, 'meta' => ['today' => $today, 'pagination' => [
            'page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total(),
        ]]])->header('ETag', $this->etags->semester($semester, AppSetting::query()->findOrFail(1)));
    }

    public function source(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate(['date' => ['required', 'date_format:Y-m-d']]);
        if ($data['date'] < $semester->start_date->toDateString() || $data['date'] > $semester->end_date->toDateString()) {
            throw new ApiProblemException('LONG_TERM_DATE_INVALID', '请选择本学期内的日期', 422);
        }
        $version = $this->periods->versionForDate($semester, $data['date']);
        if ($version === null) {
            throw new ApiProblemException('LONG_TERM_NO_TIMETABLE', '请先发布一份正式课表，再进行长期调整', 409);
        }
        $template = $semester->scheduleTemplate()->with(['days', 'items'])->firstOrFail();

        return response()->json(['data' => [
            'version_id' => $version->id, 'date' => $data['date'], 'today' => today()->toDateString(),
            'days' => $template->days->where('is_enabled', true)->values(),
            'items' => $template->items->where('is_active', true)->where('allows_course', true)->where('counts_as_course', true)->sortBy('sort_order')->values(),
            'entries' => $version->entries()->with(LongTermChangeService::RELATIONS)->orderBy('weekday')->orderBy('item_id')->get(),
        ]])->header('ETag', $this->etags->semester($semester, AppSetting::query()->findOrFail(1)));
    }

    public function preview(Request $request, Semester $semester): JsonResponse
    {
        return $this->publish($request, $semester, true);
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        return $this->publish($request, $semester, false);
    }

    private function publish(Request $request, Semester $semester, bool $preview): JsonResponse
    {
        $data = $request->validate([
            'source_version_id' => ['required', 'integer'], 'effective_from' => ['required', 'date_format:Y-m-d'],
            'effective_to' => ['required', 'date_format:Y-m-d', 'after_or_equal:effective_from'],
            'reason' => ['required', 'string', 'min:2', 'max:500'], 'notify_teachers' => ['sometimes', 'boolean'],
            'changes' => ['required', 'array', 'min:1', 'max:500'],
            'changes.*.entry_id' => ['required', 'integer', 'distinct'],
            'changes.*.weekday' => ['sometimes', 'integer', 'between:1,7'],
            'changes.*.item_id' => ['sometimes', 'integer', 'exists:items,id'],
            'changes.*.teacher_id' => ['sometimes', 'integer', 'exists:teachers,id'],
            'changes.*.actual_room_id' => ['sometimes', 'integer', 'exists:rooms,id'],
        ]);

        return $this->transaction($request, $semester, $preview, function ($locked, $actor) use ($data, $request, $preview): array {
            $result = $this->changes->publish($locked, $actor, $data);
            if (! $preview) {
                $this->audit->record($request, $actor, 'publish', 'long_term_change', $result['record']->id, null, $result['record']->toArray());
            }
            unset($result['segments']);

            return $result;
        });
    }

    public function restorePreview(Request $request, Semester $semester, LongTermChange $change): JsonResponse
    {
        return $this->restoreChange($request, $semester, $change, true);
    }

    public function restore(Request $request, Semester $semester, LongTermChange $change): JsonResponse
    {
        return $this->restoreChange($request, $semester, $change, false);
    }

    private function restoreChange(Request $request, Semester $semester, LongTermChange $change, bool $preview): JsonResponse
    {
        abort_unless($change->semester_id === $semester->id, 404);
        $data = $request->validate(['effective_from' => ['required', 'date_format:Y-m-d']]);

        return $this->transaction($request, $semester, $preview, function ($locked, $actor) use ($change, $data, $request, $preview): array {
            $record = LongTermChange::query()->lockForUpdate()->findOrFail($change->id);
            $result = $this->changes->restore($locked, $actor, $record, $data['effective_from']);
            if (! $preview) {
                $this->audit->record($request, $actor, 'restore', 'long_term_change', $record->id, null, $record->toArray());
            }

            return $result;
        });
    }

    /** @param callable(Semester, User): array<string, mixed> $operation */
    private function transaction(Request $request, Semester $semester, bool $preview, callable $operation): JsonResponse
    {
        DB::beginTransaction();
        try {
            [$actor, $settings, $locked] = $this->guard->semester($request, $semester, false, true);
            $originalEtag = $this->etags->semester($locked, $settings);
            $result = $operation($locked, $actor);
            $etag = $preview ? $originalEtag : $this->etags->semester($locked->fresh(), $settings);
            if ($preview) {
                DB::rollBack();
            } else {
                DB::commit();
            }

            return response()->json(['data' => ['allowed' => true, ...$result]], $preview ? 200 : 201)->header('ETag', $etag);
        } catch (\Throwable $error) {
            DB::rollBack();
            throw $error;
        }
    }
}
