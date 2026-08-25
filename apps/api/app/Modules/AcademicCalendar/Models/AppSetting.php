<?php

namespace App\Modules\AcademicCalendar\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int|null $current_semester_id
 * @property string $catalog_revision
 * @property string $timezone
 * @property-read Semester|null $currentSemester
 */
class AppSetting extends Model
{
    protected $fillable = ['current_semester_id', 'timezone'];

    protected function casts(): array
    {
        return ['catalog_revision' => 'string'];
    }

    /** @return BelongsTo<Semester, $this> */
    public function currentSemester(): BelongsTo
    {
        return $this->belongsTo(Semester::class, 'current_semester_id');
    }
}
