import { useState, type FormEvent } from "react"
import { Navigate, useNavigate } from "react-router"
import { EyeIcon, EyeOffIcon, LoaderCircleIcon } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { apiMessage } from "@/lib/api"
import { SYSTEM_NAME } from "@/lib/brand"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/page"
import { LogoMark } from "@/components/brand"

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [submitError, setSubmitError] = useState<string>()

  if (user) return <Navigate to={user.must_change_password ? "/change-password" : "/"} replace />

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const emailValue = data.get("email")
    const passwordValue = data.get("password")
    const email = typeof emailValue === "string" ? emailValue.trim() : ""
    const password = typeof passwordValue === "string" ? passwordValue : ""
    const nextErrors = {
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? undefined : "请输入有效邮箱",
      password: password ? undefined : "请输入密码",
    }

    setSubmitError(undefined)
    setErrors(nextErrors)
    if (nextErrors.email || nextErrors.password) return

    setSubmitting(true)
    try {
      const next = await login(email, password)
      void navigate(next.must_change_password ? "/change-password" : "/", { replace: true })
    } catch (error) {
      setSubmitError(apiMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12 selection:bg-primary selection:text-primary-foreground sm:px-10">
      <form onSubmit={submit} noValidate className="w-full max-w-[26rem]">
        <div className="mb-14 flex items-center gap-3">
          <LogoMark className="size-10" />
          <p className="text-base font-semibold tracking-tight">{SYSTEM_NAME}</p>
        </div>

        <div className="mb-10">
          <h1 className="text-[2.5rem] leading-[1.1] font-semibold tracking-[-0.04em] text-balance">
            登录工作台
          </h1>
          <p className="mt-3 max-w-sm text-base leading-7 text-muted-foreground">
            使用学校分配的账号登录。首次登录需修改临时密码。
          </p>
        </div>

        <div className="grid gap-6">
          <Field label="邮箱" error={errors.email} errorId="login-email-error">
            <Input
              name="email"
              type="email"
              autoComplete="username"
              placeholder="name@school.edu"
              autoFocus
              className="h-14 rounded-xl px-4 text-base caret-foreground md:text-base"
              aria-invalid={Boolean(errors.email) || undefined}
              aria-describedby={errors.email ? "login-email-error" : undefined}
            />
          </Field>
          <Field label="密码" error={errors.password} errorId="login-password-error">
            <div className="relative">
              <Input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="请输入密码"
                className="h-14 rounded-xl px-4 pr-14 text-base caret-foreground md:text-base"
                aria-invalid={Boolean(errors.password) || undefined}
                aria-describedby={errors.password ? "login-password-error" : undefined}
              />
              <button
                type="button"
                className="absolute top-1/2 right-1 flex size-12 -translate-y-1/2 touch-manipulation items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? (
                  <EyeOffIcon className="size-5" aria-hidden="true" />
                ) : (
                  <EyeIcon className="size-5" aria-hidden="true" />
                )}
              </button>
            </div>
          </Field>
          {submitError && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive"
            >
              {submitError}
            </p>
          )}
          <Button
            type="submit"
            className="mt-2 h-14 w-full rounded-xl px-5 text-base font-semibold"
            disabled={submitting}
          >
            {submitting && <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />}
            {submitting ? "正在登录…" : "登录"}
          </Button>
        </div>
      </form>
    </main>
  )
}
