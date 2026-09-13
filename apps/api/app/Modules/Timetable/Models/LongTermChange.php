<?php

namespace App\Modules\Timetable\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $semester_id
 * @property Carbon $effective_from
 * @property Carbon $effective_to
 * @property Carbon|null $restored_from
 * @property string $reason
 * @property list<array<string, mixed>> $changes
 * @property list<array<string, mixed>> $segments
 * @property int $created_by
 */
class LongTermChange extends Model
{
    protected $guarded = ['id'];

    protected $hidden = ['segments', 'search_text'];

    protected function casts(): array
    {
        return [
            'effective_from' => 'date:Y-m-d', 'effective_to' => 'date:Y-m-d',
            'restored_from' => 'date:Y-m-d', 'changes' => 'array', 'segments' => 'array',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
