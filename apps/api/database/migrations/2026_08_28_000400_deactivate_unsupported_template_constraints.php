<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $unsupported = DB::table('scheduling_constraints')
            ->where('source', 'template')
            ->where('status', 'active')
            ->where('category', '!=', 'preferred_slot');
        $semesterIds = (clone $unsupported)
            ->pluck('semester_id')
            ->map(fn ($id): int => (int) $id)
            ->unique()
            ->values()
            ->all();

        if ($semesterIds === []) {
            return;
        }

        $unsupported->update([
            'status' => 'inactive',
            'updated_at' => now(),
        ]);
        DB::table('semesters')->whereIn('id', $semesterIds)->update([
            'input_revision' => DB::raw('input_revision + 1'),
            'constraint_revision' => DB::raw('constraint_revision + 1'),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        // The prior active/inactive state cannot be reconstructed safely. A rollback
        // must not silently reactivate template rules the scheduler cannot execute.
    }
};
