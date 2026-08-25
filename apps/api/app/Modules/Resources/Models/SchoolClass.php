<?php

namespace App\Modules\Resources\Models;

use App\Enums\ResourceStatus;
use App\Modules\AcademicCalendar\Models\AcademicYear;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $academic_year_id
 * @property int $grade_id
 * @property string $name
 * @property string|null $code
 * @property ResourceStatus $status
 * @property-read AcademicYear $academicYear
 * @property-read Grade $grade
 */
class SchoolClass extends Model
{
    protected $fillable = ['academic_year_id', 'grade_id', 'name', 'code', 'status'];

    protected function casts(): array
    {
        return ['status' => ResourceStatus::class];
    }

    /** @return BelongsTo<AcademicYear, $this> */
    public function academicYear(): BelongsTo
    {
        return $this->belongsTo(AcademicYear::class);
    }

    /** @return BelongsTo<Grade, $this> */
    public function grade(): BelongsTo
    {
        return $this->belongsTo(Grade::class);
    }
}
