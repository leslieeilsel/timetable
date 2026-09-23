<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lesson_instances', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id')->constrained()->restrictOnDelete();
            $table->foreignId('teaching_assignment_id')->constrained()->restrictOnDelete();
            $table->unsignedSmallInteger('occurrence_no');
            $table->string('status', 20)->default('active');
            $table->timestamps();
            $table->unique(
                ['semester_id', 'teaching_assignment_id', 'occurrence_no'],
                'uq_lesson_instance_occurrence',
            );
            $table->index(['semester_id', 'teaching_assignment_id'], 'ix_lesson_instance_assignment');
        });

        Schema::table('timetable_entries', function (Blueprint $table): void {
            $table->foreignId('lesson_instance_id')
                ->nullable()
                ->after('entry_key')
                ->constrained('lesson_instances')
                ->restrictOnDelete();
            $table->unique(
                ['timetable_version_id', 'lesson_instance_id'],
                'uq_timetable_version_lesson_instance',
            );
        });

        Schema::table('calendar_exceptions', function (Blueprint $table): void {
            $table->foreignId('lesson_instance_id')
                ->nullable()
                ->after('original_entry_id')
                ->constrained('lesson_instances')
                ->restrictOnDelete();
            $table->foreignId('related_lesson_instance_id')
                ->nullable()
                ->after('related_entry_id')
                ->constrained('lesson_instances')
                ->restrictOnDelete();
        });

        Schema::table('substitutions', function (Blueprint $table): void {
            $table->foreignId('lesson_instance_id')
                ->nullable()
                ->after('original_entry_id')
                ->constrained('lesson_instances')
                ->restrictOnDelete();
            $table->index(['lesson_instance_id', 'effective_date'], 'ix_substitution_lesson_date');
        });

        $this->backfillLessonInstances();
        $this->backfillOperationalReferences();
    }

    public function down(): void
    {
        Schema::table('substitutions', function (Blueprint $table): void {
            $table->dropIndex('ix_substitution_lesson_date');
            $table->dropConstrainedForeignId('lesson_instance_id');
        });
        Schema::table('calendar_exceptions', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('related_lesson_instance_id');
            $table->dropConstrainedForeignId('lesson_instance_id');
        });
        Schema::table('timetable_entries', function (Blueprint $table): void {
            $table->dropUnique('uq_timetable_version_lesson_instance');
            $table->dropConstrainedForeignId('lesson_instance_id');
        });
        Schema::dropIfExists('lesson_instances');
    }

    private function backfillLessonInstances(): void
    {
        $assignments = DB::table('teaching_assignments')
            ->select(['id', 'semester_id', 'weekly_items'])
            ->whereExists(function ($query): void {
                $query->selectRaw('1')
                    ->from('timetable_entries')
                    ->whereColumn('timetable_entries.teaching_assignment_id', 'teaching_assignments.id');
            })
            ->orderBy('semester_id')
            ->orderBy('id')
            ->get();

        foreach ($assignments as $assignment) {
            $counts = DB::table('timetable_entries')
                ->where('teaching_assignment_id', $assignment->id)
                ->selectRaw('timetable_version_id, COUNT(*) AS entry_count')
                ->groupBy('timetable_version_id')
                ->pluck('entry_count');
            $required = max((int) $assignment->weekly_items, (int) ($counts->max() ?? 0));
            if ($required < 1) {
                continue;
            }

            $timestamp = now();
            $rows = [];
            for ($occurrence = 1; $occurrence <= $required; $occurrence++) {
                $rows[] = [
                    'semester_id' => $assignment->semester_id,
                    'teaching_assignment_id' => $assignment->id,
                    'occurrence_no' => $occurrence,
                    'status' => 'active',
                    'created_at' => $timestamp,
                    'updated_at' => $timestamp,
                ];
            }
            DB::table('lesson_instances')->insert($rows);
            $instances = DB::table('lesson_instances')
                ->where('teaching_assignment_id', $assignment->id)
                ->orderBy('occurrence_no')
                ->pluck('id')
                ->map(fn ($id): int => (int) $id)
                ->values()
                ->all();

            $currentVersionId = DB::table('semesters')
                ->where('id', $assignment->semester_id)
                ->value('current_timetable_version_id');
            $versionIds = DB::table('timetable_entries')
                ->where('teaching_assignment_id', $assignment->id)
                ->distinct()
                ->pluck('timetable_version_id')
                ->map(fn ($id): int => (int) $id)
                ->values()
                ->all();
            usort($versionIds, function (int $left, int $right) use ($currentVersionId): int {
                if ($left === (int) $currentVersionId) {
                    return -1;
                }
                if ($right === (int) $currentVersionId) {
                    return 1;
                }

                return $right <=> $left;
            });

            $keyMap = [];
            foreach ($versionIds as $versionId) {
                $entries = DB::table('timetable_entries')
                    ->where('teaching_assignment_id', $assignment->id)
                    ->where('timetable_version_id', $versionId)
                    ->orderBy('week_pattern')
                    ->orderBy('weekday')
                    ->orderBy('item_id')
                    ->orderBy('id')
                    ->get(['id', 'entry_key']);
                $used = [];
                foreach ($entries as $entry) {
                    $instanceId = null;
                    if ($entry->entry_key !== null && isset($keyMap[$entry->entry_key])) {
                        $candidate = $keyMap[$entry->entry_key];
                        if (! isset($used[$candidate])) {
                            $instanceId = $candidate;
                        }
                    }
                    if ($instanceId === null) {
                        foreach ($instances as $candidate) {
                            if (! isset($used[$candidate])) {
                                $instanceId = $candidate;
                                break;
                            }
                        }
                    }
                    if ($instanceId === null) {
                        continue;
                    }
                    DB::table('timetable_entries')->where('id', $entry->id)->update([
                        'lesson_instance_id' => $instanceId,
                    ]);
                    $used[$instanceId] = true;
                    if ($entry->entry_key !== null && ! isset($keyMap[$entry->entry_key])) {
                        $keyMap[$entry->entry_key] = $instanceId;
                    }
                }
            }
        }
    }

    private function backfillOperationalReferences(): void
    {
        DB::table('calendar_exceptions')
            ->whereNotNull('original_entry_id')
            ->orderBy('id')
            ->chunkById(500, function ($rows): void {
                foreach ($rows as $row) {
                    DB::table('calendar_exceptions')->where('id', $row->id)->update([
                        'lesson_instance_id' => DB::table('timetable_entries')
                            ->where('id', $row->original_entry_id)
                            ->value('lesson_instance_id'),
                    ]);
                }
            });

        DB::table('calendar_exceptions')
            ->whereNotNull('related_entry_id')
            ->orderBy('id')
            ->chunkById(500, function ($rows): void {
                foreach ($rows as $row) {
                    DB::table('calendar_exceptions')->where('id', $row->id)->update([
                        'related_lesson_instance_id' => DB::table('timetable_entries')
                            ->where('id', $row->related_entry_id)
                            ->value('lesson_instance_id'),
                    ]);
                }
            });

        DB::table('substitutions')
            ->orderBy('id')
            ->chunkById(500, function ($rows): void {
                foreach ($rows as $row) {
                    DB::table('substitutions')->where('id', $row->id)->update([
                        'lesson_instance_id' => DB::table('timetable_entries')
                            ->where('id', $row->original_entry_id)
                            ->value('lesson_instance_id'),
                    ]);
                }
            });
    }
};
