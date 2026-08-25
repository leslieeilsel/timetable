<?php

use App\Modules\AcademicCalendar\Http\Controllers\AcademicCalendarController;
use App\Modules\AcademicCalendar\Http\Controllers\ContextController;
use App\Modules\AcademicCalendar\Http\Controllers\SchoolSettingsController;
use App\Modules\Identity\Http\Controllers\AuthController;
use App\Modules\Identity\Http\Controllers\MeController;
use App\Modules\Identity\Http\Controllers\UserController;
use App\Modules\Resources\Http\Controllers\CatalogController;
use App\Modules\Resources\Http\Controllers\SchoolClassController;
use App\Modules\ScheduleTemplate\Http\Controllers\ScheduleTemplateController;
use App\Modules\SemesterClassSetting\Http\Controllers\SemesterClassSettingController;
use App\Modules\TeachingTask\Http\Controllers\TeachingTaskController;
use App\Modules\Timetable\Http\Controllers\TimetableController;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;

Route::get('/v1/health', function () {
    try {
        $ready = DB::select('select 1')
            && Schema::hasTable('migrations')
            && Schema::hasTable('app_settings')
            && DB::table('app_settings')->where('id', 1)->exists();
    } catch (Throwable) {
        $ready = false;
    }

    return response()->json(['data' => [
        'status' => $ready ? 'ready' : 'unavailable',
        'version' => config('app.version', 'dev'),
        'commit' => config('app.commit', 'local'),
    ]], $ready ? 200 : 503);
});

Route::prefix('v1')->group(function (): void {
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:login');

    Route::middleware(['auth:sanctum', 'session.valid'])->group(function (): void {
        Route::get('/me', MeController::class)->name('me');
        Route::post('/auth/logout', [AuthController::class, 'logout'])->name('auth.logout');
        Route::post('/auth/change-password', [AuthController::class, 'changePassword'])->name('auth.change-password');
        Route::get('/users', [UserController::class, 'index']);
        Route::post('/users', [UserController::class, 'store']);
        Route::patch('/users/{user}', [UserController::class, 'update']);
        Route::post('/users/{user}/reset-password', [UserController::class, 'resetPassword']);

        Route::get('/context', [ContextController::class, 'show']);
        Route::put('/context/current-semester', [ContextController::class, 'update']);
        Route::get('/school-settings', [SchoolSettingsController::class, 'show']);
        Route::patch('/school-settings', [SchoolSettingsController::class, 'update']);
        Route::get('/catalog', [CatalogController::class, 'catalog']);
        Route::get('/grades', [CatalogController::class, 'grades']);
        Route::post('/grades', [CatalogController::class, 'storeGrade']);
        Route::patch('/grades/{grade}', [CatalogController::class, 'updateGrade']);
        Route::delete('/grades/{grade}', [CatalogController::class, 'deleteGrade']);
        Route::get('/teachers', [CatalogController::class, 'teachers']);
        Route::post('/teachers', [CatalogController::class, 'storeTeacher']);
        Route::patch('/teachers/{teacher}', [CatalogController::class, 'updateTeacher']);
        Route::delete('/teachers/{teacher}', [CatalogController::class, 'deleteTeacher']);
        Route::put('/teachers/{teacher}/courses', [CatalogController::class, 'teacherCourses']);
        Route::get('/courses', [CatalogController::class, 'courses']);
        Route::post('/courses', [CatalogController::class, 'storeCourse']);
        Route::patch('/courses/{course}', [CatalogController::class, 'updateCourse']);
        Route::delete('/courses/{course}', [CatalogController::class, 'deleteCourse']);
        Route::get('/rooms', [CatalogController::class, 'rooms']);
        Route::post('/rooms', [CatalogController::class, 'storeRoom']);
        Route::patch('/rooms/{room}', [CatalogController::class, 'updateRoom']);
        Route::delete('/rooms/{room}', [CatalogController::class, 'deleteRoom']);

        Route::get('/academic-years', [AcademicCalendarController::class, 'years']);
        Route::post('/academic-years', [AcademicCalendarController::class, 'storeYear']);
        Route::patch('/academic-years/{year}', [AcademicCalendarController::class, 'updateYear']);
        Route::delete('/academic-years/{year}', [AcademicCalendarController::class, 'deleteYear']);
        Route::post('/academic-years/{year}/open', [AcademicCalendarController::class, 'openYear']);
        Route::post('/academic-years/{year}/close', [AcademicCalendarController::class, 'closeYear']);
        Route::post('/academic-years/{year}/reopen', [AcademicCalendarController::class, 'reopenYear']);
        Route::get('/academic-years/{year}/semesters', [AcademicCalendarController::class, 'semesters']);
        Route::post('/academic-years/{year}/semesters', [AcademicCalendarController::class, 'storeSemester']);
        Route::get('/semesters/{semester}', [AcademicCalendarController::class, 'showSemester']);
        Route::patch('/semesters/{semester}', [AcademicCalendarController::class, 'updateSemester']);
        Route::delete('/semesters/{semester}', [AcademicCalendarController::class, 'deleteSemester']);
        Route::post('/semesters/{semester}/open', [AcademicCalendarController::class, 'openSemester']);
        Route::post('/semesters/{semester}/close', [AcademicCalendarController::class, 'closeSemester']);
        Route::post('/semesters/{semester}/reopen', [AcademicCalendarController::class, 'reopenSemester']);

        Route::get('/academic-years/{year}/classes', [SchoolClassController::class, 'index']);
        Route::post('/academic-years/{year}/classes', [SchoolClassController::class, 'store']);
        Route::patch('/academic-years/{year}/classes/{schoolClass}', [SchoolClassController::class, 'update']);
        Route::delete('/academic-years/{year}/classes/{schoolClass}', [SchoolClassController::class, 'destroy']);
        Route::post('/academic-years/{year}/classes/import/preview', [SchoolClassController::class, 'preview']);
        Route::post('/academic-years/{year}/classes/import/commit', [SchoolClassController::class, 'commit']);

        Route::get('/semesters/{semester}/class-settings', [SemesterClassSettingController::class, 'index']);
        Route::put('/semesters/{semester}/class-settings/{schoolClass}', [SemesterClassSettingController::class, 'put']);
        Route::delete('/semesters/{semester}/class-settings/{schoolClass}', [SemesterClassSettingController::class, 'destroy']);
        Route::post('/semesters/{semester}/class-settings/{schoolClass}/migrate-room', [SemesterClassSettingController::class, 'migrateRoom']);
        Route::post('/semesters/{semester}/class-settings/copy', [SemesterClassSettingController::class, 'copy']);
        Route::get('/semesters/{semester}/schedule-template', [ScheduleTemplateController::class, 'show']);
        Route::put('/semesters/{semester}/schedule-template', [ScheduleTemplateController::class, 'put']);
        Route::delete('/semesters/{semester}/schedule-template', [ScheduleTemplateController::class, 'destroy']);
        Route::post('/semesters/{semester}/schedule-template/copy', [ScheduleTemplateController::class, 'copy']);

        Route::get('/semesters/{semester}/teaching-tasks', [TeachingTaskController::class, 'index']);
        Route::post('/semesters/{semester}/teaching-tasks', [TeachingTaskController::class, 'store']);
        Route::post('/semesters/{semester}/teaching-tasks/copy', [TeachingTaskController::class, 'copy']);
        Route::post('/semesters/{semester}/teaching-tasks/confirm', [TeachingTaskController::class, 'confirm']);
        Route::patch('/semesters/{semester}/teaching-tasks/{task}', [TeachingTaskController::class, 'update']);
        Route::delete('/semesters/{semester}/teaching-tasks/{task}', [TeachingTaskController::class, 'destroy']);
        Route::post('/semesters/{semester}/teaching-tasks/{task}/unconfirm', [TeachingTaskController::class, 'unconfirm']);
        Route::post('/semesters/{semester}/teaching-tasks/{task}/deactivate', [TeachingTaskController::class, 'deactivate']);
        Route::post('/semesters/{semester}/teaching-tasks/{task}/restore', [TeachingTaskController::class, 'restore']);
        Route::post('/semesters/{semester}/teaching-tasks/{task}/migrate-room', [TeachingTaskController::class, 'migrateRoom']);

        Route::get('/semesters/{semester}/timetable', [TimetableController::class, 'index']);
        Route::post('/semesters/{semester}/timetable/entries', [TimetableController::class, 'store']);
        Route::patch('/semesters/{semester}/timetable/entries/{entry}', [TimetableController::class, 'update']);
        Route::delete('/semesters/{semester}/timetable/entries/{entry}', [TimetableController::class, 'destroy']);
        Route::put('/semesters/{semester}/timetable/entries/{entry}/lock', [TimetableController::class, 'lock']);
        Route::delete('/semesters/{semester}/timetable/entries/{entry}/lock', [TimetableController::class, 'unlock']);
        Route::get('/semesters/{semester}/timetable/validation', [TimetableController::class, 'validation']);
        Route::get('/semesters/{semester}/timetable/completeness', [TimetableController::class, 'completeness']);
        Route::get('/semesters/{semester}/timetable/export.csv', [TimetableController::class, 'export']);
    });
});
