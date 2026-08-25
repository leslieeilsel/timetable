<?php

use App\Enums\LifecycleStatus;
use App\Enums\ResourceStatus;
use App\Enums\Role;
use App\Enums\RoomMode;
use App\Enums\RoomType;
use App\Enums\TaskStatus;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\AcademicYear;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\Course;
use App\Modules\Resources\Models\Grade;
use App\Modules\Resources\Models\Room;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use App\Modules\SemesterClassSetting\Models\SemesterClassSetting;
use App\Modules\TeachingTask\Models\TeachingTask;

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->admin = User::factory()->create([
        'role' => Role::Admin,
        'must_change_password' => false,
    ]);
    $this->actingAs($this->admin)->withSession(['auth_version' => $this->admin->auth_version]);
});

it('requires a fresh impact confirmation before deactivating a used resource', function (): void {
    $grade = Grade::query()->create(['name' => '一年级', 'sort_order' => 1, 'is_active' => true]);
    $teacher = Teacher::query()->create(['name' => '陈老师', 'is_active' => true]);
    $course = Course::query()->create(['name' => '语文', 'is_active' => true]);
    $room = Room::query()->create(['name' => '101 教室', 'type' => RoomType::Classroom, 'is_active' => true]);
    $year = AcademicYear::query()->create([
        'name' => '2026-2027 学年',
        'start_date' => '2026-09-01',
        'end_date' => '2027-07-15',
        'status' => LifecycleStatus::Open,
    ]);
    $semester = Semester::query()->create([
        'academic_year_id' => $year->id,
        'name' => '上学期',
        'sequence' => 1,
        'start_date' => '2026-09-01',
        'end_date' => '2027-01-20',
        'status' => LifecycleStatus::Open,
    ]);
    $class = SchoolClass::query()->create([
        'academic_year_id' => $year->id,
        'grade_id' => $grade->id,
        'name' => '一年级 1 班',
        'status' => ResourceStatus::Active,
    ]);
    SemesterClassSetting::query()->create([
        'semester_id' => $semester->id,
        'academic_year_id' => $year->id,
        'school_class_id' => $class->id,
        'fixed_room_id' => $room->id,
        'status' => ResourceStatus::Active,
    ]);
    TeachingTask::query()->create([
        'semester_id' => $semester->id,
        'academic_year_id' => $year->id,
        'school_class_id' => $class->id,
        'course_id' => $course->id,
        'teacher_id' => $teacher->id,
        'weekly_items' => 2,
        'room_mode' => RoomMode::ClassDefault,
        'status' => TaskStatus::Confirmed,
    ]);

    $etag = $this->getJson('/api/v1/grades')->assertOk()->headers->get('ETag');
    $warning = $this->withHeader('If-Match', $etag)->patchJson("/api/v1/grades/{$grade->id}", [
        'is_active' => false,
    ])->assertStatus(409)
        ->assertJsonPath('code', 'ACTIVE_RESOURCE_IN_USE')
        ->assertJsonPath('impacts.0.confirmed_tasks', 1)
        ->assertJsonPath('impacts.0.unplaced_items', 2);

    $this->withHeader('If-Match', $etag)->patchJson("/api/v1/grades/{$grade->id}", [
        'is_active' => false,
        'confirm_open_impact' => true,
        'impact_hash' => $warning->json('impact_hash'),
    ])->assertOk()
        ->assertJsonPath('data.is_active', false);
});
