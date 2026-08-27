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
            $table->unsignedBigInteger('input_revision')->default(0);
            $table->unsignedBigInteger('assignment_revision')->default(0);
            $table->unsignedBigInteger('constraint_revision')->default(0);
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
            $table->foreignId('semester_id')->constrained()->restrictOnDelete();
            $table->string('name', 100);
            $table->unsignedTinyInteger('cycle_length')->default(1);
            $table->json('week_labels')->nullable();
            $table->boolean('is_default')->default(true);
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

        Schema::create('teaching_groups', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id')->constrained()->restrictOnDelete();
            $table->string('name', 100);
            $table->string('mode', 20);
            $table->string('status', 20)->default('active');
            $table->timestamps();
            $table->unique(['semester_id', 'name'], 'uq_teaching_group_name');
            $table->unique(['id', 'semester_id'], 'uq_teaching_group_semester');
        });

        Schema::create('teaching_group_classes', function (Blueprint $table): void {
            $table->foreignId('teaching_group_id')->constrained()->cascadeOnDelete();
            $table->foreignId('school_class_id')->constrained()->restrictOnDelete();
            $table->primary(['teaching_group_id', 'school_class_id']);
        });

        Schema::create('teaching_assignments', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id');
            $table->foreignId('academic_year_id');
            $table->foreignId('school_class_id')->nullable();
            $table->foreignId('teaching_group_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('course_id')->constrained()->restrictOnDelete();
            $table->foreignId('teacher_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('weekly_items');
            $table->unsignedTinyInteger('items_per_session')->default(1);
            $table->string('week_pattern', 20)->default('all');
            $table->json('active_weeks')->nullable();
            $table->string('room_mode', 30);
            $table->foreignId('specified_room_id')->nullable()->constrained('rooms')->restrictOnDelete();
            $table->boolean('allows_substitution')->default(true);
            $table->string('status', 20)->default('draft');
            $table->timestamps();
            $table->unique(['semester_id', 'school_class_id', 'course_id', 'week_pattern'], 'uq_assignment_class_course');
            $table->unique(['semester_id', 'teaching_group_id', 'course_id', 'week_pattern'], 'uq_assignment_group_course');
            $table->unique(['id', 'semester_id'], 'uq_assignment_semester');
            $table->foreign(['semester_id', 'academic_year_id'], 'fk_assignment_semester_year')
                ->references(['id', 'academic_year_id'])->on('semesters')->restrictOnDelete();
            $table->foreign(['school_class_id', 'academic_year_id'], 'fk_assignment_class_year')
                ->references(['id', 'academic_year_id'])->on('school_classes')->restrictOnDelete();
        });

        Schema::create('teaching_assignment_collaborators', function (Blueprint $table): void {
            $table->foreignId('teaching_assignment_id')->constrained()->cascadeOnDelete();
            $table->foreignId('teacher_id')->constrained()->restrictOnDelete();
            $table->string('role', 20)->default('collaborator');
            $table->primary(['teaching_assignment_id', 'teacher_id']);
        });

        Schema::create('scheduling_constraints', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id')->constrained()->restrictOnDelete();
            $table->string('name', 120);
            $table->string('kind', 20);
            $table->string('category', 50);
            $table->string('target_type', 40)->nullable();
            $table->unsignedBigInteger('target_id')->nullable();
            $table->json('scope');
            $table->json('condition')->nullable();
            $table->json('requirement');
            $table->unsignedSmallInteger('weight')->nullable();
            $table->string('source', 20)->default('user');
            $table->string('status', 20)->default('draft');
            $table->text('explanation')->nullable();
            $table->timestamps();
            $table->index(['semester_id', 'kind', 'status']);
            $table->index(['target_type', 'target_id']);
        });

        Schema::create('fixed_placements', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id');
            $table->foreignId('teaching_assignment_id');
            $table->string('week_pattern', 20)->default('all');
            $table->json('active_weeks')->nullable();
            $table->unsignedTinyInteger('weekday');
            $table->foreignId('item_id');
            $table->foreignId('room_id')->nullable()->constrained('rooms')->restrictOnDelete();
            $table->boolean('is_locked')->default(true);
            $table->string('status', 20)->default('active');
            $table->timestamps();
            $table->unique(['semester_id', 'teaching_assignment_id', 'week_pattern', 'weekday', 'item_id'], 'uq_fixed_assignment_slot');
            $table->foreign(['teaching_assignment_id', 'semester_id'], 'fk_fixed_assignment_semester')
                ->references(['id', 'semester_id'])->on('teaching_assignments')->restrictOnDelete();
            $table->foreign(['item_id', 'semester_id'], 'fk_fixed_item_semester')
                ->references(['id', 'semester_id'])->on('items')->restrictOnDelete();
        });

        Schema::create('schedule_runs', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id')->constrained()->restrictOnDelete();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->string('status', 20)->default('queued');
            $table->json('scope');
            $table->json('preservation');
            $table->json('constraint_snapshot');
            $table->json('strategy');
            $table->unsignedTinyInteger('candidate_count')->default(3);
            $table->unsignedBigInteger('input_revision');
            $table->string('algorithm_version', 50);
            $table->unsignedBigInteger('random_seed');
            $table->string('progress_stage', 40)->default('queued');
            $table->unsignedTinyInteger('progress_percent')->default(0);
            $table->string('error_code', 80)->nullable();
            $table->text('error_message')->nullable();
            $table->json('diagnostics')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
            $table->index(['semester_id', 'status']);
        });

        Schema::create('schedule_candidates', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('schedule_run_id')->constrained()->cascadeOnDelete();
            $table->foreignId('semester_id')->constrained()->restrictOnDelete();
            $table->unsignedTinyInteger('rank');
            $table->string('name', 100);
            $table->decimal('quality_score', 5, 2)->nullable();
            $table->json('score_breakdown');
            $table->unsignedInteger('hard_conflict_count')->default(0);
            $table->unsignedInteger('soft_warning_count')->default(0);
            $table->unsignedInteger('unscheduled_count')->default(0);
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['schedule_run_id', 'rank']);
            $table->index(['semester_id', 'quality_score']);
        });

        Schema::create('schedule_candidate_entries', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('schedule_candidate_id')->constrained()->cascadeOnDelete();
            $table->foreignId('teaching_assignment_id')->constrained()->restrictOnDelete();
            $table->string('week_pattern', 20)->default('all');
            $table->json('active_weeks')->nullable();
            $table->unsignedTinyInteger('weekday');
            $table->foreignId('item_id')->constrained('items')->restrictOnDelete();
            $table->foreignId('actual_room_id')->constrained('rooms')->restrictOnDelete();
            $table->boolean('is_locked')->default(false);
            $table->unique(['schedule_candidate_id', 'teaching_assignment_id', 'week_pattern', 'weekday', 'item_id'], 'uq_candidate_assignment_slot');
        });

        Schema::create('timetable_versions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('version_no');
            $table->string('name', 120);
            $table->string('status', 20)->default('draft');
            $table->string('source', 20)->default('manual');
            $table->foreignId('source_candidate_id')->nullable()->unique()->constrained('schedule_candidates')->nullOnDelete();
            $table->foreignId('base_version_id')->nullable()->constrained('timetable_versions')->nullOnDelete();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->unsignedBigInteger('input_revision');
            $table->decimal('quality_score', 5, 2)->nullable();
            $table->json('score_breakdown')->nullable();
            $table->unsignedInteger('hard_conflict_count')->default(0);
            $table->unsignedInteger('soft_warning_count')->default(0);
            $table->timestamp('activated_at')->nullable();
            $table->timestamps();
            $table->unique(['semester_id', 'version_no']);
            $table->index(['semester_id', 'status']);
        });

        Schema::table('semesters', function (Blueprint $table): void {
            $table->foreignId('current_timetable_version_id')->nullable()->after('input_revision')
                ->constrained('timetable_versions')->nullOnDelete();
        });

        Schema::create('timetable_entries', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id');
            $table->foreignId('timetable_version_id')->constrained()->cascadeOnDelete();
            $table->foreignId('teaching_assignment_id');
            $table->foreignId('school_class_id')->nullable();
            $table->foreignId('teaching_group_id')->nullable();
            $table->foreignId('teacher_id');
            $table->foreignId('course_id');
            $table->foreignId('actual_room_id')->constrained('rooms')->restrictOnDelete();
            $table->string('week_pattern', 20)->default('all');
            $table->json('active_weeks')->nullable();
            $table->unsignedTinyInteger('weekday');
            $table->foreignId('item_id');
            $table->string('source', 20)->default('manual');
            $table->boolean('is_locked')->default(false);
            $table->timestamps();
            $table->index(['timetable_version_id', 'school_class_id', 'weekday', 'item_id'], 'ix_timetable_class_slot');
            $table->index(['timetable_version_id', 'teacher_id', 'weekday', 'item_id'], 'ix_timetable_teacher_slot');
            $table->index(['timetable_version_id', 'actual_room_id', 'weekday', 'item_id'], 'ix_timetable_room_slot');
            $table->unique(['timetable_version_id', 'teaching_assignment_id', 'week_pattern', 'weekday', 'item_id'], 'uq_timetable_assignment_slot');
            $table->unique(['id', 'timetable_version_id'], 'uq_entry_version');
            $table->foreign(['teaching_assignment_id', 'semester_id'], 'fk_entry_assignment_semester')
                ->references(['id', 'semester_id'])->on('teaching_assignments')->restrictOnDelete();
            $table->foreign(['teaching_group_id', 'semester_id'], 'fk_entry_group_semester')
                ->references(['id', 'semester_id'])->on('teaching_groups')->restrictOnDelete();
            $table->foreign(['item_id', 'semester_id'], 'fk_entry_item_semester')
                ->references(['id', 'semester_id'])->on('items')->restrictOnDelete();
            $table->foreign(['semester_id', 'weekday'], 'fk_entry_day_semester')
                ->references(['semester_id', 'weekday'])->on('schedule_template_days')->restrictOnDelete();
        });

        Schema::create('timetable_entry_classes', function (Blueprint $table): void {
            $table->foreignId('timetable_entry_id');
            $table->foreignId('timetable_version_id');
            $table->foreignId('school_class_id')->constrained()->restrictOnDelete();
            $table->string('week_pattern', 20);
            $table->unsignedTinyInteger('weekday');
            $table->foreignId('item_id')->constrained('items')->restrictOnDelete();
            $table->primary(['timetable_entry_id', 'school_class_id']);
            $table->index(['timetable_version_id', 'school_class_id', 'weekday', 'item_id'], 'ix_entry_class_slot');
            $table->foreign(['timetable_entry_id', 'timetable_version_id'], 'fk_entry_class_version')
                ->references(['id', 'timetable_version_id'])->on('timetable_entries')->cascadeOnDelete();
        });

        Schema::create('timetable_entry_teachers', function (Blueprint $table): void {
            $table->foreignId('timetable_entry_id');
            $table->foreignId('timetable_version_id');
            $table->foreignId('teacher_id')->constrained()->restrictOnDelete();
            $table->string('week_pattern', 20);
            $table->unsignedTinyInteger('weekday');
            $table->foreignId('item_id')->constrained('items')->restrictOnDelete();
            $table->primary(['timetable_entry_id', 'teacher_id']);
            $table->index(['timetable_version_id', 'teacher_id', 'weekday', 'item_id'], 'ix_entry_teacher_slot');
            $table->foreign(['timetable_entry_id', 'timetable_version_id'], 'fk_entry_teacher_version')
                ->references(['id', 'timetable_version_id'])->on('timetable_entries')->cascadeOnDelete();
        });

        Schema::create('calendar_exceptions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id')->constrained()->restrictOnDelete();
            $table->foreignId('timetable_version_id')->constrained()->restrictOnDelete();
            $table->date('effective_date');
            $table->date('replacement_date')->nullable();
            $table->string('type', 30);
            $table->foreignId('original_entry_id')->nullable()->constrained('timetable_entries')->restrictOnDelete();
            $table->foreignId('related_entry_id')->nullable()->constrained('timetable_entries')->restrictOnDelete();
            $table->foreignId('replacement_assignment_id')->nullable()->constrained('teaching_assignments')->restrictOnDelete();
            $table->foreignId('replacement_teacher_id')->nullable()->constrained('teachers')->restrictOnDelete();
            $table->foreignId('replacement_room_id')->nullable()->constrained('rooms')->restrictOnDelete();
            $table->foreignId('replacement_item_id')->nullable()->constrained('items')->restrictOnDelete();
            $table->string('title', 120)->nullable();
            $table->string('status', 20)->default('active');
            $table->text('reason');
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
            $table->index(['semester_id', 'effective_date', 'status']);
            $table->index(['semester_id', 'replacement_date', 'status']);
        });

        Schema::create('teacher_leaves', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id')->constrained()->restrictOnDelete();
            $table->foreignId('teacher_id')->constrained()->restrictOnDelete();
            $table->dateTime('starts_at');
            $table->dateTime('ends_at');
            $table->string('type', 30);
            $table->string('status', 20)->default('active');
            $table->text('reason')->nullable();
            $table->boolean('includes_non_course_items')->default(false);
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
            $table->index(['teacher_id', 'starts_at', 'ends_at']);
        });

        Schema::create('substitutions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('teacher_leave_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('calendar_exception_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('original_entry_id')->constrained('timetable_entries')->restrictOnDelete();
            $table->date('effective_date');
            $table->foreignId('replacement_teacher_id')->constrained('teachers')->restrictOnDelete();
            $table->string('status', 20)->default('active');
            $table->text('reason')->nullable();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
            $table->unique(['original_entry_id', 'effective_date'], 'uq_substitution_entry_date');
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
            'schedule_templates' => ['ck_template_cycle' => 'cycle_length in (1,2)'],
            'schedule_template_days' => ['ck_weekday' => 'weekday between 1 and 7'],
            'items' => [
                'ck_item_type' => "type in ('course','fixed_non_course','self_study')",
                'ck_item_time' => 'start_time < end_time',
            ],
            'teaching_assignments' => [
                'ck_assignment_items' => 'weekly_items > 0',
                'ck_assignment_session_items' => 'items_per_session > 0 and items_per_session <= weekly_items',
                'ck_assignment_status' => "status in ('draft','confirmed','inactive')",
                'ck_assignment_target' => '(school_class_id is not null and teaching_group_id is null) or (school_class_id is null and teaching_group_id is not null)',
                'ck_assignment_week_pattern' => "week_pattern in ('all','a','b','specified')",
                'ck_assignment_room' => "(room_mode = 'class_default' and specified_room_id is null) or (room_mode = 'specified' and specified_room_id is not null)",
            ],
            'teaching_groups' => [
                'ck_teaching_group_mode' => "mode in ('combined','split','roaming')",
                'ck_teaching_group_status' => "status in ('active','inactive')",
            ],
            'teaching_assignment_collaborators' => ['ck_assignment_collaborator_role' => "role in ('collaborator','assistant')"],
            'scheduling_constraints' => [
                'ck_constraint_kind' => "kind in ('hard','soft')",
                'ck_constraint_status' => "status in ('draft','active','inactive')",
                'ck_constraint_source' => "source in ('system','template','user','copied')",
                'ck_constraint_weight' => "(kind = 'hard' and weight is null) or (kind = 'soft' and weight between 1 and 100)",
            ],
            'fixed_placements' => [
                'ck_fixed_weekday' => 'weekday between 1 and 7',
                'ck_fixed_week_pattern' => "week_pattern in ('all','a','b','specified')",
                'ck_fixed_status' => "status in ('active','inactive')",
            ],
            'schedule_runs' => [
                'ck_run_status' => "status in ('queued','checking','solving','optimizing','building_candidates','completed','failed','cancelled')",
                'ck_run_candidate_count' => 'candidate_count between 1 and 3',
                'ck_run_progress' => 'progress_percent between 0 and 100',
            ],
            'timetable_versions' => [
                'ck_version_status' => "status in ('draft','active','historical')",
                'ck_version_source' => "source in ('manual','candidate','restored')",
            ],
            'timetable_entries' => [
                'ck_entry_target' => '(school_class_id is not null and teaching_group_id is null) or (school_class_id is null and teaching_group_id is not null)',
                'ck_entry_weekday' => 'weekday between 1 and 7',
                'ck_entry_week_pattern' => "week_pattern in ('all','a','b','specified')",
                'ck_entry_source' => "source in ('manual','automatic','restored')",
            ],
            'timetable_entry_classes' => [
                'ck_entry_class_weekday' => 'weekday between 1 and 7',
                'ck_entry_class_week_pattern' => "week_pattern in ('all','a','b','specified')",
            ],
            'timetable_entry_teachers' => [
                'ck_entry_teacher_weekday' => 'weekday between 1 and 7',
                'ck_entry_teacher_week_pattern' => "week_pattern in ('all','a','b','specified')",
            ],
            'calendar_exceptions' => [
                'ck_exception_type' => "type in ('move','swap','teacher_change','room_change','cancel','makeup','activity')",
                'ck_exception_status' => "status in ('draft','active','cancelled')",
            ],
            'teacher_leaves' => [
                'ck_leave_dates' => 'starts_at < ends_at',
                'ck_leave_status' => "status in ('draft','active','cancelled')",
            ],
            'substitutions' => ['ck_substitution_status' => "status in ('draft','active','cancelled')"],
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
        Schema::dropIfExists('substitutions');
        Schema::dropIfExists('teacher_leaves');
        Schema::dropIfExists('calendar_exceptions');
        Schema::dropIfExists('timetable_entry_teachers');
        Schema::dropIfExists('timetable_entry_classes');
        Schema::dropIfExists('timetable_entries');
        Schema::table('semesters', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('current_timetable_version_id');
        });
        Schema::dropIfExists('timetable_versions');
        Schema::dropIfExists('schedule_candidate_entries');
        Schema::dropIfExists('schedule_candidates');
        Schema::dropIfExists('schedule_runs');
        Schema::dropIfExists('fixed_placements');
        Schema::dropIfExists('scheduling_constraints');
        Schema::dropIfExists('teaching_assignment_collaborators');
        Schema::dropIfExists('teaching_assignments');
        Schema::dropIfExists('teaching_group_classes');
        Schema::dropIfExists('teaching_groups');
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
