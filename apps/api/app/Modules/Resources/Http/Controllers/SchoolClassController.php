<?php

namespace App\Modules\Resources\Http\Controllers;

use App\Enums\ResourceStatus;
use App\Enums\Role;
use App\Modules\AcademicCalendar\Models\AcademicYear;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Resources\Models\ClassImportPreview;
use App\Modules\Resources\Models\Grade;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Services\CatalogImpactService;
use App\Modules\Resources\Services\HistoricalReferenceService;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\Normalizer;
use App\Support\WriteGuard;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SchoolClassController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
        private readonly CatalogImpactService $impacts,
        private readonly HistoricalReferenceService $history,
    ) {}

    public function index(AcademicYear $year): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);
        $classes = $year->schoolClasses()->with('grade:id,name')->orderBy('name')->get();

        return response()->json(['data' => $classes])->header('ETag', $this->etags->catalog($settings));
    }

    public function store(Request $request, AcademicYear $year): JsonResponse
    {
        $data = $request->validate([
            'grade_id' => ['required', 'integer', 'exists:grades,id'],
            'name' => ['required', 'string', 'max:100', Rule::unique('school_classes')->where('academic_year_id', $year->id)],
            'code' => ['nullable', 'string', 'max:50', Rule::unique('school_classes')->where('academic_year_id', $year->id)],
        ]);

        return DB::transaction(function () use ($request, $year, $data): JsonResponse {
            [$actor, $settings] = $this->guard->catalog($request);
            $lockedYear = AcademicYear::query()->lockForUpdate()->findOrFail($year->id);
            $class = SchoolClass::query()->create([
                'academic_year_id' => $lockedYear->id,
                'grade_id' => $data['grade_id'],
                'name' => Normalizer::text($data['name']),
                'code' => Normalizer::code($data['code'] ?? null),
                'status' => ResourceStatus::Active,
            ]);
            $settings->increment('catalog_revision');
            $settings->refresh();
            $this->audit->record($request, $actor, 'create', 'school_class', $class->id, null, $class->toArray());

            return response()->json(['data' => $class->load('grade:id,name')], 201)->header('ETag', $this->etags->catalog($settings));
        }, 3);
    }

    public function update(Request $request, AcademicYear $year, SchoolClass $schoolClass): JsonResponse
    {
        $this->assertParent($year, $schoolClass);
        $data = $request->validate([
            'grade_id' => ['sometimes', 'integer', 'exists:grades,id'],
            'name' => ['sometimes', 'required', 'string', 'max:100', Rule::unique('school_classes')->where('academic_year_id', $year->id)->ignore($schoolClass->id)],
            'code' => ['sometimes', 'nullable', 'string', 'max:50', Rule::unique('school_classes')->where('academic_year_id', $year->id)->ignore($schoolClass->id)],
            'status' => ['sometimes', Rule::enum(ResourceStatus::class)],
            'confirm_open_impact' => ['sometimes', 'boolean'],
            'impact_hash' => ['sometimes', 'string', 'max:2000'],
        ]);
        unset($data['confirm_open_impact'], $data['impact_hash']);

        return DB::transaction(function () use ($request, $schoolClass, $data): JsonResponse {
            [$actor, $settings] = $this->guard->catalog($request);
            $locked = SchoolClass::query()->lockForUpdate()->findOrFail($schoolClass->id);
            $historicalCorrection = collect(['grade_id', 'name', 'code'])->contains(
                fn (string $field): bool => array_key_exists($field, $data)
                    && $data[$field] !== $locked->getAttribute($field),
            ) && $this->history->hasClosedReference('school_class', $locked->id);
            if ($historicalCorrection && $actor->role !== Role::Admin) {
                throw new ApiProblemException('HISTORICAL_CORRECTION_ADMIN_REQUIRED', '该班级已有历史学期，仅管理员可以更正身份资料', 403);
            }
            $nextStatus = $data['status'] ?? $locked->status;
            $nextStatusValue = $nextStatus instanceof ResourceStatus ? $nextStatus->value : $nextStatus;
            if ($locked->status === ResourceStatus::Active && $nextStatusValue === ResourceStatus::Inactive->value) {
                $this->impacts->assertCanDeactivate($request, 'school_class', $locked->id, $settings);
            }
            $before = $locked->toArray();
            $locked->fill([
                'grade_id' => $data['grade_id'] ?? $locked->grade_id,
                'name' => isset($data['name']) ? Normalizer::text($data['name']) : $locked->name,
                'code' => array_key_exists('code', $data) ? Normalizer::code($data['code']) : $locked->code,
                'status' => $data['status'] ?? $locked->status,
            ]);
            if ($locked->isDirty()) {
                $locked->save();
                $settings->increment('catalog_revision');
                $settings->refresh();
                $this->audit->record($request, $actor, $historicalCorrection ? 'historical_correction' : 'update', 'school_class', $locked->id, $before, $locked->toArray());
            }

            return response()->json(['data' => $locked->load('grade:id,name')])->header('ETag', $this->etags->catalog($settings));
        }, 3);
    }

    public function destroy(Request $request, AcademicYear $year, SchoolClass $schoolClass): JsonResponse
    {
        $this->assertParent($year, $schoolClass);

        try {
            return DB::transaction(function () use ($request, $schoolClass): JsonResponse {
                [$actor, $settings] = $this->guard->catalog($request);
                $locked = SchoolClass::query()->lockForUpdate()->findOrFail($schoolClass->id);
                $before = $locked->toArray();
                $locked->delete();
                $settings->increment('catalog_revision');
                $settings->refresh();
                $this->audit->record($request, $actor, 'delete', 'school_class', $schoolClass->id, $before, null);

                return response()->json(['data' => ['deleted_id' => $schoolClass->id]])->header('ETag', $this->etags->catalog($settings));
            }, 3);
        } catch (QueryException) {
            throw new ApiProblemException('RESOURCE_IN_USE', '该班级已被学期数据引用，请改为停用', 409);
        }
    }

    public function preview(Request $request, AcademicYear $year): JsonResponse
    {
        $this->guard->actor($request);
        $request->validate(['file' => ['required', 'file', 'max:2048']]);
        $file = $request->file('file');
        assert($file instanceof UploadedFile);
        $raw = file_get_contents($file->getRealPath());
        if ($raw === false || ! mb_check_encoding($raw, 'UTF-8')) {
            throw new ApiProblemException('CSV_ENCODING_INVALID', 'CSV 必须使用 UTF-8 编码', 422);
        }
        $raw = str_starts_with($raw, "\xEF\xBB\xBF") ? substr($raw, 3) : $raw;
        $stream = fopen('php://temp', 'r+');
        fwrite($stream, $raw);
        rewind($stream);
        $header = fgetcsv($stream);
        if ($header !== ['grade_name', 'class_name', 'class_code']) {
            throw new ApiProblemException('CSV_HEADER_INVALID', 'CSV 表头必须为 grade_name,class_name,class_code', 422);
        }

        $grades = Grade::query()->where('is_active', true)->get()->keyBy('name');
        $existingNames = $year->schoolClasses()->pluck('name')->all();
        $existingCodes = $year->schoolClasses()->whereNotNull('code')->pluck('code')->all();
        $rows = [];
        $rowNumber = 1;
        while (($values = fgetcsv($stream)) !== false) {
            $rowNumber++;
            if ($values === [null] || collect($values)->every(fn ($value) => trim((string) $value) === '')) {
                continue;
            }
            if (count($values) !== 3) {
                $rows[] = ['row' => $rowNumber, 'valid' => false, 'errors' => [['code' => 'CSV_COLUMN_COUNT', 'message' => '列数必须为3']]];

                continue;
            }
            [$gradeName, $className, $classCode] = array_map(fn ($value) => Normalizer::text((string) $value), $values);
            $classCode = Normalizer::code($classCode);
            $errors = [];
            $grade = $grades->get($gradeName);
            if ($grade === null) {
                $errors[] = ['code' => 'GRADE_NOT_FOUND', 'message' => '未找到启用的年级'];
            }
            if ($className === '' || mb_strlen($className) > 100) {
                $errors[] = ['code' => 'CLASS_NAME_INVALID', 'message' => '班级名称不能为空且最多100字'];
            }
            if (in_array($className, $existingNames, true)) {
                $errors[] = ['code' => 'CLASS_NAME_EXISTS', 'message' => '班级名称已存在'];
            }
            if ($classCode !== null && in_array($classCode, $existingCodes, true)) {
                $errors[] = ['code' => 'CLASS_CODE_EXISTS', 'message' => '班级编号已存在'];
            }
            $rows[] = [
                'row' => $rowNumber,
                'grade_id' => $grade?->id,
                'grade_name' => $gradeName,
                'class_name' => $className,
                'class_code' => $classCode,
                'valid' => $errors === [],
                'errors' => $errors,
            ];
            if (count($rows) > 5000) {
                throw new ApiProblemException('CSV_TOO_MANY_ROWS', 'CSV 最多包含5000行数据', 422);
            }
        }
        fclose($stream);

        $nameGroups = collect($rows)->groupBy('class_name')->filter(fn ($group) => $group->count() > 1);
        $codeGroups = collect($rows)->filter(fn ($row) => $row['class_code'] !== null)->groupBy('class_code')->filter(fn ($group) => $group->count() > 1);
        foreach ($rows as &$row) {
            if ($nameGroups->has($row['class_name'])) {
                $row['valid'] = false;
                $row['errors'][] = ['code' => 'DUPLICATE_CLASS_NAME_IN_FILE', 'message' => '文件内班级名称重复'];
            }
            if ($row['class_code'] !== null && $codeGroups->has($row['class_code'])) {
                $row['valid'] = false;
                $row['errors'][] = ['code' => 'DUPLICATE_CLASS_CODE_IN_FILE', 'message' => '文件内班级编号重复'];
            }
        }
        unset($row);

        $settings = AppSetting::query()->findOrFail(1);
        $token = bin2hex(random_bytes(32));
        ClassImportPreview::query()->create([
            'token_hash' => hash('sha256', $token),
            'user_id' => $request->user()->id,
            'academic_year_id' => $year->id,
            'catalog_revision' => $settings->getRawOriginal('catalog_revision'),
            'file_sha256' => hash('sha256', $raw),
            'normalized_rows' => $rows,
            'expires_at' => now()->addMinutes(20),
            'created_at' => now(),
        ]);

        return response()->json(['data' => ['token' => $token, 'rows' => $rows]])->header('ETag', $this->etags->catalog($settings));
    }

    public function commit(Request $request, AcademicYear $year): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string', 'size:64'],
            'selected_rows' => ['required', 'array', 'min:1'],
            'selected_rows.*' => ['integer', 'distinct', 'min:2'],
        ]);
        $selectedRows = $this->integerList($data['selected_rows']);
        sort($selectedRows);
        $selectionHash = hash('sha256', json_encode($selectedRows, JSON_THROW_ON_ERROR));

        return DB::transaction(function () use ($request, $year, $data, $selectionHash): JsonResponse {
            $actor = $this->guard->actor($request);
            $settings = AppSetting::query()->lockForUpdate()->findOrFail(1);
            $preview = ClassImportPreview::query()->where('token_hash', hash('sha256', $data['token']))->lockForUpdate()->first();
            if ($preview === null || $preview->user_id !== $actor->id || $preview->academic_year_id !== $year->id) {
                throw new ApiProblemException('IMPORT_TOKEN_INVALID', '导入预检令牌无效', 409);
            }
            if ($preview->consumed_at !== null) {
                if ($preview->committed_selection_hash !== $selectionHash) {
                    throw new ApiProblemException('IMPORT_TOKEN_SELECTION_MISMATCH', '该令牌已使用，且提交行与首次不同', 409);
                }
                throw new ApiProblemException('IMPORT_ALREADY_COMMITTED', '该导入已经提交', 409, ['commit_result' => $preview->commit_result]);
            }
            $this->etags->assertCatalog($request, $settings);
            if ((string) $preview->catalog_revision !== (string) $settings->getRawOriginal('catalog_revision')) {
                throw new ApiProblemException('IMPORT_PREVIEW_STALE', '基础资料已变化，请重新预检 CSV', 409);
            }
            if ($preview->expires_at->isPast()) {
                throw new ApiProblemException('IMPORT_TOKEN_EXPIRED', '导入预检已过期，请重新预检', 409);
            }
            $selected = collect($preview->normalized_rows)->whereIn('row', $data['selected_rows']);
            if ($selected->count() !== count($data['selected_rows']) || $selected->contains(fn ($row) => ! $row['valid'])) {
                throw new ApiProblemException('IMPORT_SELECTION_INVALID', '只能提交预检通过的行', 422);
            }

            $created = [];
            foreach ($selected as $row) {
                $class = SchoolClass::query()->create([
                    'academic_year_id' => $year->id,
                    'grade_id' => $row['grade_id'],
                    'name' => $row['class_name'],
                    'code' => $row['class_code'],
                    'status' => ResourceStatus::Active,
                ]);
                $created[] = ['row' => $row['row'], 'id' => $class->id];
            }
            $settings->increment('catalog_revision');
            $settings->refresh();
            $result = ['created' => $created, 'count' => count($created)];
            $preview->forceFill([
                'consumed_at' => now(),
                'committed_selection_hash' => $selectionHash,
                'commit_result' => $result,
            ])->save();
            $this->audit->record($request, $actor, 'import_commit', 'academic_year', $year->id, null, ['count' => count($created), 'rows' => $data['selected_rows']]);

            return response()->json(['data' => $result], 201)->header('ETag', $this->etags->catalog($settings));
        }, 3);
    }

    private function assertParent(AcademicYear $year, SchoolClass $schoolClass): void
    {
        if ($schoolClass->academic_year_id !== $year->id) {
            throw new ApiProblemException('CLASS_YEAR_MISMATCH', '班级不属于该学年', 404);
        }
    }

    /** @return list<int> */
    private function integerList(mixed $value): array
    {
        if (! is_array($value)) {
            throw new \LogicException('Validated integer list must be an array.');
        }

        return array_map(static fn (mixed $item): int => (int) $item, array_values($value));
    }
}
