<?php

namespace App\Http\Middleware;

use App\Support\ApiProblemException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureSessionIsValid
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if ($user === null || ! $user->is_active || (int) $request->session()->get('auth_version', -1) !== $user->auth_version) {
            $request->session()->invalidate();
            throw new ApiProblemException('SESSION_REVOKED', '登录状态已失效，请重新登录', 401);
        }

        if ($user->must_change_password && ! in_array($request->route()?->getName(), ['me', 'auth.change-password', 'auth.logout'], true)) {
            throw new ApiProblemException('PASSWORD_CHANGE_REQUIRED', '请先修改临时密码', 403);
        }

        return $next($request);
    }
}
