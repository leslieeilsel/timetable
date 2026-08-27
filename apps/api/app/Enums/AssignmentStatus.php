<?php

namespace App\Enums;

enum AssignmentStatus: string
{
    case Draft = 'draft';
    case Confirmed = 'confirmed';
    case Inactive = 'inactive';
}
