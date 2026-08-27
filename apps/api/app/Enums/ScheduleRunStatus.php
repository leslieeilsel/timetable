<?php

namespace App\Enums;

enum ScheduleRunStatus: string
{
    case Queued = 'queued';
    case Checking = 'checking';
    case Solving = 'solving';
    case Optimizing = 'optimizing';
    case BuildingCandidates = 'building_candidates';
    case Completed = 'completed';
    case Failed = 'failed';
    case Cancelled = 'cancelled';
}
