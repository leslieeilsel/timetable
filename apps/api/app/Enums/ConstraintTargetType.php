<?php

namespace App\Enums;

enum ConstraintTargetType: string
{
    case Semester = 'semester';
    case Grade = 'grade';
    case SchoolClass = 'school_class';
    case Teacher = 'teacher';
    case Course = 'course';
    case Room = 'room';
    case TeachingAssignment = 'teaching_assignment';
    case TeachingGroup = 'teaching_group';
}
