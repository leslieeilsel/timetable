<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->foreignId('teacher_id')
                ->nullable()
                ->after('role')
                ->unique()
                ->constrained('teachers')
                ->restrictOnDelete();
        });

        Schema::table('timetable_entries', function (Blueprint $table): void {
            $table->uuid('entry_key')->nullable()->after('id');
            $table->unique(['timetable_version_id', 'entry_key'], 'uq_timetable_version_entry_key');
        });

        DB::table('timetable_entries')
            ->select('id')
            ->orderBy('id')
            ->chunkById(500, function ($entries): void {
                foreach ($entries as $entry) {
                    DB::table('timetable_entries')->where('id', $entry->id)->update([
                        'entry_key' => (string) Str::uuid(),
                    ]);
                }
            });

        Schema::create('timetable_effective_periods', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id')->constrained()->restrictOnDelete();
            $table->foreignId('timetable_version_id')->constrained()->restrictOnDelete();
            $table->date('effective_from');
            $table->date('effective_to');
            $table->string('status', 20)->default('active');
            $table->text('reason');
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
            $table->index(
                ['semester_id', 'status', 'effective_from', 'effective_to'],
                'ix_effective_period_lookup',
            );
        });

        $semesters = DB::table('semesters')
            ->whereNotNull('current_timetable_version_id')
            ->orderBy('id')
            ->get(['id', 'start_date', 'end_date', 'current_timetable_version_id']);
        foreach ($semesters as $semester) {
            $creatorId = DB::table('timetable_versions')
                ->where('id', $semester->current_timetable_version_id)
                ->value('created_by');
            if ($creatorId === null) {
                continue;
            }
            DB::table('timetable_effective_periods')->insert([
                'semester_id' => $semester->id,
                'timetable_version_id' => $semester->current_timetable_version_id,
                'effective_from' => $semester->start_date,
                'effective_to' => $semester->end_date,
                'status' => 'active',
                'reason' => '迁移既有当前课表',
                'created_by' => $creatorId,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE users DROP CHECK ck_users_role');
            DB::statement("ALTER TABLE users ADD CONSTRAINT ck_users_role CHECK (role in ('admin','scheduler','viewer','teacher'))");
            DB::statement('ALTER TABLE timetable_effective_periods ADD CONSTRAINT ck_effective_period_dates CHECK (effective_from <= effective_to)');
            DB::statement("ALTER TABLE timetable_effective_periods ADD CONSTRAINT ck_effective_period_status CHECK (status in ('active','cancelled'))");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE users DROP CHECK ck_users_role');
            DB::statement("ALTER TABLE users ADD CONSTRAINT ck_users_role CHECK (role in ('admin','scheduler','viewer'))");
        }

        Schema::dropIfExists('timetable_effective_periods');
        Schema::table('timetable_entries', function (Blueprint $table): void {
            $table->dropUnique('uq_timetable_version_entry_key');
            $table->dropColumn('entry_key');
        });
        Schema::table('users', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('teacher_id');
        });
    }
};
