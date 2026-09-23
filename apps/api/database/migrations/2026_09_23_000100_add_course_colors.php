<?php

use App\Modules\Resources\Services\CoursePalette;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('courses', function (Blueprint $table): void {
            $table->string('color', 7)->nullable();
        });
        Schema::table('app_settings', function (Blueprint $table): void {
            $table->unsignedBigInteger('appearance_revision')->default(0);
        });

        // Assign once, with active subjects first. Later renames never recalculate colors.
        $colors = CoursePalette::colors();
        foreach (DB::table('courses')->orderByDesc('is_active')->orderBy('id')->pluck('id') as $index => $id) {
            DB::table('courses')->where('id', $id)->update(['color' => $colors[$index % count($colors)]]);
        }
    }

    public function down(): void
    {
        Schema::table('courses', fn (Blueprint $table) => $table->dropColumn('color'));
        Schema::table('app_settings', fn (Blueprint $table) => $table->dropColumn('appearance_revision'));
    }
};
