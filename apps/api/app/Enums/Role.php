<?php

namespace App\Enums;

enum Role: string
{
    case Admin = 'admin';
    case Scheduler = 'scheduler';
    case Viewer = 'viewer';

    public function canEdit(): bool
    {
        return $this !== self::Viewer;
    }
}
