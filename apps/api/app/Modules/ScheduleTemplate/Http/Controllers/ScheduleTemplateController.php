<?php

namespace App\Modules\ScheduleTemplate\Http\Controllers;

use App\Enums\ItemType;
use App\Enums\LifecycleStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\ScheduleTemplate\Models\Item;
use App\Modules\ScheduleTemplate\Models\ScheduleTemplate;
use App\Modules\ScheduleTemplate\Models\ScheduleTemplateDay;
use App\Modules\ScheduleTemplate\Services\ScheduleValidator;
use App\Modules\TeachingAssignment\Services\CapacityService;
use App\Modules\Timetable\Models\TimetableEntry;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\Normalizer;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ScheduleTemplateController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly ScheduleValidator $validator,
        private readonly CapacityService $capacity,
    ) {}

    public function show(Semester $semester): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $template = $semester->scheduleTemplate()->with(['days', 'items'])->first();

        return response()->json(['data' => $template, 'meta' => $this->meta($semester, $settings)])
            ->header('ETag', $this->etags->semester($semester, $settings));
    }

    public function put(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'days' => ['required', 'array', 'size:7'],
            'days.*.weekday' => ['required', 'integer', 'distinct', 'between:1,7'],
            'days.*.is_enabled' => ['required', 'boolean'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.id' => ['nullable', 'integer'],
            'items.*.name' => ['required', 'string', 'max:100'],
            'items.*.type' => ['required', Rule::enum(ItemType::class)],
            'items.*.start_time' => ['required', 'date_format:H:i'],
            'items.*.end_time' => ['required', 'date_format:H:i'],
            'items.*.sort_order' => ['required', 'integer', 'min:0', 'distinct'],
            'items.*.allows_teacher' => ['sometimes', 'boolean'],
            'items.*.show_in_official' => ['sometimes', 'boolean'],
            'items.*.is_active' => ['required', 'boolean'],
        ]);
        $normalizedItems = $this->normalizeItems($data['items']);
        $this->validator->assertNoOverlap($normalizedItems);
        $items = collect($normalizedItems);

        return DB::transaction(function () use ($request, $semester, $data, $items): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            $template = ScheduleTemplate::query()->where('semester_id', $lockedSemester->id)->with(['days', 'items'])->lockForUpdate()->first();
            $before = $template?->toArray();
            if ($template === null) {
                $template = ScheduleTemplate::query()->create([
                    'semester_id' => $lockedSemester->id,
                    'name' => Normalizer::text($data['name']),
                ]);
            } else {
                $template->update(['name' => Normalizer::text($data['name'])]);
            }

            foreach ($data['days'] as $day) {
                $existingDay = ScheduleTemplateDay::query()->where('semester_id', $lockedSemester->id)->where('weekday', $day['weekday'])->first();
                if ($existingDay !== null && $existingDay->is_enabled && ! $day['is_enabled'] && TimetableEntry::query()->where('semester_id', $lockedSemester->id)->where('weekday', $day['weekday'])->exists()) {
                    throw new ApiProblemException('SCHEDULE_DAY_IN_USE', '已有课程的星期不能停用', 409, ['weekday' => $day['weekday']]);
                }
                ScheduleTemplateDay::query()->updateOrCreate(
                    ['semester_id' => $lockedSemester->id, 'weekday' => $day['weekday']],
                    ['schedule_template_id' => $template->id, 'is_enabled' => $day['is_enabled']],
                );
            }

            $submittedIds = $items->pluck('id')->filter()->map(fn ($id) => (int) $id);
            foreach ($template->items as $existing) {
                if (! $submittedIds->contains($existing->id)) {
                    if ($existing->timetableEntries()->exists()) {
                        throw new ApiProblemException('ITEM_IN_USE', '已被课程使用的课节不能删除', 409, ['item_id' => $existing->id]);
                    }
                    $existing->delete();
                } else {
                    $existing->forceFill([
                        'sort_order' => 100000 + $existing->id,
                        'name' => '__temporary_'.$existing->id,
                    ])->save();
                }
            }

            foreach ($items as $itemData) {
                $item = isset($itemData['id']) ? Item::query()->where('semester_id', $lockedSemester->id)->findOrFail($itemData['id']) : new Item;
                if ($item->exists && $item->timetableEntries()->exists() && (! $itemData['is_active'] || ! $itemData['allows_course'] || ! $itemData['show_in_official'])) {
                    throw new ApiProblemException('ITEM_IN_USE', '已被课程使用的课节不能停用、隐藏或改成不可排课', 409, ['item_id' => $item->id]);
                }
                $item->fill(array_merge($itemData, [
                    'schedule_template_id' => $template->id,
                    'semester_id' => $lockedSemester->id,
                ]));
                $item->save();
            }

            $template->load(['days', 'items']);
            if ($lockedSemester->status === LifecycleStatus::Open && (! $template->days->contains('is_enabled', true) || ! $template->items->contains(fn ($item) => $item->is_active && $item->allows_course))) {
                throw new ApiProblemException('SCHEDULE_TEMPLATE_INCOMPLETE', '开放学期必须至少启用一天和一个课程课节', 409);
            }
            if ($lockedSemester->status === LifecycleStatus::Open) {
                $this->capacity->assertCanConfirm($lockedSemester, collect());
            }
            if ($before !== $template->toArray()) {
                $this->bumpInputRevision($lockedSemester);
                $this->audit->record($request, $actor, 'put', 'schedule_template', $template->id, $before, $template->toArray());
            }

            return response()->json(['data' => $template, 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function destroy(Request $request, Semester $semester): JsonResponse
    {
        return DB::transaction(function () use ($request, $semester): JsonResponse {
            [$actor, $settings, $lockedSemester] = $this->guard->semester($request, $semester);
            if ($lockedSemester->status !== LifecycleStatus::Draft) {
                throw new ApiProblemException('SCHEDULE_TEMPLATE_DELETE_FORBIDDEN', '只有草稿学期可以删除作息模板', 409);
            }
            if ($lockedSemester->timetableEntries()->exists()) {
                throw new ApiProblemException('SCHEDULE_TEMPLATE_IN_USE', '作息模板已被课表使用', 409);
            }
            $template = $lockedSemester->scheduleTemplate()->with(['days', 'items'])->firstOrFail();
            $before = $template->toArray();
            $template->delete();
            $this->bumpInputRevision($lockedSemester);
            $this->audit->record($request, $actor, 'delete', 'schedule_template', $template->id, $before, null);

            return response()->json(['data' => ['deleted' => true], 'meta' => $this->meta($lockedSemester, $settings)])
                ->header('ETag', $this->etags->semester($lockedSemester, $settings));
        }, 3);
    }

    public function copy(Request $request, Semester $semester): JsonResponse
    {
        $data = $request->validate(['source_semester_id' => ['required', 'integer', 'exists:semesters,id']]);

        return DB::transaction(function () use ($request, $semester, $data): JsonResponse {
            [$actor, $settings, $target] = $this->guard->semester($request, $semester);
            if ($target->scheduleTemplate()->exists()) {
                throw new ApiProblemException('COPY_TARGET_CONFLICT', '目标学期已有作息模板', 409);
            }
            $source = Semester::query()->with('scheduleTemplate.days', 'scheduleTemplate.items')->lockForUpdate()->findOrFail($data['source_semester_id']);
            if ($source->academic_year_id !== $target->academic_year_id || $source->sequence >= $target->sequence || $source->scheduleTemplate === null) {
                throw new ApiProblemException('COPY_SOURCE_INVALID', '只能从同一学年较早学期复制完整作息', 422);
            }
            $template = ScheduleTemplate::query()->create(['semester_id' => $target->id, 'name' => $source->scheduleTemplate->name]);
            foreach ($source->scheduleTemplate->days as $day) {
                ScheduleTemplateDay::query()->create([
                    'schedule_template_id' => $template->id, 'semester_id' => $target->id,
                    'weekday' => $day->weekday, 'is_enabled' => $day->is_enabled,
                ]);
            }
            foreach ($source->scheduleTemplate->items as $item) {
                Item::query()->create(array_merge($item->only([
                    'name', 'type', 'start_time', 'end_time', 'sort_order', 'allows_course', 'allows_teacher',
                    'counts_as_course', 'show_in_official', 'show_in_full', 'is_active',
                ]), ['schedule_template_id' => $template->id, 'semester_id' => $target->id]));
            }
            $this->bumpInputRevision($target);
            $template->load(['days', 'items']);
            $this->audit->record($request, $actor, 'copy', 'schedule_template', $template->id, null, ['source_semester_id' => $source->id]);

            return response()->json(['data' => $template, 'meta' => $this->meta($target, $settings)], 201)
                ->header('ETag', $this->etags->semester($target, $settings));
        }, 3);
    }

    /**
     * @return list<array{
     *     allows_course: bool,
     *     counts_as_course: bool,
     *     allows_teacher: bool,
     *     show_in_official: bool,
     *     show_in_full: bool,
     *     id: int|null,
     *     name: string,
     *     type: string,
     *     start_time: string,
     *     end_time: string,
     *     sort_order: int,
     *     is_active: bool
     * }>
     */
    private function normalizeItems(mixed $value): array
    {
        if (! is_array($value)) {
            throw new \LogicException('Validated items must be an array.');
        }

        return array_map(function (mixed $value): array {
            if (! is_array($value)) {
                throw new \LogicException('Each validated item must be an array.');
            }
            $item = $value;
            $type = ItemType::from($item['type']);
            $defaults = $type->defaults();
            if ($type === ItemType::SelfStudy) {
                $defaults['allows_teacher'] = (bool) ($item['allows_teacher'] ?? true);
                $defaults['show_in_official'] = (bool) ($item['show_in_official'] ?? false);
            } elseif ($type === ItemType::FixedNonCourse) {
                $defaults['show_in_official'] = (bool) ($item['show_in_official'] ?? false);
            }

            return array_merge($defaults, [
                'id' => isset($item['id']) ? (int) $item['id'] : null,
                'name' => Normalizer::text($item['name']),
                'type' => $type->value,
                'start_time' => $item['start_time'].':00',
                'end_time' => $item['end_time'].':00',
                'sort_order' => (int) $item['sort_order'],
                'is_active' => (bool) $item['is_active'],
            ]);
        }, array_values($value));
    }

    private function bumpInputRevision(Semester $semester): void
    {
        $semester->increment('input_revision');
        $semester->increment('timetable_revision');
        $semester->refresh();
    }

    /** @return array<string, int|string> */
    private function meta(Semester $semester, AppSetting $settings): array
    {
        return [
            'semester_id' => $semester->id,
            'timetable_revision' => (string) $semester->getRawOriginal('timetable_revision'),
            'input_revision' => (string) $semester->getRawOriginal('input_revision'),
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
