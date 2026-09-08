import { Navigate, Route, Routes } from "react-router"

import { useAuth } from "@/lib/auth"
import { ChangePasswordPage } from "@/pages/change-password-page"
import { LoginPage } from "@/pages/login-page"
import { TimetablePage } from "@/pages/timetable-page"

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return <div className="min-h-dvh bg-background" />

  return (
    <Routes>
      <Route
        path="/login"
        element={
          user ? (
            <Navigate to={user.must_change_password ? "/change-password" : "/"} replace />
          ) : (
            <LoginPage />
          )
        }
      />
      <Route
        path="/change-password"
        element={
          !user ? (
            <Navigate to="/login" replace />
          ) : user.role !== "teacher" ? (
            <Navigate to="/login" replace />
          ) : (
            <ChangePasswordPage />
          )
        }
      />
      <Route
        path="*"
        element={
          !user ? (
            <Navigate to="/login" replace />
          ) : user.must_change_password ? (
            <Navigate to="/change-password" replace />
          ) : user.role !== "teacher" ? (
            <Navigate to="/login" replace />
          ) : (
            <TimetablePage />
          )
        }
      />
    </Routes>
  )
}
