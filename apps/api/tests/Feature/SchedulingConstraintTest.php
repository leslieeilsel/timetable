<?php

use App\Enums\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->scheduler = User::factory()->create([
        'role' => Role::Scheduler,
        'must_change_password' => false,
    ]);
    $this->actingAs($this->scheduler)->withSession(['auth_version' => $this->scheduler->auth_version]);
});

it('creates, activates, filters and protects scheduling constraints', function (): void {
    [$semesterId, $teacherId] = constraintFixture();
    $etag = $this->getJson("/api/v1/semesters/{$semesterId}")->assertOk()->headers->get('ETag');

    $created = $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$semesterId}/scheduling-constraints", [
            'name' => '胡静尽量不排周五第 7 节',
            'kind' => 'soft',
            'category' => 'preferred_slot',
            'target_type' => 'teacher',
            'target_id' => $teacherId,
            'scope' => ['weekdays' => [5]],
            'condition' => ['item_sort_orders' => [7]],
            'requirement' => ['preference' => 'avoid'],
            'weight' => 80,
            'explanation' => '教师个人时间偏好，不影响可行解。',
        ])->assertCreated()
        ->assertJsonPath('data.status', 'draft')
        ->assertJsonPath('data.kind', 'soft')
        ->assertJsonPath('meta.constraint_revision', '1');
    $constraintId = $created->json('data.id');

    $activated = $this->withHeader('If-Match', $created->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$semesterId}/scheduling-constraints/{$constraintId}/activate")
        ->assertOk()
        ->assertJsonPath('data.status', 'active')
        ->assertJsonPath('meta.constraint_revision', '2');

    $this->getJson("/api/v1/semesters/{$semesterId}/scheduling-constraints?kind=soft&status=active&per_page=20")
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('meta.pagination.total', 1)
        ->assertJsonPath('meta.pagination.page', 1);

    $this->withHeader('If-Match', $activated->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$semesterId}/scheduling-constraints", [
            'name' => '错误的硬约束权重',
            'kind' => 'hard',
            'category' => 'availability',
            'scope' => ['weekdays' => [1]],
            'requirement' => ['available' => false],
            'weight' => 100,
        ])->assertStatus(422)
        ->assertJsonPath('code', 'CONSTRAINT_WEIGHT_INVALID');

    $this->withHeader('If-Match', $activated->headers->get('ETag'))
        ->postJson("/api/v1/semesters/{$semesterId}/scheduling-constraints", [
            'name' => '缺少上限值的每日负荷规则',
            'kind' => 'hard',
            'category' => 'daily_load',
            'target_type' => 'teacher',
            'target_id' => $teacherId,
            'scope' => [],
            'requirement' => ['balance' => true],
        ])->assertStatus(422)
        ->assertJsonPath('code', 'CONSTRAINT_REQUIREMENT_INVALID');

    $systemConstraintId = DB::table('scheduling_constraints')->insertGetId([
        'semester_id' => $semesterId,
        'name' => '教师同课节不可重复',
        'kind' => 'hard',
        'category' => 'availability',
        'scope' => json_encode(['semester_id' => $semesterId], JSON_THROW_ON_ERROR),
        'requirement' => json_encode(['resource_no_overlap' => 'teacher'], JSON_THROW_ON_ERROR),
        'source' => 'system',
        'status' => 'active',
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    $this->withHeader('If-Match', $activated->headers->get('ETag'))
        ->deleteJson("/api/v1/semesters/{$semesterId}/scheduling-constraints/{$systemConstraintId}")
        ->assertStatus(409)
        ->assertJsonPath('code', 'SYSTEM_CONSTRAINT_IMMUTABLE');
});

it('rejects unsupported kind category pairs and non strict nested payloads', function (): void {
    [$semesterId] = constraintFixture();
    $etag = $this->getJson("/api/v1/semesters/{$semesterId}")->headers->get('ETag');

    $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$semesterId}/scheduling-constraints", [
            'name' => '伪硬时段偏好',
            'kind' => 'hard',
            'category' => 'preferred_slot',
            'scope' => ['weekdays' => [5]],
            'requirement' => ['preference' => 'avoid'],
        ])->assertStatus(422)
        ->assertJsonPath('code', 'CONSTRAINT_KIND_CATEGORY_UNSUPPORTED');

    $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$semesterId}/scheduling-constraints", [
            'name' => '字符串布尔值',
            'kind' => 'hard',
            'category' => 'availability',
            'scope' => ['weekdays' => [5]],
            'requirement' => ['available' => 'false'],
        ])->assertStatus(422)
        ->assertJsonPath('code', 'CONSTRAINT_REQUIREMENT_INVALID');

    $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$semesterId}/scheduling-constraints", [
            'name' => '求解器不读取的嵌套字段',
            'kind' => 'soft',
            'category' => 'preferred_slot',
            'scope' => ['weekdays' => [5], 'timezone' => 'Asia/Shanghai'],
            'requirement' => ['preference' => 'avoid'],
            'weight' => 60,
        ])->assertStatus(422)
        ->assertJsonPath('code', 'CONSTRAINT_SCOPE_INVALID')
        ->assertJsonPath('unknown_fields.0', 'timezone');

    $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$semesterId}/scheduling-constraints", [
            'name' => '伪硬教室规则',
            'kind' => 'hard',
            'category' => 'room_requirement',
            'scope' => [],
            'requirement' => ['assignment_room_mode' => true],
        ])->assertStatus(422)
        ->assertJsonPath('code', 'CONSTRAINT_KIND_CATEGORY_UNSUPPORTED');

    $this->withHeader('If-Match', $etag)
        ->postJson("/api/v1/semesters/{$semesterId}/scheduling-constraints", [
            'name' => '求解器不读取的软每周上限',
            'kind' => 'soft',
            'category' => 'weekly_load',
            'scope' => [],
            'requirement' => ['max_items_per_week' => 20],
            'weight' => 60,
        ])->assertStatus(422)
        ->assertJsonPath('code', 'CONSTRAINT_KIND_CATEGORY_UNSUPPORTED');

    foreach ([
        ['hard', 'mutual_exclusion', ['with_assignment_ids' => [999], 'mode' => 'same_slot']],
        ['hard', 'course_distribution', ['max_same_course_per_day' => 1]],
        ['hard', 'spacing', ['min_gap_days' => 1]],
        ['soft', 'daily_load', ['max_items_per_day' => 4]],
        ['soft', 'consecutive_items', ['max_consecutive_items' => 3]],
        ['soft', 'course_distribution', ['spread_across_weekdays' => true]],
        ['soft', 'spacing', ['max_same_course_per_day' => 1]],
        ['soft', 'workload_balance', ['balance_teacher_daily_load' => true]],
        ['soft', 'teacher_gaps', ['minimize_teacher_gaps' => true]],
        ['soft', 'course_priority', ['prefer_earlier_items' => ['数学']]],
    ] as [$kind, $category, $requirement]) {
        $this->withHeader('If-Match', $etag)
            ->postJson("/api/v1/semesters/{$semesterId}/scheduling-constraints", [
                'name' => "不一致矩阵 {$kind} {$category}",
                'kind' => $kind,
                'category' => $category,
                'scope' => [],
                'requirement' => $requirement,
                ...($kind === 'soft' ? ['weight' => 60] : []),
            ])->assertStatus(422)
            ->assertJsonPath('code', 'CONSTRAINT_KIND_CATEGORY_UNSUPPORTED');
    }
});

it('blocks preparation when a legacy active rule cannot be executed', function (): void {
    [$semesterId] = constraintFixture();
    $constraintId = DB::table('scheduling_constraints')->insertGetId([
        'semester_id' => $semesterId,
        'name' => '遗留的伪硬偏好',
        'kind' => 'hard',
        'category' => 'preferred_slot',
        'scope' => json_encode(['weekdays' => [5]], JSON_THROW_ON_ERROR),
        'condition' => null,
        'requirement' => json_encode(['preference' => 'avoid'], JSON_THROW_ON_ERROR),
        'source' => 'user',
        'status' => 'active',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $response = $this->getJson("/api/v1/semesters/{$semesterId}/preparation-check")
        ->assertOk()
        ->assertJsonPath('data.ready', false);
    $check = collect($response->json('data.checks'))->firstWhere('key', 'constraint_integrity');

    expect($check['status'])->toBe('blocking')
        ->and($check['items'][0]['constraint_id'])->toBe($constraintId)
        ->and($check['items'][0]['code'])->toBe('CONSTRAINT_KIND_CATEGORY_UNSUPPORTED');
});

/** @return array{int, int} */
function constraintFixture(): array
{
    $now = now();
    $yearId = DB::table('academic_years')->insertGetId([
        'name' => '2026-2027 学年', 'start_date' => '2026-09-01', 'end_date' => '2027-07-15',
        'status' => 'open', 'created_at' => $now, 'updated_at' => $now,
    ]);
    $semesterId = DB::table('semesters')->insertGetId([
        'academic_year_id' => $yearId, 'name' => '上学期', 'sequence' => 1,
        'start_date' => '2026-09-01', 'end_date' => '2027-01-20', 'status' => 'open',
        'created_at' => $now, 'updated_at' => $now,
    ]);
    $teacherId = DB::table('teachers')->insertGetId([
        'employee_no' => 'T001', 'name' => '胡静', 'is_active' => true,
        'created_at' => $now, 'updated_at' => $now,
    ]);

    return [$semesterId, $teacherId];
}
