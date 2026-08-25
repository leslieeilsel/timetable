<?php

namespace App\Modules\Identity\Http\Controllers;

use App\Models\User;
use App\Support\ApiProblemException;
use App\Support\Normalizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

class AuthController
{
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email:rfc'],
            'password' => ['required', 'string'],
        ]);
        $email = Normalizer::email($data['email']);

        if (! Auth::attempt(['email' => $email, 'password' => $data['password'], 'is_active' => true])) {
            throw new ApiProblemException('INVALID_CREDENTIALS', '账号或密码错误', 422, [
                'errors' => ['email' => ['账号或密码错误']],
            ]);
        }

        $request->session()->regenerate();
        $request->session()->put('auth_version', $request->user()->auth_version);

        return response()->json(['data' => $this->userData($request->user())]);
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['data' => ['logged_out' => true]]);
    }

    public function changePassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'confirmed', Password::min(12)->letters()->mixedCase()->numbers()],
        ]);

        $user = DB::transaction(function () use ($request, $data): User {
            $user = User::query()->lockForUpdate()->findOrFail($request->user()->id);
            if (! Hash::check($data['current_password'], $user->password)) {
                throw new ApiProblemException('CURRENT_PASSWORD_INVALID', '当前密码不正确', 422, [
                    'errors' => ['current_password' => ['当前密码不正确']],
                ]);
            }

            $user->forceFill([
                'password' => $data['password'],
                'must_change_password' => false,
                'auth_version' => $user->auth_version + 1,
            ])->save();
            DB::table('sessions')->where('user_id', $user->id)->delete();

            return $user;
        }, 3);

        Auth::forgetGuards();
        Auth::guard('web')->login($user);
        $request->session()->regenerate();
        $request->session()->put('auth_version', $user->auth_version);

        return response()->json(['data' => $this->userData($user)]);
    }

    /** @return array<string, mixed> */
    private function userData(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role->value,
            'is_active' => $user->is_active,
            'must_change_password' => $user->must_change_password,
        ];
    }
}
