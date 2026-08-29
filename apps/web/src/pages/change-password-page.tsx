import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleIcon,
  EyeIcon,
  EyeOffIcon,
  LogOutIcon,
} from "lucide-react"
import { useAuth } from "@/lib/auth"
import { api, apiMessage, jsonBody } from "@/lib/api"
import type { User } from "@/lib/types"
import { Brand } from "@/components/brand"
import { Field } from "@/components/page"
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
  const { user, refresh, logout } = useAuth()
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

  useEffect(() => {
    if (!user) void navigate("/login", { replace: true })
  }, [navigate, user])

  if (!user) return null

  const leave = async () => {
    if (user.must_change_password) {
      await logout()
      void navigate("/login", { replace: true })
      return
    }
    void navigate(-1)
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

  return (
    <div className="min-h-svh bg-background">
      <header className="flex h-24 items-center border-b px-6 lg:px-8">
        <Brand />
      </header>
      <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
        <Button variant="ghost" className="mb-8 -ml-3" onClick={() => void leave()}>
          {user.must_change_password ? <LogOutIcon /> : <ArrowLeftIcon />}
          {user.must_change_password ? "退出登录" : "返回工作台"}
        </Button>
        <form
          onSubmit={submit}
          className="surface-panel grid overflow-hidden lg:grid-cols-[40%_60%]"
        >
          <section className="border-b p-8 lg:min-h-[680px] lg:border-r lg:border-b-0 lg:p-12">
            <h1 className="text-3xl font-semibold tracking-tight">修改密码</h1>
            <p className="mt-4 text-muted-foreground">为了保护账号安全，请设置一个新的登录密码。</p>
            <div className="mt-14 max-w-sm">
              <p className="border-b pb-4 font-medium">密码要求</p>
              <div className="mt-5 grid gap-5">
                {requirements.map((requirement) => (
                  <Requirement key={requirement.label} {...requirement} />
                ))}
              </div>
            </div>
          </section>
          <section className="p-8 lg:p-12">
            <div className="grid gap-7">
              <Field
                label="当前密码"
                error={form.formState.errors.current_password?.message}
                errorId="current-password-error"
              >
                <PasswordInput
                  autoComplete="current-password"
                  placeholder="输入当前密码"
                  aria-invalid={Boolean(form.formState.errors.current_password) || undefined}
                  aria-describedby={
                    form.formState.errors.current_password ? "current-password-error" : undefined
                  }
                  {...form.register("current_password")}
                />
              </Field>
              <Field
                label="新密码"
                error={form.formState.errors.password?.message}
                errorId="new-password-error"
              >
                <PasswordInput
                  autoComplete="new-password"
                  placeholder="至少 12 位"
                  aria-invalid={Boolean(form.formState.errors.password) || undefined}
                  aria-describedby={
                    form.formState.errors.password ? "new-password-error" : undefined
                  }
                  {...form.register("password")}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {requirements.map((requirement) => (
                  <Requirement key={requirement.label} {...requirement} compact />
                ))}
              </div>
              <Field
                label="确认新密码"
                error={form.formState.errors.password_confirmation?.message}
                errorId="confirm-password-error"
              >
                <PasswordInput
                  autoComplete="new-password"
                  placeholder="再次输入新密码"
                  aria-invalid={Boolean(form.formState.errors.password_confirmation) || undefined}
                  aria-describedby={
                    form.formState.errors.password_confirmation
                      ? "confirm-password-error"
                      : undefined
                  }
                  {...form.register("password_confirmation")}
                />
              </Field>
              <div className="mt-2 border-t pt-6">
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => void leave()}>
                    {user.must_change_password ? "退出登录" : "取消"}
                  </Button>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    保存密码
                  </Button>
                </div>
                <p className="mt-5 text-right text-sm text-muted-foreground">
                  保存后将返回工作台。
                </p>
              </div>
            </div>
          </section>
        </form>
      </main>
    </div>
  )
}

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="pr-10" />
      <button
        type="button"
        className="absolute top-1/2 right-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={visible ? "隐藏密码" : "显示密码"}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  )
}

function Requirement({
  label,
  passed,
  compact = false,
}: {
  label: string
  passed: boolean
  compact?: boolean
}) {
  const Icon = passed ? CheckCircle2Icon : CircleIcon

  return (
    <div
      className={`flex items-center gap-3 ${compact ? "text-xs" : "text-sm"} ${passed ? "text-emerald-600" : "text-muted-foreground"}`}
    >
      <Icon className={compact ? "size-4" : "size-5"} />
      <span className={passed ? "text-foreground" : undefined}>{label}</span>
    </div>
  )
}
