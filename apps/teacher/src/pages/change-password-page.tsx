import { ArrowLeft, Eye, EyeOff, LoaderCircle } from "lucide-react"
import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router"

import { api, apiMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { User } from "@/lib/types"

type PasswordFieldName = "current" | "new" | "confirmation"

export function ChangePasswordPage() {
  const { user, refresh, logout } = useAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [visible, setVisible] = useState<Record<PasswordFieldName, boolean>>({
    current: false,
    new: false,
    confirmation: false,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirmation) {
      setError("两次输入的新密码不一致")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      await api<User>("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          password,
          password_confirmation: confirmation,
        }),
      })
      await refresh()
      void navigate("/", { replace: true })
    } catch (reason) {
      setError(apiMessage(reason))
    } finally {
      setSubmitting(false)
    }
  }

  async function leave() {
    if (user?.must_change_password) {
      await logout()
      void navigate("/login", { replace: true })
      return
    }
    void navigate(-1)
  }

  function toggle(name: PasswordFieldName) {
    setVisible((current) => ({ ...current, [name]: !current[name] }))
  }

  return (
    <main className="teacher-page">
      <div className="teacher-shell password-shell">
        <header className="plain-header">
          <button type="button" className="header-icon-button" aria-label="返回" onClick={leave}>
            <ArrowLeft />
          </button>
          <strong>设置新密码</strong>
          <span aria-hidden="true" />
        </header>

        <section className="password-content" aria-labelledby="password-intro">
          <p id="password-intro" className="password-intro">
            {user?.must_change_password ? "首次登录需要修改初始密码" : "修改教师账号登录密码"}
          </p>

          <form className="auth-form password-form" onSubmit={submit}>
            <PasswordInput
              id="current-password"
              label="当前密码"
              value={currentPassword}
              visible={visible.current}
              onToggle={() => toggle("current")}
              onChange={setCurrentPassword}
            />
            <PasswordInput
              id="new-password"
              label="新密码"
              value={password}
              visible={visible.new}
              onToggle={() => toggle("new")}
              onChange={setPassword}
            />
            <p className="password-hint">至少 12 位，包含大小写字母和数字</p>
            <PasswordInput
              id="confirmation"
              label="确认新密码"
              value={confirmation}
              visible={visible.confirmation}
              onToggle={() => toggle("confirmation")}
              onChange={setConfirmation}
            />

            {error ? (
              <p role="alert" className="form-error">
                {error}
              </p>
            ) : null}

            <button className="primary-action password-submit" type="submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="spin" /> : null}
              {submitting ? "正在保存" : "保存并进入课表"}
            </button>
          </form>

          {user?.must_change_password ? (
            <button className="text-action" type="button" onClick={() => void leave()}>
              退出登录
            </button>
          ) : null}
        </section>
      </div>
    </main>
  )
}

function PasswordInput({
  id,
  label,
  value,
  visible,
  onToggle,
  onChange,
}: {
  id: string
  label: string
  value: string
  visible: boolean
  onToggle: () => void
  onChange: (value: string) => void
}) {
  return (
    <div className="password-control">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="password-field">
        <input
          className="teacher-input"
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          minLength={id === "current-password" ? undefined : 12}
          autoComplete={id === "current-password" ? "current-password" : "new-password"}
          required
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={visible ? `隐藏${label}` : `显示${label}`}
          onClick={onToggle}
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </div>
    </div>
  )
}
