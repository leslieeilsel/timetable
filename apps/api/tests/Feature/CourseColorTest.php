<?php

use App\Enums\Role;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\Resources\Models\Course;
use App\Modules\Resources\Services\CoursePalette;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/../Fixtures/DailyOperationsFixture.php';

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->admin = User::factory()->create(['role' => Role::Admin, 'must_change_password' => false]);
    $this->actingAs($this->admin)->withSession(['auth_version' => $this->admin->auth_version]);
});

it('allocates unused colors before reusing the least occupied color', function (): void {
    $colors = [];
    foreach (range(1, count(CoursePalette::colors())) as $index) {
        $etag = $this->getJson('/api/v1/courses')->assertOk()->headers->get('ETag');
        $colors[] = $this->withHeader('If-Match', $etag)->postJson('/api/v1/courses', ['name' => '课程'.$index])
            ->assertCreated()->json('data.color');
    }
    expect(array_unique($colors))->toHaveCount(count(CoursePalette::colors()));
    Course::query()->create(['name' => '手动同色', 'color' => $colors[0]]);
    expect(CoursePalette::recommend())->toBe($colors[1]);
});

it('preserves color when a course is renamed and validates manual colors', function (): void {
    $course = Course::query()->create(['name' => '语文']);
    $etag = $this->getJson('/api/v1/courses')->headers->get('ETag');
    $renamed = $this->withHeader('If-Match', $etag)->patchJson('/api/v1/courses/'.$course->id, ['name' => '语文阅读'])
        ->assertOk()->assertJsonPath('data.color', $course->color);
    $etag = $renamed->headers->get('ETag');
    foreach (['red', '#FFFFFF', 'url(test)', null] as $invalid) {
        $this->withHeader('If-Match', $etag)->patchJson('/api/v1/courses/'.$course->id, ['color' => $invalid])
            ->assertUnprocessable()->assertJsonValidationErrors('color');
    }
    $this->withHeader('If-Match', $etag)->postJson('/api/v1/courses', ['name' => '自选同色课程', 'color' => $course->color])
        ->assertCreated()->assertJsonPath('data.color', $course->color);
});

it('changes appearance without invalidating scheduling revisions and rejects stale edits', function (): void {
    $fixture = dailyOperationsFixture($this->admin->id);
    $course = Course::query()->firstOrFail();
    $catalogRevision = AppSetting::query()->findOrFail(1)->catalog_revision;
    $semesterRevision = DB::table('semesters')->where('id', $fixture['semester_id'])->value('input_revision');
    $url = '/api/v1/semesters/'.$fixture['semester_id'].'/timetable';
    $semesterEtag = $this->getJson($url)->headers->get('ETag');
    $etag = $this->getJson('/api/v1/courses')->headers->get('ETag');
    $color = CoursePalette::colors()[4];
    $updated = $this->withHeader('If-Match', $etag)->patchJson('/api/v1/courses/'.$course->id, [
        'name' => $course->name, 'short_name' => $course->short_name, 'is_active' => true, 'color' => $color,
    ])->assertOk()->assertJsonPath('data.color', $color);

    expect($updated->headers->get('ETag'))->not->toBe($etag);
    expect(AppSetting::query()->findOrFail(1)->catalog_revision)->toBe($catalogRevision);
    expect(DB::table('semesters')->where('id', $fixture['semester_id'])->value('input_revision'))->toBe($semesterRevision);
    foreach (['class', 'teacher', 'room'] as $view) {
        $result = $this->getJson($url.'?view='.$view)->assertOk()->assertJsonPath('data.entries.0.course.color', $color);
        expect($result->headers->get('ETag'))->toBe($semesterEtag);
    }
    $this->withHeader('If-Match', $etag)->patchJson('/api/v1/courses/'.$course->id, ['color' => CoursePalette::colors()[5]])
        ->assertStatus(412)->assertJsonPath('code', 'CATALOG_ETAG_CONFLICT');
});

it('still advances the scheduling catalog revision when color and business data change together', function (): void {
    $course = Course::query()->create(['name' => '语文']);
    $revision = (int) AppSetting::query()->findOrFail(1)->catalog_revision;
    $etag = $this->getJson('/api/v1/courses')->headers->get('ETag');
    $this->withHeader('If-Match', $etag)->patchJson('/api/v1/courses/'.$course->id, [
        'name' => '语文阅读', 'color' => CoursePalette::colors()[2],
    ])->assertOk();
    expect((int) AppSetting::query()->findOrFail(1)->catalog_revision)->toBe($revision + 1);
});

it('backfills existing courses without changing their identities or scheduling revision', function (): void {
    $courses = collect(range(1, 5))->map(fn (int $i) => Course::query()->create(['name' => '既有课程'.$i]));
    $revision = AppSetting::query()->findOrFail(1)->catalog_revision;
    $migration = require database_path('migrations/2026_09_23_000100_add_course_colors.php');
    $migration->down();
    $migration->up();
    expect(Course::query()->pluck('id')->all())->toBe($courses->pluck('id')->all());
    expect(Course::query()->pluck('color')->unique())->toHaveCount(5);
    expect(AppSetting::query()->findOrFail(1)->catalog_revision)->toBe($revision);
});

it('does not let a viewer change course appearance', function (): void {
    $course = Course::query()->create(['name' => '语文']);
    $viewer = User::factory()->create(['role' => Role::Viewer, 'must_change_password' => false]);
    $this->actingAs($viewer)->withSession(['auth_version' => $viewer->auth_version]);
    $etag = $this->getJson('/api/v1/catalog')->headers->get('ETag');
    $this->withHeader('If-Match', $etag)->patchJson('/api/v1/courses/'.$course->id, ['color' => CoursePalette::colors()[2]])
        ->assertForbidden();
});
