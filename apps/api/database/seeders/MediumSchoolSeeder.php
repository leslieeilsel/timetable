<?php

namespace Database\Seeders;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

class MediumSchoolSeeder extends Seeder
{
    private const CLASSES_PER_GRADE = 8;

    private const DATASET_REQUEST_PREFIX = 'seed-medium-school-';

    /** @var array<string, array<string, int>> */
    private array $gradeLoads = [
        '七年级' => [
            '语文' => 5, '数学' => 5, '英语' => 4, '道德与法治' => 2, '历史' => 2,
            '地理' => 2, '生物' => 2, '体育与健康' => 3, '音乐' => 1, '美术' => 1,
            '信息技术' => 1, '劳动教育' => 1, '综合实践活动' => 1, '心理健康' => 1,
            '班会' => 1, '校本课程' => 1,
        ],
        '八年级' => [
            '语文' => 5, '数学' => 5, '英语' => 4, '道德与法治' => 2, '历史' => 2,
            '地理' => 2, '生物' => 2, '物理' => 3, '体育与健康' => 3, '音乐' => 1,
            '美术' => 1, '信息技术' => 1, '劳动教育' => 1, '心理健康' => 1, '班会' => 1,
        ],
        '九年级' => [
            '语文' => 5, '数学' => 5, '英语' => 4, '道德与法治' => 2, '历史' => 2,
            '物理' => 4, '化学' => 3, '体育与健康' => 3, '音乐' => 1, '美术' => 1,
            '信息技术' => 1, '劳动教育' => 1, '心理健康' => 1, '班会' => 1,
        ],
    ];

    public function run(): void
    {
        DB::transaction(function (): void {
            $users = $this->seedUsers();
            $catalog = $this->seedCatalog();
            $calendar = $this->seedCalendar();
            $this->clearOwnedSemesterData($calendar['semester_ids']);

            $classes = $this->seedClasses($calendar['years'], $catalog['grade_ids']);
            $homeroomTeachers = array_slice($catalog['core_teacher_ids'], 0, 24);

            foreach ($calendar['semesters'] as $semester) {
                $semesterClasses = array_values(array_filter(
                    $classes,
                    fn (array $class): bool => $class['academic_year_id'] === $semester['academic_year_id'],
                ));
                $settings = $this->seedClassSettings(
                    $semester,
                    $semesterClasses,
                    $catalog['classroom_ids'],
                    $homeroomTeachers,
                    $catalog['course_ids']['班会'],
                );
                $courseItems = $this->seedScheduleTemplate($semester);
                $assignments = $this->seedTeachingAssignments(
                    $semester,
                    $semesterClasses,
                    $settings,
                    $catalog['course_ids'],
                    $catalog['teacher_pools'],
                    $catalog['room_pools'],
                );
                $constraintCount = $this->seedSchedulingConstraints($semester);
                DB::table('semesters')->where('id', $semester['id'])->update([
                    'assignment_revision' => count($assignments),
                    'constraint_revision' => $constraintCount,
                    'input_revision' => 1,
                    'updated_at' => now(),
                ]);

                if ($semester['status'] !== 'draft') {
                    $timetable = $this->seedTimetable(
                        $semester,
                        $assignments,
                        $courseItems,
                        $semester['status'] === 'closed',
                        $users['scheduler_id'],
                    );
                    DB::table('semesters')->where('id', $semester['id'])->update([
                        'current_timetable_version_id' => $timetable['version_id'],
                        'timetable_revision' => $timetable['entry_count'],
                        'updated_at' => now(),
                    ]);
                    if ($semester['status'] === 'open') {
                        $this->seedDailyOperations(
                            $semester,
                            $timetable['version_id'],
                            $courseItems,
                            $users['scheduler_id'],
                        );
                        DB::table('semesters')->where('id', $semester['id'])->increment('timetable_revision', 7, [
                            'updated_at' => now(),
                        ]);
                    }
                }
            }

            DB::table('app_settings')->where('id', 1)->update([
                'current_semester_id' => $calendar['current_semester_id'],
                'catalog_revision' => DB::raw('catalog_revision + 1'),
                'timezone' => 'Asia/Shanghai',
                'updated_at' => now(),
            ]);

            $this->seedAuditLogs(
                $users['admin_id'],
                $calendar['current_semester_id'],
                $calendar['current_year_id'],
                $classes,
                $catalog['course_ids'],
            );
        }, 3);

        $this->command?->info('中型初中演示数据已生成：2 个学年、48 个班级、4 个学期和 3 个完整课表。');
    }

    /** @return array{admin_id: int, scheduler_id: int, viewer_id: int} */
    private function seedUsers(): array
    {
        $users = [
            [
                'name' => '演示系统管理员', 'email' => 'demo-admin@example.test',
                'password' => 'DemoAdmin2026!', 'role' => 'admin', 'is_active' => true,
                'must_change_password' => false,
            ],
            [
                'name' => '演示排课员', 'email' => 'demo-scheduler@example.test',
                'password' => 'DemoScheduler2026!', 'role' => 'scheduler', 'is_active' => true,
                'must_change_password' => false,
            ],
            [
                'name' => '演示查看者', 'email' => 'demo-viewer@example.test',
                'password' => 'DemoViewer2026!', 'role' => 'viewer', 'is_active' => true,
                'must_change_password' => false,
            ],
            [
                'name' => '待改密排课员', 'email' => 'demo-temporary@example.test',
                'password' => 'Temporary2026!', 'role' => 'scheduler', 'is_active' => true,
                'must_change_password' => true,
            ],
            [
                'name' => '已停用查看者', 'email' => 'demo-inactive@example.test',
                'password' => 'InactiveViewer2026!', 'role' => 'viewer', 'is_active' => false,
                'must_change_password' => false,
            ],
        ];

        foreach ($users as $data) {
            User::query()->updateOrCreate(
                ['email' => $data['email']],
                [
                    'name' => $data['name'],
                    'password' => Hash::make($data['password']),
                    'role' => $data['role'],
                    'is_active' => $data['is_active'],
                    'must_change_password' => $data['must_change_password'],
                ],
            );
        }

        return [
            'admin_id' => $this->idBy('users', 'email', 'demo-admin@example.test'),
            'scheduler_id' => $this->idBy('users', 'email', 'demo-scheduler@example.test'),
            'viewer_id' => $this->idBy('users', 'email', 'demo-viewer@example.test'),
        ];
    }

    /**
     * @return array{
     *     grade_ids: array<string, int>,
     *     course_ids: array<string, int>,
     *     teacher_pools: array<string, list<array{id: int, pool_index: int}>>,
     *     core_teacher_ids: list<int>,
     *     classroom_ids: list<int>,
     *     room_pools: array<string, list<int>>
     * }
     */
    private function seedCatalog(): array
    {
        $timestamp = now();
        $grades = [
            ['name' => '七年级', 'sort_order' => 7],
            ['name' => '八年级', 'sort_order' => 8],
            ['name' => '九年级', 'sort_order' => 9],
        ];
        foreach ($grades as $grade) {
            DB::table('grades')->updateOrInsert(
                ['name' => $grade['name']],
                ['sort_order' => $grade['sort_order'], 'is_active' => true, 'updated_at' => $timestamp, 'created_at' => $timestamp],
            );
        }
        $gradeIds = $this->idsByName('grades', array_column($grades, 'name'));

        $courses = [
            ['name' => '语文', 'short_name' => '语'], ['name' => '数学', 'short_name' => '数'],
            ['name' => '英语', 'short_name' => '英'], ['name' => '道德与法治', 'short_name' => '道法'],
            ['name' => '历史', 'short_name' => '史'], ['name' => '地理', 'short_name' => '地'],
            ['name' => '生物', 'short_name' => '生'], ['name' => '物理', 'short_name' => '物'],
            ['name' => '化学', 'short_name' => '化'], ['name' => '体育与健康', 'short_name' => '体育'],
            ['name' => '音乐', 'short_name' => '音'], ['name' => '美术', 'short_name' => '美'],
            ['name' => '信息技术', 'short_name' => '信息'], ['name' => '劳动教育', 'short_name' => '劳动'],
            ['name' => '综合实践活动', 'short_name' => '综实'], ['name' => '心理健康', 'short_name' => '心理'],
            ['name' => '班会', 'short_name' => '班会'], ['name' => '校本课程', 'short_name' => '校本'],
        ];
        foreach ($courses as $course) {
            DB::table('courses')->updateOrInsert(
                ['name' => $course['name']],
                ['short_name' => $course['short_name'], 'is_active' => true, 'updated_at' => $timestamp, 'created_at' => $timestamp],
            );
        }
        DB::table('courses')->updateOrInsert(
            ['name' => '书法（已停用）'],
            ['short_name' => '书法', 'is_active' => false, 'updated_at' => $timestamp, 'created_at' => $timestamp],
        );
        $courseIds = $this->idsByName('courses', array_column($courses, 'name'));

        $teacherCounts = [
            '语文' => 12, '数学' => 12, '英语' => 12, '道德与法治' => 4, '历史' => 4,
            '地理' => 3, '生物' => 3, '物理' => 4, '化学' => 3, '体育与健康' => 6,
            '音乐' => 3, '美术' => 3, '信息技术' => 3, '劳动教育' => 2,
            '综合实践活动' => 2, '心理健康' => 2, '校本课程' => 2,
        ];
        $surnames = ['王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周', '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗'];
        $givenNames = ['静', '伟', '敏', '磊', '芳', '涛', '晓梅', '志强', '文博', '雅琴'];
        $teacherPools = [];
        $coreTeacherIds = [];
        $teacherNumber = 1;
        foreach ($teacherCounts as $courseName => $count) {
            $teacherPools[$courseName] = [];
            for ($poolIndex = 0; $poolIndex < $count; $poolIndex++) {
                $nameIndex = $teacherNumber - 1;
                $teacherName = $surnames[$nameIndex % count($surnames)].$givenNames[intdiv($nameIndex, count($surnames)) % count($givenNames)];
                $employeeNo = sprintf('DEMO-JS%03d', $teacherNumber);
                DB::table('teachers')->updateOrInsert(
                    ['employee_no' => $employeeNo],
                    ['name' => $teacherName, 'is_active' => true, 'updated_at' => $timestamp, 'created_at' => $timestamp],
                );
                $teacherId = $this->idBy('teachers', 'employee_no', $employeeNo);
                DB::table('teacher_course')->insertOrIgnore([
                    'teacher_id' => $teacherId,
                    'course_id' => $courseIds[$courseName],
                ]);
                $teacherPools[$courseName][] = ['id' => $teacherId, 'pool_index' => $poolIndex];
                if (in_array($courseName, ['语文', '数学', '英语'], true)) {
                    $coreTeacherIds[] = $teacherId;
                }
                $teacherNumber++;
            }
        }
        DB::table('teachers')->updateOrInsert(
            ['employee_no' => 'DEMO-JS999'],
            ['name' => '周建国（已退休）', 'is_active' => false, 'updated_at' => $timestamp, 'created_at' => $timestamp],
        );

        [$classroomIds, $roomPools] = $this->seedRooms($timestamp);

        return [
            'grade_ids' => $gradeIds,
            'course_ids' => $courseIds,
            'teacher_pools' => $teacherPools,
            'core_teacher_ids' => $coreTeacherIds,
            'classroom_ids' => $classroomIds,
            'room_pools' => $roomPools,
        ];
    }

    /** @return array{0: list<int>, 1: array<string, list<int>>} */
    private function seedRooms(mixed $timestamp): array
    {
        $classroomNames = [];
        $buildings = ['博学楼', '明德楼', '致远楼'];
        foreach ($buildings as $buildingIndex => $building) {
            for ($section = 1; $section <= self::CLASSES_PER_GRADE; $section++) {
                $floor = intdiv($section - 1, 4) + 1;
                $room = $floor * 100 + (($section - 1) % 4) + 1;
                $classroomNames[] = $building.$room.'教室';
            }
        }

        $specialRooms = [
            '体育与健康' => [
                ['风雨操场', 'playground'], ['田径场 A 区', 'playground'], ['田径场 B 区', 'playground'],
                ['篮球场 A 区', 'playground'], ['篮球场 B 区', 'playground'], ['体育馆', 'playground'],
            ],
            '音乐' => [['音乐教室 1', 'music_room'], ['音乐教室 2', 'music_room'], ['合唱教室', 'music_room']],
            '美术' => [['美术教室 1', 'art_room'], ['美术教室 2', 'art_room'], ['陶艺教室', 'art_room']],
            '信息技术' => [['计算机教室 1', 'computer_room'], ['计算机教室 2', 'computer_room'], ['计算机教室 3', 'computer_room']],
            '生物' => [['生物实验室 1', 'laboratory'], ['生物实验室 2', 'laboratory'], ['生物实验室 3', 'laboratory']],
            '物理' => [['物理实验室 1', 'laboratory'], ['物理实验室 2', 'laboratory'], ['物理实验室 3', 'laboratory'], ['物理实验室 4', 'laboratory']],
            '化学' => [['化学实验室 1', 'laboratory'], ['化学实验室 2', 'laboratory'], ['化学实验室 3', 'laboratory']],
            '劳动教育' => [['劳动实践室 1', 'other'], ['劳动实践室 2', 'other']],
            '综合实践活动' => [['创客空间 1', 'other'], ['创客空间 2', 'other']],
            '心理健康' => [['心理团辅室 1', 'other'], ['心理团辅室 2', 'other']],
        ];

        foreach ($classroomNames as $name) {
            DB::table('rooms')->updateOrInsert(
                ['name' => $name],
                ['type' => 'classroom', 'is_active' => true, 'updated_at' => $timestamp, 'created_at' => $timestamp],
            );
        }
        $classroomIds = array_map(fn (string $name): int => $this->idBy('rooms', 'name', $name), $classroomNames);

        $roomPools = [];
        foreach ($specialRooms as $courseName => $rooms) {
            $roomPools[$courseName] = [];
            foreach ($rooms as [$name, $type]) {
                DB::table('rooms')->updateOrInsert(
                    ['name' => $name],
                    ['type' => $type, 'is_active' => true, 'updated_at' => $timestamp, 'created_at' => $timestamp],
                );
                $roomPools[$courseName][] = $this->idBy('rooms', 'name', $name);
            }
        }

        foreach ([['图书馆', 'other'], ['报告厅', 'other'], ['录播教室', 'other']] as [$name, $type]) {
            DB::table('rooms')->updateOrInsert(
                ['name' => $name],
                ['type' => $type, 'is_active' => true, 'updated_at' => $timestamp, 'created_at' => $timestamp],
            );
        }
        DB::table('rooms')->updateOrInsert(
            ['name' => '旧阶梯教室（已停用）'],
            ['type' => 'other', 'is_active' => false, 'updated_at' => $timestamp, 'created_at' => $timestamp],
        );

        return [$classroomIds, $roomPools];
    }

    /**
     * @return array{
     *     years: list<array{id: int, name: string, code_year: int}>,
     *     semesters: list<array{id: int, academic_year_id: int, academic_year_name: string, sequence: int, name: string, status: string}>,
     *     semester_ids: list<int>, current_semester_id: int, current_year_id: int
     * }
     */
    private function seedCalendar(): array
    {
        $yearDefinitions = [
            [
                'name' => '2025-2026 学年（演示历史）', 'code_year' => 2025,
                'start_date' => '2025-09-01', 'end_date' => '2026-07-10', 'status' => 'closed',
                'semesters' => [
                    ['sequence' => 1, 'name' => '上学期', 'start_date' => '2025-09-01', 'end_date' => '2026-01-30', 'status' => 'closed'],
                    ['sequence' => 2, 'name' => '下学期', 'start_date' => '2026-02-23', 'end_date' => '2026-07-10', 'status' => 'closed'],
                ],
            ],
            [
                'name' => '2026-2027 学年（演示当前）', 'code_year' => 2026,
                'start_date' => '2026-09-01', 'end_date' => '2027-07-09', 'status' => 'open',
                'semesters' => [
                    ['sequence' => 1, 'name' => '上学期', 'start_date' => '2026-09-01', 'end_date' => '2027-01-29', 'status' => 'open'],
                    ['sequence' => 2, 'name' => '下学期', 'start_date' => '2027-02-22', 'end_date' => '2027-07-09', 'status' => 'draft'],
                ],
            ],
        ];
        $timestamp = now();
        $years = [];
        $semesters = [];
        $currentSemesterId = 0;
        $currentYearId = 0;

        foreach ($yearDefinitions as $definition) {
            DB::table('academic_years')->updateOrInsert(
                ['name' => $definition['name']],
                [
                    'start_date' => $definition['start_date'], 'end_date' => $definition['end_date'],
                    'status' => $definition['status'], 'updated_at' => $timestamp, 'created_at' => $timestamp,
                ],
            );
            $yearId = $this->idBy('academic_years', 'name', $definition['name']);
            $years[] = ['id' => $yearId, 'name' => $definition['name'], 'code_year' => $definition['code_year']];
            if ($definition['code_year'] === 2026) {
                $currentYearId = $yearId;
            }

            foreach ($definition['semesters'] as $semesterDefinition) {
                DB::table('semesters')->updateOrInsert(
                    ['academic_year_id' => $yearId, 'sequence' => $semesterDefinition['sequence']],
                    [
                        'name' => $semesterDefinition['name'], 'start_date' => $semesterDefinition['start_date'],
                        'end_date' => $semesterDefinition['end_date'], 'status' => $semesterDefinition['status'],
                        'timetable_revision' => 0, 'input_revision' => 0, 'assignment_revision' => 0,
                        'constraint_revision' => 0, 'updated_at' => $timestamp, 'created_at' => $timestamp,
                    ],
                );
                $semesterId = (int) DB::table('semesters')
                    ->where('academic_year_id', $yearId)
                    ->where('sequence', $semesterDefinition['sequence'])
                    ->value('id');
                $semesters[] = [
                    'id' => $semesterId, 'academic_year_id' => $yearId,
                    'academic_year_name' => $definition['name'], 'sequence' => $semesterDefinition['sequence'],
                    'name' => $semesterDefinition['name'], 'status' => $semesterDefinition['status'],
                ];
                if ($definition['code_year'] === 2026 && $semesterDefinition['sequence'] === 1) {
                    $currentSemesterId = $semesterId;
                }
            }
        }

        return [
            'years' => $years,
            'semesters' => $semesters,
            'semester_ids' => array_column($semesters, 'id'),
            'current_semester_id' => $currentSemesterId,
            'current_year_id' => $currentYearId,
        ];
    }

    /** @param list<int> $semesterIds */
    private function clearOwnedSemesterData(array $semesterIds): void
    {
        $entryIds = DB::table('timetable_entries')->whereIn('semester_id', $semesterIds)->pluck('id');
        $leaveIds = DB::table('teacher_leaves')->whereIn('semester_id', $semesterIds)->pluck('id');
        $exceptionIds = DB::table('calendar_exceptions')->whereIn('semester_id', $semesterIds)->pluck('id');
        DB::table('substitutions')->where(function ($query) use ($entryIds, $leaveIds, $exceptionIds): void {
            $query->whereIn('original_entry_id', $entryIds)
                ->orWhereIn('teacher_leave_id', $leaveIds)
                ->orWhereIn('calendar_exception_id', $exceptionIds);
        })
            ->delete();
        DB::table('teacher_leaves')->whereIn('semester_id', $semesterIds)->delete();
        DB::table('calendar_exceptions')->whereIn('semester_id', $semesterIds)->delete();
        DB::table('timetable_entries')->whereIn('semester_id', $semesterIds)->delete();
        DB::table('semesters')->whereIn('id', $semesterIds)->update(['current_timetable_version_id' => null]);
        DB::table('timetable_versions')->whereIn('semester_id', $semesterIds)->delete();
        $runIds = DB::table('schedule_runs')->whereIn('semester_id', $semesterIds)->pluck('id');
        $candidateIds = DB::table('schedule_candidates')->whereIn('schedule_run_id', $runIds)->pluck('id');
        DB::table('schedule_candidate_entries')->whereIn('schedule_candidate_id', $candidateIds)->delete();
        DB::table('schedule_candidates')->whereIn('schedule_run_id', $runIds)->delete();
        DB::table('schedule_runs')->whereIn('id', $runIds)->delete();
        DB::table('fixed_placements')->whereIn('semester_id', $semesterIds)->delete();
        DB::table('scheduling_constraints')->whereIn('semester_id', $semesterIds)->delete();
        $assignmentIds = DB::table('teaching_assignments')->whereIn('semester_id', $semesterIds)->pluck('id');
        DB::table('teaching_assignment_collaborators')->whereIn('teaching_assignment_id', $assignmentIds)->delete();
        DB::table('teaching_assignments')->whereIn('semester_id', $semesterIds)->delete();
        $groupIds = DB::table('teaching_groups')->whereIn('semester_id', $semesterIds)->pluck('id');
        DB::table('teaching_group_classes')->whereIn('teaching_group_id', $groupIds)->delete();
        DB::table('teaching_groups')->whereIn('id', $groupIds)->delete();
        DB::table('semester_class_settings')->whereIn('semester_id', $semesterIds)->delete();
        DB::table('items')->whereIn('semester_id', $semesterIds)->delete();
        DB::table('schedule_template_days')->whereIn('semester_id', $semesterIds)->delete();
        DB::table('schedule_templates')->whereIn('semester_id', $semesterIds)->delete();
    }

    /**
     * @param  list<array{id: int, name: string, code_year: int}>  $years
     * @param  array<string, int>  $gradeIds
     * @return list<array{id: int, academic_year_id: int, grade_name: string, section: int, global_index: int, name: string}>
     */
    private function seedClasses(array $years, array $gradeIds): array
    {
        $classes = [];
        $timestamp = now();
        foreach ($years as $year) {
            foreach (array_keys($this->gradeLoads) as $gradeIndex => $gradeName) {
                for ($section = 1; $section <= self::CLASSES_PER_GRADE; $section++) {
                    $name = $gradeName.$section.'班';
                    $code = sprintf('DEMO-%d-G%d-%02d', $year['code_year'], $gradeIndex + 7, $section);
                    DB::table('school_classes')->updateOrInsert(
                        ['academic_year_id' => $year['id'], 'code' => $code],
                        [
                            'grade_id' => $gradeIds[$gradeName], 'name' => $name, 'status' => 'active',
                            'updated_at' => $timestamp, 'created_at' => $timestamp,
                        ],
                    );
                    $classId = (int) DB::table('school_classes')
                        ->where('academic_year_id', $year['id'])->where('code', $code)->value('id');
                    $classes[] = [
                        'id' => $classId, 'academic_year_id' => $year['id'], 'grade_name' => $gradeName,
                        'section' => $section, 'global_index' => $gradeIndex * self::CLASSES_PER_GRADE + $section - 1,
                        'name' => $name,
                    ];
                }
            }
        }

        return $classes;
    }

    /**
     * @param  array{id: int, academic_year_id: int, academic_year_name: string, sequence: int, name: string, status: string}  $semester
     * @param  list<array{id: int, academic_year_id: int, grade_name: string, section: int, global_index: int, name: string}>  $classes
     * @param  list<int>  $classroomIds
     * @param  list<int>  $homeroomTeachers
     * @return array<int, array{fixed_room_id: int, homeroom_teacher_id: int}>
     */
    private function seedClassSettings(
        array $semester,
        array $classes,
        array $classroomIds,
        array $homeroomTeachers,
        int $homeroomCourseId,
    ): array {
        $settings = [];
        $timestamp = now();
        foreach ($classes as $class) {
            $roomId = $classroomIds[$class['global_index']];
            $teacherId = $homeroomTeachers[$class['global_index']];
            DB::table('semester_class_settings')->insert([
                'semester_id' => $semester['id'], 'academic_year_id' => $semester['academic_year_id'],
                'school_class_id' => $class['id'], 'fixed_room_id' => $roomId,
                'homeroom_teacher_id' => $teacherId, 'status' => 'active',
                'created_at' => $timestamp, 'updated_at' => $timestamp,
            ]);
            DB::table('teacher_course')->insertOrIgnore([
                'teacher_id' => $teacherId,
                'course_id' => $homeroomCourseId,
            ]);
            $settings[$class['id']] = ['fixed_room_id' => $roomId, 'homeroom_teacher_id' => $teacherId];
        }

        return $settings;
    }

    /**
     * @param  array{id: int, academic_year_id: int, academic_year_name: string, sequence: int, name: string, status: string}  $semester
     * @return list<int>
     */
    private function seedScheduleTemplate(array $semester): array
    {
        $timestamp = now();
        $templateId = (int) DB::table('schedule_templates')->insertGetId([
            'semester_id' => $semester['id'],
            'name' => $semester['academic_year_name'].' '.$semester['name'].'作息表',
            'created_at' => $timestamp, 'updated_at' => $timestamp,
        ]);
        for ($weekday = 1; $weekday <= 7; $weekday++) {
            DB::table('schedule_template_days')->insert([
                'schedule_template_id' => $templateId, 'semester_id' => $semester['id'],
                'weekday' => $weekday, 'is_enabled' => $weekday <= 5,
            ]);
        }

        $items = [
            ['晨读', 'fixed_non_course', '07:35', '07:55', false, false, false, false],
            ['第1节', 'course', '08:00', '08:45', true, true, true, true],
            ['第2节', 'course', '08:55', '09:40', true, true, true, true],
            ['大课间', 'fixed_non_course', '09:40', '10:10', false, false, false, false],
            ['第3节', 'course', '10:10', '10:55', true, true, true, true],
            ['第4节', 'course', '11:05', '11:50', true, true, true, true],
            ['第5节', 'course', '14:00', '14:45', true, true, true, true],
            ['第6节', 'course', '14:55', '15:40', true, true, true, true],
            ['第7节', 'course', '16:00', '16:45', true, true, true, true],
            ['课后服务', 'self_study', '17:00', '17:45', false, true, false, false],
        ];
        $courseItemIds = [];
        foreach ($items as $index => [$name, $type, $start, $end, $allowsCourse, $allowsTeacher, $countsAsCourse, $official]) {
            $itemId = (int) DB::table('items')->insertGetId([
                'schedule_template_id' => $templateId, 'semester_id' => $semester['id'],
                'name' => $name, 'type' => $type, 'start_time' => $start, 'end_time' => $end,
                'sort_order' => $index + 1, 'allows_course' => $allowsCourse,
                'allows_teacher' => $allowsTeacher, 'counts_as_course' => $countsAsCourse,
                'show_in_official' => $official, 'show_in_full' => true, 'is_active' => true,
                'created_at' => $timestamp, 'updated_at' => $timestamp,
            ]);
            if ($allowsCourse) {
                $courseItemIds[] = $itemId;
            }
        }

        return $courseItemIds;
    }

    /**
     * @param  array{id: int, academic_year_id: int, academic_year_name: string, sequence: int, name: string, status: string}  $semester
     * @param  list<array{id: int, academic_year_id: int, grade_name: string, section: int, global_index: int, name: string}>  $classes
     * @param  array<int, array{fixed_room_id: int, homeroom_teacher_id: int}>  $settings
     * @param  array<string, int>  $courseIds
     * @param  array<string, list<array{id: int, pool_index: int}>>  $teacherPools
     * @param  array<string, list<int>>  $roomPools
     * @return list<array{id: int, school_class_id: int, course_id: int, course_name: string, teacher_id: int, weekly_items: int, actual_room_id: int, room_mode: string}>
     */
    private function seedTeachingAssignments(
        array $semester,
        array $classes,
        array $settings,
        array $courseIds,
        array $teacherPools,
        array $roomPools,
    ): array {
        $timestamp = now();
        $assignmentDefinitions = [];
        foreach ($classes as $class) {
            foreach ($this->gradeLoads[$class['grade_name']] as $courseIndex => $weeklyItems) {
                if ($courseIndex === '班会') {
                    $teacherId = $settings[$class['id']]['homeroom_teacher_id'];
                    $poolIndex = 0;
                } else {
                    $pool = $teacherPools[$courseIndex];
                    $poolIndex = $class['global_index'] % count($pool);
                    $teacherId = $pool[$poolIndex]['id'];
                }
                $specifiedRoomId = isset($roomPools[$courseIndex]) ? $roomPools[$courseIndex][$poolIndex] : null;
                $isInactiveDraft = $semester['status'] === 'draft'
                    && (($class['global_index'] + array_search($courseIndex, array_keys($this->gradeLoads[$class['grade_name']]), true)) % 41 === 0);
                $status = $semester['status'] === 'draft' ? ($isInactiveDraft ? 'inactive' : 'draft') : 'confirmed';
                $assignmentDefinitions[] = [
                    'semester_id' => $semester['id'], 'academic_year_id' => $semester['academic_year_id'],
                    'school_class_id' => $class['id'], 'course_id' => $courseIds[$courseIndex],
                    'teacher_id' => $teacherId, 'weekly_items' => $weeklyItems,
                    'room_mode' => $specifiedRoomId === null ? 'class_default' : 'specified',
                    'specified_room_id' => $specifiedRoomId, 'status' => $status,
                    'created_at' => $timestamp, 'updated_at' => $timestamp,
                    '_course_name' => $courseIndex,
                    '_actual_room_id' => $specifiedRoomId ?? $settings[$class['id']]['fixed_room_id'],
                ];
            }
        }

        foreach (array_chunk($assignmentDefinitions, 150) as $chunk) {
            DB::table('teaching_assignments')->insert(array_map(function (array $assignment): array {
                unset($assignment['_course_name'], $assignment['_actual_room_id']);

                return $assignment;
            }, $chunk));
        }

        $assignmentIds = [];
        foreach (DB::table('teaching_assignments')->where('semester_id', $semester['id'])->get(['id', 'school_class_id', 'course_id']) as $assignment) {
            $assignmentIds[$assignment->school_class_id.'-'.$assignment->course_id] = (int) $assignment->id;
        }

        return array_map(function (array $assignment) use ($assignmentIds): array {
            return [
                'id' => $assignmentIds[$assignment['school_class_id'].'-'.$assignment['course_id']],
                'school_class_id' => $assignment['school_class_id'], 'course_id' => $assignment['course_id'],
                'course_name' => $assignment['_course_name'], 'teacher_id' => $assignment['teacher_id'],
                'weekly_items' => $assignment['weekly_items'], 'actual_room_id' => $assignment['_actual_room_id'],
                'room_mode' => $assignment['room_mode'],
            ];
        }, $assignmentDefinitions);
    }

    /**
     * @param  array{id: int, academic_year_id: int, academic_year_name: string, sequence: int, name: string, status: string}  $semester
     */
    private function seedSchedulingConstraints(array $semester): int
    {
        $definitions = [
            ['教师同课节不可重复', 'hard', 'availability', null, ['resource_no_overlap' => 'teacher'], '同一教师在同一周型、星期和课节只能授课一次。'],
            ['班级同课节不可重复', 'hard', 'availability', null, ['resource_no_overlap' => 'school_class'], '同一班级在同一周型、星期和课节只能有一项课程安排。'],
            ['教室同课节不可重复', 'hard', 'availability', null, ['resource_no_overlap' => 'room'], '同一教室在同一周型、星期和课节只能被一个课程安排使用。'],
            ['已确认任课关系课时必须排满', 'hard', 'weekly_load', null, ['assignment_completeness' => true], '每条已确认任课关系都必须完整安排规定课时。'],
            ['只能使用允许排课的课节', 'hard', 'availability', null, ['item_allows_course' => true], '停用课节及非课程课节不能安排普通课程。'],
            ['教室必须满足任课关系要求', 'hard', 'room_requirement', null, ['assignment_room_mode' => true], '课程安排必须使用班级固定教室或任课关系指定教室。'],
            ['教师必须具备课程资格', 'hard', 'availability', null, ['teacher_course_qualification' => true], '任课教师必须具备对应课程授课资格。'],
            ['锁定课程保持原位', 'hard', 'availability', null, ['preserve_locked_entries' => true], '自动排课和普通调整不得移动已锁定课程。'],
            ['同一课程尽量均匀分布', 'soft', 'course_distribution', 90, ['spread_across_weekdays' => true], '减少同一课程集中在少数工作日。'],
            ['语数英优先安排在精力较好时段', 'soft', 'course_priority', 75, ['prefer_earlier_items' => ['语文', '数学', '英语']], '核心课程优先安排在上午及下午前段。'],
            ['减少教师空堂', 'soft', 'teacher_gaps', 70, ['minimize_teacher_gaps' => true], '在不增加硬冲突的前提下减少教师当日空堂。'],
            ['平衡教师每日工作量', 'soft', 'workload_balance', 65, ['balance_teacher_daily_load' => true], '避免单日授课过多或过少。'],
            ['限制连续授课', 'soft', 'consecutive_items', 80, ['max_consecutive_items' => 3], '教师连续授课尽量不超过三节。'],
            ['避免同一课程同日重复', 'soft', 'spacing', 85, ['max_same_course_per_day' => 1], '除连堂配置外，同一班级同一课程每天尽量只安排一次。'],
        ];
        $timestamp = now();
        foreach ($definitions as [$name, $kind, $category, $weight, $requirement, $explanation]) {
            DB::table('scheduling_constraints')->insert([
                'semester_id' => $semester['id'],
                'name' => $name,
                'kind' => $kind,
                'category' => $category,
                'scope' => json_encode(['semester_id' => $semester['id']], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'requirement' => json_encode($requirement, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'weight' => $weight,
                'source' => $kind === 'hard' ? 'system' : 'template',
                'status' => 'active',
                'explanation' => $explanation,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
        }

        return count($definitions);
    }

    /**
     * @param  array{id: int, academic_year_id: int, academic_year_name: string, sequence: int, name: string, status: string}  $semester
     * @param  list<array{id: int, school_class_id: int, course_id: int, course_name: string, teacher_id: int, weekly_items: int, actual_room_id: int, room_mode: string}>  $assignments
     * @param  list<int>  $courseItems
     * @return array{entry_count: int, version_id: int}
     */
    private function seedTimetable(
        array $semester,
        array $assignments,
        array $courseItems,
        bool $historical,
        int $creatorId,
    ): array {
        $lessonsByDay = $this->assignLessonsToDays($assignments, count($courseItems));
        $timestamp = now();
        $versionId = (int) DB::table('timetable_versions')->insertGetId([
            'semester_id' => $semester['id'],
            'version_no' => 1,
            'name' => $historical ? '历史归档课表 v1' : '当前课表 v1',
            'status' => 'active',
            'source' => 'manual',
            'created_by' => $creatorId,
            'input_revision' => 1,
            'hard_conflict_count' => 0,
            'soft_warning_count' => 0,
            'activated_at' => $timestamp,
            'created_at' => $timestamp,
            'updated_at' => $timestamp,
        ]);
        $entries = [];
        foreach ($lessonsByDay as $weekday => $lessons) {
            foreach ($this->colorDayLessons($lessons, count($courseItems)) as $lesson) {
                $assignment = $lesson['assignment'];
                $itemId = $courseItems[$lesson['color']];
                $entries[] = [
                    'semester_id' => $semester['id'], 'timetable_version_id' => $versionId,
                    'teaching_assignment_id' => $assignment['id'],
                    'school_class_id' => $assignment['school_class_id'], 'teacher_id' => $assignment['teacher_id'],
                    'course_id' => $assignment['course_id'], 'actual_room_id' => $assignment['actual_room_id'],
                    'week_pattern' => 'all', 'weekday' => $weekday, 'item_id' => $itemId, 'source' => 'manual',
                    'is_locked' => $historical
                        ? (($assignment['id'] + $weekday + $itemId) % 4 === 0)
                        : (($assignment['id'] + $weekday + $itemId) % 11 === 0),
                    'created_at' => $timestamp, 'updated_at' => $timestamp,
                ];
            }
        }

        foreach (array_chunk($entries, 200) as $chunk) {
            DB::table('timetable_entries')->insert($chunk);
        }
        $classPivots = [];
        $teacherPivots = [];
        foreach (DB::table('timetable_entries')->where('timetable_version_id', $versionId)->get([
            'id', 'school_class_id', 'teacher_id', 'week_pattern', 'weekday', 'item_id',
        ]) as $entry) {
            $slot = [
                'timetable_entry_id' => $entry->id,
                'timetable_version_id' => $versionId,
                'week_pattern' => $entry->week_pattern,
                'weekday' => $entry->weekday,
                'item_id' => $entry->item_id,
            ];
            $classPivots[] = [...$slot, 'school_class_id' => $entry->school_class_id];
            $teacherPivots[] = [...$slot, 'teacher_id' => $entry->teacher_id];
        }
        foreach (array_chunk($classPivots, 300) as $chunk) {
            DB::table('timetable_entry_classes')->insert($chunk);
        }
        foreach (array_chunk($teacherPivots, 300) as $chunk) {
            DB::table('timetable_entry_teachers')->insert($chunk);
        }

        return ['entry_count' => count($entries), 'version_id' => $versionId];
    }

    /**
     * @param  array{id: int, academic_year_id: int, academic_year_name: string, sequence: int, name: string, status: string}  $semester
     * @param  list<int>  $courseItems
     */
    private function seedDailyOperations(
        array $semester,
        int $versionId,
        array $courseItems,
        int $creatorId,
    ): void {
        $timestamp = now();
        $entriesByWeekday = [];
        foreach (range(1, 5) as $weekday) {
            $entriesByWeekday[$weekday] = DB::table('timetable_entries')
                ->where('timetable_version_id', $versionId)
                ->where('weekday', $weekday)
                ->orderBy('id')
                ->get();
        }

        $cancelEntry = $entriesByWeekday[2]->first();
        if ($cancelEntry !== null) {
            DB::table('calendar_exceptions')->insert([
                'semester_id' => $semester['id'],
                'timetable_version_id' => $versionId,
                'effective_date' => $this->firstDateForWeekday($semester, 2),
                'type' => 'cancel',
                'original_entry_id' => $cancelEntry->id,
                'status' => 'active',
                'reason' => '年级统一体检，原课程当日暂停。',
                'created_by' => $creatorId,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
        }

        $move = $this->findMovableEntry($entriesByWeekday[3], $versionId, $courseItems);
        if ($move !== null) {
            DB::table('calendar_exceptions')->insert([
                'semester_id' => $semester['id'],
                'timetable_version_id' => $versionId,
                'effective_date' => $this->firstDateForWeekday($semester, 3),
                'replacement_date' => $this->firstDateForWeekday($semester, 3),
                'type' => 'move',
                'original_entry_id' => $move['entry']->id,
                'replacement_item_id' => $move['item_id'],
                'status' => 'active',
                'reason' => '教师参加教研活动，课程临时后移。',
                'created_by' => $creatorId,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
        }

        $teacherChange = $this->findTeacherReplacement($entriesByWeekday[4], $versionId);
        if ($teacherChange !== null) {
            DB::table('calendar_exceptions')->insert([
                'semester_id' => $semester['id'],
                'timetable_version_id' => $versionId,
                'effective_date' => $this->firstDateForWeekday($semester, 4),
                'type' => 'teacher_change',
                'original_entry_id' => $teacherChange['entry']->id,
                'replacement_teacher_id' => $teacherChange['teacher_id'],
                'status' => 'active',
                'reason' => '校内公开课观摩，由同学科教师临时授课。',
                'created_by' => $creatorId,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
        }

        $roomChange = $this->findRoomReplacement($entriesByWeekday[5], $versionId);
        if ($roomChange !== null) {
            DB::table('calendar_exceptions')->insert([
                'semester_id' => $semester['id'],
                'timetable_version_id' => $versionId,
                'effective_date' => $this->firstDateForWeekday($semester, 5),
                'type' => 'room_change',
                'original_entry_id' => $roomChange['entry']->id,
                'replacement_room_id' => $roomChange['room_id'],
                'status' => 'active',
                'reason' => '原教室设备检修，临时调整至备用教室。',
                'created_by' => $creatorId,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
        }

        $leaveReplacement = $this->findTeacherReplacement($entriesByWeekday[1], $versionId);
        if ($leaveReplacement !== null) {
            $entry = $leaveReplacement['entry'];
            $date = $this->firstDateForWeekday($semester, 1, 1);
            $item = DB::table('items')->where('id', $entry->item_id)->firstOrFail();
            $leaveId = DB::table('teacher_leaves')->insertGetId([
                'semester_id' => $semester['id'],
                'teacher_id' => $entry->teacher_id,
                'starts_at' => $date.' '.CarbonImmutable::parse($item->start_time)->subMinutes(15)->format('H:i:s'),
                'ends_at' => $date.' '.CarbonImmutable::parse($item->end_time)->addMinutes(15)->format('H:i:s'),
                'type' => 'training',
                'status' => 'active',
                'reason' => '参加市级学科培训。',
                'includes_non_course_items' => false,
                'created_by' => $creatorId,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
            DB::table('substitutions')->insert([
                'teacher_leave_id' => $leaveId,
                'original_entry_id' => $entry->id,
                'effective_date' => $date,
                'replacement_teacher_id' => $leaveReplacement['teacher_id'],
                'status' => 'active',
                'reason' => '同学科教师代课。',
                'created_by' => $creatorId,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
        }

        $historicalEntry = $entriesByWeekday[2]->skip(1)->first();
        if ($historicalEntry !== null) {
            $date = $this->firstDateForWeekday($semester, 2, 2);
            $item = DB::table('items')->where('id', $historicalEntry->item_id)->firstOrFail();
            DB::table('teacher_leaves')->insert([
                'semester_id' => $semester['id'],
                'teacher_id' => $historicalEntry->teacher_id,
                'starts_at' => $date.' '.$item->start_time,
                'ends_at' => $date.' '.$item->end_time,
                'type' => 'personal',
                'status' => 'cancelled',
                'reason' => '演示用已取消请假记录。',
                'includes_non_course_items' => false,
                'created_by' => $creatorId,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
        }
    }

    /** @param  Collection<int, object>  $entries @param list<int> $itemIds */
    private function findMovableEntry($entries, int $versionId, array $itemIds): ?array
    {
        foreach ($entries as $entry) {
            foreach ($itemIds as $itemId) {
                if ($itemId === $entry->item_id) {
                    continue;
                }
                $occupied = DB::table('timetable_entries')
                    ->where('timetable_version_id', $versionId)
                    ->where('weekday', $entry->weekday)
                    ->where('item_id', $itemId)
                    ->where(function ($query) use ($entry): void {
                        $query->where('school_class_id', $entry->school_class_id)
                            ->orWhere('teacher_id', $entry->teacher_id)
                            ->orWhere('actual_room_id', $entry->actual_room_id);
                    })
                    ->exists();
                if (! $occupied) {
                    return ['entry' => $entry, 'item_id' => $itemId];
                }
            }
        }

        return null;
    }

    /** @param  Collection<int, object>  $entries */
    private function findTeacherReplacement($entries, int $versionId): ?array
    {
        foreach ($entries as $entry) {
            $teacherIds = DB::table('teacher_course')
                ->join('teachers', 'teachers.id', '=', 'teacher_course.teacher_id')
                ->where('teacher_course.course_id', $entry->course_id)
                ->where('teachers.is_active', true)
                ->where('teachers.id', '!=', $entry->teacher_id)
                ->orderBy('teachers.id')
                ->pluck('teachers.id');
            foreach ($teacherIds as $teacherId) {
                $occupied = DB::table('timetable_entries')
                    ->where('timetable_version_id', $versionId)
                    ->where('weekday', $entry->weekday)
                    ->where('item_id', $entry->item_id)
                    ->where('teacher_id', $teacherId)
                    ->exists();
                if (! $occupied) {
                    return ['entry' => $entry, 'teacher_id' => (int) $teacherId];
                }
            }
        }

        return null;
    }

    /** @param  Collection<int, object>  $entries */
    private function findRoomReplacement($entries, int $versionId): ?array
    {
        foreach ($entries as $entry) {
            $roomIds = DB::table('rooms')->where('is_active', true)
                ->where('id', '!=', $entry->actual_room_id)->orderBy('id')->pluck('id');
            foreach ($roomIds as $roomId) {
                $occupied = DB::table('timetable_entries')
                    ->where('timetable_version_id', $versionId)
                    ->where('weekday', $entry->weekday)
                    ->where('item_id', $entry->item_id)
                    ->where('actual_room_id', $roomId)
                    ->exists();
                if (! $occupied) {
                    return ['entry' => $entry, 'room_id' => (int) $roomId];
                }
            }
        }

        return null;
    }

    /**
     * @param  array{id: int, academic_year_id: int, academic_year_name: string, sequence: int, name: string, status: string}  $semester
     */
    private function firstDateForWeekday(array $semester, int $weekday, int $weekOffset = 0): string
    {
        $date = CarbonImmutable::parse($semester['start_date'] ?? DB::table('semesters')->where('id', $semester['id'])->value('start_date'));
        while ($date->dayOfWeekIso !== $weekday) {
            $date = $date->addDay();
        }

        return $date->addWeeks($weekOffset)->toDateString();
    }

    /**
     * @param  list<array{id: int, school_class_id: int, course_id: int, course_name: string, teacher_id: int, weekly_items: int, actual_room_id: int, room_mode: string}>  $assignments
     * @return array<int, list<array{id: int, school_class_id: int, course_id: int, course_name: string, teacher_id: int, weekly_items: int, actual_room_id: int, room_mode: string}>>
     */
    private function assignLessonsToDays(array $assignments, int $dailyCapacity): array
    {
        $teacherLoads = [];
        foreach ($assignments as $assignment) {
            $teacherLoads[$assignment['teacher_id']] = ($teacherLoads[$assignment['teacher_id']] ?? 0) + $assignment['weekly_items'];
        }

        for ($attempt = 0; $attempt < 80; $attempt++) {
            $classDayLoads = [];
            $teacherDayLoads = [];
            $lessonsByDay = array_fill(1, 5, []);
            $orderedAssignments = $assignments;
            usort($orderedAssignments, function (array $left, array $right) use ($teacherLoads, $attempt): int {
                $leftPriority = $left['weekly_items'] * 100 + $teacherLoads[$left['teacher_id']];
                $rightPriority = $right['weekly_items'] * 100 + $teacherLoads[$right['teacher_id']];
                if ($leftPriority !== $rightPriority) {
                    return $rightPriority <=> $leftPriority;
                }

                return $this->stableNoise($attempt, $left['id']) <=> $this->stableNoise($attempt, $right['id']);
            });
            $failed = false;

            foreach ($orderedAssignments as $assignment) {
                $days = range(1, 5);
                usort($days, function (int $day, int $other) use ($classDayLoads, $teacherDayLoads, $assignment, $attempt): int {
                    $score = ($classDayLoads[$assignment['school_class_id']][$day] ?? 0) * 100
                        + ($teacherDayLoads[$assignment['teacher_id']][$day] ?? 0) * 12
                        + $this->stableNoise($attempt, $assignment['id'], $day) % 17;
                    $otherScore = ($classDayLoads[$assignment['school_class_id']][$other] ?? 0) * 100
                        + ($teacherDayLoads[$assignment['teacher_id']][$other] ?? 0) * 12
                        + $this->stableNoise($attempt, $assignment['id'], $other) % 17;
                    if ($assignment['course_name'] === '班会') {
                        $score += $day === 5 ? -35 : 20;
                        $otherScore += $other === 5 ? -35 : 20;
                    }

                    return $score <=> $otherScore;
                });

                $selectedDays = [];
                foreach ($days as $day) {
                    if (($classDayLoads[$assignment['school_class_id']][$day] ?? 0) >= $dailyCapacity
                        || ($teacherDayLoads[$assignment['teacher_id']][$day] ?? 0) >= $dailyCapacity) {
                        continue;
                    }
                    $selectedDays[] = $day;
                    if (count($selectedDays) === $assignment['weekly_items']) {
                        break;
                    }
                }
                if (count($selectedDays) !== $assignment['weekly_items']) {
                    $failed = true;
                    break;
                }

                foreach ($selectedDays as $day) {
                    $lessonsByDay[$day][] = $assignment;
                    $classDayLoads[$assignment['school_class_id']][$day] =
                        ($classDayLoads[$assignment['school_class_id']][$day] ?? 0) + 1;
                    $teacherDayLoads[$assignment['teacher_id']][$day] =
                        ($teacherDayLoads[$assignment['teacher_id']][$day] ?? 0) + 1;
                }
            }

            if (! $failed) {
                return $lessonsByDay;
            }
        }

        throw new RuntimeException('无法把任课关系均匀分配到五个工作日。');
    }

    /**
     * @param  list<array{id: int, school_class_id: int, course_id: int, course_name: string, teacher_id: int, weekly_items: int, actual_room_id: int, room_mode: string}>  $lessons
     * @return list<array{color: int, assignment: array{id: int, school_class_id: int, course_id: int, course_name: string, teacher_id: int, weekly_items: int, actual_room_id: int, room_mode: string}}>
     */
    private function colorDayLessons(array $lessons, int $itemCount): array
    {
        $classIds = array_values(array_unique(array_column($lessons, 'school_class_id')));
        $teacherIds = array_values(array_unique(array_column($lessons, 'teacher_id')));
        $classIndexes = array_flip($classIds);
        $teacherIndexes = array_flip($teacherIds);
        $vertexCount = max(count($classIds), count($teacherIds));
        $leftDegrees = array_fill(0, $vertexCount, 0);
        $rightDegrees = array_fill(0, $vertexCount, 0);
        $edgeBuckets = array_fill(0, $vertexCount, []);
        $edges = [];

        foreach ($lessons as $assignment) {
            $left = $classIndexes[$assignment['school_class_id']];
            $right = $teacherIndexes[$assignment['teacher_id']];
            $edgeIndex = count($edges);
            $edges[] = $assignment;
            $edgeBuckets[$left][$right][] = $edgeIndex;
            $leftDegrees[$left]++;
            $rightDegrees[$right]++;
        }

        $degree = max(max($leftDegrees), max($rightDegrees));
        if ($degree > $itemCount) {
            throw new RuntimeException('单日任课关系超过了作息容量。');
        }

        $leftDeficits = [];
        $rightDeficits = [];
        for ($vertex = 0; $vertex < $vertexCount; $vertex++) {
            for ($missing = $leftDegrees[$vertex]; $missing < $degree; $missing++) {
                $leftDeficits[] = $vertex;
            }
            for ($missing = $rightDegrees[$vertex]; $missing < $degree; $missing++) {
                $rightDeficits[] = $vertex;
            }
        }
        if (count($leftDeficits) !== count($rightDeficits)) {
            throw new RuntimeException('课表二分图的度数补全失败。');
        }

        foreach ($leftDeficits as $index => $left) {
            $right = $rightDeficits[$index];
            $edgeIndex = count($edges);
            $edges[] = null;
            $edgeBuckets[$left][$right][] = $edgeIndex;
        }

        $coloredLessons = [];
        for ($color = 0; $color < $degree; $color++) {
            $matching = $this->perfectMatching($edgeBuckets, $vertexCount, $color);
            foreach ($matching as $right => $left) {
                $edgeIndex = array_pop($edgeBuckets[$left][$right]);
                if ($edgeIndex === null) {
                    throw new RuntimeException('课表匹配边不存在。');
                }
                if ($edges[$edgeIndex] !== null) {
                    $coloredLessons[] = ['color' => $color, 'assignment' => $edges[$edgeIndex]];
                }
            }
        }

        return $coloredLessons;
    }

    /**
     * @param  array<int, array<int, list<int>>>  $edgeBuckets
     * @return list<int>
     */
    private function perfectMatching(array $edgeBuckets, int $vertexCount, int $color): array
    {
        $rightMatches = array_fill(0, $vertexCount, -1);
        $leftOrder = range(0, $vertexCount - 1);
        usort($leftOrder, fn (int $left, int $other): int => $this->stableNoise($color, $left) <=> $this->stableNoise($color, $other));

        foreach ($leftOrder as $left) {
            $seenRights = array_fill(0, $vertexCount, false);
            if (! $this->augmentMatching($left, $edgeBuckets, $rightMatches, $seenRights, $color)) {
                throw new RuntimeException('无法分解课表的无冲突匹配。');
            }
        }

        return $rightMatches;
    }

    /**
     * @param  array<int, array<int, list<int>>>  $edgeBuckets
     * @param  list<int>  $rightMatches
     * @param  list<bool>  $seenRights
     */
    private function augmentMatching(
        int $left,
        array $edgeBuckets,
        array &$rightMatches,
        array &$seenRights,
        int $color,
    ): bool {
        $rights = array_keys($edgeBuckets[$left]);
        usort($rights, fn (int $right, int $other): int => $this->stableNoise($color, $left, $right) <=> $this->stableNoise($color, $left, $other));
        foreach ($rights as $right) {
            if ($edgeBuckets[$left][$right] === [] || $seenRights[$right]) {
                continue;
            }
            $seenRights[$right] = true;
            if ($rightMatches[$right] === -1
                || $this->augmentMatching($rightMatches[$right], $edgeBuckets, $rightMatches, $seenRights, $color)) {
                $rightMatches[$right] = $left;

                return true;
            }
        }

        return false;
    }

    private function stableNoise(int ...$values): int
    {
        return (int) sprintf('%u', crc32(implode(':', $values)));
    }

    /**
     * @param  list<array{id: int, academic_year_id: int, grade_name: string, section: int, global_index: int, name: string}>  $classes
     * @param  array<string, int>  $courseIds
     */
    private function seedAuditLogs(
        int $adminId,
        int $semesterId,
        int $yearId,
        array $classes,
        array $courseIds,
    ): void {
        DB::table('audit_logs')->where('request_id', 'like', self::DATASET_REQUEST_PREFIX.'%')->delete();
        $logs = [];
        $sequence = 1;
        $addLog = function (string $action, string $type, ?int $id, array $after, bool $system = false) use (&$logs, &$sequence, $adminId): void {
            $logs[] = [
                'actor_type' => $system ? 'system' : 'user',
                'actor_user_id' => $system ? null : $adminId,
                'action' => $action, 'auditable_type' => $type, 'auditable_id' => $id,
                'before_data' => null, 'after_data' => json_encode($after, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'request_id' => self::DATASET_REQUEST_PREFIX.sprintf('%04d', $sequence++),
                'created_at' => now()->subMinutes(120 - min(119, $sequence)),
            ];
        };

        $addLog('open', 'academic_year', $yearId, ['status' => 'open']);
        $addLog('open', 'semester', $semesterId, ['status' => 'open']);
        foreach ($courseIds as $name => $courseId) {
            $addLog('seed', 'course', $courseId, ['name' => $name], true);
        }
        foreach (array_slice(array_values(array_filter(
            $classes,
            fn (array $class): bool => $class['academic_year_id'] === $yearId,
        )), 0, 24) as $class) {
            $addLog('import', 'school_class', $class['id'], ['name' => $class['name'], 'status' => 'active']);
        }
        for ($index = 0; $index < 18; $index++) {
            $addLog(
                $index % 3 === 0 ? 'lock' : 'place',
                'timetable_entry',
                null,
                ['semester_id' => $semesterId, 'batch_index' => $index + 1],
            );
        }

        foreach (array_chunk($logs, 100) as $chunk) {
            DB::table('audit_logs')->insert($chunk);
        }
    }

    /** @param list<string> $names @return array<string, int> */
    private function idsByName(string $table, array $names): array
    {
        $ids = [];
        foreach (DB::table($table)->whereIn('name', $names)->get(['id', 'name']) as $record) {
            $ids[(string) $record->name] = (int) $record->id;
        }

        return $ids;
    }

    private function idBy(string $table, string $column, string $value): int
    {
        $id = DB::table($table)->where($column, $value)->value('id');
        if ($id === null) {
            throw new RuntimeException("{$table}.{$column}={$value} 不存在。");
        }

        return (int) $id;
    }
}
