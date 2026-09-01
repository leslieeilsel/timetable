<?php

use App\Enums\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
});

it('keeps draft timetable versions out of every viewer read path', function (): void {
    $creator = User::factory()->create([
        'role' => Role::Scheduler,
        'must_change_password' => false,
    ]);
    $viewer = User::factory()->create([
        'role' => Role::Viewer,
        'must_change_password' => false,
    ]);
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
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $roomId = DB::table('rooms')->insertGetId([
        'name' => '只读测试教室',
        'type' => 'classroom',
        'is_active' => true,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $activeId = DB::table('timetable_versions')->insertGetId([
        'semester_id' => $semesterId,
        'version_no' => 1,
        'name' => '当前正式版',
        'status' => 'active',
        'source' => 'manual',
        'created_by' => $creator->id,
        'input_revision' => 0,
        'catalog_revision' => 0,
        'activated_at' => $now,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    $draftId = DB::table('timetable_versions')->insertGetId([
        'semester_id' => $semesterId,
        'version_no' => 2,
        'name' => '未发布调整',
        'status' => 'draft',
        'source' => 'manual',
        'created_by' => $creator->id,
        'input_revision' => 0,
        'catalog_revision' => 0,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    DB::table('semesters')->where('id', $semesterId)->update([
        'current_timetable_version_id' => $activeId,
        'updated_at' => $now,
    ]);

    $this->actingAs($viewer)->withSession(['auth_version' => $viewer->auth_version]);

    $this->getJson("/api/v1/semesters/{$semesterId}")
        ->assertOk()
        ->assertJsonPath('data.current_timetable_version_id', $activeId);
    $this->getJson("/api/v1/semesters/{$semesterId}/timetable-versions?per_page=100")
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $activeId)
        ->assertJsonMissing(['id' => $draftId]);
    $this->getJson("/api/v1/semesters/{$semesterId}/timetable")
        ->assertOk()
        ->assertJsonPath('data.version.id', $activeId)
        ->assertJsonPath('data.version.status', 'active');

    $draftReadUrls = [
        "/api/v1/semesters/{$semesterId}/timetable?version_id={$draftId}",
        "/api/v1/semesters/{$semesterId}/teaching-assignments?version_id={$draftId}",
        "/api/v1/semesters/{$semesterId}/timetable/completeness?version_id={$draftId}",
        "/api/v1/semesters/{$semesterId}/timetable/validation?version_id={$draftId}",
        "/api/v1/semesters/{$semesterId}/timetable/export.csv?view=room&resource_id={$roomId}&version_id={$draftId}",
    ];
    foreach ($draftReadUrls as $url) {
        $this->getJson($url)
            ->assertNotFound()
            ->assertJsonPath('code', 'VERSION_NOT_PUBLISHED');
    }
    $this->postJson("/api/v1/semesters/{$semesterId}/timetable/export.zip", [
        'teacher_ids' => [],
        'class_ids' => [1],
        'version_id' => $draftId,
    ])->assertNotFound()->assertJsonPath('code', 'VERSION_NOT_PUBLISHED');

    $this->getJson(
        "/api/v1/semesters/{$semesterId}/timetable-versions/compare"
        ."?left_version_id={$activeId}&right_version_id={$draftId}",
    )->assertNotFound()->assertJsonPath('code', 'VERSION_NOT_PUBLISHED');
    $this->postJson("/api/v1/semesters/{$semesterId}/timetable/diagnose", [
        'teaching_assignment_id' => 1,
        'weekday' => 1,
        'item_id' => 1,
        'version_id' => $draftId,
    ])->assertNotFound()->assertJsonPath('code', 'VERSION_NOT_PUBLISHED');
    $this->postJson("/api/v1/semesters/{$semesterId}/timetable/swap/diagnose", [
        'entry_id' => 1,
        'target_entry_id' => 2,
        'version_id' => $draftId,
    ])->assertNotFound()->assertJsonPath('code', 'VERSION_NOT_PUBLISHED');
});
