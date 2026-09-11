<?php

namespace App\Modules\AcademicCalendar\Http\Controllers;

use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\Audit\Services\AuditLogger;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SchoolSettingsController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly AuditLogger $audit,
    ) {}

    public function branding(): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json(['data' => [
            'system_name' => $settings->system_name,
            'system_tagline' => $settings->system_tagline,
        ]]);
    }

    public function show(): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json(['data' => $this->data($settings)])
            ->header('ETag', $this->etags->catalog($settings));
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'system_name' => ['required', 'string', 'max:60'],
            'system_tagline' => ['sometimes', 'nullable', 'string', 'max:60'],
            'timezone' => ['prohibited'],
        ]);

        return DB::transaction(function () use ($request, $data): JsonResponse {
            [$actor, $settings] = $this->guard->catalog($request, true);
            $before = $this->data($settings);
            $settings->system_name = $data['system_name'];
            if (array_key_exists('system_tagline', $data)) {
                $settings->system_tagline = $data['system_tagline'];
            }
            if ($settings->isDirty()) {
                $settings->save();
                $settings->increment('catalog_revision');
                $settings->refresh();
                $this->audit->record($request, $actor, 'update', 'school_settings', $settings->id, $before, $this->data($settings));
            }

            return response()->json(['data' => $this->data($settings)])
                ->header('ETag', $this->etags->catalog($settings));
        }, 3);
    }

    /** @return array{id: int, system_name: string, system_tagline: string|null, timezone: string, catalog_revision: string} */
    private function data(AppSetting $settings): array
    {
        return [
            'id' => $settings->id,
            'system_name' => $settings->system_name,
            'system_tagline' => $settings->system_tagline,
            'timezone' => $settings->timezone,
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
