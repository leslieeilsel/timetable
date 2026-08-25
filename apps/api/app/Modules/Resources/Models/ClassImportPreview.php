<?php

namespace App\Modules\Resources\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property string $token_hash
 * @property int $user_id
 * @property int $academic_year_id
 * @property int $catalog_revision
 * @property string $file_sha256
 * @property list<array<string, mixed>> $normalized_rows
 * @property Carbon $expires_at
 * @property Carbon|null $consumed_at
 * @property string|null $committed_selection_hash
 * @property array<string, mixed>|null $commit_result
 */
class ClassImportPreview extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'token_hash', 'user_id', 'academic_year_id', 'catalog_revision', 'file_sha256',
        'normalized_rows', 'expires_at', 'consumed_at', 'committed_selection_hash',
        'commit_result', 'created_at',
    ];

    protected function casts(): array
    {
        return [
            'normalized_rows' => 'array',
            'commit_result' => 'array',
            'expires_at' => 'datetime',
            'consumed_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }
}
