<?php

namespace App\Support;

use RuntimeException;
use ZipArchive;

final class SimpleXlsxWriter
{
    /**
     * @param  list<list<bool|float|int|string|null>>  $rows
     */
    public function write(array $rows, string $sheetName = '课表', int $headerRow = 1): string
    {
        return $this->writePackage(
            $sheetName,
            $this->styles(),
            $this->worksheet($rows, $headerRow),
        );
    }

    /**
     * @param  array{
     *     title: string,
     *     headers: list<string>,
     *     rows: list<array{
     *         label: string,
     *         time: string,
     *         cells: list<list<array{title: string, detail: string}>>
     *     }>
     * }  $document
     */
    public function writeTimetable(array $document, string $sheetName = '课表'): string
    {
        $columnCount = max(1, count($document['headers']));
        $lastColumn = $this->columnName($columnCount);
        $lastRow = count($document['rows']) + 3;

        return $this->writePackage(
            $sheetName,
            $this->timetableStyles(),
            $this->timetableWorksheet($document),
            '$A$1:$'.$lastColumn.'$'.$lastRow,
            '$3:$3',
        );
    }

    private function writePackage(
        string $sheetName,
        string $styles,
        string $worksheet,
        ?string $printArea = null,
        ?string $printTitles = null,
    ): string {
        $path = tempnam(sys_get_temp_dir(), 'timetable-xlsx-');
        if ($path === false) {
            throw new RuntimeException('无法创建 XLSX 临时文件。');
        }

        $zip = new ZipArchive;
        $opened = $zip->open($path, ZipArchive::OVERWRITE);
        if ($opened !== true) {
            @unlink($path);
            throw new RuntimeException('无法创建 XLSX 压缩包。');
        }

        try {
            $zip->addFromString('[Content_Types].xml', $this->contentTypes());
            $zip->addFromString('_rels/.rels', $this->rootRelationships());
            $zip->addFromString('docProps/app.xml', $this->appProperties());
            $zip->addFromString('docProps/core.xml', $this->coreProperties());
            $zip->addFromString('xl/workbook.xml', $this->workbook($sheetName, $printArea, $printTitles));
            $zip->addFromString('xl/_rels/workbook.xml.rels', $this->workbookRelationships());
            $zip->addFromString('xl/styles.xml', $styles);
            $zip->addFromString('xl/worksheets/sheet1.xml', $worksheet);
        } finally {
            $zip->close();
        }

        return $path;
    }

    private function contentTypes(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>
XML;
    }

    private function rootRelationships(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>
XML;
    }

    private function appProperties(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>教务排课中心</Application><AppVersion>1.0</AppVersion></Properties>
XML;
    }

    private function coreProperties(): string
    {
        $createdAt = gmdate('Y-m-d\TH:i:s\Z');

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            .'<dc:creator>教务排课中心</dc:creator><cp:lastModifiedBy>教务排课中心</cp:lastModifiedBy>'
            .'<dcterms:created xsi:type="dcterms:W3CDTF">'.$createdAt.'</dcterms:created>'
            .'<dcterms:modified xsi:type="dcterms:W3CDTF">'.$createdAt.'</dcterms:modified></cp:coreProperties>';
    }

    private function workbook(
        string $sheetName,
        ?string $printArea = null,
        ?string $printTitles = null,
    ): string {
        $definedNames = '';
        if ($printArea !== null || $printTitles !== null) {
            $sheetReference = "'".str_replace("'", "''", $sheetName)."'";
            $definedNames = '<definedNames>';
            if ($printArea !== null) {
                $definedNames .= '<definedName name="_xlnm.Print_Area" localSheetId="0">'
                    .$this->xml($sheetReference.'!'.$printArea).'</definedName>';
            }
            if ($printTitles !== null) {
                $definedNames .= '<definedName name="_xlnm.Print_Titles" localSheetId="0">'
                    .$this->xml($sheetReference.'!'.$printTitles).'</definedName>';
            }
            $definedNames .= '</definedNames>';
        }

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            .'<sheets><sheet name="'.$this->xml($sheetName).'" sheetId="1" r:id="rId1"/></sheets>'
            .$definedNames.'</workbook>';
    }

    private function workbookRelationships(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>
XML;
    }

    private function styles(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>
XML;
    }

    private function timetableStyles(): string
    {
        $styles = <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="7"><font><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FF20231F"/><sz val="16"/><name val="Aptos"/></font><font><color rgb="FF666A63"/><sz val="9"/><name val="Aptos"/></font><font><b/><color rgb="FF20231F"/><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FF32352F"/><sz val="9.5"/><name val="Aptos"/></font><font><color rgb="FF73776F"/><sz val="8"/><name val="Aptos"/></font><font><color rgb="FF20231F"/><sz val="10"/><name val="Aptos"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9EBE7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F5F2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFAFAF8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF6F6F3"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD6D8D2"/></left><right style="thin"><color rgb="FFD6D8D2"/></right><top style="thin"><color rgb="FFD6D8D2"/></top><bottom style="thin"><color rgb="FFD6D8D2"/></bottom><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FFD6D8D2"/></top><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="5" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>
XML;

        return str_replace(
            '<name val="Aptos"/>',
            '<name val="Arial Unicode MS"/><charset val="134"/>',
            $styles,
        );
    }

    /**
     * @param  list<list<bool|float|int|string|null>>  $rows
     */
    private function worksheet(array $rows, int $headerRow): string
    {
        $columnCount = 1;
        foreach ($rows as $row) {
            $columnCount = max($columnCount, count($row));
        }
        $lastColumn = $this->columnName($columnCount);
        $lastRow = max(1, count($rows));
        $columns = '<cols><col min="1" max="1" width="16" customWidth="1"/>';
        if ($columnCount > 1) {
            $columns .= '<col min="2" max="'.$columnCount.'" width="22" customWidth="1"/>';
        }
        $columns .= '</cols>';
        $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            .'<dimension ref="A1:'.$lastColumn.$lastRow.'"/><sheetViews><sheetView workbookViewId="0">'
            .'<pane ySplit="'.$headerRow.'" topLeftCell="A'.($headerRow + 1).'" activePane="bottomLeft" state="frozen"/>'
            .'</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>'.$columns.'<sheetData>';

        foreach ($rows as $rowIndex => $row) {
            $number = $rowIndex + 1;
            $xml .= '<row r="'.$number.'">';
            foreach ($row as $columnIndex => $value) {
                $style = $number === $headerRow ? 2 : ($number < $headerRow && $columnIndex === 0 && $value !== '' ? 1 : 0);
                $reference = $this->columnName($columnIndex + 1).$number;
                $xml .= '<c r="'.$reference.'" t="inlineStr" s="'.$style.'"><is><t xml:space="preserve">'
                    .$this->xml((string) ($value ?? '')).'</t></is></c>';
            }
            $xml .= '</row>';
        }

        $xml .= '</sheetData>';
        if ($lastRow >= $headerRow && $columnCount >= 7) {
            $xml .= '<autoFilter ref="A'.$headerRow.':G'.$lastRow.'"/>';
        }

        return $xml.'</worksheet>';
    }

    /**
     * @param  array{
     *     title: string,
     *     headers: list<string>,
     *     rows: list<array{
     *         label: string,
     *         time: string,
     *         cells: list<list<array{title: string, detail: string}>>
     *     }>
     * }  $document
     */
    private function timetableWorksheet(array $document): string
    {
        $columnCount = max(1, count($document['headers']));
        $lastColumn = $this->columnName($columnCount);
        $bodyRowCount = count($document['rows']);
        $lastRow = max(3, $bodyRowCount + 3);
        $dayColumnWidth = match (true) {
            $columnCount <= 6 => 15,
            $columnCount === 7 => 12.5,
            default => 11,
        };
        $bodyRowHeight = match (true) {
            $bodyRowCount <= 8 => 60,
            $bodyRowCount <= 10 => 50,
            $bodyRowCount <= 12 => 42,
            default => 34,
        };
        $columns = '<cols><col min="1" max="1" width="12" customWidth="1"/>';
        if ($columnCount > 1) {
            $columns .= '<col min="2" max="'.$columnCount.'" width="'.$dayColumnWidth.'" customWidth="1"/>';
        }
        $columns .= '</cols>';
        $pane = $columnCount > 1
            ? '<pane xSplit="1" ySplit="3" topLeftCell="B4" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="B4" sqref="B4"/>'
            : '<pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A4" sqref="A4"/>';

        $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            .'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            .'<sheetPr><pageSetUpPr fitToPage="1" autoPageBreaks="0"/></sheetPr>'
            .'<dimension ref="A1:'.$lastColumn.$lastRow.'"/>'
            .'<sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="90" zoomScaleNormal="90">'
            .$pane.'</sheetView></sheetViews>'
            .'<sheetFormatPr defaultRowHeight="18"/>'.$columns.'<sheetData>'
            .'<row r="1" ht="32" customHeight="1">'.$this->inlineCell('A1', $document['title'], 1).'</row>'
            .'<row r="2" ht="9" customHeight="1"/>'
            .'<row r="3" ht="26" customHeight="1">';

        foreach ($document['headers'] as $columnIndex => $header) {
            $xml .= $this->inlineCell($this->columnName($columnIndex + 1).'3', $header, 4);
        }
        $xml .= '</row>';

        foreach ($document['rows'] as $rowIndex => $row) {
            $number = $rowIndex + 4;
            $maxEntries = 1;
            foreach ($row['cells'] as $entries) {
                $maxEntries = max($maxEntries, count($entries));
            }
            $height = min(82, $bodyRowHeight + (($maxEntries - 1) * 20));
            $bodyStyle = $rowIndex % 2 === 0 ? 6 : 7;
            $xml .= '<row r="'.$number.'" ht="'.$height.'" customHeight="1">'
                .$this->timetableLabelCell('A'.$number, $row['label'], $row['time']);
            for ($columnIndex = 1; $columnIndex < $columnCount; $columnIndex++) {
                $reference = $this->columnName($columnIndex + 1).$number;
                $xml .= $this->timetableEntriesCell(
                    $reference,
                    $row['cells'][$columnIndex - 1] ?? [],
                    $bodyStyle,
                );
            }
            $xml .= '</row>';
        }

        $xml .= '</sheetData>';

        if ($columnCount > 1) {
            $xml .= '<mergeCells count="1">'
                .'<mergeCell ref="A1:'.$lastColumn.'1"/>'
                .'</mergeCells>';
        }

        return $xml
            .'<printOptions horizontalCentered="1"/>'
            .'<pageMargins left="0.25" right="0.25" top="0.28" bottom="0.28" header="0.12" footer="0.12"/>'
            .'<pageSetup paperSize="9" orientation="portrait" pageOrder="overThenDown" fitToWidth="1" fitToHeight="1" horizontalDpi="600" verticalDpi="600"/>'
            .'</worksheet>';
    }

    private function inlineCell(string $reference, string $value, int $style): string
    {
        return '<c r="'.$reference.'" t="inlineStr" s="'.$style.'"><is><t xml:space="preserve">'
            .$this->xml($value).'</t></is></c>';
    }

    private function timetableLabelCell(string $reference, string $label, string $time): string
    {
        return '<c r="'.$reference.'" t="inlineStr" s="5"><is>'
            .$this->richTextRun($label, true, 'FF32352F', '9.5')
            .$this->richTextRun("\n".$time, false, 'FF73776F', '8')
            .'</is></c>';
    }

    /** @param list<array{title: string, detail: string}> $entries */
    private function timetableEntriesCell(string $reference, array $entries, int $style): string
    {
        if ($entries === []) {
            return $this->inlineCell($reference, '', $style);
        }

        $content = '';
        foreach ($entries as $index => $entry) {
            if ($index > 0) {
                $content .= $this->richTextRun("\n\n", false, 'FF8B8E87', '7');
            }
            $content .= $this->richTextRun($entry['title'], true, 'FF20231F', '10');
            if ($entry['detail'] !== '') {
                $content .= $this->richTextRun("\n".$entry['detail'], false, 'FF666A63', '8.5');
            }
        }

        return '<c r="'.$reference.'" t="inlineStr" s="'.$style.'"><is>'.$content.'</is></c>';
    }

    private function richTextRun(
        string $value,
        bool $bold,
        string $color,
        string $size,
    ): string {
        return '<r><rPr><rFont val="Arial Unicode MS"/><charset val="134"/>'.($bold ? '<b/>' : '')
            .'<color rgb="'.$color.'"/><sz val="'.$size.'"/></rPr>'
            .'<t xml:space="preserve">'.$this->xml($value).'</t></r>';
    }

    private function columnName(int $number): string
    {
        $name = '';
        while ($number > 0) {
            $number--;
            $name = chr(65 + ($number % 26)).$name;
            $number = intdiv($number, 26);
        }

        return $name;
    }

    private function xml(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }
}
