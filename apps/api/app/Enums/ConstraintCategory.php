<?php

namespace App\Enums;

enum ConstraintCategory: string
{
    case Availability = 'availability';
    case DailyLoad = 'daily_load';
    case WeeklyLoad = 'weekly_load';
    case ConsecutiveItems = 'consecutive_items';
    case CourseDistribution = 'course_distribution';
    case PreferredSlot = 'preferred_slot';
    case ForbiddenSlot = 'forbidden_slot';
    case RoomRequirement = 'room_requirement';
    case Spacing = 'spacing';
    case Synchronization = 'synchronization';
    case MutualExclusion = 'mutual_exclusion';
    case WorkloadBalance = 'workload_balance';
    case TeacherGaps = 'teacher_gaps';
    case CoursePriority = 'course_priority';
}
