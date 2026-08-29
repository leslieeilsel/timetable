import { Navigate } from "react-router"
import { WorkspaceShell } from "@/components/workspace-shell"
import { WorkspaceLoadingState } from "@/components/workspace-loading-state"
import { useAuth } from "@/lib/auth"

export function ProtectedWorkspace() {
  const { user, loading } = useAuth()

  if (loading) return <WorkspaceLoadingState />
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/change-password" replace />

  return <WorkspaceShell />
}
