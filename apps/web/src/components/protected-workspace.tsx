import { Navigate } from "react-router"
import { WorkspaceShell } from "@/components/workspace-shell"
import { LoadingState } from "@/components/page"
import { useAuth } from "@/lib/auth"

export function ProtectedWorkspace() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingState label="正在恢复会话…" />
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/change-password" replace />

  return <WorkspaceShell />
}
