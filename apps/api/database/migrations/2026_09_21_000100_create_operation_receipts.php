<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('operation_receipts', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('actor_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('semester_id')->constrained('semesters')->cascadeOnDelete();
            $table->string('operation', 60);
            $table->uuid('idempotency_key');
            $table->char('payload_hash', 64);
            $table->json('response_body');
            $table->string('etag');
            $table->timestamp('created_at');
            $table->unique(['actor_user_id', 'semester_id', 'operation', 'idempotency_key'], 'operation_receipt_key');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('operation_receipts');
    }
};
