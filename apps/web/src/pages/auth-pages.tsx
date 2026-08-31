import { useState, type FormEvent } from "react"
import { Navigate, useNavigate } from "react-router"
import { LoaderCircleIcon } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { apiMessage } from "@/lib/api"
import { SYSTEM_NAME } from "@/lib/brand"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LogoMark } from "@/components/brand"

const fieldLabelClassName = "mb-2 block text-[13px] font-medium tracking-[0.01em] text-foreground"

const authInputClassName =
  "h-12 rounded-md border-input bg-background px-4 py-0 text-[15px] text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)] md:text-[15px]"

const authButtonClassName =
  "h-12 w-full rounded-md bg-primary text-[15px] font-medium text-primary-foreground shadow-none hover:bg-primary/85 focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)] active:translate-y-0"

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
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
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? undefined : "请输入有效的邮箱账号",
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
    <div className="flex min-h-svh flex-col overflow-x-hidden bg-background selection:bg-primary selection:text-primary-foreground">
      <header className="shrink-0">
        <div className="flex h-20 w-full items-center px-6 sm:px-8">
          <div className="flex items-center gap-2">
            <span className="flex size-11 shrink-0 items-center justify-center">
              <LogoMark className="size-8" aria-hidden="true" />
            </span>
            <span className="text-base font-semibold tracking-tight">{SYSTEM_NAME}</span>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 sm:px-8">
        <form
          onSubmit={submit}
          noValidate
          className="relative w-full max-w-[400px] sm:-translate-y-8 md:-translate-y-10"
        >
          <h1 className="text-[42px] font-semibold tracking-[-0.05em] text-foreground sm:text-[48px]">
            登录
          </h1>
          <p className="mt-2 text-[15px] text-muted-foreground">欢迎回来 👋</p>

          <div className="mt-10 space-y-6">
            <div>
              <label htmlFor="login-account" className={fieldLabelClassName}>
                账号
              </label>
              <Input
                id="login-account"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="请输入邮箱账号"
                className={authInputClassName}
                aria-invalid={Boolean(errors.email) || undefined}
                aria-describedby={errors.email ? "login-email-error" : undefined}
              />
              {errors.email && (
                <p id="login-email-error" role="alert" className="mt-2 text-xs text-destructive">
                  {errors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="login-password" className={fieldLabelClassName}>
                密码
              </label>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="请输入登录密码"
                className={authInputClassName}
                aria-invalid={Boolean(errors.password) || undefined}
                aria-describedby={errors.password ? "login-password-error" : undefined}
              />
              {errors.password && (
                <p id="login-password-error" role="alert" className="mt-2 text-xs text-destructive">
                  {errors.password}
                </p>
              )}
            </div>

            {submitError && (
              <p role="alert" className="text-sm leading-6 text-destructive">
                {submitError}
              </p>
            )}

            <Button type="submit" className={authButtonClassName} disabled={submitting}>
              {submitting && (
                <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
              )}
              {submitting ? "正在登录…" : "登录"}
            </Button>
          </div>
        </form>
      </main>
    </div>
  )
}
