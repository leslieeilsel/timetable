<?php

namespace App\Support;

use Normalizer as IntlNormalizer;

final class Normalizer
{
    public static function text(string $value): string
    {
        $normalized = IntlNormalizer::normalize(trim($value), IntlNormalizer::FORM_C);
        $normalized = preg_replace('/\s+/u', ' ', $normalized === false ? '' : $normalized);

        return trim((string) $normalized);
    }

    public static function optional(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $normalized = self::text($value);

        return $normalized === '' ? null : $normalized;
    }

    public static function email(string $value): string
    {
        return mb_strtolower(self::text($value));
    }

    public static function code(?string $value): ?string
    {
        $normalized = self::optional($value);

        return $normalized === null ? null : mb_strtoupper($normalized);
    }
}
