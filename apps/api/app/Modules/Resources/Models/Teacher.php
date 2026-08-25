<?php

namespace App\Modules\Resources\Models;

use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * @property int $id
 * @property string|null $employee_no
 * @property string $name
 * @property bool $is_active
 * @property-read Collection<int, Course> $courses
 */
class Teacher extends Model
{
    protected $fillable = ['employee_no', 'name', 'is_active'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    /** @return BelongsToMany<Course, $this> */
    public function courses(): BelongsToMany
    {
        return $this->belongsToMany(Course::class, 'teacher_course');
    }
}
