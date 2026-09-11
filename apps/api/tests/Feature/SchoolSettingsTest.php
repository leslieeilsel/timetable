<?php

use App\Enums\Role;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\AppSetting;
use Illuminate\Support\Facades\DB;

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
});

it('publishes only the system name without authentication', function (): void {
    $this->getJson('/api/v1/branding')->assertOk()->assertExactJson([
        'data' => ['system_name' => '教务排课中心', 'system_tagline' => null],
    ]);
    $this->getJson('/api/v1/school-settings')->assertUnauthorized();
});

it('persists the system name with concurrency protection and an audit record', function (): void {
    $admin = User::factory()->create(['role' => Role::Admin, 'must_change_password' => false]);
    $this->actingAs($admin)->withSession(['auth_version' => $admin->auth_version]);
    $etag = $this->getJson('/api/v1/school-settings')->assertOk()->headers->get('ETag');

    $updated = $this->withHeader('If-Match', $etag)->patchJson('/api/v1/school-settings', [
        'system_name' => '  第一中学教务中心  ',
    ])->assertOk()->assertJsonPath('data.system_name', '第一中学教务中心')
        ->assertJsonPath('data.timezone', 'Asia/Shanghai');

    expect($updated->headers->get('ETag'))->not->toBe($etag);
    $this->assertDatabaseHas('app_settings', ['id' => 1, 'system_name' => '第一中学教务中心']);
    $this->assertDatabaseHas('audit_logs', ['auditable_type' => 'school_settings', 'action' => 'update']);
    $this->getJson('/api/v1/branding')->assertJsonPath('data.system_name', '第一中学教务中心');
    $this->withHeader('If-Match', $etag)->patchJson('/api/v1/school-settings', [
        'system_name' => '过期的名称',
    ])->assertStatus(412);
    expect(AppSetting::query()->findOrFail(1)->system_name)->toBe('第一中学教务中心');
});

it('rejects invalid names and attempts to change the fixed timezone', function (array $payload): void {
    $admin = User::factory()->create(['role' => Role::Admin, 'must_change_password' => false]);
    $this->actingAs($admin)->withSession(['auth_version' => $admin->auth_version]);
    $etag = $this->getJson('/api/v1/school-settings')->assertOk()->headers->get('ETag');
    $this->withHeader('If-Match', $etag)->patchJson('/api/v1/school-settings', $payload)->assertUnprocessable();
    expect(AppSetting::query()->findOrFail(1)->system_name)->toBe('教务排课中心');
})->with([
    'empty' => [['system_name' => '   ']],
    'too long' => [['system_name' => str_repeat('名', 61)]],
    'timezone' => [['system_name' => '学校', 'timezone' => 'America/New_York']],
    'long tagline' => [['system_name' => '学校', 'system_tagline' => str_repeat('名', 61)]],
    'non-string tagline' => [['system_name' => '学校', 'system_tagline' => ['学校']]],
]);

it('uses China time even when a legacy setting contains another timezone', function (): void {
    DB::table('app_settings')->where('id', 1)->update(['timezone' => 'America/New_York']);
    expect(AppSetting::query()->findOrFail(1)->timezone)->toBe('Asia/Shanghai');
    $admin = User::factory()->create(['role' => Role::Admin, 'must_change_password' => false]);
    $this->actingAs($admin)->withSession(['auth_version' => $admin->auth_version]);
    $this->getJson('/api/v1/context')->assertOk()->assertJsonPath('data.timezone', 'Asia/Shanghai');
});

it('saves, preserves and clears the optional tagline', function (?string $emptyValue): void {
    $admin = User::factory()->create(['role' => Role::Admin, 'must_change_password' => false]);
    $this->actingAs($admin)->withSession(['auth_version' => $admin->auth_version]);
    $etag = $this->getJson('/api/v1/school-settings')->assertOk()->headers->get('ETag');
    $updated = $this->withHeader('If-Match', $etag)->patchJson('/api/v1/school-settings', [
        'system_name' => '教务排课中心',
        'system_tagline' => '  学校教务工作台  ',
    ])->assertOk()->assertJsonPath('data.system_tagline', '学校教务工作台');
    $this->getJson('/api/v1/branding')->assertJsonPath('data.system_tagline', '学校教务工作台');
    $this->assertDatabaseHas('app_settings', ['id' => 1, 'system_tagline' => '学校教务工作台']);

    $preserved = $this->withHeader('If-Match', $updated->headers->get('ETag'))->patchJson('/api/v1/school-settings', [
        'system_name' => '学校教务中心',
    ])->assertOk()->assertJsonPath('data.system_tagline', '学校教务工作台');

    $this->withHeader('If-Match', $preserved->headers->get('ETag'))->patchJson('/api/v1/school-settings', [
        'system_name' => '学校教务中心',
        'system_tagline' => $emptyValue,
    ])->assertOk()->assertJsonPath('data.system_tagline', null);
    $this->getJson('/api/v1/branding')->assertJsonPath('data.system_tagline', null);
    $this->assertDatabaseHas('app_settings', ['id' => 1, 'system_tagline' => null]);
})->with(['empty' => '', 'whitespace' => '   ', 'null' => null]);
