<?php

namespace App\Enums;

enum LifecycleStatus: string
{
    case Draft = 'draft';
    case Open = 'open';
    case Closed = 'closed';
}
