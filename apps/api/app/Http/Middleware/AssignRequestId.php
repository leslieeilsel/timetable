<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class AssignRequestId
{
    public function handle(Request $request, Closure $next): Response
    {
        $incoming = $request->header('X-Request-ID');
        $requestId = is_string($incoming) && preg_match('/^[A-Za-z0-9_.:-]{1,80}$/', $incoming)
            ? $incoming
            : 'req_'.Str::ulid()->toBase32();
        $request->attributes->set('request_id', $requestId);
        $response = $next($request);
        $response->headers->set('X-Request-ID', $requestId);
        if ($request->is('api/*')) {
            $response->headers->set('Cache-Control', 'private, no-store');
        }

        return $response;
    }
}
