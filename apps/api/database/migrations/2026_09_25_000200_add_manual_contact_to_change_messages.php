<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('timetable_change_messages', function (Blueprint $table): void {
            $table->timestamp('contacted_at')->nullable();
            $table->foreignId('contacted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('contact_note', 500)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('timetable_change_messages', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('contacted_by');
            $table->dropColumn(['contacted_at', 'contact_note']);
        });
    }
};
