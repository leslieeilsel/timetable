<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('substitutions', function (Blueprint $table): void {
            $table->foreignId('replaced_teacher_id')
                ->nullable()
                ->after('original_entry_id')
                ->constrained('teachers')
                ->restrictOnDelete();
        });

        DB::table('substitutions')
            ->select(['id', 'teacher_leave_id', 'original_entry_id'])
            ->orderBy('id')
            ->chunkById(100, function ($rows): void {
                foreach ($rows as $row) {
                    $teacherId = $row->teacher_leave_id === null
                        ? null
                        : DB::table('teacher_leaves')->where('id', $row->teacher_leave_id)->value('teacher_id');
                    $teacherId ??= DB::table('timetable_entries')
                        ->where('id', $row->original_entry_id)
                        ->value('teacher_id');
                    DB::table('substitutions')->where('id', $row->id)->update([
                        'replaced_teacher_id' => $teacherId,
                    ]);
                }
            });

        Schema::table('substitutions', function (Blueprint $table): void {
            $table->dropUnique('uq_substitution_entry_date');
            $table->unique(
                ['teacher_leave_id', 'original_entry_id', 'effective_date', 'replaced_teacher_id'],
                'uq_substitution_leave_entry_date_teacher',
            );
        });
    }

    public function down(): void
    {
        $hasDuplicates = DB::table('substitutions')
            ->select(['original_entry_id', 'effective_date'])
            ->groupBy('original_entry_id', 'effective_date')
            ->havingRaw('COUNT(*) > 1')
            ->exists();
        if ($hasDuplicates) {
            throw new RuntimeException('Cannot safely restore the legacy substitution uniqueness constraint.');
        }

        Schema::table('substitutions', function (Blueprint $table): void {
            $table->dropUnique('uq_substitution_leave_entry_date_teacher');
            $table->unique(['original_entry_id', 'effective_date'], 'uq_substitution_entry_date');
            $table->dropConstrainedForeignId('replaced_teacher_id');
        });
    }
};
