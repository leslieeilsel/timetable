<?php

namespace App\Support;

use RuntimeException;

class ApiProblemException extends RuntimeException
{
    /** @param array<string, mixed> $details */
    public function __construct(
        public readonly string $problemCode,
        string $message,
        public readonly int $status = 409,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }
}
