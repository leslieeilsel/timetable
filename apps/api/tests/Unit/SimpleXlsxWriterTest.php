<?php

namespace Tests\Unit;

use App\Support\SimpleXlsxWriter;
use ZipArchive;

it('keeps formula-like timetable content as text and escapes XML characters', function (): void {
    $formula = '=HYPERLINK("https://example.test")';
    $detail = '胡静 & <教室>';
    $path = (new SimpleXlsxWriter)->writeTimetable([
        'title' => $formula,
        'headers' => ['课节 / 时间', '周一'],
        'rows' => [[
            'label' => '第1节',
            'time' => '08:00–08:45',
            'cells' => [[['title' => $formula, 'detail' => $detail]]],
        ]],
    ]);

    try {
        $archive = new ZipArchive;
        expect($archive->open($path))->toBeTrue();
        $sheet = $archive->getFromName('xl/worksheets/sheet1.xml');
        expect($sheet)->toBeString();
        $xml = simplexml_load_string($sheet);
        expect($xml)->not->toBeFalse();
        $xml->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
        expect($xml->xpath('//s:f'))->toBe([])
            ->and((string) $xml->xpath('//s:c[@r="A1"]/@t')[0])->toBe('inlineStr')
            ->and((string) $xml->xpath('//s:c[@r="A1"]/s:is/s:t')[0])->toBe($formula)
            ->and((string) $xml->xpath('//s:c[@r="B4"]/@t')[0])->toBe('inlineStr')
            ->and((string) $xml->xpath('//s:c[@r="B4"]/s:is/s:r[1]/s:t')[0])->toBe($formula)
            ->and((string) $xml->xpath('//s:c[@r="B4"]/s:is/s:r[2]/s:t')[0])->toBe("\n".$detail);
        $archive->close();
    } finally {
        @unlink($path);
    }
});
