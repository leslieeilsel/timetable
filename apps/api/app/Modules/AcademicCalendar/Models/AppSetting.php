<?php

namespace App\Modules\AcademicCalendar\Models;

use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int|null $current_semester_id
 * @property string $catalog_revision
 * @property string|null $system_tagline
 * @property string $system_name
 * @property string $timezone
 * @property-read Semester|null $currentSemester
 */
class AppSetting extends Model
{
    public const TIMEZONE = 'Asia/Shanghai';

    protected $fillable = ['current_semester_id', 'system_name', 'system_tagline'];

    /** @return Attribute<string, never> */
    protected function timezone(): Attribute
    {
        return Attribute::get(fn (): string => self::TIMEZONE);
    }

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
