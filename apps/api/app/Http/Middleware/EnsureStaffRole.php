<?php

namespace App\Http\Middleware;

use App\Support\ApiProblemException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureStaffRole
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user()?->role->isStaff()) {
            throw new ApiProblemException('FORBIDDEN', '教师账号只能查看本人课表', 403);
        }

        return $next($request);
    }
}
