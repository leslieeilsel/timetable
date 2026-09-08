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

it('creates an A4 portrait timetable prepared for one-page printing', function (): void {
    $path = (new SimpleXlsxWriter)->writeTimetable([
        'title' => '一年级 1 班课表',
        'headers' => ['课节 / 时间', '周一', '周二', '周三', '周四', '周五'],
        'rows' => [
            [
                'label' => '第1节',
                'time' => '08:00–08:45',
                'cells' => [
                    [['title' => '数学（单周）', 'detail' => '']],
                    [],
                    [],
                    [],
                    [],
                ],
            ],
            [
                'label' => '第2节',
                'time' => '08:55–09:40',
                'cells' => [[], [], [], [], []],
            ],
        ],
    ]);

    try {
        $archive = new ZipArchive;
        expect($archive->open($path))->toBeTrue();
        $sheet = $archive->getFromName('xl/worksheets/sheet1.xml');
        $workbook = $archive->getFromName('xl/workbook.xml');
        $styles = $archive->getFromName('xl/styles.xml');
        expect($sheet)->toBeString()
            ->and($sheet)->toContain('一年级 1 班课表')
            ->and($sheet)->toContain('数学（单周）')
            ->and($sheet)->toContain('showGridLines="0"')
            ->and($sheet)->toContain('xSplit="1" ySplit="3"')
            ->and($sheet)->toContain('mergeCell ref="A1:F1"')
            ->and($sheet)->toContain('paperSize="9" orientation="portrait"')
            ->and($sheet)->toContain('fitToWidth="1" fitToHeight="1"')
            ->and($workbook)->toBeString()
            ->and($workbook)->toContain('_xlnm.Print_Area')
            ->and($workbook)->toContain('$A$1:$F$5')
            ->and($workbook)->toContain('_xlnm.Print_Titles')
            ->and($styles)->toBeString()
            ->and($styles)->toContain('FFE9EBE7');
        $archive->close();
    } finally {
        @unlink($path);
    }
});
