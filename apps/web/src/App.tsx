import { lazy, Suspense, useEffect, type ReactNode } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router"
import { useAuth } from "@/lib/auth"
import { pageTitleForPath, SYSTEM_NAME } from "@/lib/brand"
import { useSchoolContext } from "@/lib/queries"
import { semesterPath, type SemesterDestination } from "@/lib/semester"
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
const TeachingAssignmentsPage = lazy(() =>
  import("@/pages/course-assignment-matrix-page").then((module) => ({
    default: module.CourseAssignmentMatrixPage,
  })),
)
const PreparationCheckPage = lazy(() =>
  import("@/pages/preparation-check-page").then((module) => ({
    default: module.PreparationCheckPage,
  })),
)
const SchedulingConstraintsPage = lazy(() =>
  import("@/pages/scheduling-constraints-page").then((module) => ({
    default: module.SchedulingConstraintsPage,
  })),
)
const ScheduleGenerationPage = lazy(() =>
  import("@/pages/schedule-generation-page").then((module) => ({
    default: module.ScheduleGenerationPage,
  })),
)
const TimetablePage = lazy(() =>
  import("@/pages/timetable-page").then((module) => ({ default: module.TimetablePage })),
)
const DailyAdjustmentsPage = lazy(() =>
  import("@/pages/daily-adjustments-page").then((module) => ({
    default: module.DailyAdjustmentsPage,
  })),
)
const TeacherLeavesPage = lazy(() =>
  import("@/pages/teacher-leaves-page").then((module) => ({
    default: module.TeacherLeavesPage,
  })),
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

function DocumentTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = `${SYSTEM_NAME} · ${pageTitleForPath(pathname)}`
  }, [pathname])
  return null
}

function CurrentSemesterNavigate({ destination }: { destination: SemesterDestination }) {
  const context = useSchoolContext()
  const { search, hash } = useLocation()
  if (context.isLoading) return <LoadingState label="正在载入当前学期…" />
  const semesterId = context.data?.current_semester?.id
  if (!semesterId) return <Navigate to="/" replace />
  return <Navigate to={{ pathname: semesterPath(semesterId, destination), search, hash }} replace />
}

export default function App() {
  return (
    <>
      <DocumentTitle />
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
                  <CurrentSemesterNavigate destination="setup" />
                </RequireRole>
              }
            />
            <Route
              path="semester/assignments"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <CurrentSemesterNavigate destination="assignments" />
                </RequireRole>
              }
            />
            <Route
              path="semester/timetable"
              element={<CurrentSemesterNavigate destination="timetable" />}
            />
            <Route
              path="scheduling/preparation"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <CurrentSemesterNavigate destination="preparation" />
                </RequireRole>
              }
            />
            <Route
              path="scheduling/assignments"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <CurrentSemesterNavigate destination="assignments" />
                </RequireRole>
              }
            />
            <Route
              path="scheduling/constraints"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <CurrentSemesterNavigate destination="constraints" />
                </RequireRole>
              }
            />
            <Route
              path="scheduling/generate"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <CurrentSemesterNavigate destination="generate" />
                </RequireRole>
              }
            />
            <Route
              path="scheduling/timetable"
              element={<CurrentSemesterNavigate destination="timetable" />}
            />
            <Route
              path="daily/adjustments"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <CurrentSemesterNavigate destination="adjustments" />
                </RequireRole>
              }
            />
            <Route
              path="daily/leaves"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <CurrentSemesterNavigate destination="leaves" />
                </RequireRole>
              }
            />
            <Route
              path="semesters/:semesterId/setup"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <SemesterSetupPage />
                </RequireRole>
              }
            />
            <Route
              path="semesters/:semesterId/assignments"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <TeachingAssignmentsPage />
                </RequireRole>
              }
            />
            <Route
              path="semesters/:semesterId/preparation"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <PreparationCheckPage />
                </RequireRole>
              }
            />
            <Route
              path="semesters/:semesterId/constraints"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <SchedulingConstraintsPage />
                </RequireRole>
              }
            />
            <Route
              path="semesters/:semesterId/generate"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <ScheduleGenerationPage />
                </RequireRole>
              }
            />
            <Route path="semesters/:semesterId/timetable" element={<TimetablePage />} />
            <Route
              path="semesters/:semesterId/adjustments"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <DailyAdjustmentsPage />
                </RequireRole>
              }
            />
            <Route
              path="semesters/:semesterId/leaves"
              element={
                <RequireRole roles={["admin", "scheduler"]}>
                  <TeacherLeavesPage />
                </RequireRole>
              }
            />
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
    </>
  )
}
