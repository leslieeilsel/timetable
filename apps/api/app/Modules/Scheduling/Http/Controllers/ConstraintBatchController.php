<?php

namespace App\Modules\Scheduling\Http\Controllers;

use App\Enums\LifecycleStatus;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use App\Modules\Scheduling\Services\ConstraintDraftService;
use App\Modules\Scheduling\Services\ConstraintPayloadValidator;
use App\Support\ApiProblemException;
use App\Support\EtagService;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class ConstraintBatchController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly EtagService $etags,
        private readonly ConstraintDraftService $drafts,
        private readonly ConstraintPayloadValidator $payloads,
    ) {}

    public function capabilities(Request $request, Semester $semester): JsonResponse
    {
        return response()->json(['data' => $this->payloads->draftCapabilities()]);
    }

    public function preview(Request $request, Semester $semester): JsonResponse
    {
        return DB::transaction(function () use ($request, $semester): JsonResponse {
            $this->guard->actor($request);
            $settings = AppSetting::query()->lockForUpdate()->findOrFail(1);
            $locked = Semester::query()->lockForUpdate()->findOrFail($semester->id);
            if ($locked->status === LifecycleStatus::Closed) {
                throw new ApiProblemException('SEMESTER_NOT_EDITABLE', '已关闭学期为只读状态', 409);
            }
            $rows = $this->drafts->validateBatch($request, $locked);
            $etag = $this->etags->semester($locked, $settings);

            return response()->json(['data' => [
                'constraints' => array_map(fn (array $row): array => [...$row, 'scope' => (object) $row['scope'], 'condition' => (object) $row['condition']], $rows),
                'summaries' => array_map(fn (array $row): string => $this->drafts->summary($locked, $row), $rows),
                'etag' => $etag,
            ]])->header('ETag', $etag);
        }, 3);
    }

    public function store(Request $request, Semester $semester): JsonResponse
    {
        $key = Validator::make(['key' => $request->header('Idempotency-Key')], ['key' => ['required', 'uuid']])->validate()['key'];
        // Hash the complete submitted body, including field order normalization. Never treat a
        // different payload as a successful retry, even when validation would discard fields.
        $hash = hash('sha256', json_encode($this->canonical($request->all()), JSON_THROW_ON_ERROR));

        return DB::transaction(function () use ($request, $semester, $key, $hash): JsonResponse {
            $actor = $this->guard->actor($request);
            AppSetting::query()->lockForUpdate()->findOrFail(1);
            Semester::query()->lockForUpdate()->findOrFail($semester->id);
            $receipt = DB::table('operation_receipts')->where([
                'actor_user_id' => $actor->id, 'semester_id' => $semester->id,
                'operation' => 'constraint_drafts', 'idempotency_key' => $key,
            ])->first();
            if ($receipt !== null) {
                if (! hash_equals($receipt->payload_hash, $hash)) {
                    throw new ApiProblemException('IDEMPOTENCY_CONFLICT', '本次提交标识已用于不同内容，请重新预览', 409);
                }

                return response()->json(json_decode($receipt->response_body, true, 512, JSON_THROW_ON_ERROR))
                    ->header('ETag', $receipt->etag);
            }
            [$actor, $settings, $locked] = $this->guard->semester($request, $semester);
            $rows = $this->drafts->validateBatch($request, $locked);
            $created = $this->drafts->create($request, $actor, $locked, $rows);
            $etag = $this->etags->semester($locked, $settings);
            $body = ['data' => array_map(fn ($constraint): array => $constraint->toArray(), $created)];
            DB::table('operation_receipts')->insert([
                'actor_user_id' => $actor->id, 'semester_id' => $locked->id,
                'operation' => 'constraint_drafts', 'idempotency_key' => $key, 'payload_hash' => $hash,
                'response_body' => json_encode($body, JSON_THROW_ON_ERROR), 'etag' => $etag, 'created_at' => now(),
            ]);

            return response()->json($body, 201)->header('ETag', $etag);
        }, 3);
    }

    private function canonical(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value);
        }

        return array_map($this->canonical(...), $value);
    }
}
