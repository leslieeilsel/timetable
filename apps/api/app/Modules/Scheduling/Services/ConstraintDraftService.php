<?php

namespace App\Modules\Scheduling\Services;

use App\Enums\ConstraintCategory;
use App\Enums\ConstraintKind;
use App\Enums\ConstraintStatus;
use App\Enums\ConstraintTargetType;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Resources\Models\Course;
use App\Modules\Resources\Models\Teacher;
use App\Modules\ScheduleTemplate\Models\Item;
use App\Modules\Scheduling\Models\SchedulingConstraint;
use App\Support\ApiProblemException;
use App\Support\Normalizer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ConstraintDraftService
{
    public const FIELDS = ['name', 'kind', 'category', 'target_type', 'target_id', 'scope', 'condition', 'requirement', 'weight', 'explanation'];

    public function __construct(private readonly ConstraintPayloadValidator $payloads, private readonly AuditLogger $audit) {}

    /** @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function validate(array $input, bool $partial = false, bool $strict = false): array
    {
        if ($strict && array_diff(array_keys($input), self::FIELDS) !== []) {
            throw ValidationException::withMessages(['constraints' => ['规则包含未支持的字段。']]);
        }
        $presence = $partial ? 'sometimes' : 'required';
        $data = Validator::make($input, [
            'name' => [$presence, 'string', 'max:120'],
            'kind' => [$presence, Rule::enum(ConstraintKind::class)],
            'category' => [$presence, Rule::enum(ConstraintCategory::class)],
            'target_type' => [$partial ? 'sometimes' : 'nullable', 'nullable', Rule::enum(ConstraintTargetType::class)],
            'target_id' => [$partial ? 'sometimes' : 'nullable', 'nullable', 'integer'],
            'scope' => [$partial ? 'sometimes' : 'present', 'array'],
            'condition' => ['sometimes', 'nullable', 'array'],
            'requirement' => [$presence, 'array', 'min:1'],
            'weight' => ['sometimes', 'nullable', 'integer', 'between:1,100'],
            'explanation' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ])->validate();
        if (isset($data['name'])) {
            $data['name'] = Normalizer::text($data['name']);
        }

        return $data;
    }

    /** @return list<array<string, mixed>> */
    public function validateBatch(Request $request, Semester $semester): array
    {
        if (array_diff(array_keys($request->all()), ['constraints']) !== []) {
            throw ValidationException::withMessages(['constraints' => ['请求包含未支持的字段。']]);
        }
        $input = $request->validate([
            'constraints' => ['required', 'array', 'list', 'min:1', 'max:10'],
            'constraints.*' => ['required', 'array'],
        ]);
        $result = [];
        foreach ($input['constraints'] as $row) {
            $data = $this->validate($row, strict: true);
            $this->payloads->assertValid($semester, $data);
            $template = collect($this->payloads->draftCapabilities())->first(fn (array $template): bool => $template['kind'] === $data['kind'] && $template['category'] === $data['category']
                && $template['target_type'] === ($data['target_type'] ?? null));
            if ($template === null || ($data['condition'] ?? []) !== []
                || array_diff(array_keys($data['scope']), $template['scope_keys']) !== []) {
                throw new ApiProblemException('DRAFT_TEMPLATE_UNSUPPORTED', '批量草稿仅支持能力接口列出的规则模板与范围', 422);
            }
            // A preview must name concrete slots. The existing editor can also prepare
            // rules using future sort orders before a schedule template is configured.
            Validator::make($data, [
                'scope.weekdays.*' => ['integer', 'between:1,7'],
                'scope.item_ids.*' => [Rule::exists('items', 'id')->where('semester_id', $semester->id)
                    ->where('is_active', true)->where('allows_course', true)->where('counts_as_course', true)],
            ])->validate();
            $result[] = [
                'name' => $data['name'], 'kind' => $data['kind'], 'category' => $data['category'],
                'target_type' => $data['target_type'] ?? null, 'target_id' => $data['target_id'] ?? null,
                'scope' => $data['scope'], 'condition' => $data['condition'] ?? [],
                'requirement' => $data['requirement'], 'weight' => $data['weight'] ?? null,
                'explanation' => $data['explanation'] ?? null,
            ];
        }

        return $result;
    }

    /** @param list<array<string, mixed>> $rows
     * @return list<SchedulingConstraint>
     */
    public function create(Request $request, User $actor, Semester $semester, array $rows): array
    {
        $created = [];
        foreach ($rows as $data) {
            $this->payloads->assertValid($semester, $data);
            $constraint = SchedulingConstraint::query()->create([
                ...$data, 'name' => Normalizer::text($data['name']),
                'semester_id' => $semester->id, 'source' => 'user', 'status' => ConstraintStatus::Draft,
            ]);
            $this->audit->record($request, $actor, 'create', 'scheduling_constraint', $constraint->id, null, $constraint->toArray());
            $created[] = $constraint;
        }
        $semester->increment('constraint_revision');
        $semester->increment('input_revision');
        $semester->increment('timetable_revision');
        $semester->refresh();

        return $created;
    }

    /** @param array<string, mixed> $data */
    public function summary(Semester $semester, array $data): string
    {
        $target = match ($data['target_type']) {
            'teacher' => Teacher::query()->find($data['target_id'])?->name,
            'course' => Course::query()->find($data['target_id'])?->name,
            default => null,
        } ?? '所选对象';
        $days = array_map(fn (int $day): string => ['一', '二', '三', '四', '五', '六', '日'][$day - 1], $data['scope']['weekdays'] ?? []);
        $items = Item::query()->where('semester_id', $semester->id)
            ->whereIn('id', $data['scope']['item_ids'] ?? [])->orderBy('sort_order')->get()
            ->map(fn (Item $item): string => $item->name.'（'.substr($item->start_time, 0, 5).'–'.substr($item->end_time, 0, 5).'）')->all();
        $scope = ($days === [] ? '每个上课日' : '每周'.implode('、周', $days))
            .($items === [] ? '' : '，'.implode('、', $items));
        $requirement = match ($data['category']) {
            'forbidden_slot', 'availability' => '不安排课程',
            'preferred_slot' => ($data['requirement']['preference'] ?? '') === 'avoid' ? '尽量避免安排' : '优先安排',
            'daily_load' => '每天最多 '.$data['requirement']['max_items_per_day'].' 节课',
            default => $data['name'],
        };

        return $target.' · '.$scope.' · '.$requirement.' · '.($data['kind'] === 'hard' ? '必须满足' : '尽量满足（权重 '.$data['weight'].'）');
    }
}
