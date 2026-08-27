<?php

use App\Enums\LifecycleStatus;
use App\Enums\ResourceStatus;
use App\Enums\Role;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\AcademicYear;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Resources\Models\Course;
use App\Modules\Resources\Models\Grade;
use App\Modules\Resources\Models\SchoolClass;
use App\Modules\Resources\Models\Teacher;
use App\Modules\SemesterClassSetting\Models\SemesterClassSetting;
use App\Modules\TeachingAssignment\Models\TeachingGroup;
use Illuminate\Http\UploadedFile;

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->admin = User::factory()->create([
        'role' => Role::Admin,
        'must_change_password' => false,
    ]);
    $this->actingAs($this->admin)->withSession(['auth_version' => $this->admin->auth_version]);
});

it('paginates and filters growing catalog and user lists on the server', function (): void {
    $course = Course::query()->create(['name' => '测试课程', 'short_name' => '测试', 'is_active' => true]);

    foreach (range(1, 25) as $index) {
        $teacher = Teacher::query()->create([
            'employee_no' => sprintf('T%03d', $index),
            'name' => sprintf('测试教师%02d', $index),
            'is_active' => $index !== 25,
        ]);
        $teacher->courses()->attach($course->id);
    }

    $this->getJson("/api/v1/teachers?course_id={$course->id}&status=active&search=测试教师&sort=employee_no&direction=desc&page=2&per_page=20")
        ->assertOk()
        ->assertJsonPath('meta.pagination.page', 2)
        ->assertJsonPath('meta.pagination.per_page', 20)
        ->assertJsonPath('meta.pagination.total', 24)
        ->assertJsonCount(4, 'data')
        ->assertJsonPath('data.0.employee_no', 'T004');

    $this->getJson('/api/v1/teachers?per_page=10')
        ->assertUnprocessable()
        ->assertJsonValidationErrors('per_page');

    foreach (range(1, 25) as $index) {
        User::factory()->create([
            'name' => sprintf('测试用户%02d', $index),
            'email' => sprintf('viewer%02d@example.test', $index),
            'role' => Role::Viewer,
            'is_active' => $index !== 25,
        ]);
    }

    $this->getJson('/api/v1/users?role=viewer&status=active&search=测试用户&sort=name&direction=asc&page=2&per_page=20')
        ->assertOk()
        ->assertJsonPath('meta.pagination.total', 24)
        ->assertJsonCount(4, 'data')
        ->assertJsonPath('data.0.name', '测试用户21');
});

it('paginates classes, semester settings, and teaching groups without losing filters', function (): void {
    $grade = Grade::query()->create(['name' => '七年级', 'sort_order' => 7, 'is_active' => true]);
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

    $classes = collect(range(1, 25))->map(function (int $index) use ($grade, $semester, $year): SchoolClass {
        $class = SchoolClass::query()->create([
            'academic_year_id' => $year->id,
            'grade_id' => $grade->id,
            'name' => sprintf('七年级测试班%02d', $index),
            'code' => sprintf('G7C%02d', $index),
            'status' => ResourceStatus::Active,
        ]);
        SemesterClassSetting::query()->create([
            'semester_id' => $semester->id,
            'academic_year_id' => $year->id,
            'school_class_id' => $class->id,
            'status' => ResourceStatus::Active,
        ]);

        return $class;
    });

    $this->getJson("/api/v1/academic-years/{$year->id}/classes?grade_id={$grade->id}&status=active&search=测试班&page=2&per_page=20")
        ->assertOk()
        ->assertJsonPath('meta.pagination.total', 25)
        ->assertJsonCount(5, 'data')
        ->assertJsonPath('data.0.name', '七年级测试班21');

    $this->getJson("/api/v1/semesters/{$semester->id}/class-settings?grade_id={$grade->id}&status=active&search=测试班&page=2&per_page=20")
        ->assertOk()
        ->assertJsonPath('meta.summary.total', 25)
        ->assertJsonPath('meta.pagination.total', 25)
        ->assertJsonCount(5, 'data')
        ->assertJsonPath('data.0.school_class.name', '七年级测试班21');

    $targetClass = $classes->last();
    assert($targetClass instanceof SchoolClass);
    foreach (range(1, 21) as $index) {
        $group = TeachingGroup::query()->create([
            'semester_id' => $semester->id,
            'name' => sprintf('走班教学组%02d', $index),
            'mode' => 'roaming',
            'status' => ResourceStatus::Active,
        ]);
        $group->schoolClasses()->attach($targetClass->id);
    }

    $this->getJson("/api/v1/semesters/{$semester->id}/teaching-groups?search=测试班25&page=2&per_page=20")
        ->assertOk()
        ->assertJsonPath('meta.pagination.total', 21)
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.name', '走班教学组21');
});

it('pages large CSV previews on the server while preserving the cross-page selection set', function (): void {
    Grade::query()->create(['name' => '七年级', 'sort_order' => 7, 'is_active' => true]);
    $year = AcademicYear::query()->create([
        'name' => '2026-2027 学年',
        'start_date' => '2026-09-01',
        'end_date' => '2027-07-15',
        'status' => LifecycleStatus::Draft,
    ]);
    $lines = ['grade_name,class_name,class_code'];
    foreach (range(1, 25) as $index) {
        $lines[] = sprintf('七年级,七年级导入班%02d,IMPORT%02d', $index, $index);
    }

    $preview = $this->post("/api/v1/academic-years/{$year->id}/classes/import/preview", [
        'file' => UploadedFile::fake()->createWithContent('classes.csv', implode("\n", $lines)),
    ])->assertOk()
        ->assertJsonCount(20, 'data.rows')
        ->assertJsonCount(25, 'data.valid_rows')
        ->assertJsonPath('data.summary.total', 25)
        ->assertJsonPath('meta.pagination.last_page', 2);

    $token = $preview->json('data.token');
    $this->getJson("/api/v1/academic-years/{$year->id}/classes/import/preview?token={$token}&page=2&per_page=20")
        ->assertOk()
        ->assertJsonPath('meta.pagination.page', 2)
        ->assertJsonCount(5, 'data.rows')
        ->assertJsonPath('data.rows.0.row', 22);
});
