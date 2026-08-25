<?php

namespace App\Support;

use App\Enums\LifecycleStatus;
use App\Enums\Role;
use App\Models\User;
use App\Modules\AcademicCalendar\Models\AppSetting;
use App\Modules\AcademicCalendar\Models\Semester;
use Illuminate\Http\Request;

class WriteGuard
{
    public function __construct(private readonly EtagService $etags) {}

    public function actor(Request $request, bool $adminOnly = false): User
    {
        $id = $request->user()?->id;
        $actor = $id === null ? null : User::query()->lockForUpdate()->find($id);
        if ($actor === null || ! $actor->is_active || (int) $request->session()->get('auth_version', -1) !== $actor->auth_version) {
            throw new ApiProblemException('SESSION_REVOKED', '登录状态已失效，请重新登录', 401);
        }
        if ($actor->must_change_password) {
            throw new ApiProblemException('PASSWORD_CHANGE_REQUIRED', '请先修改临时密码', 403);
        }
        if ($adminOnly && $actor->role !== Role::Admin) {
            throw new ApiProblemException('FORBIDDEN', '仅管理员可执行此操作', 403);
        }
        if (! $adminOnly && ! $actor->role->canEdit()) {
            throw new ApiProblemException('FORBIDDEN', '当前账号只有查看权限', 403);
        }

        return $actor;
    }

    /** @return array{User, AppSetting} */
    public function catalog(Request $request, bool $adminOnly = false): array
    {
        $actor = $this->actor($request, $adminOnly);
        $settings = AppSetting::query()->lockForUpdate()->findOrFail(1);
        $this->etags->assertCatalog($request, $settings);

        return [$actor, $settings];
    }

    /** @return array{User, AppSetting, Semester} */
    public function semester(
        Request $request,
        Semester $semester,
        bool $adminOnly = false,
        bool $requireOpen = false,
        bool $allowClosed = false,
    ): array {
        $actor = $this->actor($request, $adminOnly);
        $settings = AppSetting::query()->lockForUpdate()->findOrFail(1);
        $locked = Semester::query()->lockForUpdate()->findOrFail($semester->id);
        $this->etags->assertSemester($request, $locked, $settings);

        if ($requireOpen && $locked->status !== LifecycleStatus::Open) {
            throw new ApiProblemException('SEMESTER_NOT_EDITABLE', '只有开放学期可以执行此操作', 409);
        }
        if (! $requireOpen && ! $allowClosed && $locked->status === LifecycleStatus::Closed) {
            throw new ApiProblemException('SEMESTER_NOT_EDITABLE', '已关闭学期为只读状态', 409);
        }

        return [$actor, $settings, $locked];
    }
}
