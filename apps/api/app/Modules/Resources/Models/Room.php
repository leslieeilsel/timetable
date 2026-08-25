<?php

namespace App\Modules\Resources\Models;

use App\Enums\RoomType;
use Illuminate\Database\Eloquent\Model;

/**
 * @property int $id
 * @property string $name
 * @property RoomType $type
 * @property bool $is_active
 */
class Room extends Model
{
    protected $fillable = ['name', 'type', 'is_active'];

    protected function casts(): array
    {
        return ['type' => RoomType::class, 'is_active' => 'boolean'];
    }
}
