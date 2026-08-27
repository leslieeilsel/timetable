<?php

namespace App\Modules\Scheduling\Exceptions;

use RuntimeException;

class SchedulingFailureException extends RuntimeException
{
    /** @param array<string, mixed> $diagnostics */
    public function __construct(
        public readonly string $failureCode,
        string $message,
        public readonly array $diagnostics = [],
    ) {
        parent::__construct($message);
    }
}
