<?php

namespace App\Enums;

enum ConstraintKind: string
{
    case Hard = 'hard';
    case Soft = 'soft';
}
