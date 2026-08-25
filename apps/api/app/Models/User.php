<?php

namespace App\Models;

use App\Enums\Role;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

/**
 * @property int $id
 * @property string $name
 * @property string $email
 * @property string $password
 * @property Role $role
 * @property bool $is_active
 * @property bool $must_change_password
 * @property int $auth_version
 */
#[Fillable(['name', 'email', 'password', 'role', 'is_active', 'must_change_password', 'auth_version'])]
#[Hidden(['password', 'remember_token', 'auth_version'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'role' => Role::class,
            'is_active' => 'boolean',
            'must_change_password' => 'boolean',
            'auth_version' => 'integer',
        ];
    }
}
