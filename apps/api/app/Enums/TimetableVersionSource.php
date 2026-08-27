<?php

namespace App\Enums;

enum TimetableVersionSource: string
{
    case Manual = 'manual';
    case Candidate = 'candidate';
    case Restored = 'restored';
}
