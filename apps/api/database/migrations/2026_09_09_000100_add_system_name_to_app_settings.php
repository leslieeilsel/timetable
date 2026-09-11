<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('app_settings', function (Blueprint $table): void {
            $table->string('system_name', 60)->default('教务排课中心');
        });

        DB::table('app_settings')->where('timezone', '!=', 'Asia/Shanghai')->update([
            'timezone' => 'Asia/Shanghai',
            'catalog_revision' => DB::raw('catalog_revision + 1'),
        ]);
    }

    public function down(): void
    {
        Schema::table('app_settings', function (Blueprint $table): void {
            $table->dropColumn('system_name');
        });
    }
};
