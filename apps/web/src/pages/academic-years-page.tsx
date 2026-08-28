import { useDeferredValue, useEffect, useRef, useState } from "react"
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { ArrowLeftIcon, ChevronRightIcon, FileUpIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { api, apiAllPages, ApiError, apiMessage, jsonBody } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { AcademicYear, Grade, PaginationMeta, SchoolClass, Semester } from "@/lib/types"
import { EmptyList, ErrorState, Field, LoadingState, PageHeader } from "@/components/page"
import { StatusBadge } from "@/components/status-badge"
import { TableActionButton } from "@/components/table-action-button"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { ListToolbar, ToolbarSelect } from "@/components/list-toolbar"
import { useSchoolContext } from "@/lib/queries"
import { enumParam, mergeSearchParams, positiveIntegerParam } from "@/lib/url-state"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function AcademicYearsPage() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const context = useSchoolContext()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "" })
  const [saving, setSaving] = useState(false)
  const years = useQuery({
    queryKey: ["academic-years"],
    queryFn: () => api<AcademicYear[]>("/api/v1/academic-years"),
  })
  const yearItems = years.data?.data ?? []
  const classCounts = useQueries({
    queries: yearItems.map((year) => ({
      queryKey: ["classes", year.id],
      queryFn: () => apiAllPages<SchoolClass>(`/api/v1/academic-years/${year.id}/classes`),
    })),
  })
  const semesterCounts = useQueries({
    queries: yearItems.map((year) => ({
      queryKey: ["semesters", year.id],
      queryFn: async () =>
        (await api<Semester[]>(`/api/v1/academic-years/${year.id}/semesters`)).data,
    })),
  })
  const pagination = useTablePagination(years.data?.data)

  const save = async () => {
    if (!years.data?.etag) return
    setSaving(true)
    try {
      const result = await api<AcademicYear>("/api/v1/academic-years", {
        method: "POST",
        etag: years.data.etag,
        body: jsonBody(form),
      })
      toast.success("学年已创建，请继续配置上下两个学期和班级。")
      setOpen(false)
      setForm({ name: "", start_date: "", end_date: "" })
      await client.invalidateQueries({ queryKey: ["academic-years"] })
      await navigate(`/years/${result.data.id}`)
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setSaving(false)
    }
  }
  const newYearButton = (
    <Button onClick={() => setOpen(true)}>
      <PlusIcon />
      新建学年
    </Button>
  )

  return (
    <>
      <PageHeader
        title="学年与班级"
        description="按学年初始化班级，再进入各学期准备作息、任务和课表。"
      />
      <div className="p-5 md:p-7">
        {years.isLoading ? (
          <LoadingState />
        ) : years.isError ? (
          <ErrorState retry={() => void years.refetch()} />
        ) : !years.data?.data.length ? (
          <EmptyList
            title="还没有学年"
            description="新建学年后，系统会引导你补齐两个学期和班级资料。"
            actions={newYearButton}
          />
        ) : (
          <div className="surface-panel overflow-hidden">
            <ListToolbar actions={newYearButton} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>学年</TableHead>
                  <TableHead>日期范围</TableHead>
                  <TableHead>班级</TableHead>
                  <TableHead>学期</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.items.map((year) => {
                  const index = yearItems.findIndex((item) => item.id === year.id)
                  const classCount = classCounts[index]?.data?.data.length ?? 0
                  const semesterCount = semesterCounts[index]?.data?.length ?? 0
                  const isCurrent = context.data?.current_semester?.academic_year.id === year.id
                  return (
                    <TableRow
                      key={year.id}
                      className={isCurrent ? "border-l-4 border-l-primary" : undefined}
                    >
                      <TableCell className="font-medium">{year.name}</TableCell>
                      <TableCell>
                        {year.start_date} 至 {year.end_date}
                      </TableCell>
                      <TableCell>{classCount} 个班级</TableCell>
                      <TableCell>
                        <div className="min-w-20">
                          <span>{semesterCount}/2</span>
                          <div className="mt-1 h-1 w-10 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${semesterCount * 50}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <StatusBadge value={year.status} />
                          {isCurrent && (
                            <span className="rounded-lg border px-1.5 py-0.5 text-xs">当前</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          nativeButton={false}
                          render={<Link to={`/years/${year.id}`} />}
                        >
                          {isCurrent ? "管理学年" : "查看详情"}
                          {isCurrent && <ChevronRightIcon />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <TablePagination {...pagination} />
          </div>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建学年</DialogTitle>
            <DialogDescription>
              建议使用“2026-2027 学年”这样的名称，日期需覆盖两个学期。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="学年名称">
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="开始日期">
                <Input
                  type="date"
                  value={form.start_date}
                  onInput={(event) => {
                    const value = event.currentTarget.value
                    setForm((current) => ({ ...current, start_date: value }))
                  }}
                />
              </Field>
              <Field label="结束日期">
                <Input
                  type="date"
                  value={form.end_date}
                  onInput={(event) => {
                    const value = event.currentTarget.value
                    setForm((current) => ({ ...current, end_date: value }))
                  }}
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              disabled={saving || !form.name || !form.start_date || !form.end_date}
              onClick={() => void save()}
            >
              创建并继续
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function AcademicYearDetailPage() {
  const { user } = useAuth()
  const { yearId = "" } = useParams()
  const id = Number(yearId)
  const client = useQueryClient()
  const navigate = useNavigate()
  const [urlParams, setUrlParams] = useSearchParams()
  const [classModal, setClassModal] = useState<SchoolClass | null | undefined>(undefined)
  const [semesterModal, setSemesterModal] = useState<1 | 2 | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [classSearch, setClassSearch] = useState(() => urlParams.get("q") ?? "")
  const [gradeFilter, setGradeFilter] = useState(() => {
    const value = urlParams.get("grade")
    return value && /^\d+$/.test(value) ? value : "all"
  })
  const [statusFilter, setStatusFilter] = useState(() =>
    enumParam(urlParams, "status", ["all", "active", "inactive"], "all"),
  )
  const [classPage, setClassPage] = useState(() => positiveIntegerParam(urlParams, "page", 1))
  const [classPageSize, setClassPageSize] = useState(() =>
    positiveIntegerParam(urlParams, "per_page", 20, [20, 50, 100]),
  )
  const deferredClassSearch = useDeferredValue(classSearch.trim())
  const [lifecycleModal, setLifecycleModal] = useState<{
    semester: Semester
    action: "close" | "reopen"
  } | null>(null)
  const years = useQuery({
    queryKey: ["academic-years"],
    queryFn: () => api<AcademicYear[]>("/api/v1/academic-years"),
  })
  const year = years.data?.data.find((item) => item.id === id)
  const semesters = useQuery({
    queryKey: ["semesters", id],
    queryFn: async () => (await api<Semester[]>(`/api/v1/academic-years/${id}/semesters`)).data,
    enabled: Number.isFinite(id),
  })
  const classes = useQuery({
    queryKey: [
      "classes",
      id,
      classPage,
      classPageSize,
      deferredClassSearch,
      gradeFilter,
      statusFilter,
    ],
    queryFn: () => {
      const query = new URLSearchParams({
        page: String(classPage),
        per_page: String(classPageSize),
      })
      if (deferredClassSearch) query.set("search", deferredClassSearch)
      if (gradeFilter !== "all") query.set("grade_id", gradeFilter)
      if (statusFilter !== "all") query.set("status", statusFilter)
      return api<SchoolClass[]>(`/api/v1/academic-years/${id}/classes?${query}`)
    },
    enabled: Number.isFinite(id),
  })
  const grades = useQuery({
    queryKey: ["grades"],
    queryFn: () => apiAllPages<Grade>("/api/v1/grades"),
  })
  const classesPagination = classes.data?.meta?.pagination as PaginationMeta | undefined
  const classTotal = classesPagination?.total ?? classes.data?.data.length ?? 0
  const hasClassFilters = Boolean(
    deferredClassSearch || gradeFilter !== "all" || statusFilter !== "all",
  )
  const didMountClassFilters = useRef(false)
  useEffect(() => {
    if (!didMountClassFilters.current) {
      didMountClassFilters.current = true
      return
    }
    setClassPage(1)
  }, [deferredClassSearch, gradeFilter, statusFilter])
  useEffect(() => {
    setUrlParams(
      (current) =>
        mergeSearchParams(current, {
          q: classSearch.trim() || null,
          grade: gradeFilter === "all" ? null : gradeFilter,
          status: statusFilter === "all" ? null : statusFilter,
          page: classPage === 1 ? null : classPage,
          per_page: classPageSize === 20 ? null : classPageSize,
        }),
      { replace: true },
    )
  }, [classPage, classPageSize, classSearch, gradeFilter, setUrlParams, statusFilter])
  useEffect(() => {
    if (classesPagination && classPage > Math.max(1, classesPagination.last_page)) {
      setClassPage(Math.max(1, classesPagination.last_page))
    }
  }, [classPage, classesPagination])
  const semestersPagination = useTablePagination(semesters.data)
  const refreshAll = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["academic-years"] }),
      client.invalidateQueries({ queryKey: ["semesters", id] }),
      client.invalidateQueries({ queryKey: ["classes", id] }),
    ])
  }

  const yearAction = async (action: "open" | "close" | "reopen" | "delete") => {
    if (!year || !years.data?.etag) return
    try {
      await api(
        action === "delete"
          ? `/api/v1/academic-years/${id}`
          : `/api/v1/academic-years/${id}/${action}`,
        {
          method: action === "delete" ? "DELETE" : "POST",
          etag: years.data.etag,
          body: action === "reopen" ? jsonBody({ reason: "管理员重新开放" }) : undefined,
        },
      )
      toast.success(action === "delete" ? "学年已删除" : "学年状态已更新")
      if (action === "delete") void navigate("/years", { replace: true })
      else await refreshAll()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  const semesterAction = async (
    semester: Semester,
    action: "open" | "close" | "reopen" | "current" | "delete",
    body?: Record<string, unknown>,
  ) => {
    try {
      if (action === "current")
        await api("/api/v1/context/current-semester", {
          method: "PUT",
          body: jsonBody({ semester_id: semester.id }),
        })
      else {
        if (action === "delete" && !window.confirm(`确定删除空的${semester.name}吗？`)) return
        await api(
          action === "delete"
            ? `/api/v1/semesters/${semester.id}`
            : `/api/v1/semesters/${semester.id}/${action}`,
          {
            method: action === "delete" ? "DELETE" : "POST",
            etag: semester.etag,
            body: body ? jsonBody(body) : undefined,
          },
        )
      }
      toast.success(
        action === "current"
          ? "当前学期已切换"
          : action === "delete"
            ? "学期已删除"
            : "学期状态已更新",
      )
      await Promise.all([client.invalidateQueries({ queryKey: ["context"] }), refreshAll()])
      return true
    } catch (error) {
      toast.error(apiMessage(error))
      return false
    }
  }
  if (years.isLoading || semesters.isLoading || classes.isLoading || grades.isLoading)
    return <LoadingState />
  if (!year) return <ErrorState retry={() => void years.refetch()} />

  return (
    <>
      <div className="flex flex-col gap-3 border-b bg-background px-5 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="icon-sm"
            variant="ghost"
            className="shrink-0"
            aria-label="返回学年列表"
            onClick={() => navigate("/years")}
          >
            <ArrowLeftIcon />
          </Button>
          <h1 className="shrink-0 text-lg leading-tight font-semibold tracking-[-0.02em]">
            {year.name}
          </h1>
          <div className="hidden min-w-0 items-center gap-2 text-sm text-muted-foreground lg:flex">
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            <span>
              {year.start_date} 至 {year.end_date}
            </span>
            <span aria-hidden="true">·</span>
            <StatusBadge value={year.status} />
            <span aria-hidden="true">·</span>
            <span>{classTotal} 个班级</span>
            <span aria-hidden="true">·</span>
            <span>{semesters.data?.length ?? 0} 个学期</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {year.status === "draft" && (
            <Button variant="outline" onClick={() => void yearAction("open")}>
              开放学年
            </Button>
          )}
          {year.status === "open" && (
            <Button variant="outline" onClick={() => void yearAction("close")}>
              关闭学年
            </Button>
          )}
          {year.status === "closed" && user?.role === "admin" && (
            <Button variant="outline" onClick={() => void yearAction("reopen")}>
              重新开放
            </Button>
          )}
        </div>
      </div>
      <div className="p-5 md:p-7">
        <Tabs defaultValue="classes">
          <TabsList>
            <TabsTrigger value="classes">班级（{classTotal}）</TabsTrigger>
            <TabsTrigger value="semesters">学期（{semesters.data?.length ?? 0}/2）</TabsTrigger>
          </TabsList>
          <TabsContent
            value="classes"
            className="mt-5 overflow-hidden rounded-xl border bg-background"
          >
            <div className="flex items-center justify-between border-b p-3">
              <div>
                <p className="font-medium">学年班级</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <FileUpIcon />
                  CSV 导入
                </Button>
                <Button onClick={() => setClassModal(null)}>
                  <PlusIcon />
                  新增班级
                </Button>
              </div>
            </div>
            {!classes.data?.data.length && !hasClassFilters ? (
              <EmptyList
                title="还没有班级"
                description="可逐个新增，也可用固定表头的 UTF-8 CSV 批量导入。"
              />
            ) : (
              <>
                <ListToolbar
                  search={classSearch}
                  onSearchChange={setClassSearch}
                  searchPlaceholder="搜索班级名称或编号"
                  summary={<span>共 {classTotal} 个班级</span>}
                >
                  <ToolbarSelect value={gradeFilter} onChange={setGradeFilter} label="年级筛选">
                    <option value="all">全部年级</option>
                    {(grades.data?.data ?? []).map((grade) => (
                      <option key={grade.id} value={grade.id}>
                        {grade.name}
                      </option>
                    ))}
                  </ToolbarSelect>
                  <ToolbarSelect value={statusFilter} onChange={setStatusFilter} label="状态筛选">
                    <option value="all">全部状态</option>
                    <option value="active">已启用</option>
                    <option value="inactive">已停用</option>
                  </ToolbarSelect>
                </ListToolbar>
                {classes.data?.data.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>班级</TableHead>
                        <TableHead>年级</TableHead>
                        <TableHead>编号</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {classes.data?.data.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell>{item.grade.name}</TableCell>
                          <TableCell>{item.code || "—"}</TableCell>
                          <TableCell>
                            <StatusBadge value={item.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <TableActionButton intent="edit" onClick={() => setClassModal(item)}>
                              编辑
                            </TableActionButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyList title="没有匹配的班级" description="请调整搜索词或筛选条件。" />
                )}
                {classesPagination && classesPagination.total > 0 && (
                  <TablePagination
                    page={classesPagination.page}
                    pageSize={classesPagination.per_page}
                    totalItems={classesPagination.total}
                    totalPages={classesPagination.last_page}
                    onPageChange={setClassPage}
                    onPageSizeChange={(value) => {
                      setClassPageSize(value)
                      setClassPage(1)
                    }}
                  />
                )}
              </>
            )}
          </TabsContent>
          <TabsContent
            value="semesters"
            className="mt-5 overflow-hidden rounded-xl border bg-background"
          >
            <div className="flex items-center justify-between border-b p-3">
              <div>
                <p className="font-medium">上下学期</p>
                <p className="text-sm text-muted-foreground">
                  学年开放前必须恰好创建两个互不重叠的学期。
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button disabled={(semesters.data?.length ?? 0) >= 2}>
                      <PlusIcon />
                      创建学期
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={semesters.data?.some((semester) => semester.sequence === 1)}
                    onClick={() => setSemesterModal(1)}
                  >
                    上学期
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={semesters.data?.some((semester) => semester.sequence === 2)}
                    onClick={() => setSemesterModal(2)}
                  >
                    下学期
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {!semesters.data?.length ? (
              <EmptyList
                title="尚未创建学期"
                description="先创建上下两个学期，再配置作息和任课关系。"
              />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>学期</TableHead>
                      <TableHead>日期范围</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {semestersPagination.items.map((semester) => (
                      <TableRow key={semester.id}>
                        <TableCell className="font-medium">{semester.name}</TableCell>
                        <TableCell>
                          {semester.start_date} 至 {semester.end_date}
                        </TableCell>
                        <TableCell>
                          <StatusBadge value={semester.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            nativeButton={false}
                            render={<Link to={`/semesters/${semester.id}/setup`} />}
                          >
                            配置学期
                          </Button>
                          {semester.status === "draft" && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void semesterAction(semester, "open")}
                              >
                                开放
                              </Button>
                              {user?.role === "admin" && (
                                <TableActionButton
                                  intent="delete"
                                  onClick={() => void semesterAction(semester, "delete")}
                                >
                                  删除
                                </TableActionButton>
                              )}
                            </>
                          )}
                          {semester.status === "open" && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void semesterAction(semester, "current")}
                              >
                                设为当前
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setLifecycleModal({ semester, action: "close" })}
                              >
                                关闭
                              </Button>
                            </>
                          )}
                          {semester.status === "closed" && user?.role === "admin" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setLifecycleModal({ semester, action: "reopen" })}
                            >
                              重开
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <TablePagination {...semestersPagination} />
              </>
            )}
          </TabsContent>
        </Tabs>
        {year.status === "draft" &&
          user?.role === "admin" &&
          !semesters.data?.length &&
          classTotal === 0 && (
            <div className="mt-6 flex justify-end">
              <Button variant="destructive" onClick={() => void yearAction("delete")}>
                <Trash2Icon />
                删除空学年
              </Button>
            </div>
          )}
      </div>
      <ClassDialog
        yearId={id}
        item={classModal}
        open={classModal !== undefined}
        grades={grades.data?.data ?? []}
        etag={classes.data?.etag}
        onClose={() => setClassModal(undefined)}
        onSaved={refreshAll}
      />
      <SemesterDialog
        yearId={id}
        sequence={semesterModal}
        etag={years.data?.etag}
        onClose={() => setSemesterModal(null)}
        onSaved={refreshAll}
      />
      <CsvImportDialog
        yearId={id}
        open={importOpen}
        etag={classes.data?.etag}
        onClose={() => setImportOpen(false)}
        onSaved={refreshAll}
      />
      <SemesterLifecycleDialog
        state={lifecycleModal}
        isAdmin={user?.role === "admin"}
        replacementSemesters={(semesters.data ?? []).filter(
          (semester) => semester.status === "open" && semester.id !== lifecycleModal?.semester.id,
        )}
        onClose={() => setLifecycleModal(null)}
        onSubmit={async (semester, action, body) => {
          const saved = await semesterAction(semester, action, body)
          if (saved) setLifecycleModal(null)
        }}
      />
    </>
  )
}

function SemesterLifecycleDialog({
  state,
  isAdmin,
  replacementSemesters,
  onClose,
  onSubmit,
}: {
  state: { semester: Semester; action: "close" | "reopen" } | null
  isAdmin: boolean
  replacementSemesters: Semester[]
  onClose: () => void
  onSubmit: (
    semester: Semester,
    action: "close" | "reopen",
    body: Record<string, unknown>,
  ) => Promise<void>
}) {
  const [reason, setReason] = useState("")
  const [replacementId, setReplacementId] = useState("")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setReason("")
    setReplacementId("")
  }, [state])
  if (!state) return null
  const reopening = state.action === "reopen"
  const submit = async () => {
    setSaving(true)
    await onSubmit(state.semester, state.action, {
      ...(reason ? { reason } : {}),
      ...(!reopening
        ? { replacement_semester_id: replacementId ? Number(replacementId) : null }
        : {}),
    })
    setSaving(false)
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {reopening ? "重新开放" : "关闭"}
            {state.semester.name}
          </DialogTitle>
          <DialogDescription>
            {reopening
              ? "重开历史学期会使旧排课工作台版本失效，必须填写审计原因。"
              : "关闭前会校验草稿任务和排课完整性；若这是当前学期且不选择替代项，当前学期将被清空。"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {!reopening && (
            <Field label="替代当前学期（可选）">
              <select
                className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
                value={replacementId}
                onChange={(event) => setReplacementId(event.target.value)}
              >
                <option value="">不设置</option>
                {replacementSemesters.map((semester) => (
                  <option key={semester.id} value={semester.id}>
                    {semester.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {(reopening || isAdmin) && (
            <Field label={reopening ? "重开原因" : "例外关闭原因（可选）"}>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  reopening ? "说明为什么需要修改历史学期" : "仅管理员在任务未排满时用于例外关闭"
                }
              />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            variant={reopening ? "default" : "destructive"}
            disabled={saving || (reopening && !reason.trim())}
            onClick={() => void submit()}
          >
            {saving ? "处理中…" : reopening ? "确认重开" : "确认关闭"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ClassDialog({
  yearId,
  item,
  open,
  grades,
  etag,
  onClose,
  onSaved,
}: {
  yearId: number
  item: SchoolClass | null | undefined
  open: boolean
  grades: Grade[]
  etag?: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState({ grade_id: "", name: "", code: "", status: "active" })
  useEffect(
    () =>
      setForm({
        grade_id: String(item?.grade_id ?? grades[0]?.id ?? ""),
        name: item?.name ?? "",
        code: item?.code ?? "",
        status: item?.status ?? "active",
      }),
    [item, grades, open],
  )
  const save = async () => {
    if (!etag) return
    const body = {
      grade_id: Number(form.grade_id),
      name: form.name,
      code: form.code || null,
      ...(item ? { status: form.status } : {}),
    }
    const endpoint = item
      ? `/api/v1/academic-years/${yearId}/classes/${item.id}`
      : `/api/v1/academic-years/${yearId}/classes`
    const persist = (extra: Record<string, unknown> = {}) =>
      api(endpoint, {
        method: item ? "PATCH" : "POST",
        etag,
        body: jsonBody({ ...body, ...extra }),
      })
    try {
      try {
        await persist()
      } catch (error) {
        const hash = error instanceof ApiError ? error.details.impact_hash : null
        if (
          !(error instanceof ApiError) ||
          error.code !== "ACTIVE_RESOURCE_IN_USE" ||
          typeof hash !== "string" ||
          !window.confirm(
            "该班级正在开放学期中使用。停用不会删除现有任务和课表，但会阻止继续排课。确认停用吗？",
          )
        )
          throw error
        await persist({ confirm_open_impact: true, impact_hash: hash })
      }
      toast.success("班级已保存")
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
          <DialogTitle>{item ? "编辑班级" : "新增班级"}</DialogTitle>
          <DialogDescription>班级名称和编号在当前学年内必须唯一。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="年级">
            <select
              className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
              value={form.grade_id}
              onChange={(event) => setForm({ ...form, grade_id: event.target.value })}
            >
              {grades
                .filter((grade) => grade.is_active)
                .map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="班级名称">
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="班级编号（可选）">
            <Input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </Field>
          {item && (
            <Field label="状态">
              <select
                className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value })}
              >
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </select>
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={!form.name || !form.grade_id}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SemesterDialog({
  yearId,
  sequence,
  etag,
  onClose,
  onSaved,
}: {
  yearId: number
  sequence: 1 | 2 | null
  etag?: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [dates, setDates] = useState({ start_date: "", end_date: "" })
  const save = async () => {
    if (!sequence || !etag) return
    try {
      await api(`/api/v1/academic-years/${yearId}/semesters`, {
        method: "POST",
        etag,
        body: jsonBody({ sequence, ...dates }),
      })
      toast.success("学期已创建")
      onClose()
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  return (
    <Dialog open={sequence !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建{sequence === 1 ? "上" : "下"}学期</DialogTitle>
          <DialogDescription>学期日期需位于学年范围内，且不能与另一学期重叠。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="开始日期">
            <Input
              type="date"
              value={dates.start_date}
              onInput={(event) => {
                const value = event.currentTarget.value
                setDates((current) => ({ ...current, start_date: value }))
              }}
            />
          </Field>
          <Field label="结束日期">
            <Input
              type="date"
              value={dates.end_date}
              onInput={(event) => {
                const value = event.currentTarget.value
                setDates((current) => ({ ...current, end_date: value }))
              }}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!dates.start_date || !dates.end_date} onClick={() => void save()}>
            创建学期
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface PreviewRow {
  row: number
  grade_name?: string
  class_name?: string
  class_code?: string | null
  valid: boolean
  errors: { message: string }[]
}
interface PreviewPageData {
  token?: string
  rows: PreviewRow[]
  valid_rows?: number[]
  summary: { total: number; valid: number; invalid: number }
}
interface PreviewStartData extends PreviewPageData {
  token: string
  valid_rows: number[]
}
function CsvImportDialog({
  yearId,
  open,
  etag,
  onClose,
  onSaved,
}: {
  yearId: number
  open: boolean
  etag?: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [summary, setSummary] = useState({ total: 0, valid: 0, invalid: 0 })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [pagination, setPagination] = useState<PaginationMeta | null>(null)
  const [rowsLoading, setRowsLoading] = useState(false)
  const [rowsError, setRowsError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    if (!open) {
      setFile(null)
      setToken(null)
      setRows([])
      setSelected([])
      setSummary({ total: 0, valid: 0, invalid: 0 })
      setPage(1)
      setPageSize(20)
      setPagination(null)
      setRowsError(false)
    }
  }, [open])
  useEffect(() => {
    if (!token) return
    let active = true
    setRowsLoading(true)
    setRowsError(false)
    void api<PreviewPageData>(
      `/api/v1/academic-years/${yearId}/classes/import/preview?token=${encodeURIComponent(token)}&page=${page}&per_page=${pageSize}`,
    )
      .then((result) => {
        if (!active) return
        setRows(result.data.rows)
        setSummary(result.data.summary)
        setPagination((result.meta?.pagination as PaginationMeta | undefined) ?? null)
      })
      .catch(() => {
        if (active) setRowsError(true)
      })
      .finally(() => {
        if (active) setRowsLoading(false)
      })
    return () => {
      active = false
    }
  }, [page, pageSize, reloadKey, token, yearId])
  const preview = async () => {
    if (!file) return
    const data = new FormData()
    data.append("file", file)
    try {
      const result = await api<PreviewStartData>(
        `/api/v1/academic-years/${yearId}/classes/import/preview`,
        { method: "POST", body: data, formData: true },
      )
      setToken(result.data.token)
      setRows(result.data.rows)
      setSelected(result.data.valid_rows ?? [])
      setSummary(result.data.summary)
      setPage(1)
      setPagination((result.meta?.pagination as PaginationMeta | undefined) ?? null)
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  const commit = async () => {
    if (!token || !etag) return
    try {
      await api(`/api/v1/academic-years/${yearId}/classes/import/commit`, {
        method: "POST",
        etag,
        body: jsonBody({ token, selected_rows: selected }),
      })
      toast.success(`已导入 ${selected.length} 个班级`)
      onClose()
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>CSV 导入班级</DialogTitle>
          <DialogDescription>
            仅接受 UTF-8，固定表头：grade_name,class_name,class_code。预检不会写入数据。
          </DialogDescription>
        </DialogHeader>
        {!token ? (
          <div className="grid gap-4">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <div className="rounded-2xl bg-muted/50 p-3 font-mono text-xs">
              grade_name,class_name,class_code
              <br />
              一年级,一年级 1 班,G1C1
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border">
            <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-4 py-2 text-sm">
              <span>共 {summary.total} 行</span>
              <span className="text-emerald-700">{summary.valid} 行可导入</span>
              {summary.invalid > 0 && (
                <span className="text-destructive">{summary.invalid} 行需修正</span>
              )}
              {rowsLoading && (
                <span className="ml-auto text-muted-foreground">正在加载当前页…</span>
              )}
              {rowsError && (
                <Button
                  className="ml-auto"
                  size="sm"
                  variant="ghost"
                  onClick={() => setReloadKey((value) => value + 1)}
                >
                  当前页加载失败，重试
                </Button>
              )}
            </div>
            <div className="max-h-80 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>行</TableHead>
                    <TableHead>年级</TableHead>
                    <TableHead>班级</TableHead>
                    <TableHead>编号</TableHead>
                    <TableHead>结果</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.row}
                      data-state={selected.includes(row.row) ? "selected" : undefined}
                    >
                      <TableCell>
                        <Checkbox
                          disabled={!row.valid}
                          checked={selected.includes(row.row)}
                          onCheckedChange={(checked) =>
                            setSelected((current) =>
                              checked
                                ? [...current, row.row]
                                : current.filter((value) => value !== row.row),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>{row.row}</TableCell>
                      <TableCell>{row.grade_name ?? "—"}</TableCell>
                      <TableCell>{row.class_name ?? "—"}</TableCell>
                      <TableCell>{row.class_code ?? "—"}</TableCell>
                      <TableCell>
                        {row.valid ? (
                          <StatusBadge value="active" />
                        ) : (
                          <span className="text-xs text-destructive">
                            {row.errors.map((error) => error.message).join("；")}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {pagination && pagination.total > 0 && (
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          {token ? (
            <Button disabled={!selected.length} onClick={() => void commit()}>
              提交所选 {selected.length} 行
            </Button>
          ) : (
            <Button disabled={!file} onClick={() => void preview()}>
              开始预检
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
