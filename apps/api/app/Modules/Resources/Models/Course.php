<?php

namespace App\Modules\Resources\Models;

use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * @property int $id
 * @property string $name
 * @property string|null $short_name
 * @property bool $is_active
 * @property-read Collection<int, Teacher> $teachers
 */
class Course extends Model
{
    protected $fillable = ['name', 'short_name', 'is_active'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    /** @return BelongsToMany<Teacher, $this> */
    public function teachers(): BelongsToMany
    {
        return $this->belongsToMany(Teacher::class, 'teacher_course');
    }
}
