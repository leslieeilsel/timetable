<?php

namespace App\Enums;

enum TaskStatus: string
{
    case Draft = 'draft';
    case Confirmed = 'confirmed';
    case Inactive = 'inactive';
}
