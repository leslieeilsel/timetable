<?php

namespace App\Enums;

enum ConstraintStatus: string
{
    case Draft = 'draft';
    case Active = 'active';
    case Inactive = 'inactive';
}
