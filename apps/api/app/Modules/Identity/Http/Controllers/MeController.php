<?php

namespace App\Modules\Identity\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MeController
{
    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user()->load('teacher:id,name,employee_no,is_active');

        return response()->json(['data' => [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role->value,
            'teacher' => $user->teacher?->only(['id', 'name', 'employee_no']),
            'is_active' => $user->is_active,
            'must_change_password' => $user->must_change_password,
        ]]);
    }
}
