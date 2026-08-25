<?php

namespace App\Modules\Identity\Console;

use App\Enums\Role;
use App\Models\User;
use App\Support\Normalizer;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

class CreateAdminCommand extends Command
{
    protected $signature = 'timetable:create-admin {--name=} {--email=} {--password-env=}';

    protected $description = '安全创建排课系统管理员账号';

    public function handle(): int
    {
        $name = Normalizer::text((string) ($this->option('name') ?: $this->ask('管理员姓名')));
        $email = Normalizer::email((string) ($this->option('email') ?: $this->ask('登录邮箱')));
        $passwordVariable = $this->option('password-env');
        $password = is_string($passwordVariable) && $passwordVariable !== ''
            ? (string) getenv($passwordVariable)
            : (string) $this->secret('临时密码（至少12位，包含大小写字母和数字）');
        $validator = Validator::make(compact('name', 'email', 'password'), [
            'name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email:rfc', 'unique:users,email'],
            'password' => ['required', Password::min(12)->letters()->mixedCase()->numbers()],
        ]);
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }

        User::query()->create([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make($password),
            'role' => Role::Admin,
            'is_active' => true,
            'must_change_password' => true,
        ]);
        $this->info('管理员账号已创建，请在首次登录后修改临时密码。');

        return self::SUCCESS;
    }
}
