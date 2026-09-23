<?php

namespace App\Modules\Resources\Services;

use App\Modules\Resources\Models\Course;

class CoursePalette
{
    /** @return list<string> */
    public static function colors(): array
    {
        /** @var list<array{value: string, label: string}> $palette */
        $palette = json_decode(file_get_contents(base_path('../../contracts/course-colors.json')), true, flags: JSON_THROW_ON_ERROR);

        return array_column($palette, 'value');
    }

    public static function recommend(): string
    {
        $usage = Course::query()->where('is_active', true)->pluck('color')->countBy();
        $colors = self::colors();
        $recommended = $colors[0];
        foreach ($colors as $color) {
            if (($usage[$color] ?? 0) < ($usage[$recommended] ?? 0)) {
                $recommended = $color;
            }
        }

        return $recommended;
    }
}
