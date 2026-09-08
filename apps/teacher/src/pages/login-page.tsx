import { Eye, EyeOff, LoaderCircle } from "lucide-react"
import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router"

import { apiMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError("")
    try {
      const user = await login(email.trim(), password)
      void navigate(user.must_change_password ? "/change-password" : "/", { replace: true })
    } catch (reason) {
      setError(apiMessage(reason))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="teacher-page">
      <div className="teacher-shell auth-shell">
        <div className="auth-brand">教师课表</div>

        <section className="auth-content" aria-labelledby="login-title">
          <h1 id="login-title">教师登录</h1>
          <p className="auth-description">使用学校分配的教师账号</p>

          <form className="auth-form" onSubmit={submit}>
            <label className="field-label" htmlFor="email">
              账号
            </label>
            <input
              className="teacher-input"
              id="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="请输入教师账号"
              aria-invalid={Boolean(error)}
              required
            />

            <label className="field-label" htmlFor="password">
              密码
            </label>
            <div className="password-field">
              <input
                className="teacher-input"
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                aria-invalid={Boolean(error)}
                required
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>

            {error ? (
              <p role="alert" className="form-error">
                {error}
              </p>
            ) : null}

            <button className="primary-action" type="submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="spin" /> : null}
              {submitting ? "正在登录" : "登录"}
            </button>
          </form>

          <p className="auth-help">账号问题请联系学校管理员</p>
        </section>

        <footer className="auth-footer">课表数据由学校统一维护</footer>
      </div>
    </main>
  )
}
