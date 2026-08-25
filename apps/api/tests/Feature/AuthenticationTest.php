<?php

use App\Enums\Role;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

it('starts a session for the configured Vite development host', function (): void {
    $this->withHeaders(['Origin' => 'http://127.0.0.1:5173', 'Referer' => 'http://127.0.0.1:5173/']);
    $user = User::factory()->create([
        'email' => 'local-admin@example.test',
        'password' => 'Permanent5678',
        'role' => Role::Admin,
        'must_change_password' => false,
    ]);

    $this->postJson('/api/v1/auth/login', [
        'email' => 'local-admin@example.test',
        'password' => 'Permanent5678',
    ])->assertOk();

    $this->getJson('/api/v1/me')
        ->assertOk()
        ->assertJsonPath('data.id', $user->id);
});

it('requires a temporary password to be changed before using the workspace', function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $user = User::factory()->create([
        'email' => 'scheduler@example.test',
        'password' => 'Temporary1234',
        'role' => Role::Scheduler,
        'must_change_password' => true,
    ]);

    $this->postJson('/api/v1/auth/login', [
        'email' => ' Scheduler@Example.Test ',
        'password' => 'Temporary1234',
    ])->assertOk()
        ->assertJsonPath('data.must_change_password', true);

    $this->getJson('/api/v1/catalog')
        ->assertForbidden()
        ->assertJsonPath('code', 'PASSWORD_CHANGE_REQUIRED');

    $this->postJson('/api/v1/auth/change-password', [
        'current_password' => 'Temporary1234',
        'password' => 'Permanent5678',
        'password_confirmation' => 'Permanent5678',
    ])->assertOk()
        ->assertJsonPath('data.must_change_password', false);

    expect(Hash::check('Permanent5678', $user->fresh()->password))->toBeTrue();
    $this->getJson('/api/v1/catalog')->assertOk();
});

it('protects the last enabled administrator', function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $admin = User::factory()->create(['role' => Role::Admin, 'must_change_password' => false]);
    $this->actingAs($admin)->withSession(['auth_version' => $admin->auth_version]);

    $this->patchJson("/api/v1/users/{$admin->id}", ['is_active' => false])
        ->assertStatus(409)
        ->assertJsonPath('code', 'LAST_ADMIN_REQUIRED');
});

it('enforces the scheduler and viewer permission boundaries', function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $scheduler = User::factory()->create([
        'role' => Role::Scheduler,
        'must_change_password' => false,
    ]);
    $viewer = User::factory()->create([
        'role' => Role::Viewer,
        'must_change_password' => false,
    ]);

    $this->actingAs($viewer)->withSession(['auth_version' => $viewer->auth_version]);
    $catalogEtag = $this->getJson('/api/v1/catalog')->assertOk()->headers->get('ETag');
    $this->withHeader('If-Match', $catalogEtag)->postJson('/api/v1/grades', [
        'name' => '一年级',
        'sort_order' => 1,
    ])->assertForbidden()->assertJsonPath('code', 'FORBIDDEN');
    $this->getJson('/api/v1/users')->assertForbidden()->assertJsonPath('code', 'FORBIDDEN');

    $this->actingAs($scheduler)->withSession(['auth_version' => $scheduler->auth_version]);
    $catalogEtag = $this->getJson('/api/v1/catalog')->assertOk()->headers->get('ETag');
    $this->withHeader('If-Match', $catalogEtag)->postJson('/api/v1/grades', [
        'name' => '一年级',
        'sort_order' => 1,
    ])->assertCreated();
    $this->getJson('/api/v1/users')->assertForbidden()->assertJsonPath('code', 'FORBIDDEN');
    $this->patchJson('/api/v1/school-settings', ['timezone' => 'Asia/Shanghai'])
        ->assertForbidden()
        ->assertJsonPath('code', 'FORBIDDEN');
});
