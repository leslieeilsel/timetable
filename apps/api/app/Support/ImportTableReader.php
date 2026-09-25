<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use SimpleXMLElement;
use ZipArchive;

final class ImportTableReader
{
    /** @return list<array{row: int, values: list<string>}> */
    public function read(UploadedFile $file): array
    {
        if (strtolower($file->getClientOriginalExtension()) !== 'xlsx') {
            throw new ApiProblemException('IMPORT_FORMAT', '请选择 .xlsx 文件，首行为表头，每行一条明细；不支持合并单元格或公式。', 422);
        }
        $zip = new ZipArchive;
        if ($zip->open($file->getRealPath()) !== true) {
            throw new ApiProblemException('IMPORT_FORMAT', '无法读取 Excel 文件，请重新另存为 .xlsx。', 422);
        }
        try {
            $total = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $stat = $zip->statIndex($i);
                $total += $stat === false ? 0 : $stat['size'];
            }
            if ($total > 20_000_000 || $zip->numFiles > 200) {
                throw new ApiProblemException('IMPORT_SIZE', '解压后的文件过大，请按不超过 500 行拆分导入。', 422);
            }
            $workbook = $this->xml((string) $zip->getFromName('xl/workbook.xml'));
            $sheets = $workbook->xpath('//*[local-name()="sheet"]') ?: [];
            if (count($sheets) !== 1) {
                throw new ApiProblemException('IMPORT_SHEETS', '请保留一个明细工作表后导入，避免遗漏其他工作表。', 422);
            }
            $relationId = (string) $sheets[0]->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')['id'];
            $rels = $this->xml((string) $zip->getFromName('xl/_rels/workbook.xml.rels'));
            $target = '';
            foreach ($rels->children() as $rel) {
                if ((string) $rel['Id'] === $relationId && (string) $rel['TargetMode'] !== 'External') {
                    $target = (string) $rel['Target'];
                }
            }
            if ($target === '' || str_contains($target, '..')) {
                throw new ApiProblemException('IMPORT_FORMAT', '工作表引用无效，请重新另存文件。', 422);
            }
            $sheet = $this->xml((string) $zip->getFromName(str_starts_with($target, '/') ? ltrim($target, '/') : 'xl/'.$target));
            if ($sheet->xpath('//*[local-name()="mergeCell" or local-name()="f"]')) {
                throw new ApiProblemException('IMPORT_COMPLEX_CELLS', '文件包含合并单元格或公式，请取消合并并粘贴为值后重试。', 422);
            }
            $strings = [];
            $shared = $zip->getFromName('xl/sharedStrings.xml');
            if ($shared !== false) {
                foreach ($this->xml($shared)->xpath('//*[local-name()="si"]') ?: [] as $si) {
                    $strings[] = implode('', array_map(strval(...), $si->xpath('.//*[local-name()="t"]') ?: []));
                }
            }
            $rows = [];
            foreach ($sheet->xpath('//*[local-name()="sheetData"]/*[local-name()="row"]') ?: [] as $row) {
                $values = [];
                foreach ($row->children() as $cell) {
                    if (! preg_match('/^([A-Z]+)[0-9]+$/', (string) $cell['r'], $match)) {
                        throw new ApiProblemException('IMPORT_FORMAT', '单元格地址无效。', 422);
                    }
                    $column = 0;
                    foreach (str_split($match[1]) as $letter) {
                        $column = $column * 26 + ord($letter) - 64;
                    }
                    if ($column > 32) {
                        throw new ApiProblemException('IMPORT_COLUMNS', '最多支持 32 列，请移除多余内容。', 422);
                    }
                    while (count($values) < $column) {
                        $values[] = '';
                    }
                    $value = (string) $cell->v;
                    if ((string) $cell['t'] === 's') {
                        $value = $strings[(int) $value] ?? '';
                    } elseif ((string) $cell['t'] === 'inlineStr') {
                        $value = implode('', array_map(strval(...), $cell->xpath('.//*[local-name()="t"]') ?: []));
                    }
                    if (mb_strlen($value) > 1000) {
                        throw new ApiProblemException('IMPORT_CELL_SIZE', '单元格内容超过 1000 字，请检查明细格式。', 422);
                    }
                    $values[$column - 1] = Normalizer::text($value);
                }
                if (array_filter($values, fn ($value) => $value !== '') !== []) {
                    $rows[] = ['row' => (int) $row['r'], 'values' => $values];
                }
                if (count($rows) > 501) {
                    throw new ApiProblemException('IMPORT_ROWS', '一次最多导入 500 行，请拆分文件。', 422);
                }
            }
            if (count($rows) < 2) {
                throw new ApiProblemException('IMPORT_EMPTY', '文件需要一行表头和至少一行明细。', 422);
            }

            return $rows;
        } finally {
            $zip->close();
        }
    }

    private function xml(string $xml): SimpleXMLElement
    {
        if ($xml === '' || preg_match('/<!DOCTYPE|<!ENTITY/i', $xml)) {
            throw new ApiProblemException('IMPORT_XML', 'Excel 文件结构无效。', 422);
        }
        $previous = libxml_use_internal_errors(true);
        try {
            $result = simplexml_load_string($xml, SimpleXMLElement::class, LIBXML_NONET);
            if ($result === false) {
                throw new ApiProblemException('IMPORT_XML', 'Excel 文件结构无效。', 422);
            }

            return $result;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }
}
