<?php

namespace App\Enums;

enum Role: string
{
    case Admin = 'admin';
    case Scheduler = 'scheduler';
    case Viewer = 'viewer';
    case Teacher = 'teacher';

    public function canEdit(): bool
    {
        return in_array($this, [self::Admin, self::Scheduler], true);
    }

    public function isStaff(): bool
    {
        return in_array($this, [self::Admin, self::Scheduler, self::Viewer], true);
    }
}
