import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"
import {
  CheckCircle2Icon,
  CircleIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
  LogOutIcon,
} from "lucide-react"
import { useAuth } from "@/lib/auth"
import { api, apiMessage, jsonBody } from "@/lib/api"
import { SYSTEM_NAME } from "@/lib/brand"
import type { User } from "@/lib/types"
import { cn } from "@/lib/utils"
import { LogoMark } from "@/components/brand"
import { Field, LoadingState, PageHeader } from "@/components/page"
import { WorkspaceShell } from "@/components/workspace-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const passwordSchema = z
  .object({
    current_password: z.string().min(1, "请输入当前密码"),
    password: z
      .string()
      .min(12, "至少 12 位")
      .regex(/[a-z]/, "需包含小写字母")
      .regex(/[A-Z]/, "需包含大写字母")
      .regex(/\d/, "需包含数字"),
    password_confirmation: z.string(),
  })
  .refine((values) => values.password === values.password_confirmation, {
    path: ["password_confirmation"],
    message: "两次密码不一致",
  })

export function ChangePasswordPage() {
  const { user, loading, refresh, logout } = useAuth()
  const navigate = useNavigate()
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current_password: "", password: "", password_confirmation: "" },
  })
  const password = form.watch("password")
  const requirements = [
    { label: "至少 12 位", passed: password.length >= 12 },
    { label: "包含大写字母", passed: /[A-Z]/.test(password) },
    { label: "包含小写字母", passed: /[a-z]/.test(password) },
    { label: "包含数字", passed: /\d/.test(password) },
  ]
  const passedRequirementCount = requirements.filter((requirement) => requirement.passed).length
  const mustChangePassword = user?.must_change_password ?? false

  useEffect(() => {
    if (!loading && !user) void navigate("/login", { replace: true })
  }, [loading, navigate, user])

  if (loading) {
    return (
      <div className="grid min-h-svh place-items-center">
        <LoadingState label="正在载入账号信息…" />
      </div>
    )
  }
  if (!user) return null

  const leave = async () => {
    if (mustChangePassword) {
      await logout()
      void navigate("/login", { replace: true })
      return
    }
    void navigate("/")
  }
  const submit = form.handleSubmit(async (values) => {
    try {
      await api<User>("/api/v1/auth/change-password", { method: "POST", body: jsonBody(values) })
      await refresh()
      toast.success("密码已更新")
      void navigate("/", { replace: true })
    } catch (error) {
      toast.error(apiMessage(error))
    }
  })

  const inputClassName = mustChangePassword
    ? "h-14 rounded-xl px-4 pr-14 text-base caret-foreground md:text-base"
    : "md:h-10 md:rounded-xl md:px-3 md:pr-12"
  const passwordError = form.formState.errors.password ? "请满足下方全部密码要求" : undefined
  const formContent = (
    <form
      onSubmit={submit}
      noValidate
      className={cn("w-full", mustChangePassword ? "max-w-[28rem]" : "max-w-xl")}
    >
      <input
        type="email"
        name="username"
        value={user.email}
        autoComplete="username"
        hidden
        readOnly
      />
      {mustChangePassword && (
        <div className="mb-10 flex items-center gap-3">
          <LogoMark className="size-10" />
          <p className="text-base font-semibold tracking-tight">{SYSTEM_NAME}</p>
        </div>
      )}

      <div className={mustChangePassword ? "mb-9" : "mb-8"}>
        {mustChangePassword ? (
          <h1 className="text-[2.25rem] leading-[1.1] font-semibold tracking-[-0.04em] text-balance">
            设置登录密码
          </h1>
        ) : (
          <h2 className="text-lg font-semibold">登录密码</h2>
        )}
        <p
          className={cn(
            "text-muted-foreground",
            mustChangePassword ? "mt-3 text-base leading-7" : "mt-2 text-sm leading-6",
          )}
        >
          {mustChangePassword
            ? "这是你首次登录。请先替换临时密码，完成后即可进入工作台。"
            : "更新用于登录教务工作台的密码。"}
        </p>
      </div>

      <div className={cn("grid", mustChangePassword ? "gap-6" : "gap-5")}>
        <Field
          label="当前密码"
          error={form.formState.errors.current_password?.message}
          errorId="current-password-error"
        >
          <PasswordInput
            autoComplete="current-password"
            placeholder="输入当前密码"
            className={inputClassName}
            aria-invalid={Boolean(form.formState.errors.current_password) || undefined}
            aria-describedby={
              form.formState.errors.current_password ? "current-password-error" : undefined
            }
            {...form.register("current_password")}
          />
        </Field>

        <div className="grid gap-3">
          <Field label="新密码" error={passwordError} errorId="new-password-error">
            <PasswordInput
              autoComplete="new-password"
              placeholder="输入新密码"
              className={inputClassName}
              aria-invalid={Boolean(form.formState.errors.password) || undefined}
              aria-describedby={
                form.formState.errors.password
                  ? "password-requirements new-password-error"
                  : "password-requirements"
              }
              {...form.register("password")}
            />
          </Field>
          <div id="password-requirements">
            <p className="text-xs font-medium text-muted-foreground">密码要求</p>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
              {requirements.map((requirement) => (
                <Requirement key={requirement.label} {...requirement} />
              ))}
            </ul>
            <p className="sr-only" aria-live="polite">
              已满足 {passedRequirementCount} 项，共 {requirements.length} 项密码要求
            </p>
          </div>
        </div>

        <Field
          label="确认新密码"
          error={form.formState.errors.password_confirmation?.message}
          errorId="confirm-password-error"
        >
          <PasswordInput
            autoComplete="new-password"
            placeholder="再次输入新密码"
            className={inputClassName}
            aria-invalid={Boolean(form.formState.errors.password_confirmation) || undefined}
            aria-describedby={
              form.formState.errors.password_confirmation ? "confirm-password-error" : undefined
            }
            {...form.register("password_confirmation")}
          />
        </Field>

        <div className="mt-2 grid grid-cols-2 gap-3 border-t pt-6">
          <Button
            type="button"
            variant="outline"
            className={mustChangePassword ? "h-12 rounded-xl" : undefined}
            onClick={() => void leave()}
          >
            {mustChangePassword && <LogOutIcon aria-hidden="true" />}
            {mustChangePassword ? "退出登录" : "取消"}
          </Button>
          <Button
            type="submit"
            className={mustChangePassword ? "h-12 rounded-xl" : undefined}
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting && (
              <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
            )}
            {form.formState.isSubmitting
              ? "正在保存…"
              : mustChangePassword
                ? "保存密码并进入"
                : "保存密码"}
          </Button>
        </div>
      </div>
    </form>
  )

  if (mustChangePassword) {
    return (
      <main className="flex min-h-svh justify-center bg-background px-6 py-10 selection:bg-primary selection:text-primary-foreground sm:items-center sm:px-10 sm:py-14">
        {formContent}
      </main>
    )
  }

  return (
    <WorkspaceShell>
      <PageHeader title="修改密码" />
      <div className="p-5 md:p-7">{formContent}</div>
    </WorkspaceShell>
  )
}

function PasswordInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={cn("pr-14 md:pr-10", className)}
      />
      <button
        type="button"
        className="absolute top-1/2 right-1 flex size-12 -translate-y-1/2 touch-manipulation items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none md:right-1 md:size-8"
        aria-label={visible ? "隐藏密码" : "显示密码"}
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? (
          <EyeOffIcon className="size-4" aria-hidden="true" />
        ) : (
          <EyeIcon className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}

function Requirement({ label, passed }: { label: string; passed: boolean }) {
  const Icon = passed ? CheckCircle2Icon : CircleIcon

  return (
    <li
      className={cn(
        "flex items-center gap-2 text-xs transition-colors",
        passed ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
      )}
      aria-label={`${label}，${passed ? "已满足" : "未满足"}`}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </li>
  )
}
