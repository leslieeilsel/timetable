<?php

namespace App\Modules\Resources\Http\Controllers;

use App\Enums\AssignmentStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Services\AuditLogger;
use App\Modules\Resources\Models\Course;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use App\Modules\SemesterClassSetting\Models\SemesterClassSetting;
use App\Modules\TeachingAssignment\Http\Controllers\TeachingAssignmentController;
use App\Modules\TeachingAssignment\Models\TeachingAssignment;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\ImportTableReader;
use App\Support\Normalizer;
use App\Support\SimpleXlsxWriter;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class DataImportController
{
    private const FIELDS = [
        'teachers' => ['employee_no' => '教师工号', 'name' => '教师姓名', 'courses' => '任教课程'],
        'assignments' => ['class' => '班级名称', 'course' => '课程名称', 'employee_no' => '教师工号', 'name' => '教师姓名', 'weekly_items' => '每周课时', 'week_pattern' => '周型', 'room' => '指定教室'],
    ];

    public function __construct(private readonly WriteGuard $guard, private readonly EtagService $etags, private readonly AuditLogger $audit) {}

    public function template(Request $request): BinaryFileResponse
    {
        $this->guard->actor($request);
        $kind = $this->kind($request);
        $path = app(SimpleXlsxWriter::class)->writeTable([array_values(self::FIELDS[$kind])]);

        return response()->download($path, ($kind === 'teachers' ? '教师导入模板' : '任课导入模板').'.xlsx')->deleteFileAfterSend();
    }

    public function preview(Request $request): JsonResponse
    {
        $actor = $this->guard->actor($request);
        $kind = $this->kind($request);
        $request->validate(['file' => ['required', 'file', 'max:2048'], 'mapping' => ['sometimes', 'json'], 'semester_id' => [$kind === 'assignments' ? 'required' : 'nullable', 'integer', 'exists:semesters,id']]);
        $semester = $kind === 'assignments' ? Semester::query()->findOrFail($request->integer('semester_id')) : null;
        $file = $request->file('file');
        assert($file instanceof UploadedFile);
        $table = app(ImportTableReader::class)->read($file);
        $headers = array_shift($table)['values'];
        $mapping = $request->has('mapping') ? json_decode((string) $request->string('mapping'), true, flags: JSON_THROW_ON_ERROR) : [];
        if (! is_array($mapping)) {
            throw new ApiProblemException('IMPORT_MAPPING', '请为字段选择对应列。', 422);
        }
        foreach (self::FIELDS[$kind] as $key => $label) {
            if (! $request->has('mapping')) {
                $found = array_search($label, $headers, true);
                $mapping[$key] = $found === false ? null : $found;
            }
            if (isset($mapping[$key]) && (! is_int($mapping[$key]) || $mapping[$key] < 0 || $mapping[$key] >= count($headers))) {
                throw new ApiProblemException('IMPORT_MAPPING', '字段映射超出文件列范围。', 422);
            }
        }
        $settings = AppSetting::query()->findOrFail(1);
        // Read the revision before resolving dependencies, so any concurrent change invalidates commit.
        $etag = $semester ? $this->etags->semester($semester, $settings) : $this->etags->catalog($settings);
        $rows = [];
        $seen = [];
        foreach ($table as $record) {
            $values = [];
            foreach (self::FIELDS[$kind] as $key => $label) {
                $values[$key] = isset($mapping[$key]) ? ($record['values'][$mapping[$key]] ?? '') : '';
            }
            $row = $kind === 'teachers' ? $this->teacherRow($values) : $this->assignmentRow($values, $semester);
            $row['row'] = $record['row'];
            $row['values'] = $values;
            $identity = $kind === 'teachers' ? Normalizer::code($values['employee_no']) : implode('|', [$values['class'], $values['course'], $values['week_pattern'] ?: '每周']);
            if (isset($seen[$identity])) {
                $row['errors'][] = '文件内身份重复，请合并明细后重试（重复于第 '.$seen[$identity].' 行）。';
            }
            $seen[$identity] = $record['row'];
            $rows[] = $row;
        }
        $token = bin2hex(random_bytes(32));
        DB::table('data_import_previews')->insert([
            'token_hash' => hash('sha256', $token), 'user_id' => $actor->id, 'semester_id' => $semester?->id,
            'kind' => $kind, 'etag' => $etag, 'rows' => json_encode($rows, JSON_THROW_ON_ERROR),
            'expires_at' => now()->addMinutes(30), 'created_at' => now(),
        ]);
        $summary = ['create' => 0, 'update' => 0, 'skip' => 0, 'errors' => 0];
        foreach ($rows as $row) {
            $summary[$row['errors'] === [] ? $row['action'] : 'errors']++;
        }

        return response()->json(['data' => [
            'token' => $token, 'headers' => $headers, 'mapping' => $mapping,
            'fields' => self::FIELDS[$kind], 'rows' => collect($rows)->map(fn ($row) => collect($row)->except('operation')->all())->all(),
            'summary' => $summary,
        ]])->header('ETag', $etag);
    }

    public function commit(Request $request): JsonResponse
    {
        $actor = $this->guard->actor($request);
        $kind = $this->kind($request);
        $data = $request->validate(['token' => ['required', 'string', 'size:64']]);

        return DB::transaction(function () use ($request, $actor, $kind, $data): JsonResponse {
            // Follow the shared global -> semester -> entity lock order.
            $settings = AppSetting::query()->lockForUpdate()->findOrFail(1);
            $preview = DB::table('data_import_previews')->where('token_hash', hash('sha256', $data['token']))->lockForUpdate()->first();
            if (! $preview || $preview->user_id !== $actor->id || $preview->kind !== $kind) {
                throw new ApiProblemException('IMPORT_NOT_FOUND', '导入预览不存在，请重新预检。', 404);
            }
            if ($preview->result !== null) {
                return response()->json(['data' => json_decode($preview->result, true, flags: JSON_THROW_ON_ERROR)]);
            }
            if (now()->greaterThan($preview->expires_at)) {
                throw new ApiProblemException('IMPORT_EXPIRED', '预览已过期，文件仍可重新预检。', 409);
            }
            $semester = $preview->semester_id ? Semester::query()->lockForUpdate()->findOrFail($preview->semester_id) : null;
            $current = $semester ? $this->etags->semester($semester, $settings) : $this->etags->catalog($settings);
            if ($current !== $preview->etag || $request->header('If-Match') !== $preview->etag) {
                throw new ApiProblemException('IMPORT_STALE', '资料在预检后发生变化，请重新预检并核对差异。尚未写入任何行。', 412);
            }
            $rows = json_decode($preview->rows, true, flags: JSON_THROW_ON_ERROR);
            if (! is_array($rows)) {
                throw new ApiProblemException('IMPORT_INVALID', '预览损坏，请重新预检。', 409);
            }
            if (collect($rows)->contains(fn ($row) => $row['errors'] !== [])) {
                throw new ApiProblemException('IMPORT_HAS_ERRORS', '请修正所有错误后重新上传，整批尚未写入。', 422);
            }
            $changed = collect($rows)->where('action', '!=', 'skip')->values();
            if ($semester) {
                $this->guard->semester($request, $semester);
                if ($changed->isNotEmpty()) {
                    $bulk = clone $request;
                    $bulk->replace(['operations' => $changed->pluck('operation')->all()]);
                    app(TeachingAssignmentController::class)->bulkUpsert($bulk, $semester);
                }
            } else {
                $this->guard->catalog($request);
                foreach ($changed as $row) {
                    $operation = $row['operation'];
                    $teacher = isset($operation['id']) ? Teacher::query()->findOrFail($operation['id']) : Teacher::query()->create([
                        'employee_no' => $operation['employee_no'], 'name' => $operation['name'], 'is_active' => true,
                    ]);
                    $teacher->courses()->syncWithoutDetaching($operation['course_ids']);
                }
                if ($changed->isNotEmpty()) {
                    $settings->increment('catalog_revision');
                }
            }
            $result = ['created' => $changed->where('action', 'create')->count(), 'updated' => $changed->where('action', 'update')->count(), 'skipped' => count($rows) - $changed->count()];
            DB::table('data_import_previews')->where('id', $preview->id)->update(['result' => json_encode($result, JSON_THROW_ON_ERROR)]);
            $this->audit->record($request, $actor, 'import', $kind, $semester->id ?? 0, null, $result);

            return response()->json(['data' => $result]);
        }, 3);
    }

    private function kind(Request $request): string
    {
        $kind = (string) $request->route('kind');
        abort_unless(isset(self::FIELDS[$kind]), 404);

        return $kind;
    }

    /** @param array<string, string> $values
     * @return array<string, mixed>
     */
    private function teacherRow(array $values): array
    {
        $errors = [];
        $code = Normalizer::code($values['employee_no']);
        if (! $code || mb_strlen($code) > 50) {
            $errors[] = '教师工号必填，最多 50 字；请在 Excel 中将工号列设为文本以保留前导零。';
        }
        if ($values['name'] === '' || mb_strlen($values['name']) > 100) {
            $errors[] = '教师姓名必填，最多 100 字。';
        }
        $teacher = $code ? Teacher::query()->with('courses')->where('employee_no', $code)->first() : null;
        if ($teacher && ($teacher->name !== $values['name'] || ! $teacher->is_active)) {
            $errors[] = '该工号已存在但姓名不同或已停用，请先到教师资料核实身份；不会按同名自动合并。';
        }
        $names = array_values(array_unique(array_filter(preg_split('/[、,，;；]/u', $values['courses']) ?: [], fn ($value) => trim($value) !== '')));
        $courseIds = [];
        foreach ($names as $name) {
            $course = Course::query()->where('name', trim($name))->where('is_active', true)->first();
            if (! $course) {
                $errors[] = '未找到启用的课程：'.trim($name).'，请先维护课程资料。';
            } else {
                $courseIds[] = $course->id;
            }
        }
        $existingIds = $teacher?->courses->pluck('id')->all() ?? [];
        $afterNames = array_values(array_unique([...($teacher?->courses->pluck('name')->all() ?? []), ...array_map(trim(...), $names)]));

        return [
            'label' => $values['name'].' · '.$code,
            'action' => ! $teacher ? 'create' : (array_diff($courseIds, $existingIds) === [] ? 'skip' : 'update'),
            'before' => $teacher ? $teacher->name.' · '.($teacher->courses->pluck('name')->join('、') ?: '未配置任教课程') : '不存在',
            'after' => $values['name'].' · '.(implode('、', $afterNames) ?: '未配置任教课程'), 'errors' => $errors,
            'operation' => ['id' => $teacher?->id, 'employee_no' => $code, 'name' => $values['name'], 'course_ids' => $courseIds],
        ];
    }

    /** @param array<string, string> $values
     * @return array<string, mixed>
     */
    private function assignmentRow(array $values, ?Semester $semester): array
    {
        assert($semester !== null);
        $errors = [];
        $class = SchoolClass::query()->with('grade')->where('academic_year_id', $semester->academic_year_id)->where('name', $values['class'])->first();
        $setting = $class ? SemesterClassSetting::query()->where('semester_id', $semester->id)->where('school_class_id', $class->id)->first() : null;
        if (! $class || $class->status->value !== 'active' || ! $class->grade->is_active || $setting?->status->value !== 'active') {
            $errors[] = '班级未找到或未在本学期启用，请先导入班级并配置学期班级。';
        }
        $course = Course::query()->where('name', $values['course'])->where('is_active', true)->first();
        if (! $course) {
            $errors[] = '未找到启用的课程，请先维护课程资料。';
        }
        $teacher = Teacher::query()->with('courses')->where('employee_no', Normalizer::code($values['employee_no']) ?? '')->where('is_active', true)->first();
        if (! $teacher || $values['employee_no'] === '') {
            $errors[] = '未找到该工号的启用教师，请先导入教师；不能仅凭姓名匹配。';
        } elseif ($values['name'] !== '' && $teacher->name !== $values['name']) {
            $errors[] = '工号与教师姓名不一致，请核实身份。';
        } elseif ($course && ! $teacher->courses->contains('id', $course->id)) {
            $errors[] = '教师尚未配置这门任教课程，请先维护教师资料。';
        }
        $weekly = filter_var($values['weekly_items'], FILTER_VALIDATE_INT);
        if ($weekly === false || $weekly < 1 || $weekly > 100) {
            $errors[] = '每周课时须为 1 至 100 的整数。';
        }
        $pattern = ['' => 'all', '每周' => 'all', '单周' => 'a', '双周' => 'b'][$values['week_pattern']] ?? null;
        if ($pattern === null) {
            $errors[] = '周型请填写每周、单周或双周；指定周请在任课编辑中设置。';
        }
        $room = $values['room'] !== '' ? Room::query()->where('name', $values['room'])->where('is_active', true)->first() : Room::query()->whereKey($setting?->fixed_room_id)->where('is_active', true)->first();
        if (! $room) {
            $errors[] = '未找到启用的教室；留空时须先配置班级固定教室。';
        }
        $existing = $class && $course && $pattern ? TeachingAssignment::query()->with(['teacher', 'specifiedRoom', 'collaborators'])->withCount('entries')->where('semester_id', $semester->id)->where('school_class_id', $class->id)->where('course_id', $course->id)->where('week_pattern', $pattern)->first() : null;
        $operation = [
            'school_class_id' => $class?->id, 'course_id' => $course?->id, 'teacher_id' => $teacher?->id,
            'weekly_items' => $weekly, 'items_per_session' => $existing->items_per_session ?? 1,
            'week_pattern' => $pattern, 'room_mode' => $values['room'] !== '' ? 'specified' : 'class_default', 'specified_room_id' => $values['room'] !== '' ? $room?->id : null,
            'collaborator_ids' => $existing?->collaborators->pluck('id')->all() ?? [], 'allows_substitution' => $existing->allows_substitution ?? true,
        ];
        $changed = ! $existing || $existing->teacher_id !== $teacher?->id || $existing->weekly_items !== $weekly || $existing->room_mode->value !== $operation['room_mode'] || $existing->specified_room_id !== $operation['specified_room_id'];
        if ($existing) {
            $operation['assignment_id'] = $existing->id;
            if ($changed && ($existing->status !== AssignmentStatus::Draft || $existing->entries_count > 0)) {
                $errors[] = '已有任课已确认、停用或已有排课，不能通过导入覆盖。请到任课详情或长期调课处理。';
            }
            if ($weekly !== false && $weekly < $existing->items_per_session) {
                $errors[] = '每周课时不能低于已有连排节数。';
            }
        }

        return [
            'label' => $values['class'].' · '.$values['course'].' · '.($values['week_pattern'] ?: '每周'),
            'action' => ! $existing ? 'create' : ($changed ? 'update' : 'skip'),
            'before' => $existing ? $existing->teacher->name.'（'.$existing->teacher->employee_no.'） · '.$existing->weekly_items.' 节 · '.($existing->specifiedRoom->name ?? '班级固定教室') : '不存在',
            'after' => ($teacher->name ?? $values['name']).'（'.$values['employee_no'].'） · '.$values['weekly_items'].' 节 · '.($values['room'] ?: '班级固定教室'),
            'errors' => $errors, 'operation' => $operation,
        ];
    }
}
