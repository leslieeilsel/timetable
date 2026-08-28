<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('schedule_runs', function (Blueprint $table): void {
            $table->unsignedBigInteger('catalog_revision')->nullable()->after('input_revision');
            $table->unsignedBigInteger('timetable_revision')->nullable()->after('catalog_revision');
            $table->unsignedBigInteger('assignment_revision')->nullable()->after('timetable_revision');
            $table->unsignedBigInteger('constraint_revision')->nullable()->after('assignment_revision');
            $table->unsignedBigInteger('base_version_id')->nullable()->after('constraint_revision')->index();
            $table->char('base_version_fingerprint', 64)->nullable()->after('base_version_id');
        });

        Schema::table('timetable_versions', function (Blueprint $table): void {
            $table->unsignedBigInteger('catalog_revision')->nullable()->after('input_revision');
        });

        Schema::create('jobs', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->string('queue')->index();
            $table->longText('payload');
            $table->unsignedTinyInteger('attempts');
            $table->unsignedInteger('reserved_at')->nullable();
            $table->unsignedInteger('available_at');
            $table->unsignedInteger('created_at');
        });

        Schema::create('failed_jobs', function (Blueprint $table): void {
            $table->id();
            $table->string('uuid')->unique();
            $table->text('connection');
            $table->text('queue');
            $table->longText('payload');
            $table->longText('exception');
            $table->timestamp('failed_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('failed_jobs');
        Schema::dropIfExists('jobs');

        Schema::table('timetable_versions', function (Blueprint $table): void {
            $table->dropColumn('catalog_revision');
        });

        Schema::table('schedule_runs', function (Blueprint $table): void {
            $table->dropIndex(['base_version_id']);
            $table->dropColumn([
                'catalog_revision',
                'timetable_revision',
                'assignment_revision',
                'constraint_revision',
                'base_version_id',
                'base_version_fingerprint',
            ]);
        });
    }
};
