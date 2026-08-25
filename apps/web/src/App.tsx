import { lazy, Suspense, type ReactNode } from "react"
import { Navigate, Route, Routes } from "react-router"
import { useAuth } from "@/lib/auth"
import { WorkspaceShell } from "@/components/workspace-shell"
import { LoadingState } from "@/components/page"

const LoginPage = lazy(() =>
  import("@/pages/auth-pages").then((module) => ({ default: module.LoginPage })),
)
const ChangePasswordPage = lazy(() =>
  import("@/pages/auth-pages").then((module) => ({ default: module.ChangePasswordPage })),
)
const DashboardPage = lazy(() =>
  import("@/pages/dashboard-page").then((module) => ({ default: module.DashboardPage })),
)
const GradesPage = lazy(() =>
  import("@/pages/resources-page").then((module) => ({ default: module.GradesPage })),
)
const TeachersPage = lazy(() =>
  import("@/pages/resources-page").then((module) => ({ default: module.TeachersPage })),
)
const CoursesPage = lazy(() =>
  import("@/pages/resources-page").then((module) => ({ default: module.CoursesPage })),
)
const RoomsPage = lazy(() =>
  import("@/pages/resources-page").then((module) => ({ default: module.RoomsPage })),
)
const AcademicYearsPage = lazy(() =>
  import("@/pages/academic-years-page").then((module) => ({ default: module.AcademicYearsPage })),
)
const AcademicYearDetailPage = lazy(() =>
  import("@/pages/academic-years-page").then((module) => ({
    default: module.AcademicYearDetailPage,
  })),
)
const SemesterSetupPage = lazy(() =>
  import("@/pages/semester-setup-page").then((module) => ({ default: module.SemesterSetupPage })),
)
const TeachingTasksPage = lazy(() =>
  import("@/pages/teaching-tasks-page").then((module) => ({ default: module.TeachingTasksPage })),
)
const TimetablePage = lazy(() =>
  import("@/pages/timetable-page").then((module) => ({ default: module.TimetablePage })),
)
const UsersPage = lazy(() =>
  import("@/pages/system-pages").then((module) => ({ default: module.UsersPage })),
)
const SettingsPage = lazy(() =>
  import("@/pages/system-pages").then((module) => ({ default: module.SettingsPage })),
)

function ProtectedWorkspace() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingState label="正在恢复会话…" />
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  return <WorkspaceShell />
}

function RequireRole({
  roles,
  children,
}: {
  roles: Array<"admin" | "scheduler" | "viewer">
  children: ReactNode
}) {
  const { user } = useAuth()
  return user && roles.includes(user.role) ? children : <Navigate to="/" replace />
}

export default function App() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route element={<ProtectedWorkspace />}>
          <Route index element={<DashboardPage />} />
          <Route path="resources" element={<Navigate to="/resources/grades" replace />} />
          <Route
            path="resources/grades"
            element={
              <RequireRole roles={["admin", "scheduler"]}>
                <GradesPage />
              </RequireRole>
            }
          />
          <Route
            path="resources/teachers"
            element={
              <RequireRole roles={["admin", "scheduler"]}>
                <TeachersPage />
              </RequireRole>
            }
          />
          <Route
            path="resources/courses"
            element={
              <RequireRole roles={["admin", "scheduler"]}>
                <CoursesPage />
              </RequireRole>
            }
          />
          <Route
            path="resources/rooms"
            element={
              <RequireRole roles={["admin", "scheduler"]}>
                <RoomsPage />
              </RequireRole>
            }
          />
          <Route
            path="years"
            element={
              <RequireRole roles={["admin", "scheduler"]}>
                <AcademicYearsPage />
              </RequireRole>
            }
          />
          <Route
            path="years/:yearId"
            element={
              <RequireRole roles={["admin", "scheduler"]}>
                <AcademicYearDetailPage />
              </RequireRole>
            }
          />
          <Route
            path="semester/setup"
            element={
              <RequireRole roles={["admin", "scheduler"]}>
                <SemesterSetupPage />
              </RequireRole>
            }
          />
          <Route
            path="semester/tasks"
            element={
              <RequireRole roles={["admin", "scheduler"]}>
                <TeachingTasksPage />
              </RequireRole>
            }
          />
          <Route path="semester/timetable" element={<TimetablePage />} />
          <Route
            path="semesters/:semesterId/setup"
            element={
              <RequireRole roles={["admin", "scheduler"]}>
                <SemesterSetupPage />
              </RequireRole>
            }
          />
          <Route
            path="semesters/:semesterId/tasks"
            element={
              <RequireRole roles={["admin", "scheduler"]}>
                <TeachingTasksPage />
              </RequireRole>
            }
          />
          <Route path="semesters/:semesterId/timetable" element={<TimetablePage />} />
          <Route
            path="users"
            element={
              <RequireRole roles={["admin"]}>
                <UsersPage />
              </RequireRole>
            }
          />
          <Route
            path="settings"
            element={
              <RequireRole roles={["admin"]}>
                <SettingsPage />
              </RequireRole>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
