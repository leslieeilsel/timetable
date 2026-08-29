<?php

use App\Enums\Role;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Scheduling\Services\PreparationCheckService;
use Database\Seeders\MediumSchoolSeeder;
use Illuminate\Support\Facades\DB;

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->scheduler = User::factory()->create([
        'role' => Role::Scheduler,
        'must_change_password' => false,
    ]);
    $this->actingAs($this->scheduler)->withSession(['auth_version' => $this->scheduler->auth_version]);
});

it('returns all preparation checks from current semester data', function (): void {
    $fixture = preparationCheckFixture($this->scheduler->id);

    $response = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/preparation-check")
        ->assertOk()
        ->assertJsonPath('data.ready', true)
        ->assertJsonPath('data.status', 'passed')
        ->assertJsonPath('data.summary.blocking', 0)
        ->assertJsonPath('data.summary.warnings', 0)
        ->assertJsonPath('data.summary.passed', 9)
        ->assertJsonPath('data.summary.confirmed_assignments', 1)
        ->assertJsonPath('data.summary.required_entries', 1)
        ->assertJsonCount(9, 'data.checks');

    expect(collect($response->json('data.checks'))->pluck('key')->all())->toBe([
        'schedule_template',
        'class_settings',
        'confirmed_assignments',
        'assignment_resources',
        'theoretical_capacity',
        'fixed_placements',
        'constraint_integrity',
        'active_constraints',
        'current_version',
    ]);
});

it('blocks preparation when a draft assignment exists', function (): void {
    $fixture = preparationCheckFixture($this->scheduler->id);
    addPreparationAssignment($fixture, 'draft');

    $response = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/preparation-check")
        ->assertOk()
        ->assertJsonPath('data.ready', false)
        ->assertJsonPath('data.status', 'blocking');
    $check = collect($response->json('data.checks'))->firstWhere('key', 'confirmed_assignments');

    expect($check)
        ->not->toBeNull()
        ->and($check['status'])->toBe('blocking')
        ->and($check['issue_count'])->toBe(1)
        ->and($check['message'])->toContain('1 条待确认')
        ->and($check['fix_path'])->toBe('/scheduling/assignments?view=table&status=draft');
});

it('detects invalid assignment resources', function (string $fault, string $reason): void {
    $fixture = preparationCheckFixture($this->scheduler->id);

    match ($fault) {
        'teacher' => DB::table('teachers')->where('id', $fixture['teacher_id'])->update(['is_active' => false]),
        'course' => DB::table('courses')->where('id', $fixture['course_id'])->update(['is_active' => false]),
        'qualification' => DB::table('teacher_course')
            ->where('teacher_id', $fixture['teacher_id'])
            ->where('course_id', $fixture['course_id'])
            ->delete(),
        'room' => DB::table('rooms')->where('id', $fixture['room_id'])->update(['is_active' => false]),
        'class_setting' => DB::table('semester_class_settings')
            ->where('semester_id', $fixture['semester_id'])
            ->where('school_class_id', $fixture['class_id'])
            ->update(['status' => 'inactive']),
    };

    $response = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/preparation-check")
        ->assertOk()
        ->assertJsonPath('data.ready', false);
    $check = collect($response->json('data.checks'))->firstWhere('key', 'assignment_resources');

    expect($check)
        ->not->toBeNull()
        ->and($check['status'])->toBe('blocking')
        ->and($check['issue_count'])->toBe(1)
        ->and($check['items'][0]['reasons'])->toContain($reason);
})->with([
    'inactive teacher' => ['teacher', '主讲或协同教师已停用'],
    'inactive course' => ['course', '课程已停用'],
    'missing qualification' => ['qualification', '主讲或协同教师不具备课程资格'],
    'inactive room' => ['room', '教室无法解析或已停用'],
    'inactive semester class setting' => ['class_setting', '缺少本学期班级配置'],
]);

it('detects theoretical capacity overload', function (): void {
    $fixture = preparationCheckFixture($this->scheduler->id);
    DB::table('teaching_assignments')->where('id', $fixture['assignment_id'])->update(['weekly_items' => 11]);

    $response = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/preparation-check")
        ->assertOk()
        ->assertJsonPath('data.ready', false);
    $check = collect($response->json('data.checks'))->firstWhere('key', 'theoretical_capacity');

    expect($check)
        ->not->toBeNull()
        ->and($check['status'])->toBe('blocking')
        ->and($check['issue_count'])->toBe(3)
        ->and($check['items'])->each(
            fn ($issue) => $issue
                ->required->toBe(11)
                ->capacity->toBe(10)
                ->shortage->toBe(1),
        );
});

it('detects conflicts between fixed placements', function (): void {
    $fixture = preparationCheckFixture($this->scheduler->id);
    $secondAssignmentId = addPreparationAssignment($fixture, 'confirmed');
    $now = now();
    foreach ([$fixture['assignment_id'], $secondAssignmentId] as $assignmentId) {
        DB::table('fixed_placements')->insert([
            'semester_id' => $fixture['semester_id'],
            'teaching_assignment_id' => $assignmentId,
            'week_pattern' => 'all',
            'weekday' => 1,
            'item_id' => $fixture['item_ids'][0],
            'is_locked' => true,
            'status' => 'active',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    $response = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/preparation-check")
        ->assertOk()
        ->assertJsonPath('data.ready', false);
    $check = collect($response->json('data.checks'))->firstWhere('key', 'fixed_placements');

    expect($check)
        ->not->toBeNull()
        ->and($check['status'])->toBe('blocking')
        ->and($check['issue_count'])->toBeGreaterThanOrEqual(2)
        ->and(collect($check['items'])->pluck('resource')->all())
        ->toContain("room:{$fixture['room_id']}", "school_class:{$fixture['class_id']}");
});

it('reports missing schedule and class setup as blockers', function (): void {
    $fixture = preparationCheckFixture($this->scheduler->id);
    DB::table('schedule_template_days')->where('semester_id', $fixture['semester_id'])->update(['is_enabled' => false]);
    DB::table('semester_class_settings')->where('semester_id', $fixture['semester_id'])->update(['status' => 'inactive']);

    $response = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/preparation-check")
        ->assertOk()
        ->assertJsonPath('data.ready', false);
    $checks = collect($response->json('data.checks'))->keyBy('key');

    expect($checks['schedule_template']['status'])->toBe('blocking')
        ->and($checks['class_settings']['status'])->toBe('blocking');
});

it('reports missing soft rules and current timetable as warnings', function (): void {
    $fixture = preparationCheckFixture($this->scheduler->id);
    DB::table('scheduling_constraints')->where('semester_id', $fixture['semester_id'])->delete();
    DB::table('semesters')->where('id', $fixture['semester_id'])->update(['current_timetable_version_id' => null]);

    $response = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/preparation-check")
        ->assertOk()
        ->assertJsonPath('data.ready', true)
        ->assertJsonPath('data.status', 'warning')
        ->assertJsonPath('data.summary.warnings', 2);
    $checks = collect($response->json('data.checks'))->keyBy('key');

    expect($checks['active_constraints']['status'])->toBe('warning')
        ->and($checks['current_version']['status'])->toBe('warning');
});

it('reports a current timetable based on older input as a warning', function (): void {
    $fixture = preparationCheckFixture($this->scheduler->id);
    DB::table('semesters')->where('id', $fixture['semester_id'])->increment('input_revision');

    $response = $this->getJson("/api/v1/semesters/{$fixture['semester_id']}/preparation-check")
        ->assertOk()
        ->assertJsonPath('data.ready', true)
        ->assertJsonPath('data.status', 'warning');
    $check = collect($response->json('data.checks'))->firstWhere('key', 'current_version');

    expect($check['status'])->toBe('warning')
        ->and($check['message'])->toContain('输入已变化');
});

it('keeps preparation query count bounded for a medium school', function (): void {
    $this->seed(MediumSchoolSeeder::class);
    $semesterId = (int) DB::table('app_settings')->where('id', 1)->value('current_semester_id');
    $semester = Semester::query()->findOrFail($semesterId);

    DB::flushQueryLog();
    DB::enableQueryLog();
    $result = app(PreparationCheckService::class)->inspect($semester);
    $queryCount = count(DB::getQueryLog());
    DB::disableQueryLog();
    $constraintCheck = collect($result['checks'])->firstWhere('key', 'constraint_integrity');

    expect($result['summary']['confirmed_assignments'])->toBe(360)
        ->and($result['summary']['required_entries'])->toBe(808)
        ->and($constraintCheck['status'])->toBe('passed')
        ->and($queryCount)->toBeLessThanOrEqual(20);
});

/**
 * @return array{
 *   semester_id: int,
 *   academic_year_id: int,
 *   class_id: int,
 *   teacher_id: int,
 *   course_id: int,
 *   room_id: int,
 *   assignment_id: int,
 *   item_ids: list<int>
 * }
 */
function preparationCheckFixture(int $userId): array
{
    $now = now();
    $yearId = DB::table('academic_years')->insertGetId([
        'name' => '2026-2027 学年',
        'start_date' => '2026-09-01',
        'end_date' => '2027-07-15',
        'status' => 'open',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $semesterId = DB::table('semesters')->insertGetId([
        'academic_year_id' => $yearId,
        'name' => '上学期',
        'sequence' => 1,
        'start_date' => '2026-09-01',
        'end_date' => '2027-01-20',
        'status' => 'open',
        'input_revision' => 1,
        'assignment_revision' => 1,
        'constraint_revision' => 1,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $gradeId = DB::table('grades')->insertGetId([
        'name' => '七年级',
        'sort_order' => 7,
        'is_active' => true,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $roomId = DB::table('rooms')->insertGetId([
        'name' => '七年级 1 班教室',
        'type' => 'classroom',
        'is_active' => true,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $classId = DB::table('school_classes')->insertGetId([
        'academic_year_id' => $yearId,
        'grade_id' => $gradeId,
        'name' => '七年级 1 班',
        'code' => 'G7C1',
        'status' => 'active',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    DB::table('semester_class_settings')->insert([
        'semester_id' => $semesterId,
        'academic_year_id' => $yearId,
        'school_class_id' => $classId,
        'fixed_room_id' => $roomId,
        'status' => 'active',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $teacherId = DB::table('teachers')->insertGetId([
        'employee_no' => 'T-PREPARATION-001',
        'name' => '准备检查教师',
        'is_active' => true,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $courseId = DB::table('courses')->insertGetId([
        'name' => '数学',
        'short_name' => '数',
        'is_active' => true,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    DB::table('teacher_course')->insert(['teacher_id' => $teacherId, 'course_id' => $courseId]);
    $templateId = DB::table('schedule_templates')->insertGetId([
        'semester_id' => $semesterId,
        'name' => '标准作息',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    foreach (range(1, 5) as $weekday) {
        DB::table('schedule_template_days')->insert([
            'schedule_template_id' => $templateId,
            'semester_id' => $semesterId,
            'weekday' => $weekday,
            'is_enabled' => true,
        ]);
    }
    $itemIds = [];
    foreach ([['第 1 节', '08:00', '08:45'], ['第 2 节', '08:55', '09:40']] as $index => [$name, $start, $end]) {
        $itemIds[] = DB::table('items')->insertGetId([
            'schedule_template_id' => $templateId,
            'semester_id' => $semesterId,
            'name' => $name,
            'type' => 'course',
            'start_time' => $start,
            'end_time' => $end,
            'sort_order' => $index + 1,
            'allows_course' => true,
            'allows_teacher' => true,
            'counts_as_course' => true,
            'show_in_official' => true,
            'show_in_full' => true,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }
    $assignmentId = DB::table('teaching_assignments')->insertGetId([
        'semester_id' => $semesterId,
        'academic_year_id' => $yearId,
        'school_class_id' => $classId,
        'course_id' => $courseId,
        'teacher_id' => $teacherId,
        'weekly_items' => 1,
        'room_mode' => 'class_default',
        'status' => 'confirmed',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    DB::table('scheduling_constraints')->insert([
        'semester_id' => $semesterId,
        'name' => '周一优先排课',
        'kind' => 'soft',
        'category' => 'preferred_slot',
        'target_type' => 'semester',
        'target_id' => $semesterId,
        'scope' => json_encode(['weekdays' => [1]], JSON_THROW_ON_ERROR),
        'requirement' => json_encode(['preference' => 'prefer'], JSON_THROW_ON_ERROR),
        'weight' => 70,
        'source' => 'user',
        'status' => 'active',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $versionId = DB::table('timetable_versions')->insertGetId([
        'semester_id' => $semesterId,
        'version_no' => 1,
        'name' => '当前课表',
        'status' => 'active',
        'source' => 'manual',
        'created_by' => $userId,
        'input_revision' => 1,
        'catalog_revision' => 0,
        'hard_conflict_count' => 0,
        'soft_warning_count' => 0,
        'activated_at' => $now,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    DB::table('semesters')->where('id', $semesterId)->update([
        'current_timetable_version_id' => $versionId,
        'updated_at' => $now,
    ]);

    return [
        'semester_id' => $semesterId,
        'academic_year_id' => $yearId,
        'class_id' => $classId,
        'teacher_id' => $teacherId,
        'course_id' => $courseId,
        'room_id' => $roomId,
        'assignment_id' => $assignmentId,
        'item_ids' => $itemIds,
    ];
}

/**
 * @param  array{semester_id: int, academic_year_id: int, class_id: int, teacher_id: int}  $fixture
 */
function addPreparationAssignment(array $fixture, string $status): int
{
    $now = now();
    $courseId = DB::table('courses')->insertGetId([
        'name' => '英语',
        'short_name' => '英',
        'is_active' => true,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    DB::table('teacher_course')->insert([
        'teacher_id' => $fixture['teacher_id'],
        'course_id' => $courseId,
    ]);

    return DB::table('teaching_assignments')->insertGetId([
        'semester_id' => $fixture['semester_id'],
        'academic_year_id' => $fixture['academic_year_id'],
        'school_class_id' => $fixture['class_id'],
        'course_id' => $courseId,
        'teacher_id' => $fixture['teacher_id'],
        'weekly_items' => 1,
        'room_mode' => 'class_default',
        'status' => $status,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
}
