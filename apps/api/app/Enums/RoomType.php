<?php

namespace App\Enums;

enum RoomType: string
{
    case Classroom = 'classroom';
    case Playground = 'playground';
    case MusicRoom = 'music_room';
    case ArtRoom = 'art_room';
    case Laboratory = 'laboratory';
    case ComputerRoom = 'computer_room';
    case Other = 'other';
}
