<?php

namespace App\Modules\Identity\Http\Controllers;

use App\Enums\Role;
use App\Models\User;
use App\Modules\Audit\Services\AuditLogger;
use App\Support\ApiProblemException;
use App\Support\Normalizer;
use App\Support\WriteGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class UserController
{
    public function __construct(
        private readonly WriteGuard $guard,
        private readonly AuditLogger $audit,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->assertAdmin($request);
        $filters = $request->validate([
            'search' => ['sometimes', 'string', 'max:100'],
            'role' => ['sometimes', Rule::enum(Role::class)],
            'status' => ['sometimes', Rule::in(['active', 'inactive'])],
            'sort' => ['sometimes', Rule::in(['name', 'email', 'role', 'created_at'])],
            'direction' => ['sometimes', Rule::in(['asc', 'desc'])],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', Rule::in([20, 50, 100])],
        ]);
        $query = User::query()
            ->when(isset($filters['search']), function ($query) use ($filters): void {
                $search = '%'.Normalizer::text($filters['search']).'%';
                $query->where(fn ($match) => $match->where('name', 'like', $search)
                    ->orWhere('email', 'like', $search));
            })
            ->when(isset($filters['role']), fn ($query) => $query->where('role', $filters['role']))
            ->when(isset($filters['status']), fn ($query) => $query->where('is_active', $filters['status'] === 'active'));
        $paginator = $query
            ->orderBy((string) ($filters['sort'] ?? 'name'), (string) ($filters['direction'] ?? 'asc'))
            ->orderBy('id')
            ->paginate((int) ($filters['per_page'] ?? 20));
        $users = collect($paginator->items())->map(fn (User $user) => $this->data($user));

        return response()->json(['data' => $users, 'meta' => ['pagination' => [
            'page' => $paginator->currentPage(),
            'per_page' => $paginator->perPage(),
            'total' => $paginator->total(),
            'last_page' => $paginator->lastPage(),
            'from' => $paginator->firstItem(),
            'to' => $paginator->lastItem(),
        ]]]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'string', 'email:rfc', 'max:255'],
            'role' => ['required', Rule::enum(Role::class)],
            'temporary_password' => ['required', Password::min(12)->letters()->mixedCase()->numbers()],
        ]);

        $user = DB::transaction(function () use ($request, $validated): User {
            $actor = $this->guard->actor($request, true);
            $user = User::query()->create([
                'name' => Normalizer::text($validated['name']),
                'email' => Normalizer::email($validated['email']),
                'role' => $validated['role'],
                'password' => $validated['temporary_password'],
                'is_active' => true,
                'must_change_password' => true,
            ]);
            $this->audit->record($request, $actor, 'create', 'user', $user->id, null, $this->data($user));

            return $user;
        }, 3);

        return response()->json(['data' => $this->data($user)], 201);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:100'],
            'email' => ['sometimes', 'required', 'string', 'email:rfc', 'max:255', Rule::unique('users')->ignore($user->id)],
            'role' => ['sometimes', Rule::enum(Role::class)],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $user = DB::transaction(function () use ($request, $user, $validated): User {
            $actor = $this->guard->actor($request, true);
            $target = User::query()->lockForUpdate()->findOrFail($user->id);
            $before = $this->data($target);
            $nextRole = isset($validated['role']) ? Role::from($validated['role']) : $target->role;
            $nextActive = $validated['is_active'] ?? $target->is_active;
            if ($target->role === Role::Admin && $target->is_active && ($nextRole !== Role::Admin || ! $nextActive)) {
                $enabledAdmins = User::query()->where('role', Role::Admin->value)->where('is_active', true)->lockForUpdate()->count();
                if ($enabledAdmins <= 1) {
                    throw new ApiProblemException('LAST_ADMIN_REQUIRED', '系统必须至少保留一个启用的管理员', 409);
                }
            }

            $sensitiveChanged = $nextRole !== $target->role || $nextActive !== $target->is_active || isset($validated['email']);
            $target->fill([
                'name' => isset($validated['name']) ? Normalizer::text($validated['name']) : $target->name,
                'email' => isset($validated['email']) ? Normalizer::email($validated['email']) : $target->email,
                'role' => $nextRole,
                'is_active' => $nextActive,
            ]);
            if ($sensitiveChanged) {
                $target->auth_version++;
            }
            $target->save();
            if ($sensitiveChanged) {
                DB::table('sessions')->where('user_id', $target->id)->delete();
            }
            $this->audit->record($request, $actor, 'update', 'user', $target->id, $before, $this->data($target));

            return $target;
        }, 3);

        return response()->json(['data' => $this->data($user)]);
    }

    public function resetPassword(Request $request, User $user): JsonResponse
    {
        $validated = $request->validate([
            'temporary_password' => ['required', Password::min(12)->letters()->mixedCase()->numbers()],
        ]);

        DB::transaction(function () use ($request, $user, $validated): void {
            $actor = $this->guard->actor($request, true);
            $target = User::query()->lockForUpdate()->findOrFail($user->id);
            $target->forceFill([
                'password' => $validated['temporary_password'],
                'must_change_password' => true,
                'auth_version' => $target->auth_version + 1,
            ])->save();
            DB::table('sessions')->where('user_id', $target->id)->delete();
            $this->audit->record($request, $actor, 'reset_password', 'user', $target->id, null, ['must_change_password' => true]);
        }, 3);

        return response()->json(['data' => ['reset' => true]]);
    }

    private function assertAdmin(Request $request): void
    {
        if ($request->user()->role !== Role::Admin) {
            throw new ApiProblemException('FORBIDDEN', '仅管理员可管理用户', 403);
        }
    }

    /** @return array<string, mixed> */
    private function data(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role->value,
            'is_active' => $user->is_active,
            'must_change_password' => $user->must_change_password,
            'created_at' => $user->created_at?->toISOString(),
        ];
    }
}
