<?php

namespace App\Http\Middleware;

use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Symfony\Component\HttpFoundation\Cookie;

class PreventClientRequestForgery extends PreventRequestForgery
{
    protected function newCookie($request, $config)
    {
        return new Cookie(
            UseClientSession::xsrfCookieName($request),
            $request->session()->token(),
            $this->availableAt(60 * $config['lifetime']),
            $config['path'],
            $config['domain'],
            $config['secure'],
            false,
            false,
            $config['same_site'] ?? null,
            $config['partitioned'] ?? false
        );
    }
}
