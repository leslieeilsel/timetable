<?php

namespace App\Enums;

enum CalendarExceptionType: string
{
    case Move = 'move';
    case Swap = 'swap';
    case TeacherChange = 'teacher_change';
    case RoomChange = 'room_change';
    case Cancel = 'cancel';
    // Retained only to read and withdraw historical records.
    case Makeup = 'makeup';
    case Activity = 'activity';
}
