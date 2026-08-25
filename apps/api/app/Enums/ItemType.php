<?php

namespace App\Enums;

enum ItemType: string
{
    case Course = 'course';
    case FixedNonCourse = 'fixed_non_course';
    case SelfStudy = 'self_study';

    /** @return array{allows_course: bool, counts_as_course: bool, allows_teacher: bool, show_in_official: bool, show_in_full: bool} */
    public function defaults(): array
    {
        return match ($this) {
            self::Course => [
                'allows_course' => true,
                'counts_as_course' => true,
                'allows_teacher' => true,
                'show_in_official' => true,
                'show_in_full' => true,
            ],
            self::FixedNonCourse => [
                'allows_course' => false,
                'counts_as_course' => false,
                'allows_teacher' => false,
                'show_in_official' => false,
                'show_in_full' => true,
            ],
            self::SelfStudy => [
                'allows_course' => false,
                'counts_as_course' => false,
                'allows_teacher' => true,
                'show_in_official' => false,
                'show_in_full' => true,
            ],
        };
    }
}
