import { useDeferredValue, useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router"
import { CopyIcon, PanelLeftIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { api, apiAllPages, apiMessage } from "@/lib/api"
import type { AcademicYear, PaginationMeta, Semester, Teacher, User } from "@/lib/types"
import { EmptyList, ErrorState, Field, LoadingState, PageHeader } from "@/components/page"
import { ListToolbar, ToolbarSelect } from "@/components/list-toolbar"
import { SimpleSelect } from "@/components/simple-select"
import { SearchablePicker } from "@/components/searchable-picker"
import { StatusBadge } from "@/components/status-badge"
import { TableActionButton } from "@/components/table-action-button"
import { TablePagination } from "@/components/table-pagination"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SidebarBrand } from "@/components/brand"
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
import { useSchoolContext, type SystemBranding } from "@/lib/queries"
import { enumParam, mergeSearchParams, positiveIntegerParam } from "@/lib/url-state"

type ManagedUser = User & { etag: string }

export function UsersPage() {
  const client = useQueryClient()
  const [urlParams, setUrlParams] = useSearchParams()
  const [editing, setEditing] = useState<ManagedUser | null | undefined>(undefined)
  const [resetting, setResetting] = useState<ManagedUser | null>(null)
  const [search, setSearch] = useState(() => urlParams.get("q") ?? "")
  const [roleFilter, setRoleFilter] = useState(() =>
    enumParam(urlParams, "role", ["all", "admin", "scheduler", "viewer", "teacher"], "all"),
  )
  const [statusFilter, setStatusFilter] = useState(() =>
    enumParam(urlParams, "status", ["all", "active", "inactive"], "all"),
  )
  const [page, setPage] = useState(() => positiveIntegerParam(urlParams, "page", 1))
  const [pageSize, setPageSize] = useState(() =>
    positiveIntegerParam(urlParams, "per_page", 20, [20, 50, 100]),
  )
  const deferredSearch = useDeferredValue(search.trim())
  const users = useQuery({
    queryKey: ["users", page, pageSize, deferredSearch, roleFilter, statusFilter],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page), per_page: String(pageSize) })
      if (deferredSearch) query.set("search", deferredSearch)
      if (roleFilter !== "all") query.set("role", roleFilter)
      if (statusFilter !== "all") query.set("status", statusFilter)
      return api<ManagedUser[]>(`/api/v1/users?${query}`)
    },
  })
  const pagination = users.data?.meta?.pagination as PaginationMeta | undefined
  const hasFilters = Boolean(deferredSearch || roleFilter !== "all" || statusFilter !== "all")
  const didMountFilters = useRef(false)
  useEffect(() => {
    if (!didMountFilters.current) {
      didMountFilters.current = true
      return
    }
    setPage(1)
  }, [deferredSearch, roleFilter, statusFilter])
  useEffect(() => {
    setUrlParams(
      (current) =>
        mergeSearchParams(current, {
          q: search.trim() || null,
          role: roleFilter === "all" ? null : roleFilter,
          status: statusFilter === "all" ? null : statusFilter,
          page: page === 1 ? null : page,
          per_page: pageSize === 20 ? null : pageSize,
        }),
      { replace: true },
    )
  }, [page, pageSize, roleFilter, search, setUrlParams, statusFilter])
  useEffect(() => {
    if (pagination && page > Math.max(1, pagination.last_page)) {
      setPage(Math.max(1, pagination.last_page))
    }
  }, [page, pagination])
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
  if (users.isError) return <ErrorState retry={() => void users.refetch()} />
  return (
    <>
      <PageHeader
        title="用户管理"
        description="管理教务人员与教师账号；教师账号只能登录独立课表端查看本人课表。"
      />
      <div className="p-5 md:p-7">
        {!users.data?.data.length && !hasFilters ? (
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
              summary={<span>共 {pagination?.total ?? users.data?.data.length ?? 0} 个用户</span>}
              actions={addUserButton}
            >
              <ToolbarSelect value={roleFilter} onChange={setRoleFilter} label="角色筛选">
                <option value="all">全部角色</option>
                <option value="admin">管理员</option>
                <option value="scheduler">排课员</option>
                <option value="viewer">查看者</option>
                <option value="teacher">教师</option>
              </ToolbarSelect>
              <ToolbarSelect value={statusFilter} onChange={setStatusFilter} label="状态筛选">
                <option value="all">全部状态</option>
                <option value="active">已启用</option>
                <option value="inactive">已停用</option>
              </ToolbarSelect>
            </ListToolbar>
            {!users.data?.data.length ? (
              <EmptyList title="没有匹配的用户" description="请调整搜索词或筛选条件。" />
            ) : (
              <Table responsive>
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>教师档案</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>密码</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.data.data.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell data-label="姓名" className="font-medium">
                        <span className="inline-flex items-center gap-3">
                          <span
                            className={`flex size-9 items-center justify-center rounded-full text-sm ${avatarTone(user.id)}`}
                          >
                            {user.name.slice(0, 1)}
                          </span>
                          {user.name}
                        </span>
                      </TableCell>
                      <TableCell data-label="邮箱">
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
                      <TableCell data-label="角色">
                        <StatusBadge value={user.role} />
                      </TableCell>
                      <TableCell data-label="教师档案">
                        {user.teacher ? (
                          <span className="text-sm">
                            {user.teacher.name}
                            {user.teacher.employee_no ? ` · ${user.teacher.employee_no}` : ""}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell data-label="状态">
                        <StatusBadge value={user.is_active ? "active" : "inactive"} />
                      </TableCell>
                      <TableCell data-label="密码">
                        {user.must_change_password ? (
                          <span className="text-xs text-amber-700">待修改临时密码</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">已设置</span>
                        )}
                      </TableCell>
                      <TableCell data-label="操作" className="text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <TableActionButton intent="edit" onClick={() => setEditing(user)}>
                            编辑
                          </TableActionButton>
                          <Button size="sm" variant="ghost" onClick={() => setResetting(user)}>
                            重置密码
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {pagination && (
              <TablePagination
                page={pagination.page}
                pageSize={pagination.per_page}
                totalItems={pagination.total}
                totalPages={pagination.last_page}
                onPageChange={setPage}
                onPageSizeChange={(value) => {
                  setPageSize(value)
                  setPage(1)
                }}
              />
            )}
          </div>
        )}
      </div>
      <UserDialog
        key={editing === null ? "new" : (editing?.id ?? "closed")}
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
  user: ManagedUser | null | undefined
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState(() => userForm(user))
  const teachers = useQuery({
    queryKey: ["teachers", "user-binding"],
    queryFn: () => apiAllPages<Teacher>("/api/v1/teachers"),
    enabled: open,
  })
  const save = async () => {
    try {
      await api(user ? `/api/v1/users/${user.id}` : "/api/v1/users", {
        method: user ? "PATCH" : "POST",
        etag: user?.etag,
        body: JSON.stringify(
          user
            ? {
                name: form.name,
                email: form.email,
                role: form.role,
                teacher_id: form.role === "teacher" ? form.teacher_id : null,
                is_active: form.is_active,
              }
            : {
                name: form.name,
                email: form.email,
                role: form.role,
                teacher_id: form.role === "teacher" ? form.teacher_id : null,
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
              placeholder="例如：张老师"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="邮箱">
            <Input
              type="email"
              value={form.email}
              placeholder="name@school.edu"
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field label="角色">
            <SimpleSelect
              className="w-full"
              value={form.role}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  role: value as ManagedUser["role"],
                  teacher_id: value === "teacher" ? form.teacher_id : null,
                })
              }
            >
              <option value="viewer">查看者</option>
              <option value="scheduler">排课员</option>
              <option value="admin">管理员</option>
              <option value="teacher">教师</option>
            </SimpleSelect>
          </Field>
          {form.role === "teacher" && (
            <Field label="绑定教师">
              <SearchablePicker
                options={(teachers.data?.data ?? []).map((teacher) => ({
                  id: teacher.id,
                  label: teacher.name,
                  description: teacher.employee_no ?? "未填工号",
                  disabled: !teacher.is_active,
                }))}
                ariaLabel="搜索教师"
                placeholder={teachers.isLoading ? "正在载入教师…" : "选择账号对应的教师"}
                value={form.teacher_id}
                onValueChange={(teacherId) => setForm({ ...form, teacher_id: teacherId })}
                disabled={teachers.isLoading}
              />
            </Field>
          )}
          {user ? (
            <Field label="账号状态">
              <SimpleSelect
                className="w-full"
                value={form.is_active ? "active" : "inactive"}
                onValueChange={(value) => setForm({ ...form, is_active: value === "active" })}
              >
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </SimpleSelect>
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
            disabled={
              !form.name ||
              !form.email ||
              (form.role === "teacher" && !form.teacher_id) ||
              (!user && form.temporary_password.length < 12)
            }
            onClick={() => void save()}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function userForm(user: ManagedUser | null | undefined) {
  return {
    name: user?.name ?? "",
    email: user?.email ?? "",
    role: user?.role ?? "viewer",
    teacher_id: user?.teacher_id ?? null,
    is_active: user?.is_active ?? true,
    temporary_password: "",
  }
}

function ResetPasswordDialog({
  user,
  onClose,
  onSaved,
}: {
  user: ManagedUser | null
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
        etag: user.etag,
        body: JSON.stringify({ temporary_password: password }),
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
  const context = useSchoolContext()
  const schoolSettings = useQuery({
    queryKey: ["school-settings"],
    queryFn: () => api<SystemBranding>("/api/v1/school-settings"),
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
  const [systemName, setSystemName] = useState("")
  const [systemTagline, setSystemTagline] = useState("")
  const [saving, setSaving] = useState<"semester" | "name" | null>(null)
  useEffect(() => setSelected(String(context.data?.current_semester?.id ?? "")), [context.data])
  useEffect(() => {
    setSystemName(schoolSettings.data?.data.system_name ?? "")
    setSystemTagline(schoolSettings.data?.data.system_tagline ?? "")
  }, [schoolSettings.data])
  if (context.isLoading || years.isLoading || semesters.isLoading || schoolSettings.isLoading)
    return <LoadingState />
  const loadError = context.error ?? years.error ?? semesters.error ?? schoolSettings.error
  if (loadError) return <ErrorState retry={() => window.location.reload()} />
  const semesterId = selected ? Number(selected) : null
  const semesterChanged = semesterId !== (context.data?.current_semester?.id ?? null)
  const nextSettings = {
    system_name: systemName.trim(),
    system_tagline: systemTagline.trim() || null,
  }
  const savedSettings = schoolSettings.data?.data
  const brandingChanged = Boolean(
    savedSettings &&
    (nextSettings.system_name !== savedSettings.system_name.trim() ||
      nextSettings.system_tagline !== (savedSettings.system_tagline?.trim() || null)),
  )
  const save = async () => {
    if (saving || !semesterChanged) return
    setSaving("semester")
    try {
      await api("/api/v1/context/current-semester", {
        method: "PUT",
        body: JSON.stringify({ semester_id: semesterId }),
      })
      window.location.reload()
    } catch (error) {
      toast.error(apiMessage(error))
      setSaving(null)
    }
  }
  const saveSystemName = async () => {
    if (saving || !brandingChanged || !nextSettings.system_name || !schoolSettings.data?.etag)
      return
    setSaving("name")
    try {
      await api("/api/v1/school-settings", {
        method: "PATCH",
        etag: schoolSettings.data.etag,
        body: JSON.stringify(nextSettings),
      })
      window.location.reload()
    } catch (error) {
      toast.error(apiMessage(error))
      setSaving(null)
    }
  }
  const selectedSemester = semesters.data?.find((semester) => String(semester.id) === selected)
  return (
    <>
      <PageHeader
        title="系统设置"
        description="这里只放系统级上下文；业务资料仍在相应列表中维护。"
      />
      <div className="max-w-6xl p-5 md:p-7">
        <section className="border-b pb-7">
          <p className="text-lg font-semibold">当前学期</p>
          <div className="mt-7 grid gap-5 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start">
            <p className="pt-3 text-sm font-medium">开放学期</p>
            <div className="max-w-2xl">
              <SimpleSelect
                className="w-full"
                value={selected}
                onValueChange={setSelected}
                label="开放学期"
              >
                <option value="">不设置</option>
                {semesters.data?.map((semester) => (
                  <option key={semester.id} value={semester.id}>
                    {semester.year_name} · {semester.name}
                  </option>
                ))}
              </SimpleSelect>
              {selectedSemester && (
                <p className="mt-4 text-sm text-muted-foreground">
                  {selectedSemester.start_date} 至 {selectedSemester.end_date}
                </p>
              )}
            </div>
          </div>
          <div className="mt-7 flex justify-end">
            <Button
              disabled={saving !== null || !semesterChanged}
              aria-busy={saving === "semester"}
              onClick={() => void save()}
            >
              保存
            </Button>
          </div>
        </section>
        <form
          className="pt-7"
          onSubmit={(event) => {
            event.preventDefault()
            void saveSystemName()
          }}
        >
          <h2 className="text-lg font-semibold">系统名称与副标题</h2>
          <div className="mt-7 grid gap-8 xl:grid-cols-[minmax(0,1fr)_256px] xl:gap-12">
            <div className="min-w-0 space-y-6">
              <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-5">
                <label htmlFor="system-name" className="pt-2 text-sm font-medium">
                  名称
                </label>
                <div>
                  <Input
                    id="system-name"
                    value={systemName}
                    onChange={(event) => setSystemName(event.target.value)}
                    maxLength={60}
                    required
                    disabled={saving !== null}
                    aria-describedby="system-name-help"
                  />
                  <p id="system-name-help" className="mt-3 text-sm text-muted-foreground">
                    显示在登录页、侧栏和浏览器标题中，最多 60 个字符。
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-5">
                <label htmlFor="system-tagline" className="pt-2 text-sm font-medium">
                  副标题 <span className="font-normal text-muted-foreground">（选填）</span>
                </label>
                <div>
                  <Input
                    id="system-tagline"
                    value={systemTagline}
                    onChange={(event) => setSystemTagline(event.target.value)}
                    maxLength={60}
                    disabled={saving !== null}
                    aria-describedby="system-tagline-help"
                  />
                  <p id="system-tagline-help" className="mt-3 text-sm text-muted-foreground">
                    显示在侧栏名称下方，留空则隐藏，最多 60 个字符。
                  </p>
                </div>
              </div>
            </div>
            <aside aria-label="侧栏预览" className="min-w-0">
              <h3 className="text-sm font-medium">侧栏预览</h3>
              <div className="mt-3 w-64 max-w-full rounded-xl border bg-sidebar p-2 text-sidebar-foreground">
                <div className="flex h-8 min-w-0 items-center gap-2">
                  <SidebarBrand name={systemName.trim()} tagline={systemTagline.trim() || null} />
                  <span
                    className="flex size-8 shrink-0 items-center justify-center text-muted-foreground"
                    aria-hidden="true"
                  >
                    <PanelLeftIcon className="size-4" />
                  </span>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">输入后实时预览，保存后生效。</p>
            </aside>
          </div>
          <div className="mt-7 flex justify-end">
            <Button
              type="submit"
              disabled={
                saving !== null ||
                !brandingChanged ||
                !nextSettings.system_name ||
                !schoolSettings.data?.etag
              }
              aria-busy={saving === "name"}
            >
              保存
            </Button>
          </div>
        </form>
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
