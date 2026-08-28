import { useEffect, useRef, useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  BellRingIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleXIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api, apiAllPages, apiMessage, jsonBody } from "@/lib/api"
import { useResolvedSemesterId } from "@/lib/semester"
import type {
  CalendarException,
  CalendarExceptionPreview,
  CalendarExceptionType,
  DailyTimetable,
  DailyTimetableRow,
  Item,
  PaginationMeta,
  Room,
  ScheduleTemplate,
  Semester,
  Teacher,
  TeachingAssignment,
} from "@/lib/types"
import { EmptyList, ErrorState, Field, LoadingState, PageHeader } from "@/components/page"
import { ListToolbar, ToolbarSelect } from "@/components/list-toolbar"
import { StatusBadge } from "@/components/status-badge"
import { TablePagination } from "@/components/table-pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
  enumParam,
  mergeSearchParams,
  positiveIntegerParam,
  useHashPreservingSearchParams,
} from "@/lib/url-state"

const selectClass =
  "h-9 w-full rounded-md border bg-background px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-3 focus:ring-ring/20"
const weekdayNames = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"]
const typeLabels: Record<CalendarExceptionType, string> = {
  move: "移动课节",
  swap: "交换两节课",
  teacher_change: "临时换教师",
  room_change: "临时换教室",
  cancel: "停课",
  makeup: "补课",
  activity: "临时活动",
}
const rowStatusLabels: Record<DailyTimetableRow["status"], string> = {
  base: "正常",
  moved_out: "已移出",
  moved_in: "临时调入",
  swap: "已交换",
  teacher_change: "临时换教师",
  room_change: "临时换教室",
  cancel: "停课",
  makeup: "补课",
  activity: "活动占用",
  substitution: "代课",
}
const exceptionTypes = [
  "all",
  "move",
  "swap",
  "teacher_change",
  "room_change",
  "cancel",
  "makeup",
  "activity",
] as const
const exceptionStatuses = ["all", "active", "cancelled"] as const

export function DailyAdjustmentsPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const client = useQueryClient()
  const [urlParams, setUrlParams] = useHashPreservingSearchParams()
  const [date, setDate] = useState(() => dateParam(urlParams, "date", todayString()))
  const [dailySearch, setDailySearch] = useState(() => urlParams.get("q") ?? "")
  const [page, setPage] = useState(() => positiveIntegerParam(urlParams, "page", 1))
  const [pageSize, setPageSize] = useState(() =>
    positiveIntegerParam(urlParams, "per_page", 20, [20, 50, 100]),
  )
  const [typeFilter, setTypeFilter] = useState(() =>
    enumParam(urlParams, "type", exceptionTypes, "all"),
  )
  const [statusFilter, setStatusFilter] = useState(() =>
    enumParam(urlParams, "status", exceptionStatuses, "all"),
  )
  const [dateFrom, setDateFrom] = useState(() => dateParam(urlParams, "from", ""))
  const [dateTo, setDateTo] = useState(() => dateParam(urlParams, "to", ""))
  const [editorOpen, setEditorOpen] = useState(false)

  const semester = useQuery({
    queryKey: ["semester", semesterId],
    queryFn: () => api<Semester>(`/api/v1/semesters/${semesterId}`),
    enabled: semesterId !== null,
  })
  const current = semester.data?.data
  useEffect(() => {
    if (!current) return
    setDate((value) => clampDate(value, current.start_date, current.end_date))
  }, [current])
  const didMountFilters = useRef(false)
  useEffect(() => {
    if (!didMountFilters.current) {
      didMountFilters.current = true
      return
    }
    setPage(1)
  }, [typeFilter, statusFilter, dateFrom, dateTo])
  useEffect(() => {
    setUrlParams(
      (current) =>
        mergeSearchParams(current, {
          date,
          q: dailySearch.trim() || null,
          type: typeFilter === "all" ? null : typeFilter,
          status: statusFilter === "all" ? null : statusFilter,
          from: dateFrom || null,
          to: dateTo || null,
          page: page === 1 ? null : page,
          per_page: pageSize === 20 ? null : pageSize,
        }),
      { replace: true },
    )
  }, [dailySearch, date, dateFrom, dateTo, page, pageSize, setUrlParams, statusFilter, typeFilter])

  const dateInRange = Boolean(current && date >= current.start_date && date <= current.end_date)
  const daily = useQuery({
    queryKey: ["daily-timetable", semesterId, date],
    queryFn: () =>
      api<DailyTimetable>(`/api/v1/semesters/${semesterId}/daily-timetable?date=${date}`),
    enabled: semesterId !== null && dateInRange,
  })
  const exceptions = useQuery({
    queryKey: [
      "calendar-exceptions",
      semesterId,
      page,
      pageSize,
      typeFilter,
      statusFilter,
      dateFrom,
      dateTo,
    ],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page), per_page: String(pageSize) })
      if (typeFilter !== "all") query.set("type", typeFilter)
      if (statusFilter !== "all") query.set("status", statusFilter)
      if (dateFrom) query.set("date_from", dateFrom)
      if (dateTo) query.set("date_to", dateTo)
      return api<CalendarException[]>(
        `/api/v1/semesters/${semesterId}/calendar-exceptions?${query}`,
      )
    },
    enabled: semesterId !== null,
  })
  const template = useQuery({
    queryKey: ["schedule-template", semesterId],
    queryFn: () => api<ScheduleTemplate>(`/api/v1/semesters/${semesterId}/schedule-template`),
    enabled: semesterId !== null,
  })
  const teachers = useQuery({
    queryKey: ["teachers", "all", "daily-operations"],
    queryFn: () => apiAllPages<Teacher>("/api/v1/teachers"),
  })
  const rooms = useQuery({
    queryKey: ["rooms", "all", "daily-operations"],
    queryFn: () => apiAllPages<Room>("/api/v1/rooms"),
  })
  const assignments = useQuery({
    queryKey: ["teaching-assignments", semesterId, "confirmed", "daily-operations"],
    queryFn: () =>
      apiAllPages<TeachingAssignment>(
        `/api/v1/semesters/${semesterId}/teaching-assignments?status=confirmed`,
      ),
    enabled: semesterId !== null,
  })
  const pagination = paginationOf(exceptions.data?.meta)
  const lastPage = pagination?.last_page
  useEffect(() => {
    if (lastPage && page > Math.max(1, lastPage)) {
      setPage(Math.max(1, lastPage))
    }
  }, [lastPage, page])

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["daily-timetable", semesterId] }),
      client.invalidateQueries({ queryKey: ["calendar-exceptions", semesterId] }),
      client.invalidateQueries({ queryKey: ["context"] }),
    ])
  }
  const cancel = async (item: CalendarException) => {
    if (!exceptions.data?.etag) return
    try {
      await api(`/api/v1/semesters/${semesterId}/calendar-exceptions/${item.id}/cancel`, {
        method: "POST",
        etag: exceptions.data.etag,
      })
      toast.success("临时调整已取消，指定日期已恢复基础安排")
      await refresh()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }

  if (!semesterId && !context.isLoading)
    return (
      <>
        <PageHeader title="临时调课" />
        <EmptyList title="尚未设置当前学期" description="请先设置当前开放学期。" />
      </>
    )

  const rows = daily.data?.data.rows ?? []
  const normalizedSearch = dailySearch.trim().toLocaleLowerCase("zh-CN")
  const visibleRows = normalizedSearch
    ? rows.filter((row) =>
        [row.course_name, row.target_name, row.teacher_names.join(" "), row.room_name]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedSearch),
      )
    : rows
  const groupedRows = groupDailyRows(visibleRows)
  return (
    <>
      <PageHeader title="临时调课" description="所有修改仅作用于指定日期，不改基础周课表。" />
      <div className="space-y-4 p-4 md:p-7">
        <section className="surface-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="前一天"
                disabled={!current || date <= current.start_date}
                onClick={() => setDate(addDays(date, -1))}
              >
                <ChevronLeftIcon />
              </Button>
              <Input
                type="date"
                aria-label="查看日期"
                className="w-40"
                min={current?.start_date}
                max={current?.end_date}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="后一天"
                disabled={!current || date >= current.end_date}
                onClick={() => setDate(addDays(date, 1))}
              >
                <ChevronRightIcon />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!current}
                onClick={() =>
                  current && setDate(clampDate(todayString(), current.start_date, current.end_date))
                }
              >
                今天
              </Button>
            </div>
            <label className="relative block w-full lg:ml-auto lg:max-w-80">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={dailySearch}
                onChange={(event) => setDailySearch(event.target.value)}
                placeholder="筛选班级、课程、教师或教室"
                aria-label="筛选实际课表"
                className="pl-10"
              />
            </label>
          </div>
          {daily.isLoading ? (
            <LoadingState label="正在计算该日期的实际课表…" />
          ) : daily.isError || !daily.data ? (
            <ErrorState retry={() => void daily.refetch()} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/20 px-4 py-3 text-sm">
                <span className="font-medium">
                  {dateLabel(daily.data.data.date)} · 第 {daily.data.data.week_number} 周 ·{" "}
                  {weekdayNames[daily.data.data.weekday]}
                </span>
                <span className="text-muted-foreground">实际课程 {visibleRows.length} 节</span>
                {daily.data.data.summary.temporary > 0 && (
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                    临时变化 {daily.data.data.summary.temporary}
                  </Badge>
                )}
                {daily.data.data.summary.substitutions > 0 && (
                  <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-800">
                    代课 {daily.data.data.summary.substitutions}
                  </Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  基于“{daily.data.data.version.name}”叠加日期例外
                </span>
              </div>
              {groupedRows.length === 0 ? (
                <EmptyList
                  title={rows.length === 0 ? "当天没有课程" : "没有匹配的课程"}
                  description={
                    rows.length === 0
                      ? "该日期可能是休息日，或没有符合周次规则的课程。"
                      : "清空筛选词后可查看当天全部课程。"
                  }
                />
              ) : (
                <div className="divide-y">
                  {groupedRows.map((group) => (
                    <div
                      key={group.itemId}
                      className="grid gap-2 px-4 py-3 md:grid-cols-[8.5rem_minmax(0,1fr)]"
                    >
                      <div>
                        <p className="font-medium">{group.name}</p>
                        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                          {shortTime(group.start)}–{shortTime(group.end)}
                        </p>
                      </div>
                      <div className="grid gap-2 xl:grid-cols-2">
                        {group.rows.map((row) => (
                          <DailyRowCard key={row.key} row={row} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section className="surface-panel overflow-hidden">
          <ListToolbar
            summary={
              <span>共 {pagination?.total ?? exceptions.data?.data.length ?? 0} 条临时调整</span>
            }
            actions={
              <Button disabled={!daily.data} onClick={() => setEditorOpen(true)}>
                <PlusIcon />
                新建临时调整
              </Button>
            }
          >
            <ToolbarSelect
              value={typeFilter}
              onChange={(value) => setTypeFilter(value as (typeof exceptionTypes)[number])}
              label="调整类型"
            >
              <option value="all">全部类型</option>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </ToolbarSelect>
            <ToolbarSelect
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as (typeof exceptionStatuses)[number])}
              label="调整状态"
            >
              <option value="all">全部状态</option>
              <option value="active">生效中</option>
              <option value="cancelled">已取消</option>
            </ToolbarSelect>
            <Input
              type="date"
              aria-label="开始日期"
              className="w-40"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
            <span className="text-sm text-muted-foreground">至</span>
            <Input
              type="date"
              aria-label="结束日期"
              className="w-40"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </ListToolbar>
          {exceptions.isLoading ? (
            <LoadingState />
          ) : exceptions.isError ? (
            <ErrorState retry={() => void exceptions.refetch()} />
          ) : !exceptions.data?.data.length ? (
            <EmptyList
              title="没有匹配的临时调整"
              description="当天无需变化时，不必创建任何记录；基础周课表会直接生效。"
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>生效日期</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>课程与对象</TableHead>
                    <TableHead>变化</TableHead>
                    <TableHead>原因</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exceptions.data.data.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap">
                        <p className="font-medium">{dateLabel(item.effective_date)}</p>
                        {item.replacement_date && item.replacement_date !== item.effective_date && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            调至 {dateLabel(item.replacement_date)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>{typeLabels[item.type]}</TableCell>
                      <TableCell>
                        <p className="font-medium">
                          {item.original_entry?.course?.name ??
                            item.replacement_assignment?.course?.name ??
                            item.title ??
                            "临时安排"}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {entryTarget(item.original_entry) ??
                            assignmentTarget(item.replacement_assignment) ??
                            "—"}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-60 text-muted-foreground">
                        {exceptionChange(item)}
                      </TableCell>
                      <TableCell className="max-w-64 truncate" title={item.reason}>
                        {item.reason}
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={item.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {item.status === "active" ? (
                          <Button variant="ghost" size="sm" onClick={() => void cancel(item)}>
                            取消调整
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
            </>
          )}
        </section>
      </div>

      <ExceptionEditor
        open={editorOpen}
        semesterId={semesterId}
        date={date}
        semester={current ?? null}
        rows={rows}
        items={template.data?.data.items ?? []}
        teachers={teachers.data?.data ?? []}
        rooms={rooms.data?.data ?? []}
        assignments={assignments.data?.data ?? []}
        etag={exceptions.data?.etag ?? daily.data?.etag ?? null}
        onClose={() => setEditorOpen(false)}
        onSaved={refresh}
      />
    </>
  )
}

function DailyRowCard({ row }: { row: DailyTimetableRow }) {
  const temporary = row.status !== "base"
  const notes =
    row.substitution_notes.length > 0
      ? row.substitution_notes.filter((note): note is string => Boolean(note))
      : row.note
        ? [row.note]
        : []
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5",
        row.is_cancelled
          ? "border-dashed bg-muted/30 text-muted-foreground"
          : temporary
            ? "border-amber-200 bg-amber-50/55"
            : "bg-background",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn("font-medium", row.is_cancelled && "line-through")}>
              {row.course_name}
            </p>
            {temporary && (
              <Badge variant="outline" className="bg-background/80">
                {rowStatusLabels[row.status]}
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm">{row.target_name}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {row.teacher_names.join("、")} · {row.room_name}
          </p>
          {notes.length > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">{notes.join("；")}</p>
          )}
        </div>
      </div>
    </div>
  )
}

type ExceptionForm = {
  type: CalendarExceptionType
  effective_date: string
  replacement_date: string
  original_entry_id: string
  related_entry_id: string
  replacement_assignment_id: string
  replacement_teacher_id: string
  replacement_room_id: string
  replacement_item_id: string
  title: string
  reason: string
}

function ExceptionEditor({
  open,
  semesterId,
  date,
  semester,
  rows,
  items,
  teachers,
  rooms,
  assignments,
  etag,
  onClose,
  onSaved,
}: {
  open: boolean
  semesterId: number | null
  date: string
  semester: Semester | null
  rows: DailyTimetableRow[]
  items: Item[]
  teachers: Teacher[]
  rooms: Room[]
  assignments: TeachingAssignment[]
  etag: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState<ExceptionForm>(() => emptyExceptionForm(date))
  const [preview, setPreview] = useState<CalendarExceptionPreview | null>(null)
  const [previewEtag, setPreviewEtag] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(emptyExceptionForm(date))
    setPreview(null)
    setPreviewEtag(null)
  }, [date, open])

  const update = <K extends keyof ExceptionForm>(key: K, value: ExceptionForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setPreview(null)
    setPreviewEtag(null)
  }
  const availableRows = rows.filter((row) => !row.is_cancelled && row.original_entry_id !== null)
  const selectedEntry = availableRows.find(
    (row) => row.original_entry_id === Number(form.original_entry_id),
  )
  const submitPreview = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!semesterId) return
    setBusy(true)
    try {
      const result = await api<CalendarExceptionPreview>(
        `/api/v1/semesters/${semesterId}/calendar-exceptions/preview`,
        { method: "POST", body: jsonBody(exceptionPayload(form)) },
      )
      setPreview(result.data)
      setPreviewEtag(result.etag)
      if (!result.data.allowed) toast.warning("目标安排存在冲突，请调整后再保存")
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (!semesterId || !preview?.allowed || !(previewEtag ?? etag)) return
    setBusy(true)
    try {
      await api(`/api/v1/semesters/${semesterId}/calendar-exceptions`, {
        method: "POST",
        etag: previewEtag ?? etag,
        body: jsonBody(exceptionPayload(form)),
      })
      toast.success("临时调整已生效，基础周课表保持不变")
      onClose()
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[620px]">
        <SheetHeader className="border-b pr-14">
          <SheetTitle>新建临时调整</SheetTitle>
          <SheetDescription>先预览影响与冲突，再确认保存；记录只覆盖指定日期。</SheetDescription>
        </SheetHeader>
        <form className="grid gap-5 p-6" onSubmit={(event) => void submitPreview(event)}>
          <div className="rounded-xl border bg-muted/25 p-3 text-sm text-muted-foreground">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <CalendarClockIcon className="size-4 text-primary" />
              日期例外，不修改周课表
            </p>
            <p className="mt-1 leading-6">取消这条记录后，该日期会立即恢复“当前课表”的原始安排。</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="调整类型">
              <select
                className={selectClass}
                value={form.type}
                onChange={(event) => update("type", event.target.value as CalendarExceptionType)}
              >
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="生效日期">
              <Input
                type="date"
                disabled
                value={form.effective_date}
                aria-describedby="effective-date-help"
              />
              <p id="effective-date-help" className="mt-1.5 text-xs text-muted-foreground">
                来自当前日期视图；如需调整其他日期，请先关闭面板并切换日期。
              </p>
            </Field>
          </div>

          {form.type !== "makeup" && (
            <Field label={form.type === "activity" ? "被活动占用的课程" : "原课程"}>
              <select
                required
                className={selectClass}
                value={form.original_entry_id}
                onChange={(event) => update("original_entry_id", event.target.value)}
              >
                <option value="">请选择当天实际课程</option>
                {availableRows.map((row) => (
                  <option key={row.key} value={row.original_entry_id ?? ""}>
                    {row.item_name} · {row.target_name} · {row.course_name} · {row.teacher_name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {form.type === "swap" && (
            <Field label="交换目标课程">
              <select
                required
                className={selectClass}
                value={form.related_entry_id}
                onChange={(event) => update("related_entry_id", event.target.value)}
              >
                <option value="">请选择另一节课程</option>
                {availableRows
                  .filter((row) => row.original_entry_id !== selectedEntry?.original_entry_id)
                  .map((row) => (
                    <option key={row.key} value={row.original_entry_id ?? ""}>
                      {row.item_name} · {row.target_name} · {row.course_name}
                    </option>
                  ))}
              </select>
            </Field>
          )}

          {form.type === "makeup" && (
            <Field label="补课任课关系">
              <select
                required
                className={selectClass}
                value={form.replacement_assignment_id}
                onChange={(event) => update("replacement_assignment_id", event.target.value)}
              >
                <option value="">请选择课程、班级与教师</option>
                {assignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignmentTarget(assignment)} · {assignment.course.name} ·{" "}
                    {assignment.teacher.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {(form.type === "move" || form.type === "makeup") && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="目标日期">
                <Input
                  type="date"
                  required
                  min={semester?.start_date}
                  max={semester?.end_date}
                  value={form.replacement_date}
                  onChange={(event) => update("replacement_date", event.target.value)}
                />
              </Field>
              <Field label="目标课节">
                <select
                  required
                  className={selectClass}
                  value={form.replacement_item_id}
                  onChange={(event) => update("replacement_item_id", event.target.value)}
                >
                  <option value="">请选择课节</option>
                  {items
                    .filter((item) => item.is_active && item.allows_course)
                    .sort((left, right) => left.sort_order - right.sort_order)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {shortTime(item.start_time)}–{shortTime(item.end_time)}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
          )}

          {form.type === "teacher_change" && (
            <Field label="临时教师">
              <select
                required
                className={selectClass}
                value={form.replacement_teacher_id}
                onChange={(event) => update("replacement_teacher_id", event.target.value)}
              >
                <option value="">请选择教师</option>
                {teachers
                  .filter(
                    (teacher) =>
                      teacher.is_active &&
                      teacher.id !== selectedEntry?.teacher_id &&
                      (teacher.courses ?? []).some(
                        (course) => course.id === selectedEntry?.course_id,
                      ),
                  )
                  .map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.name} {teacher.employee_no ? `· ${teacher.employee_no}` : ""}
                    </option>
                  ))}
              </select>
            </Field>
          )}

          {form.type === "room_change" && (
            <Field label="临时教室">
              <select
                required
                className={selectClass}
                value={form.replacement_room_id}
                onChange={(event) => update("replacement_room_id", event.target.value)}
              >
                <option value="">请选择教室</option>
                {rooms
                  .filter((room) => room.is_active && room.id !== selectedEntry?.room_id)
                  .map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}

          {form.type === "activity" && (
            <Field label="活动名称">
              <Input
                required
                maxLength={120}
                value={form.title}
                onChange={(event) => update("title", event.target.value)}
                placeholder="例如：七年级体检"
              />
            </Field>
          )}

          <Field label="原因或说明">
            <textarea
              required
              minLength={2}
              maxLength={1000}
              className="min-h-24 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
              value={form.reason}
              onChange={(event) => update("reason", event.target.value)}
              placeholder="这段说明会保留在操作记录中"
            />
          </Field>

          {preview && <ExceptionPreviewPanel preview={preview} />}

          <button type="submit" className="hidden" aria-hidden="true" />
        </form>
        <SheetFooter className="flex-row flex-wrap justify-end border-t bg-background/95">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void submitPreview()}>
            {busy ? <RefreshCwIcon className="animate-spin" /> : <SearchIcon />}
            {preview ? "重新检查" : "预览影响"}
          </Button>
          <Button disabled={busy || !preview?.allowed} onClick={() => void save()}>
            <CheckCircle2Icon />
            确认保存
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function ExceptionPreviewPanel({ preview }: { preview: CalendarExceptionPreview }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border",
        preview.allowed ? "border-emerald-200" : "border-rose-200",
      )}
    >
      <div
        className={cn(
          "flex items-start gap-3 px-4 py-3",
          preview.allowed ? "bg-emerald-50 text-emerald-950" : "bg-rose-50 text-rose-950",
        )}
      >
        {preview.allowed ? (
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-600" />
        ) : (
          <CircleXIcon className="mt-0.5 size-5 shrink-0 text-rose-600" />
        )}
        <div>
          <p className="font-medium">{preview.allowed ? "可以保存" : "需要先处理冲突"}</p>
          <p className="mt-1 text-sm leading-6 opacity-80">{preview.summary}</p>
        </div>
      </div>
      {preview.conflicts.length > 0 && (
        <div className="space-y-2 border-t px-4 py-3">
          {preview.conflicts.map((conflict, index) => (
            <p key={`${conflict.type}-${index}`} className="flex gap-2 text-sm text-rose-700">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              {conflict.message}
            </p>
          ))}
        </div>
      )}
      {preview.affected.length > 0 && (
        <div className="border-t px-4 py-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground">受影响安排</p>
          <div className="mt-2 space-y-2">
            {preview.affected.map((item, index) => (
              <div key={`${item.entry_id ?? "new"}-${index}`} className="text-sm">
                <span className="font-medium">{item.target}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {item.course} · {item.teacher}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {preview.notifications.length > 0 && (
        <div className="flex gap-2 border-t bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <BellRingIcon className="mt-0.5 size-4 shrink-0" />
          <p>建议通知：{preview.notifications.join("、")}</p>
        </div>
      )}
    </div>
  )
}

function emptyExceptionForm(date: string): ExceptionForm {
  return {
    type: "move",
    effective_date: date,
    replacement_date: date,
    original_entry_id: "",
    related_entry_id: "",
    replacement_assignment_id: "",
    replacement_teacher_id: "",
    replacement_room_id: "",
    replacement_item_id: "",
    title: "",
    reason: "",
  }
}

function exceptionPayload(form: ExceptionForm) {
  const payload: Record<string, string | number> = {
    effective_date: form.effective_date,
    type: form.type,
    reason: form.reason.trim(),
  }
  if (form.type !== "makeup" && form.original_entry_id)
    payload.original_entry_id = Number(form.original_entry_id)
  if (form.type === "swap" && form.related_entry_id)
    payload.related_entry_id = Number(form.related_entry_id)
  if (form.type === "makeup" && form.replacement_assignment_id)
    payload.replacement_assignment_id = Number(form.replacement_assignment_id)
  if (form.type === "teacher_change" && form.replacement_teacher_id)
    payload.replacement_teacher_id = Number(form.replacement_teacher_id)
  if (form.type === "room_change" && form.replacement_room_id)
    payload.replacement_room_id = Number(form.replacement_room_id)
  if ((form.type === "move" || form.type === "makeup") && form.replacement_item_id) {
    payload.replacement_date = form.replacement_date
    payload.replacement_item_id = Number(form.replacement_item_id)
  }
  if (form.type === "activity") payload.title = form.title.trim()
  return payload
}

function groupDailyRows(rows: DailyTimetableRow[]) {
  const groups = new Map<
    number,
    { itemId: number; name: string; start: string; end: string; rows: DailyTimetableRow[] }
  >()
  for (const row of rows) {
    const group = groups.get(row.item_id) ?? {
      itemId: row.item_id,
      name: row.item_name,
      start: row.start_time,
      end: row.end_time,
      rows: [],
    }
    group.rows.push(row)
    groups.set(row.item_id, group)
  }
  return [...groups.values()].sort((left, right) => {
    const leftOrder = left.rows[0]?.item_sort_order ?? 0
    const rightOrder = right.rows[0]?.item_sort_order ?? 0
    return leftOrder - rightOrder
  })
}

function exceptionChange(item: CalendarException) {
  if (item.type === "move")
    return `${item.replacement_item?.name ?? "目标课节"}${item.replacement_date && item.replacement_date !== item.effective_date ? ` · ${dateLabel(item.replacement_date)}` : ""}`
  if (item.type === "swap") return `与 ${item.related_entry?.course?.name ?? "另一节课程"} 交换`
  if (item.type === "teacher_change") return item.replacement_teacher?.name ?? "临时换教师"
  if (item.type === "room_change") return item.replacement_room?.name ?? "临时换教室"
  if (item.type === "activity") return item.title ?? "临时活动"
  if (item.type === "makeup") return item.replacement_item?.name ?? "补课"
  return "当日停课"
}

function entryTarget(entry?: CalendarException["original_entry"]) {
  return entry?.school_class?.name ?? entry?.teaching_group?.name ?? null
}

function assignmentTarget(assignment?: TeachingAssignment | null) {
  return assignment?.school_class?.name ?? assignment?.teaching_group?.name ?? null
}

function paginationOf(meta?: Record<string, unknown>): PaginationMeta | null {
  const value = meta?.pagination
  if (!value || typeof value !== "object") return null
  return value as PaginationMeta
}

function todayString() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function dateParam(params: URLSearchParams, key: string, fallback: string) {
  const value = params.get(key)
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback
}

function clampDate(value: string, min: string, max: string) {
  if (value < min) return min
  if (value > max) return max
  return value
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`)
  date.setDate(date.getDate() + amount)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function shortTime(value: string) {
  return value.slice(0, 5)
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(
    new Date(`${value.slice(0, 10)}T12:00:00`),
  )
}
