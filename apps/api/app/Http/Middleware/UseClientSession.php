<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class UseClientSession
{
    public const ADMIN = 'admin';

    public const TEACHER = 'teacher';

    public const HEADER = 'X-Timetable-Client';

    public function handle(Request $request, Closure $next): Response
    {
        $client = self::client($request);
        $cookieName = self::sessionCookieName($client);
        $clientChanged = config('session.cookie') !== $cookieName;

        $request->attributes->set('timetable_client', $client);
        config(['session.cookie' => $cookieName]);

        if ($clientChanged) {
            app('session')->forgetDrivers();
            app()->forgetInstance('session.store');
            Auth::forgetGuards();
        }

        return $next($request);
    }

    public static function client(Request $request): string
    {
        return strtolower(trim((string) $request->header(self::HEADER))) === self::TEACHER
            ? self::TEACHER
            : self::ADMIN;
    }

    public static function sessionCookieName(string $client): string
    {
        return (string) config(
            $client === self::TEACHER ? 'session.teacher_cookie' : 'session.admin_cookie'
        );
    }

    public static function xsrfCookieName(Request $request): string
    {
        return (string) config(
            self::client($request) === self::TEACHER
                ? 'session.teacher_xsrf_cookie'
                : 'session.admin_xsrf_cookie'
        );
    }
}
