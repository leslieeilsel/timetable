<?php

namespace App\Enums;

enum OperationalStatus: string
{
    case Draft = 'draft';
    case Active = 'active';
    case Cancelled = 'cancelled';
}
