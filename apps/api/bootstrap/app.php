<?php

use App\Http\Middleware\AssignRequestId;
use App\Http\Middleware\EnsureSessionIsValid;
use App\Modules\Identity\Console\CreateAdminCommand;
use App\Support\ApiProblemException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->statefulApi();
        $middleware->append(AssignRequestId::class);
        $middleware->alias(['session.valid' => EnsureSessionIsValid::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
        $exceptions->render(function (ApiProblemException $exception, Request $request) {
            return response()->json(array_merge([
                'message' => $exception->getMessage(),
                'code' => $exception->problemCode,
                'request_id' => $request->attributes->get('request_id'),
            ], $exception->details), $exception->status);
        });
        $exceptions->render(function (ValidationException $exception, Request $request) {
            return response()->json([
                'message' => '请求数据校验失败',
                'code' => 'VALIDATION_FAILED',
                'errors' => $exception->errors(),
                'request_id' => $request->attributes->get('request_id'),
            ], 422);
        });
    })
    ->withCommands([CreateAdminCommand::class])
    ->create();
