<?php

namespace App\Modules\Scheduling\Models;

use App\Enums\ConstraintCategory;
use App\Enums\ConstraintKind;
use App\Enums\ConstraintStatus;
use App\Enums\ConstraintTargetType;
use App\Modules\AcademicCalendar\Models\Semester;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $semester_id
 * @property string $name
 * @property ConstraintKind $kind
 * @property ConstraintCategory $category
 * @property ConstraintTargetType|null $target_type
 * @property int|null $target_id
 * @property array<string, mixed> $scope
 * @property array<string, mixed>|null $condition
 * @property array<string, mixed> $requirement
 * @property int|null $weight
 * @property string $source
 * @property ConstraintStatus $status
 * @property string|null $explanation
 * @property-read Semester $semester
 */
class SchedulingConstraint extends Model
{
    protected $fillable = [
        'semester_id', 'name', 'kind', 'category', 'target_type', 'target_id', 'scope',
        'condition', 'requirement', 'weight', 'source', 'status', 'explanation',
    ];

    protected function casts(): array
    {
        return [
            'kind' => ConstraintKind::class,
            'category' => ConstraintCategory::class,
            'target_type' => ConstraintTargetType::class,
            'status' => ConstraintStatus::class,
            'scope' => 'array',
            'condition' => 'array',
            'requirement' => 'array',
            'weight' => 'integer',
        ];
    }

    /** @return BelongsTo<Semester, $this> */
    public function semester(): BelongsTo
    {
        return $this->belongsTo(Semester::class);
    }
}
