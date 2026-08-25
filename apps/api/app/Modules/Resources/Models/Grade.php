<?php

namespace App\Modules\Resources\Models;

use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property int $id
 * @property string $name
 * @property int $sort_order
 * @property bool $is_active
 * @property-read Collection<int, SchoolClass> $schoolClasses
 */
class Grade extends Model
{
    protected $fillable = ['name', 'sort_order', 'is_active'];

    protected function casts(): array
    {
        return ['sort_order' => 'integer', 'is_active' => 'boolean'];
    }

    /** @return HasMany<SchoolClass, $this> */
    public function schoolClasses(): HasMany
    {
        return $this->hasMany(SchoolClass::class);
    }
}
