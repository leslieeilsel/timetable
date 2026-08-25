<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('academic_years', function (Blueprint $table): void {
            $table->id();
            $table->string('name', 100)->unique();
            $table->date('start_date');
            $table->date('end_date');
            $table->string('status', 20)->default('draft');
            $table->timestamps();
        });

        Schema::create('semesters', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('academic_year_id')->constrained()->restrictOnDelete();
            $table->string('name', 20);
            $table->unsignedTinyInteger('sequence');
            $table->date('start_date');
            $table->date('end_date');
            $table->string('status', 20)->default('draft');
            $table->unsignedBigInteger('timetable_revision')->default(0);
            $table->timestamps();
            $table->unique(['academic_year_id', 'sequence'], 'uq_semester_sequence');
            $table->unique(['id', 'academic_year_id'], 'uq_semester_id_year');
        });

        Schema::create('app_settings', function (Blueprint $table): void {
            $table->unsignedTinyInteger('id')->primary();
            $table->foreignId('current_semester_id')->nullable()->constrained('semesters')->restrictOnDelete();
            $table->unsignedBigInteger('catalog_revision')->default(0);
            $table->string('timezone', 100);
            $table->timestamps();
        });

        DB::table('app_settings')->insert([
            'id' => 1,
            'current_semester_id' => null,
            'catalog_revision' => 0,
            'timezone' => env('SCHOOL_TIMEZONE', 'Asia/Shanghai'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Schema::create('grades', function (Blueprint $table): void {
            $table->id();
            $table->string('name', 100)->unique();
            $table->unsignedInteger('sort_order')->unique();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('teachers', function (Blueprint $table): void {
            $table->id();
            $table->string('employee_no', 50)->nullable()->unique();
            $table->string('name', 100);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('courses', function (Blueprint $table): void {
            $table->id();
            $table->string('name', 100)->unique();
            $table->string('short_name', 50)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('teacher_course', function (Blueprint $table): void {
            $table->foreignId('teacher_id')->constrained()->cascadeOnDelete();
            $table->foreignId('course_id')->constrained()->cascadeOnDelete();
            $table->primary(['teacher_id', 'course_id']);
        });

        Schema::create('rooms', function (Blueprint $table): void {
            $table->id();
            $table->string('name', 100)->unique();
            $table->string('type', 30);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('school_classes', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('academic_year_id')->constrained()->restrictOnDelete();
            $table->foreignId('grade_id')->constrained()->restrictOnDelete();
            $table->string('name', 100);
            $table->string('code', 50)->nullable();
            $table->string('status', 20)->default('active');
            $table->timestamps();
            $table->unique(['academic_year_id', 'name'], 'uq_class_year_name');
            $table->unique(['academic_year_id', 'code'], 'uq_class_year_code');
            $table->unique(['id', 'academic_year_id'], 'uq_class_id_year');
        });

        Schema::create('semester_class_settings', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id');
            $table->foreignId('academic_year_id');
            $table->foreignId('school_class_id');
            $table->foreignId('fixed_room_id')->nullable()->constrained('rooms')->restrictOnDelete();
            $table->foreignId('homeroom_teacher_id')->nullable()->constrained('teachers')->restrictOnDelete();
            $table->string('status', 20)->default('active');
            $table->timestamps();
            $table->unique(['semester_id', 'school_class_id'], 'uq_semester_class_setting');
            $table->foreign(['semester_id', 'academic_year_id'], 'fk_setting_semester_year')
                ->references(['id', 'academic_year_id'])->on('semesters')->restrictOnDelete();
            $table->foreign(['school_class_id', 'academic_year_id'], 'fk_setting_class_year')
                ->references(['id', 'academic_year_id'])->on('school_classes')->restrictOnDelete();
        });

        Schema::create('schedule_templates', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id')->unique()->constrained()->restrictOnDelete();
            $table->string('name', 100);
            $table->timestamps();
            $table->unique(['id', 'semester_id'], 'uq_template_id_semester');
        });

        Schema::create('schedule_template_days', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('schedule_template_id');
            $table->foreignId('semester_id');
            $table->unsignedTinyInteger('weekday');
            $table->boolean('is_enabled')->default(false);
            $table->unique(['schedule_template_id', 'weekday'], 'uq_template_weekday');
            $table->unique(['semester_id', 'weekday'], 'uq_semester_weekday');
            $table->foreign(['schedule_template_id', 'semester_id'], 'fk_day_template_semester')
                ->references(['id', 'semester_id'])->on('schedule_templates')->cascadeOnDelete();
        });

        Schema::create('items', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('schedule_template_id');
            $table->foreignId('semester_id');
            $table->string('name', 100);
            $table->string('type', 30);
            $table->time('start_time');
            $table->time('end_time');
            $table->unsignedInteger('sort_order');
            $table->boolean('allows_course');
            $table->boolean('allows_teacher');
            $table->boolean('counts_as_course');
            $table->boolean('show_in_official');
            $table->boolean('show_in_full')->default(true);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['schedule_template_id', 'sort_order'], 'uq_item_sort');
            $table->unique(['schedule_template_id', 'name'], 'uq_item_name');
            $table->unique(['id', 'semester_id'], 'uq_item_id_semester');
            $table->foreign(['schedule_template_id', 'semester_id'], 'fk_item_template_semester')
                ->references(['id', 'semester_id'])->on('schedule_templates')->cascadeOnDelete();
        });

        Schema::create('teaching_tasks', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id');
            $table->foreignId('academic_year_id');
            $table->foreignId('school_class_id');
            $table->foreignId('course_id')->constrained()->restrictOnDelete();
            $table->foreignId('teacher_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('weekly_items');
            $table->string('room_mode', 30);
            $table->foreignId('specified_room_id')->nullable()->constrained('rooms')->restrictOnDelete();
            $table->string('status', 20)->default('draft');
            $table->timestamps();
            $table->unique(['semester_id', 'school_class_id', 'course_id'], 'uq_task_class_course');
            $table->unique(['id', 'semester_id', 'school_class_id', 'course_id', 'teacher_id'], 'uq_task_snapshot');
            $table->foreign(['semester_id', 'academic_year_id'], 'fk_task_semester_year')
                ->references(['id', 'academic_year_id'])->on('semesters')->restrictOnDelete();
            $table->foreign(['school_class_id', 'academic_year_id'], 'fk_task_class_year')
                ->references(['id', 'academic_year_id'])->on('school_classes')->restrictOnDelete();
            $table->foreign(['semester_id', 'school_class_id'], 'fk_task_class_setting')
                ->references(['semester_id', 'school_class_id'])->on('semester_class_settings')->restrictOnDelete();
        });

        Schema::create('timetable_entries', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id');
            $table->foreignId('teaching_task_id');
            $table->foreignId('school_class_id');
            $table->foreignId('teacher_id');
            $table->foreignId('course_id');
            $table->foreignId('actual_room_id')->constrained('rooms')->restrictOnDelete();
            $table->unsignedTinyInteger('weekday');
            $table->foreignId('item_id');
            $table->string('source', 20)->default('manual');
            $table->boolean('is_locked')->default(false);
            $table->timestamps();
            $table->unique(['semester_id', 'school_class_id', 'weekday', 'item_id'], 'uq_timetable_class_slot');
            $table->unique(['semester_id', 'teacher_id', 'weekday', 'item_id'], 'uq_timetable_teacher_slot');
            $table->unique(['semester_id', 'actual_room_id', 'weekday', 'item_id'], 'uq_timetable_room_slot');
            $table->unique(['teaching_task_id', 'weekday', 'item_id'], 'uq_timetable_task_slot');
            $table->foreign(['teaching_task_id', 'semester_id', 'school_class_id', 'course_id', 'teacher_id'], 'fk_entry_task_snapshot')
                ->references(['id', 'semester_id', 'school_class_id', 'course_id', 'teacher_id'])->on('teaching_tasks')->restrictOnDelete();
            $table->foreign(['item_id', 'semester_id'], 'fk_entry_item_semester')
                ->references(['id', 'semester_id'])->on('items')->restrictOnDelete();
            $table->foreign(['semester_id', 'weekday'], 'fk_entry_day_semester')
                ->references(['semester_id', 'weekday'])->on('schedule_template_days')->restrictOnDelete();
        });

        Schema::create('audit_logs', function (Blueprint $table): void {
            $table->id();
            $table->string('actor_type', 20);
            $table->foreignId('actor_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('action', 80);
            $table->string('auditable_type', 100);
            $table->unsignedBigInteger('auditable_id')->nullable();
            $table->json('before_data')->nullable();
            $table->json('after_data')->nullable();
            $table->string('request_id', 80);
            $table->timestamp('created_at')->useCurrent();
            $table->index(['auditable_type', 'auditable_id']);
        });

        Schema::create('class_import_previews', function (Blueprint $table): void {
            $table->id();
            $table->string('token_hash', 64)->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('academic_year_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('catalog_revision');
            $table->string('file_sha256', 64);
            $table->json('normalized_rows');
            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();
            $table->string('committed_selection_hash', 64)->nullable();
            $table->json('commit_result')->nullable();
            $table->timestamp('created_at')->useCurrent();
        });

        $this->addMySqlChecks();
    }

    private function addMySqlChecks(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            return;
        }

        $checks = [
            'users' => ['ck_users_role' => "role in ('admin','scheduler','viewer')"],
            'academic_years' => [
                'ck_year_dates' => 'start_date < end_date',
                'ck_year_status' => "status in ('draft','open','closed')",
            ],
            'semesters' => [
                'ck_semester_sequence' => 'sequence in (1,2)',
                'ck_semester_dates' => 'start_date < end_date',
                'ck_semester_status' => "status in ('draft','open','closed')",
                'ck_semester_name' => "(sequence = 1 and name = '上学期') or (sequence = 2 and name = '下学期')",
            ],
            'rooms' => ['ck_room_type' => "type in ('classroom','playground','music_room','art_room','laboratory','computer_room','other')"],
            'school_classes' => ['ck_class_status' => "status in ('active','inactive')"],
            'semester_class_settings' => ['ck_setting_status' => "status in ('active','inactive')"],
            'schedule_template_days' => ['ck_weekday' => 'weekday between 1 and 7'],
            'items' => [
                'ck_item_type' => "type in ('course','fixed_non_course','self_study')",
                'ck_item_time' => 'start_time < end_time',
            ],
            'teaching_tasks' => [
                'ck_task_items' => 'weekly_items > 0',
                'ck_task_status' => "status in ('draft','confirmed','inactive')",
                'ck_task_room' => "(room_mode = 'class_default' and specified_room_id is null) or (room_mode = 'specified' and specified_room_id is not null)",
            ],
            'timetable_entries' => [
                'ck_entry_weekday' => 'weekday between 1 and 7',
                'ck_entry_source' => "source = 'manual'",
            ],
        ];

        foreach ($checks as $table => $tableChecks) {
            foreach ($tableChecks as $name => $expression) {
                DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$name} CHECK ({$expression})");
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('class_import_previews');
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('timetable_entries');
        Schema::dropIfExists('teaching_tasks');
        Schema::dropIfExists('items');
        Schema::dropIfExists('schedule_template_days');
        Schema::dropIfExists('schedule_templates');
        Schema::dropIfExists('semester_class_settings');
        Schema::dropIfExists('school_classes');
        Schema::dropIfExists('teacher_course');
        Schema::dropIfExists('rooms');
        Schema::dropIfExists('courses');
        Schema::dropIfExists('teachers');
        Schema::dropIfExists('grades');
        Schema::dropIfExists('app_settings');
        Schema::dropIfExists('semesters');
        Schema::dropIfExists('academic_years');
    }
};
