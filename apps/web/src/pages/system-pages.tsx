import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CopyIcon, KeyRoundIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { api, apiMessage, jsonBody } from "@/lib/api"
import type { AcademicYear, Semester, User } from "@/lib/types"
import { EmptyList, Field, LoadingState, PageHeader } from "@/components/page"
import { ListToolbar, ToolbarSelect } from "@/components/list-toolbar"
import { StatusBadge } from "@/components/status-badge"
import { TablePagination, useTablePagination } from "@/components/table-pagination"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useSchoolContext } from "@/lib/queries"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function UsersPage() {
  const client = useQueryClient()
  const [editing, setEditing] = useState<User | null | undefined>(undefined)
  const [resetting, setResetting] = useState<User | null>(null)
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const users = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api<User[]>("/api/v1/users")).data,
  })
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN")
    return (users.data ?? []).filter((user) => {
      const matchesSearch =
        !query || `${user.name} ${user.email}`.toLocaleLowerCase("zh-CN").includes(query)
      const matchesRole = roleFilter === "all" || user.role === roleFilter
      const matchesStatus = statusFilter === "all" || (statusFilter === "active") === user.is_active
      return matchesSearch && matchesRole && matchesStatus
    })
  }, [roleFilter, search, statusFilter, users.data])
  const pagination = useTablePagination(filteredUsers)
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["users"] })
  }
  const addUserButton = (
    <Button onClick={() => setEditing(null)}>
      <PlusIcon />
      新增用户
    </Button>
  )
  if (users.isLoading) return <LoadingState />
  return (
    <>
      <PageHeader
        title="用户管理"
        description="账号权限分为管理员、排课员和查看者；敏感变更会撤销该账号的现有会话。"
      />
      <div className="p-5 md:p-7">
        {!users.data?.length ? (
          <EmptyList
            title="没有用户"
            description="至少应保留一个启用的管理员。"
            actions={addUserButton}
          />
        ) : (
          <div className="surface-panel overflow-hidden">
            <ListToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="搜索姓名或邮箱"
              summary={<span>共 {filteredUsers.length} 个用户</span>}
              actions={addUserButton}
            >
              <ToolbarSelect value={roleFilter} onChange={setRoleFilter} label="角色筛选">
                <option value="all">全部角色</option>
                <option value="admin">管理员</option>
                <option value="scheduler">排课员</option>
                <option value="viewer">查看者</option>
              </ToolbarSelect>
              <ToolbarSelect value={statusFilter} onChange={setStatusFilter} label="状态筛选">
                <option value="all">全部状态</option>
                <option value="active">已启用</option>
                <option value="inactive">已停用</option>
              </ToolbarSelect>
            </ListToolbar>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>密码</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-3">
                        <span
                          className={`flex size-9 items-center justify-center rounded-full text-sm ${avatarTone(user.id)}`}
                        >
                          {user.name.slice(0, 1)}
                        </span>
                        {user.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        {user.email}
                        <button
                          type="button"
                          aria-label={`复制${user.name}的邮箱`}
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            void navigator.clipboard.writeText(user.email)
                            toast.success("邮箱已复制")
                          }}
                        >
                          <CopyIcon className="size-3.5" />
                        </button>
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={user.role} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={user.is_active ? "active" : "inactive"} />
                    </TableCell>
                    <TableCell>
                      {user.must_change_password ? (
                        <span className="text-xs text-amber-700">待修改临时密码</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">已设置</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(user)}>
                        编辑
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="重置密码"
                        onClick={() => setResetting(user)}
                      >
                        <KeyRoundIcon />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button size="icon-sm" variant="ghost" aria-label="更多用户操作" />
                          }
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(user)}>
                            编辑账号
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setResetting(user)}>
                            重置密码
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination {...pagination} />
          </div>
        )}
      </div>
      <UserDialog
        open={editing !== undefined}
        user={editing}
        onClose={() => setEditing(undefined)}
        onSaved={refresh}
      />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} onSaved={refresh} />
    </>
  )
}

function UserDialog({
  open,
  user,
  onClose,
  onSaved,
}: {
  open: boolean
  user: User | null | undefined
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "viewer",
    is_active: true,
    temporary_password: "",
  })
  useEffect(() => {
    if (open)
      setForm({
        name: user?.name ?? "",
        email: user?.email ?? "",
        role: user?.role ?? "viewer",
        is_active: user?.is_active ?? true,
        temporary_password: "",
      })
  }, [open, user])
  const save = async () => {
    try {
      await api(user ? `/api/v1/users/${user.id}` : "/api/v1/users", {
        method: user ? "PATCH" : "POST",
        body: jsonBody(
          user
            ? { name: form.name, email: form.email, role: form.role, is_active: form.is_active }
            : {
                name: form.name,
                email: form.email,
                role: form.role,
                temporary_password: form.temporary_password,
              },
        ),
      })
      toast.success("用户已保存")
      onClose()
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? "编辑用户" : "新增用户"}</DialogTitle>
          <DialogDescription>新用户首次登录必须修改临时密码。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="姓名">
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="邮箱">
            <Input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field label="角色">
            <select
              className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value })}
            >
              <option value="viewer">查看者</option>
              <option value="scheduler">排课员</option>
              <option value="admin">管理员</option>
            </select>
          </Field>
          {user ? (
            <Field label="账号状态">
              <select
                className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
                value={form.is_active ? "active" : "inactive"}
                onChange={(event) =>
                  setForm({ ...form, is_active: event.target.value === "active" })
                }
              >
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </select>
            </Field>
          ) : (
            <Field label="临时密码">
              <Input
                type="password"
                value={form.temporary_password}
                onChange={(event) => setForm({ ...form, temporary_password: event.target.value })}
                placeholder="至少 12 位，含大小写字母和数字"
              />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!form.name || !form.email || (!user && form.temporary_password.length < 12)}
            onClick={() => void save()}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({
  user,
  onClose,
  onSaved,
}: {
  user: User | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [password, setPassword] = useState("")
  useEffect(() => setPassword(""), [user])
  const reset = async () => {
    if (!user) return
    try {
      await api(`/api/v1/users/${user.id}/reset-password`, {
        method: "POST",
        body: jsonBody({ temporary_password: password }),
      })
      toast.success("临时密码已重置，原会话已撤销")
      onClose()
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  return (
    <Dialog open={user !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重置 {user?.name} 的密码</DialogTitle>
          <DialogDescription>保存后，该用户的所有现有会话都会立即失效。</DialogDescription>
        </DialogHeader>
        <Field label="新临时密码">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 12 位，含大小写字母和数字"
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={password.length < 12} onClick={() => void reset()}>
            重置密码
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SettingsPage() {
  const client = useQueryClient()
  const context = useSchoolContext()
  const schoolSettings = useQuery({
    queryKey: ["school-settings"],
    queryFn: () => api<{ timezone: string }>("/api/v1/school-settings"),
  })
  const years = useQuery({
    queryKey: ["academic-years"],
    queryFn: () => api<AcademicYear[]>("/api/v1/academic-years"),
  })
  const semesters = useQuery({
    queryKey: ["all-open-semesters"],
    queryFn: async () => {
      const allYears = (await api<AcademicYear[]>("/api/v1/academic-years")).data
      const groups = await Promise.all(
        allYears.map(async (year) => ({
          year,
          semesters: (await api<Semester[]>(`/api/v1/academic-years/${year.id}/semesters`)).data,
        })),
      )
      return groups
        .flatMap(({ year, semesters: items }) =>
          items.map((semester) => ({ ...semester, year_name: year.name })),
        )
        .filter((semester) => semester.status === "open")
    },
  })
  const [selected, setSelected] = useState("")
  const [timezone, setTimezone] = useState("")
  useEffect(() => setSelected(String(context.data?.current_semester?.id ?? "")), [context.data])
  useEffect(() => setTimezone(schoolSettings.data?.data.timezone ?? ""), [schoolSettings.data])
  if (context.isLoading || years.isLoading || semesters.isLoading || schoolSettings.isLoading)
    return <LoadingState />
  const save = async () => {
    try {
      await api("/api/v1/context/current-semester", {
        method: "PUT",
        body: jsonBody({ semester_id: selected ? Number(selected) : null }),
      })
      toast.success("当前学期已更新")
      await Promise.all([
        client.invalidateQueries({ queryKey: ["context"] }),
        client.invalidateQueries({ queryKey: ["all-open-semesters"] }),
      ])
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  const saveTimezone = async () => {
    if (!timezone || !schoolSettings.data?.etag) return
    try {
      await api("/api/v1/school-settings", {
        method: "PATCH",
        etag: schoolSettings.data.etag,
        body: jsonBody({ timezone }),
      })
      toast.success("学校时区已更新")
      await Promise.all([
        client.invalidateQueries({ queryKey: ["school-settings"] }),
        client.invalidateQueries({ queryKey: ["context"] }),
      ])
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  const selectedSemester = semesters.data?.find((semester) => String(semester.id) === selected)
  const schoolTime = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
    timeZone: timezone || "Asia/Shanghai",
  }).format(new Date())
  return (
    <>
      <PageHeader
        title="系统设置"
        description="这里只放系统级上下文；业务资料仍在相应列表中维护。"
      />
      <div className="max-w-6xl p-5 md:p-7">
        <section className="border-b pb-7">
          <div>
            <p className="text-lg font-semibold">当前学期</p>
            <p className="mt-1 text-sm text-muted-foreground">
              侧边栏的学期配置、教学任务和排课工作台会默认打开该学期。
            </p>
          </div>
          <div className="mt-7 grid gap-5 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start">
            <p className="pt-3 text-sm font-medium">开放学期</p>
            <div className="max-w-2xl">
              <select
                className="h-12 w-full rounded-lg border bg-background px-4 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">不设置</option>
                {semesters.data?.map((semester) => (
                  <option key={semester.id} value={semester.id}>
                    {semester.year_name} · {semester.name}
                  </option>
                ))}
              </select>
              {selectedSemester && (
                <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <p>
                    {selectedSemester.start_date} 至 {selectedSemester.end_date}
                  </p>
                  <p>切换不会修改历史数据，只会改变默认工作上下文。</p>
                </div>
              )}
              <p className="mt-5 text-sm text-amber-600">
                切换前请确认教务人员没有正在处理其他学期的数据。
              </p>
            </div>
          </div>
          <div className="mt-7 flex justify-end">
            <Button onClick={() => void save()}>保存当前学期</Button>
          </div>
        </section>
        <section className="pt-7">
          <div>
            <p className="text-lg font-semibold">学校时区</p>
            <p className="mt-1 text-sm text-muted-foreground">
              用于系统日期、审计时间和服务端业务时间解释。建议初始化后保持稳定。
            </p>
          </div>
          <div className="mt-7 grid gap-5 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start">
            <p className="pt-3 text-sm font-medium">IANA 时区</p>
            <div className="max-w-2xl">
              <select
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className="h-12 w-full rounded-lg border bg-background px-4 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
              >
                <option value="Asia/Shanghai">Asia/Shanghai</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong</option>
                <option value="Asia/Taipei">Asia/Taipei</option>
                <option value="Asia/Singapore">Asia/Singapore</option>
              </select>
              <p className="mt-3 text-sm text-muted-foreground">
                {timezone === "Asia/Shanghai"
                  ? "中国标准时间（UTC+08:00）"
                  : "请确认该时区与学校所在地一致。"}
              </p>
              <div className="mt-5 flex items-center gap-4 border-y py-4 text-sm">
                <span className="font-medium">当前学校时间</span>
                <span className="text-muted-foreground">{schoolTime}</span>
              </div>
            </div>
          </div>
          <div className="mt-7 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              已创建学年：{years.data?.data.length ?? 0}
            </span>
            <Button onClick={() => void saveTimezone()}>保存时区</Button>
          </div>
        </section>
      </div>
    </>
  )
}

function avatarTone(id: number) {
  const tones = [
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-violet-100 text-violet-700",
    "bg-amber-100 text-amber-700",
    "bg-rose-100 text-rose-700",
  ]
  return tones[id % tones.length]
}
