<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /** @var list<string> */
    private array $categories = [
        'course_distribution',
        'course_priority',
        'teacher_gaps',
        'workload_balance',
        'consecutive_items',
        'spacing',
    ];

    public function up(): void
    {
        $constraints = DB::table('scheduling_constraints')
            ->where('source', 'template')
            ->where('kind', 'soft')
            ->where('status', 'inactive')
            ->whereIn('category', $this->categories);
        $semesterIds = (clone $constraints)
            ->pluck('semester_id')
            ->map(fn ($id): int => (int) $id)
            ->unique()
            ->values()
            ->all();

        if ($semesterIds === []) {
            return;
        }

        $constraints->update(['status' => 'active', 'updated_at' => now()]);
        DB::table('semesters')->whereIn('id', $semesterIds)->update([
            'input_revision' => DB::raw('input_revision + 1'),
            'constraint_revision' => DB::raw('constraint_revision + 1'),
            'timetable_revision' => DB::raw('timetable_revision + 1'),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        // This is a one-way data repair. Deactivating every matching rule on rollback
        // would also overwrite rules that users intentionally enabled afterwards.
    }
};
