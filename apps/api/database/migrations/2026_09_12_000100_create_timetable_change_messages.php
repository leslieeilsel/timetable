<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('timetable_change_messages', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('calendar_exception_id')->constrained()->cascadeOnDelete();
            $table->foreignId('teacher_id')->constrained()->cascadeOnDelete();
            $table->string('event', 20);
            $table->json('changes');
            $table->timestamp('read_at')->nullable();
            $table->timestamps();
            $table->unique(['calendar_exception_id', 'teacher_id', 'event'], 'change_message_recipient');
            $table->index(['teacher_id', 'read_at', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('timetable_change_messages');
    }
};
