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

    public function show(): JsonResponse
    {
        $settings = AppSetting::query()->findOrFail(1);

        return response()->json(['data' => $this->data($settings)])
            ->header('ETag', $this->etags->catalog($settings));
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate(['timezone' => ['required', 'string', 'timezone:all']]);

        return DB::transaction(function () use ($request, $data): JsonResponse {
            [$actor, $settings] = $this->guard->catalog($request, true);
            $before = $this->data($settings);
            $settings->timezone = $data['timezone'];
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

    /** @return array{id: int, timezone: string, catalog_revision: string} */
    private function data(AppSetting $settings): array
    {
        return [
            'id' => $settings->id,
            'timezone' => $settings->timezone,
            'catalog_revision' => (string) $settings->getRawOriginal('catalog_revision'),
        ];
    }
}
