<?php

namespace App\Modules\Audit\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * @property int $id
 * @property string $actor_type
 * @property int|null $actor_user_id
 * @property string $action
 * @property string $auditable_type
 * @property int|null $auditable_id
 * @property array<string, mixed>|null $before_data
 * @property array<string, mixed>|null $after_data
 * @property string $request_id
 */
class AuditLog extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'actor_type', 'actor_user_id', 'action', 'auditable_type', 'auditable_id',
        'before_data', 'after_data', 'request_id', 'created_at',
    ];

    protected function casts(): array
    {
        return ['before_data' => 'array', 'after_data' => 'array', 'created_at' => 'datetime'];
    }
}
