<?php

namespace App\Enums;

enum TeachingGroupMode: string
{
    case Combined = 'combined';
    case Split = 'split';
    case Roaming = 'roaming';
}
