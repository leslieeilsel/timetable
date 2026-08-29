import { useState, type FormEvent } from "react"
import { Navigate, useNavigate } from "react-router"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { apiMessage } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/page"
import { Brand } from "@/components/brand"

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
    <div className="grid min-h-svh bg-background lg:grid-cols-[55.5%_44.5%]">
      <aside
        aria-label="系统介绍"
        className="relative hidden overflow-hidden border-r bg-sidebar lg:block"
      >
        <div className="absolute top-[14.5%] left-[11%] z-10">
          <Brand large />
        </div>
        <div className="absolute top-[31.5%] left-[11%] z-10 max-w-xl">
          <p className="text-[clamp(2.25rem,3vw,3.5rem)] leading-[1.32] font-semibold tracking-tight">
            把复杂的排课准备，
            <br />
            变成清晰的工作流程。
          </p>
          <p className="mt-6 text-lg text-muted-foreground">
            基础资料、学期配置、任课关系与课表统一管理。
          </p>
        </div>
        <picture>
          <source
            type="image/webp"
            srcSet="/assets/login-workflow-grid-640.webp 640w, /assets/login-workflow-grid.webp 800w"
            sizes="55.5vw"
          />
          <img
            src="/assets/login-workflow-grid.png"
            width={800}
            height={418}
            fetchPriority="high"
            decoding="async"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-[9%] w-full select-none"
          />
        </picture>
        <p className="absolute bottom-[5%] left-[11%] z-10 text-sm text-muted-foreground">
          校内系统 · 请使用已分配账号登录
        </p>
      </aside>
      <main className="flex items-center justify-center px-6 py-12 lg:px-[10%]">
        <form onSubmit={submit} noValidate className="w-full max-w-lg">
          <div className="mb-8 lg:mb-14">
            <div className="mb-10 lg:hidden">
              <Brand />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">登录工作台</h1>
            <p className="mt-3 text-base text-muted-foreground">首次登录需修改临时密码。</p>
          </div>
          <div className="grid gap-6 lg:gap-7">
            <Field label="邮箱" error={errors.email}>
              <Input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="name@school.edu"
                aria-invalid={Boolean(errors.email)}
              />
            </Field>
            <Field label="密码" error={errors.password}>
              <div className="relative">
                <Input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  className="pr-10"
                  aria-invalid={Boolean(errors.password)}
                />
                <button
                  type="button"
                  className="absolute top-1/2 right-1.5 flex size-12 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground md:right-3 md:size-8 md:rounded-md"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? (
                    <EyeOffIcon className="size-4" />
                  ) : (
                    <EyeIcon className="size-4" />
                  )}
                </button>
              </div>
            </Field>
            {submitError && (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            )}
            <Button type="submit" className="mt-2 w-full lg:mt-4" disabled={submitting}>
              {submitting ? "正在登录…" : "登录"}
            </Button>
          </div>
        </form>
      </main>
    </div>
  )
}
