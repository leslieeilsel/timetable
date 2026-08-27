<?php

namespace App\Enums;

enum TimetableVersionStatus: string
{
    case Draft = 'draft';
    case Active = 'active';
    case Historical = 'historical';
}
