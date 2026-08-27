<?php

namespace App\Enums;

enum WeekPattern: string
{
    case All = 'all';
    case A = 'a';
    case B = 'b';
    case Specified = 'specified';
}
