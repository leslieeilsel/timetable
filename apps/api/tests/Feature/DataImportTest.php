<?php

use App\Enums\Role;
use App\Models\User;
use App\Support\SimpleXlsxWriter;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/../Fixtures/DailyOperationsFixture.php';

beforeEach(function (): void {
    $this->withHeaders(['Origin' => 'http://localhost:5173', 'Referer' => 'http://localhost:5173/']);
    $this->staff = User::factory()->create(['role' => Role::Scheduler, 'must_change_password' => false]);
    $this->actingAs($this->staff)->withSession(['auth_version' => $this->staff->auth_version]);
    $this->fixture = dailyOperationsFixture($this->staff->id);
    $this->files = [];
});
afterEach(function (): void {
    foreach ($this->files as $path) {
        @unlink($path);
    }
});

function importExcel($test, string $kind, array $rows, array $extra = [])
{
    $path = (new SimpleXlsxWriter)->writeTable($rows);
    $test->files[] = $path;

    return $test->post('/api/v1/data-imports/'.$kind.'/preview', [
        'file' => new UploadedFile($path, '学校明细.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true),
        ...($kind === 'assignments' ? ['semester_id' => $test->fixture['semester_id']] : []), ...$extra,
    ], ['Accept' => 'application/json']);
}
function commitImport($test, string $kind, $preview)
{
    return $test->withHeader('If-Match', $preview->headers->get('ETag'))->postJson('/api/v1/data-imports/'.$kind.'/commit', ['token' => $preview->json('data.token')]);
}

it('imports real xlsx with mapped columns, distinct same-name staff and idempotent retries', function (): void {
    $rows = [['姓名', '编号', '学科'], ['同名教师', '001', '数学'], ['同名教师', '002', '数学']];
    $mapping = ['name' => 0, 'employee_no' => 1, 'courses' => 2];
    $preview = importExcel($this, 'teachers', $rows, ['mapping' => json_encode($mapping)])->assertOk()->assertJsonPath('data.summary.create', 2)->assertJsonPath('data.summary.errors', 0);
    expect(DB::table('teachers')->where('name', '同名教师')->count())->toBe(0);
    commitImport($this, 'teachers', $preview)->assertOk()->assertJsonPath('data.created', 2);
    commitImport($this, 'teachers', $preview)->assertOk()->assertJsonPath('data.created', 2);
    expect(DB::table('teachers')->where('name', '同名教师')->count())->toBe(2)
        ->and(DB::table('teachers')->where('employee_no', '001')->exists())->toBeTrue();
    $again = importExcel($this, 'teachers', $rows, ['mapping' => json_encode($mapping)])->assertOk()->assertJsonPath('data.summary.skip', 2);
    commitImport($this, 'teachers', $again)->assertOk()->assertJsonPath('data.created', 0);
});

it('rejects identity disagreement and duplicate rows without writing any valid row', function (): void {
    $preview = importExcel($this, 'teachers', [['教师工号', '教师姓名', '任教课程'], ['NEW', '新教师', '数学'], ['T001', '另一个人', '数学']])->assertOk()->assertJsonPath('data.summary.errors', 1);
    commitImport($this, 'teachers', $preview)->assertStatus(422);
    expect(DB::table('teachers')->where('employee_no', 'NEW')->exists())->toBeFalse();
    $duplicates = importExcel($this, 'teachers', [['教师工号', '教师姓名'], ['NEW', '新教师'], ['new', '新教师']])->assertOk()->assertJsonPath('data.summary.errors', 1);
    commitImport($this, 'teachers', $duplicates)->assertStatus(422);
});

it('requires fresh previews after concurrent writes and keeps preview tokens private', function (): void {
    $preview = importExcel($this, 'teachers', [['教师工号', '教师姓名'], ['NEW', '新教师']])->assertOk();
    DB::table('app_settings')->increment('catalog_revision');
    commitImport($this, 'teachers', $preview)->assertStatus(412);
    $other = User::factory()->create(['role' => Role::Scheduler, 'must_change_password' => false]);
    $this->actingAs($other)->withSession(['auth_version' => $other->auth_version]);
    commitImport($this, 'teachers', $preview)->assertNotFound();
    expect(DB::table('teachers')->where('employee_no', 'NEW')->exists())->toBeFalse();
});

it('imports draft assignments idempotently without changing published entries', function (): void {
    $rows = [['班级名称', '课程名称', '教师工号', '教师姓名', '每周课时', '周型', '指定教室'], ['七年级 1 班', '数学', 'T001', '胡静', '2', '每周', '']];
    $original = DB::table('timetable_entries')->get()->toJson();
    $preview = importExcel($this, 'assignments', $rows)->assertOk()->assertJsonPath('data.summary.create', 1)->assertJsonPath('data.summary.errors', 0);
    commitImport($this, 'assignments', $preview)->assertOk()->assertJsonPath('data.created', 1);
    $again = importExcel($this, 'assignments', $rows)->assertOk()->assertJsonPath('data.summary.skip', 1);
    commitImport($this, 'assignments', $again)->assertOk()->assertJsonPath('data.skipped', 1);
    $rows[1][4] = '3';
    $update = importExcel($this, 'assignments', $rows)->assertOk()->assertJsonPath('data.summary.update', 1);
    commitImport($this, 'assignments', $update)->assertOk()->assertJsonPath('data.updated', 1);
    expect(DB::table('teaching_assignments')->where('week_pattern', 'all')->count())->toBe(1)
        ->and(DB::table('teaching_assignments')->where('week_pattern', 'all')->value('weekly_items'))->toBe(3)
        ->and(DB::table('timetable_entries')->get()->toJson())->toBe($original);
    DB::table('teaching_assignments')->where('week_pattern', 'all')->update(['status' => 'confirmed']);
    $rows[1][4] = '4';
    $blocked = importExcel($this, 'assignments', $rows)->assertOk()->assertJsonPath('data.summary.errors', 1);
    commitImport($this, 'assignments', $blocked)->assertStatus(422);
    expect(DB::table('teaching_assignments')->where('week_pattern', 'all')->value('weekly_items'))->toBe(3);
});

it('reports missing dependencies and teacher ambiguity at the spreadsheet row', function (): void {
    $preview = importExcel($this, 'assignments', [['班级名称', '课程名称', '教师姓名', '每周课时'], ['不存在的班级', '未知课程', '胡静', '0']])->assertOk()->assertJsonPath('data.rows.0.row', 2)->assertJsonPath('data.summary.errors', 1);
    expect($preview->json('data.rows.0.errors'))->toHaveCount(5);
    commitImport($this, 'assignments', $preview)->assertStatus(422);
});

it('rejects formulas and merged cells instead of silently using cached values', function (string $extra): void {
    $path = (new SimpleXlsxWriter)->writeTable([['教师工号', '教师姓名'], ['NEW', '新教师']]);
    $this->files[] = $path;
    $zip = new ZipArchive;
    $zip->open($path);
    $sheet = $zip->getFromName('xl/worksheets/sheet1.xml');
    $zip->addFromString('xl/worksheets/sheet1.xml', str_replace('</worksheet>', $extra.'</worksheet>', $sheet));
    $zip->close();
    $this->post('/api/v1/data-imports/teachers/preview', ['file' => new UploadedFile($path, '学校.xlsx', null, null, true)], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonPath('code', 'IMPORT_COMPLEX_CELLS');
})->with(['<mergeCells><mergeCell ref="A1:B1"/></mergeCells>', '<f>1+1</f>']);
