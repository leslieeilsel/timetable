<?php

use App\Enums\Role;
use App\Models\User;
use Database\Seeders\MediumSchoolSeeder;
use Illuminate\Support\Facades\DB;

it('returns the compact counts needed by the dashboard', function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $user = User::factory()->create([
        'role' => Role::Scheduler,
        'must_change_password' => false,
    ]);
    $this->actingAs($user)->withSession(['auth_version' => $user->auth_version]);
    $this->seed(MediumSchoolSeeder::class);
    $semesterId = (int) DB::table('app_settings')->where('id', 1)->value('current_semester_id');

    $this->getJson("/api/v1/semesters/{$semesterId}/dashboard-summary")
        ->assertOk()
        ->assertJsonPath('data.class_count', 24)
        ->assertJsonPath('data.template_ready', true)
        ->assertJsonPath('data.assignment_count', 360)
        ->assertJsonPath('data.confirmed_count', 360)
        ->assertJsonPath('data.scheduled', 808)
        ->assertJsonPath('data.required', 808)
        ->assertJsonPath('data.remaining', 0)
        ->assertJsonPath('data.current_version_status', 'active')
        ->assertJsonPath('data.current_version_is_stale', false)
        ->assertJsonPath('data.working_draft_id', null);
});
