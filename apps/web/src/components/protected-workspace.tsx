import { Navigate } from "react-router"
import { Button } from "@/components/ui/button"
import { WorkspaceShell } from "@/components/workspace-shell"
import { WorkspaceLoadingState } from "@/components/workspace-loading-state"
import { useAuth } from "@/lib/auth"

export function ProtectedWorkspace() {
  const { user, loading, logout } = useAuth()

  if (loading) return <WorkspaceLoadingState />
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  if (user.role === "teacher") {
    const teacherUrl = import.meta.env.VITE_TEACHER_APP_URL as string | undefined
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <h1 className="text-2xl font-semibold">请使用教师课表端</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            当前账号是教师账号，不能进入教务管理端。
          </p>
          <div className="mt-6 flex justify-center gap-3">
            {teacherUrl ? <Button render={<a href={teacherUrl} />}>进入我的课表</Button> : null}
            <Button variant="outline" onClick={() => void logout()}>
              退出登录
            </Button>
          </div>
        </div>
      </main>
    )
  }

  return <WorkspaceShell />
}
