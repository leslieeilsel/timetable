<?php

namespace App\Support;

use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use Illuminate\Http\Request;

class EtagService
{
    public function catalog(AppSetting $settings): string
    {
        return sprintf('"catalog-%s"', $settings->getRawOriginal('catalog_revision'));
    }

    public function semester(Semester $semester, AppSetting $settings): string
    {
        return sprintf(
            '"semester-%d-timetable-%s-catalog-%s"',
            $semester->id,
            $semester->getRawOriginal('timetable_revision'),
            $settings->getRawOriginal('catalog_revision'),
        );
    }

    public function assertCatalog(Request $request, AppSetting $settings): void
    {
        $actual = $request->header('If-Match');
        if ($actual === null) {
            throw new ApiProblemException('CATALOG_ETAG_REQUIRED', '缺少全局资料版本，请刷新后重试', 428);
        }
        if (! preg_match('/^"catalog-\d+"$/', $actual)) {
            throw new ApiProblemException('INVALID_CATALOG_ETAG', '全局资料版本格式无效', 400);
        }
        if (! hash_equals($this->catalog($settings), $actual)) {
            throw new ApiProblemException('CATALOG_ETAG_CONFLICT', '全局资料已被其他人修改，请刷新后重试', 412, [
                'current_etag' => $this->catalog($settings),
            ]);
        }
    }

    public function assertSemester(Request $request, Semester $semester, AppSetting $settings): void
    {
        $actual = $request->header('If-Match');
        if ($actual === null) {
            throw new ApiProblemException('SEMESTER_ETAG_REQUIRED', '缺少学期版本，请刷新后重试', 428);
        }
        if (! preg_match('/^"semester-\d+-timetable-\d+-catalog-\d+"$/', $actual)) {
            throw new ApiProblemException('INVALID_SEMESTER_ETAG', '学期版本格式无效', 400);
        }
        if (! hash_equals($this->semester($semester, $settings), $actual)) {
            throw new ApiProblemException('SEMESTER_ETAG_CONFLICT', '本学期数据已被其他人修改，请刷新后重试', 412, [
                'current_etag' => $this->semester($semester, $settings),
            ]);
        }
    }
}
