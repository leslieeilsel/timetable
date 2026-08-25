<?php

namespace App\Modules\Audit\Services;

use App\Models\User;
use App\Modules\Audit\Models\AuditLog;
use Illuminate\Http\Request;

class AuditLogger
{
    /**
     * @param  array<string, mixed>|null  $before
     * @param  array<string, mixed>|null  $after
     */
    public function record(
        Request $request,
        ?User $actor,
        string $action,
        string $type,
        ?int $id,
        ?array $before = null,
        ?array $after = null,
    ): void {
        AuditLog::query()->create([
            'actor_type' => $actor === null ? 'system' : 'user',
            'actor_user_id' => $actor?->id,
            'action' => $action,
            'auditable_type' => $type,
            'auditable_id' => $id,
            'before_data' => $before,
            'after_data' => $after,
            'request_id' => (string) $request->attributes->get('request_id'),
            'created_at' => now(),
        ]);
    }
}
