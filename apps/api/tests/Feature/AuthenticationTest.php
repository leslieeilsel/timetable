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

    $etag = $this->getJson('/api/v1/users')->assertOk()->json('data.0.etag');

    $this->withHeader('If-Match', $etag)
        ->patchJson("/api/v1/users/{$admin->id}", ['is_active' => false])
        ->assertStatus(409)
        ->assertJsonPath('code', 'LAST_ADMIN_REQUIRED');
});

it('requires a resource version for user edits and password resets', function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $admin = User::factory()->create(['role' => Role::Admin, 'must_change_password' => false]);
    $target = User::factory()->create(['role' => Role::Viewer, 'must_change_password' => false]);
    $this->actingAs($admin)->withSession(['auth_version' => $admin->auth_version]);

    $this->patchJson("/api/v1/users/{$target->id}", ['name' => '新姓名'])
        ->assertStatus(428)
        ->assertJsonPath('code', 'USER_ETAG_REQUIRED');
    $this->postJson("/api/v1/users/{$target->id}/reset-password", [
        'temporary_password' => 'Temporary5678',
    ])->assertStatus(428)
        ->assertJsonPath('code', 'USER_ETAG_REQUIRED');
    $this->withHeader('If-Match', 'not-an-etag')
        ->patchJson("/api/v1/users/{$target->id}", ['name' => '新姓名'])
        ->assertBadRequest()
        ->assertJsonPath('code', 'INVALID_USER_ETAG');

    $snapshot = collect($this->getJson('/api/v1/users?per_page=100')->assertOk()->json('data'))
        ->firstWhere('id', $target->id);
    $reset = $this->withHeader('If-Match', $snapshot['etag'])
        ->postJson("/api/v1/users/{$target->id}/reset-password", [
            'temporary_password' => 'Temporary5678',
        ])->assertOk();
    expect($reset->json('data.etag'))->not->toBe($snapshot['etag'])
        ->and($reset->headers->get('ETag'))->toBe($reset->json('data.etag'))
        ->and(Hash::check('Temporary5678', $target->fresh()->password))->toBeTrue();
});

it('rejects stale full-form edits after another administrator removes access', function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $adminA = User::factory()->create(['role' => Role::Admin, 'must_change_password' => false]);
    $adminB = User::factory()->create(['role' => Role::Admin, 'must_change_password' => false]);

    foreach ([
        ['change' => ['is_active' => false], 'expected_role' => Role::Admin, 'expected_active' => false],
        ['change' => ['role' => Role::Viewer->value], 'expected_role' => Role::Viewer, 'expected_active' => true],
    ] as $scenario) {
        $target = User::factory()->create([
            'role' => Role::Admin,
            'is_active' => true,
            'must_change_password' => false,
        ]);

        $this->actingAs($adminB)->withSession(['auth_version' => $adminB->auth_version]);
        $snapshot = collect($this->getJson('/api/v1/users?per_page=100')->assertOk()->json('data'))
            ->firstWhere('id', $target->id);
        expect($snapshot['etag'])->toMatch('/^"user-\d+-[a-f0-9]{64}"$/');

        $this->actingAs($adminA)->withSession(['auth_version' => $adminA->auth_version]);
        $changed = $this->withHeader('If-Match', $snapshot['etag'])
            ->patchJson("/api/v1/users/{$target->id}", $scenario['change'])
            ->assertOk();
        expect($changed->json('data.etag'))->not->toBe($snapshot['etag']);
        expect($changed->headers->get('ETag'))->toBe($changed->json('data.etag'));

        $this->actingAs($adminB)->withSession(['auth_version' => $adminB->auth_version]);
        $this->withHeader('If-Match', $snapshot['etag'])
            ->patchJson("/api/v1/users/{$target->id}", [
                'name' => '旧表单中的姓名',
                'email' => $snapshot['email'],
                'role' => Role::Admin->value,
                'is_active' => true,
            ])->assertStatus(412)
            ->assertJsonPath('code', 'USER_ETAG_CONFLICT')
            ->assertJsonPath('current_etag', $changed->json('data.etag'));

        $target->refresh();
        expect($target->role)->toBe($scenario['expected_role'])
            ->and($target->is_active)->toBe($scenario['expected_active'])
            ->and($target->name)->not->toBe('旧表单中的姓名');
    }
});

it('rejects a stale password reset without changing the password', function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $adminA = User::factory()->create(['role' => Role::Admin, 'must_change_password' => false]);
    $adminB = User::factory()->create(['role' => Role::Admin, 'must_change_password' => false]);
    $target = User::factory()->create([
        'password' => 'OriginalPassword123',
        'role' => Role::Viewer,
        'must_change_password' => false,
    ]);

    $this->actingAs($adminB)->withSession(['auth_version' => $adminB->auth_version]);
    $snapshot = collect($this->getJson('/api/v1/users?per_page=100')->assertOk()->json('data'))
        ->firstWhere('id', $target->id);

    $this->actingAs($adminA)->withSession(['auth_version' => $adminA->auth_version]);
    $this->withHeader('If-Match', $snapshot['etag'])
        ->patchJson("/api/v1/users/{$target->id}", ['name' => '已由管理员 A 更新'])
        ->assertOk();

    $this->actingAs($adminB)->withSession(['auth_version' => $adminB->auth_version]);
    $this->withHeader('If-Match', $snapshot['etag'])
        ->postJson("/api/v1/users/{$target->id}/reset-password", [
            'temporary_password' => 'ReplacementPassword456',
        ])->assertStatus(412)
        ->assertJsonPath('code', 'USER_ETAG_CONFLICT');

    $target->refresh();
    expect(Hash::check('OriginalPassword123', $target->password))->toBeTrue()
        ->and($target->must_change_password)->toBeFalse();
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
