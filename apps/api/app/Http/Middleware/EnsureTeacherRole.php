<?php

namespace App\Http\Middleware;

use App\Enums\Role;
use App\Support\ApiProblemException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureTeacherRole
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $teacher = $user?->teacher;
        if ($user?->role !== Role::Teacher || $teacher === null || ! $teacher->is_active) {
            throw new ApiProblemException('TEACHER_ACCOUNT_INVALID', '教师账号未绑定启用中的教师', 403);
        }

        return $next($request);
    }
}
