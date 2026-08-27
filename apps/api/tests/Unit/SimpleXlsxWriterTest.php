<?php

namespace Tests\Unit;

use App\Support\SimpleXlsxWriter;
use ZipArchive;

it('creates a valid text-safe XLSX workbook', function (): void {
    $path = (new SimpleXlsxWriter)->write([
        ['学年', '2026-2027 学年'],
        [],
        ['课程', '教师'],
        ['=HYPERLINK("https://example.test")', '胡静'],
    ], '课表', 3);

    try {
        $archive = new ZipArchive;
        expect($archive->open($path))->toBeTrue();
        $sheet = $archive->getFromName('xl/worksheets/sheet1.xml');
        expect($sheet)->toBeString()
            ->and($sheet)->toContain('2026-2027 学年')
            ->and($sheet)->toContain('t="inlineStr"')
            ->and($sheet)->not->toContain('<f>');
        $archive->close();
    } finally {
        @unlink($path);
    }
});
