<?php

use App\Enums\LifecycleStatus;
use App\Enums\ResourceStatus;
use App\Enums\Role;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\AcademicYear;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Audit\Models\AuditLog;
use App\Modules\Resources\Models\Grade;
use App\Modules\Resources\Models\SchoolClass;

it('requires an administrator for identity corrections after a semester is closed', function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $grade = Grade::query()->create(['name' => '一年级', 'sort_order' => 1, 'is_active' => true]);
    $year = AcademicYear::query()->create([
        'name' => '2025-2026 学年',
        'start_date' => '2025-09-01',
        'end_date' => '2026-07-15',
        'status' => LifecycleStatus::Open,
    ]);
    $schoolClass = SchoolClass::query()->create([
        'academic_year_id' => $year->id,
        'grade_id' => $grade->id,
        'name' => '一年级 1 班',
        'code' => 'G1C1',
        'status' => ResourceStatus::Active,
    ]);
    Semester::query()->create([
        'academic_year_id' => $year->id,
        'name' => '上学期',
        'sequence' => 1,
        'start_date' => '2025-09-01',
        'end_date' => '2026-01-31',
        'status' => LifecycleStatus::Closed,
    ]);

    $scheduler = User::factory()->create(['role' => Role::Scheduler, 'must_change_password' => false]);
    $this->actingAs($scheduler)->withSession(['auth_version' => $scheduler->auth_version]);
    $etag = $this->getJson('/api/v1/catalog')->headers->get('ETag');
    $this->withHeader('If-Match', $etag)
        ->patchJson("/api/v1/academic-years/{$year->id}/classes/{$schoolClass->id}", ['name' => '一年级一班'])
        ->assertForbidden()
        ->assertJsonPath('code', 'HISTORICAL_CORRECTION_ADMIN_REQUIRED');
    $this->withHeader('If-Match', $etag)
        ->patchJson("/api/v1/grades/{$grade->id}", ['name' => '小学一年级'])
        ->assertForbidden()
        ->assertJsonPath('code', 'HISTORICAL_CORRECTION_ADMIN_REQUIRED');

    $admin = User::factory()->create(['role' => Role::Admin, 'must_change_password' => false]);
    $this->actingAs($admin)->withSession(['auth_version' => $admin->auth_version]);
    $this->withHeader('If-Match', $etag)
        ->patchJson("/api/v1/academic-years/{$year->id}/classes/{$schoolClass->id}", ['name' => '一年级一班'])
        ->assertOk();

    expect(AuditLog::query()
        ->where('auditable_type', 'school_class')
        ->where('auditable_id', $schoolClass->id)
        ->where('action', 'historical_correction')
        ->exists())->toBeTrue();
});
