<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('long_term_changes', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('semester_id')->constrained()->cascadeOnDelete();
            $table->date('effective_from');
            $table->date('effective_to');
            $table->date('restored_from')->nullable();
            $table->string('reason', 500);
            $table->text('search_text');
            $table->json('changes');
            $table->json('segments');
            $table->foreignId('created_by')->constrained('users');
            $table->timestamps();
            $table->index(['semester_id', 'effective_from']);
        });
        Schema::table('timetable_change_messages', function (Blueprint $table): void {
            $table->unsignedBigInteger('calendar_exception_id')->nullable()->change();
            $table->foreignId('long_term_change_id')->nullable()->constrained()->cascadeOnDelete();
            $table->unique(['long_term_change_id', 'teacher_id', 'event'], 'long_term_message_recipient');
        });
    }

    public function down(): void
    {
        DB::table('timetable_change_messages')->whereNotNull('long_term_change_id')->delete();
        Schema::table('timetable_change_messages', function (Blueprint $table): void {
            $table->dropUnique('long_term_message_recipient');
            $table->dropConstrainedForeignId('long_term_change_id');
        });
        Schema::dropIfExists('long_term_changes');
    }
};
