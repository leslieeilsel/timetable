import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  CircleUserRoundIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  UserRoundCheckIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api, apiAllPages, apiMessage, jsonBody } from "@/lib/api"
import { useResolvedSemesterId } from "@/lib/semester"
import type {
  DailyTimetableRow,
  PaginationMeta,
  Semester,
  SubstituteRecommendation,
  Teacher,
  TeacherLeave,
  TeacherLeaveDetail,
  TeacherLeavePreview,
} from "@/lib/types"
import { DatePicker, DateTimePicker } from "@/components/date-picker"
import { EmptyList, ErrorState, Field, LoadingState, PageHeader } from "@/components/page"
import { ListToolbar, ToolbarSelect } from "@/components/list-toolbar"
import { TeacherPicker } from "@/components/resource-picker"
import { SimpleSelect } from "@/components/simple-select"
import { StatusBadge } from "@/components/status-badge"
import { TablePagination } from "@/components/table-pagination"
import {
  enumParam,
  mergeSearchParams,
  positiveIntegerParam,
  useHashPreservingSearchParams,
} from "@/lib/url-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

const leaveTypeLabels: Record<TeacherLeave["type"], string> = {
  sick: "病假",
  personal: "事假",
  training: "培训",
  official: "公务",
  other: "其他",
}

export function TeacherLeavesPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const client = useQueryClient()
  const [urlParams, setUrlParams] = useHashPreservingSearchParams()
  const [page, setPage] = useState(() => positiveIntegerParam(urlParams, "page", 1))
  const [pageSize, setPageSize] = useState(() =>
    positiveIntegerParam(urlParams, "per_page", 20, [20, 50, 100]),
  )
  const [teacherFilter, setTeacherFilter] = useState(() => {
    const value = urlParams.get("teacher")
    return value && /^\d+$/.test(value) ? value : "all"
  })
  const [statusFilter, setStatusFilter] = useState(() =>
    enumParam(urlParams, "status", ["all", "active", "cancelled"], "all"),
  )
  const [dateFrom, setDateFrom] = useState(() => dateParam(urlParams, "from"))
  const [dateTo, setDateTo] = useState(() => dateParam(urlParams, "to"))
  const [editorOpen, setEditorOpen] = useState(false)
  const [selectedLeaveId, setSelectedLeaveId] = useState<number | null>(null)

  const didMountFilters = useRef(false)
  useEffect(() => {
    if (!didMountFilters.current) {
      didMountFilters.current = true
      return
    }
    setPage(1)
  }, [teacherFilter, statusFilter, dateFrom, dateTo])
  useEffect(() => {
    setUrlParams(
      (current) =>
        mergeSearchParams(current, {
          teacher: teacherFilter === "all" ? null : teacherFilter,
          status: statusFilter === "all" ? null : statusFilter,
          from: dateFrom || null,
          to: dateTo || null,
          page: page === 1 ? null : page,
          per_page: pageSize === 20 ? null : pageSize,
        }),
      { replace: true },
    )
  }, [dateFrom, dateTo, page, pageSize, setUrlParams, statusFilter, teacherFilter])
  const semester = useQuery({
    queryKey: ["semester", semesterId],
    queryFn: () => api<Semester>(`/api/v1/semesters/${semesterId}`),
    enabled: semesterId !== null,
  })
  const teachers = useQuery({
    queryKey: ["teachers", "all", "teacher-leaves"],
    queryFn: () => apiAllPages<Teacher>("/api/v1/teachers"),
  })
  const leaves = useQuery({
    queryKey: [
      "teacher-leaves",
      semesterId,
      page,
      pageSize,
      teacherFilter,
      statusFilter,
      dateFrom,
      dateTo,
    ],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page), per_page: String(pageSize) })
      if (teacherFilter !== "all") query.set("teacher_id", teacherFilter)
      if (statusFilter !== "all") query.set("status", statusFilter)
      if (dateFrom) query.set("date_from", dateFrom)
      if (dateTo) query.set("date_to", dateTo)
      return api<TeacherLeave[]>(`/api/v1/semesters/${semesterId}/teacher-leaves?${query}`)
    },
    enabled: semesterId !== null,
  })
  const pagination = paginationOf(leaves.data?.meta)
  const lastPage = pagination?.last_page
  useEffect(() => {
    if (lastPage && page > Math.max(1, lastPage)) {
      setPage(Math.max(1, lastPage))
    }
  }, [lastPage, page])
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["teacher-leaves", semesterId] }),
      client.invalidateQueries({ queryKey: ["teacher-leave", semesterId] }),
      client.invalidateQueries({ queryKey: ["daily-timetable", semesterId] }),
      client.invalidateQueries({ queryKey: ["context"] }),
    ])
  }

  if (!semesterId && !context.isLoading)
    return (
      <>
        <PageHeader title="请假与代课" />
        <EmptyList title="尚未设置当前学期" description="请先设置当前开放学期。" />
      </>
    )

  return (
    <>
      <PageHeader title="请假与代课" description="先看受影响课程，再批量安排可解释的代课建议。" />
      <div className="p-4 md:p-7">
        <section className="surface-panel overflow-hidden">
          <ListToolbar
            summary={
              <span>共 {pagination?.total ?? leaves.data?.data.length ?? 0} 条请假记录</span>
            }
            actions={
              <Button onClick={() => setEditorOpen(true)}>
                <PlusIcon />
                登记请假
              </Button>
            }
          >
            <ToolbarSelect value={teacherFilter} onChange={setTeacherFilter} label="教师">
              <option value="all">全部教师</option>
              {(teachers.data?.data ?? []).map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </ToolbarSelect>
            <ToolbarSelect value={statusFilter} onChange={setStatusFilter} label="状态">
              <option value="all">全部状态</option>
              <option value="active">生效中</option>
              <option value="cancelled">已取消</option>
            </ToolbarSelect>
            <DatePicker
              label="影响开始日期"
              surface="filter"
              className="w-40"
              value={dateFrom}
              onValueChange={setDateFrom}
            />
            <span className="text-sm text-muted-foreground">至</span>
            <DatePicker
              label="影响结束日期"
              surface="filter"
              className="w-40"
              value={dateTo}
              onValueChange={setDateTo}
            />
          </ListToolbar>
          {leaves.isLoading ? (
            <LoadingState />
          ) : leaves.isError ? (
            <ErrorState retry={() => void leaves.refetch()} />
          ) : !leaves.data?.data.length ? (
            <EmptyList
              title="没有匹配的请假记录"
              description="登记前会先计算实际受影响课程，不会直接改动课表。"
            />
          ) : (
            <>
              <Table responsive>
                <TableHeader>
                  <TableRow>
                    <TableHead>教师</TableHead>
                    <TableHead>请假时间</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>原因</TableHead>
                    <TableHead>已安排代课</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaves.data.data.map((leave) => (
                    <TableRow key={leave.id}>
                      <TableCell data-label="教师">
                        <p className="font-medium">{leave.teacher.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {leave.teacher.employee_no ?? "未设置工号"}
                        </p>
                      </TableCell>
                      <TableCell data-label="请假时间" className="whitespace-nowrap">
                        <p>{dateTimeLabel(leave.starts_at)}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          至 {dateTimeLabel(leave.ends_at)}
                        </p>
                      </TableCell>
                      <TableCell data-label="类型">{leaveTypeLabels[leave.type]}</TableCell>
                      <TableCell
                        data-label="原因"
                        className="max-w-72 truncate"
                        title={leave.reason ?? undefined}
                      >
                        {leave.reason || "—"}
                      </TableCell>
                      <TableCell data-label="已安排代课">
                        <span className="font-medium tabular-nums">
                          {leave.substitutions_count ?? 0}
                        </span>
                        <span className="ml-1 text-muted-foreground">节</span>
                      </TableCell>
                      <TableCell data-label="状态">
                        <StatusBadge value={leave.status} />
                      </TableCell>
                      <TableCell data-label="操作" className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedLeaveId(leave.id)}
                        >
                          {leave.status === "active" ? "安排代课" : "查看详情"}
                        </Button>
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

      <LeaveEditor
        open={editorOpen}
        semesterId={semesterId}
        semester={semester.data?.data ?? null}
        teachers={teachers.data?.data ?? []}
        etag={leaves.data?.etag ?? semester.data?.etag ?? null}
        onClose={() => setEditorOpen(false)}
        onSaved={async (leaveId) => {
          await refresh()
          setSelectedLeaveId(leaveId)
        }}
      />
      <LeaveDetailDialog
        leaveId={selectedLeaveId}
        semesterId={semesterId}
        onClose={() => setSelectedLeaveId(null)}
        onChanged={refresh}
      />
    </>
  )
}

type LeaveForm = {
  teacher_id: string
  starts_at: string
  ends_at: string
  type: TeacherLeave["type"]
  reason: string
}

function LeaveEditor({
  open,
  semesterId,
  semester,
  teachers,
  etag,
  onClose,
  onSaved,
}: {
  open: boolean
  semesterId: number | null
  semester: Semester | null
  teachers: Teacher[]
  etag: string | null
  onClose: () => void
  onSaved: (leaveId: number) => Promise<void>
}) {
  const [form, setForm] = useState<LeaveForm>(() => emptyLeaveForm(semester))
  const [preview, setPreview] = useState<TeacherLeavePreview | null>(null)
  const [previewEtag, setPreviewEtag] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof LeaveForm, string>>>({})

  useEffect(() => {
    if (!open) return
    setForm(emptyLeaveForm(semester))
    setPreview(null)
    setPreviewEtag(null)
    setErrors({})
  }, [open, semester])
  const update = <K extends keyof LeaveForm>(key: K, value: LeaveForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setPreview(null)
    setPreviewEtag(null)
    setErrors((current) => ({ ...current, [key]: undefined }))
  }
  const payload = () => ({
    teacher_id: Number(form.teacher_id),
    starts_at: form.starts_at,
    ends_at: form.ends_at,
    type: form.type,
    reason: form.reason.trim() || null,
    includes_non_course_items: false,
  })
  const previewReady = Boolean(
    semesterId && form.teacher_id && form.starts_at && form.ends_at > form.starts_at,
  )
  const runPreview = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!semesterId) return
    const nextErrors = validateLeaveForm(form)
    setErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) {
      toast.error("请先补齐标出的必填项")
      return
    }
    if (!previewReady) return
    setBusy(true)
    try {
      const result = await api<TeacherLeavePreview>(
        `/api/v1/semesters/${semesterId}/teacher-leaves/preview`,
        { method: "POST", body: jsonBody(payload()) },
      )
      setPreview(result.data)
      setPreviewEtag(result.etag)
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (!semesterId || !preview || !(previewEtag ?? etag)) return
    setBusy(true)
    try {
      const result = await api<{ leave: TeacherLeave }>(
        `/api/v1/semesters/${semesterId}/teacher-leaves`,
        {
          method: "POST",
          etag: previewEtag ?? etag,
          body: jsonBody(payload()),
        },
      )
      toast.success(
        preview.affected_count > 0
          ? `请假已登记，待处理 ${preview.affected_count} 节受影响课程`
          : "请假已登记，该时段没有课程受影响",
      )
      onClose()
      await onSaved(result.data.leave.id)
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b p-6 pr-16">
          <DialogTitle>登记教师请假</DialogTitle>
          <DialogDescription>保存前先列出这个时间段内实际发生且受影响的课程。</DialogDescription>
        </DialogHeader>
        <form
          className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-6"
          onSubmit={(event) => void runPreview(event)}
        >
          <Field label="请假教师（必填）" error={errors.teacher_id}>
            <TeacherPicker
              invalid={Boolean(errors.teacher_id)}
              teachers={teachers}
              value={form.teacher_id}
              onValueChange={(value) => update("teacher_id", value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="开始时间（必填）" error={errors.starts_at}>
              <DateTimePicker
                required
                invalid={Boolean(errors.starts_at)}
                min={semester ? `${semester.start_date}T00:00` : undefined}
                max={semester ? `${semester.end_date}T23:59` : undefined}
                value={form.starts_at}
                onValueChange={(value) => update("starts_at", value)}
                label="开始时间"
                className="w-full"
              />
            </Field>
            <Field label="结束时间（必填）" error={errors.ends_at}>
              <DateTimePicker
                required
                invalid={Boolean(errors.ends_at)}
                min={form.starts_at || (semester ? `${semester.start_date}T00:00` : undefined)}
                max={semester ? `${semester.end_date}T23:59` : undefined}
                value={form.ends_at}
                onValueChange={(value) => update("ends_at", value)}
                label="结束时间"
                className="w-full"
              />
            </Field>
          </div>
          <Field label="请假类型">
            <SimpleSelect
              className="w-full"
              value={form.type}
              onValueChange={(value) => update("type", value as TeacherLeave["type"])}
            >
              {Object.entries(leaveTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SimpleSelect>
          </Field>
          <Field label="原因或说明">
            <textarea
              maxLength={1000}
              className="min-h-24 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
              value={form.reason}
              onChange={(event) => update("reason", event.target.value)}
              placeholder="可选；例如培训名称、请假说明"
            />
          </Field>
          {preview && <LeavePreviewPanel preview={preview} />}
          <button type="submit" className="hidden" aria-hidden="true" />
        </form>
        <DialogFooter className="flex-row flex-wrap justify-end border-t bg-background/95 p-6">
          {!previewReady && (
            <p
              id="leave-preview-help"
              aria-live="polite"
              className="mr-auto w-full self-center text-xs text-muted-foreground sm:w-auto"
            >
              请选择教师，并确认结束时间晚于开始时间。
            </p>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="outline"
            onClick={() => void runPreview()}
            disabled={busy || !previewReady}
            aria-describedby={!previewReady ? "leave-preview-help" : undefined}
          >
            {busy ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
            {preview ? "重新预览" : "预览受影响课程"}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !preview}>
            <CheckCircle2Icon />
            确认登记
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function validateLeaveForm(form: LeaveForm) {
  const errors: Partial<Record<keyof LeaveForm, string>> = {}
  if (!form.teacher_id) errors.teacher_id = "请选择请假教师"
  if (!form.starts_at) errors.starts_at = "请选择开始时间"
  if (!form.ends_at) errors.ends_at = "请选择结束时间"
  else if (form.starts_at && form.ends_at <= form.starts_at)
    errors.ends_at = "结束时间必须晚于开始时间"
  return errors
}

function LeavePreviewPanel({ preview }: { preview: TeacherLeavePreview }) {
  const grouped = groupAffectedRows(preview.affected)
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex items-center gap-3 border-b bg-muted/25 px-4 py-3">
        <CalendarDaysIcon className="size-5 text-primary" />
        <div>
          <p className="font-medium">
            {preview.affected_count > 0
              ? `将影响 ${preview.affected_count} 节课程`
              : "该时段没有课程受影响"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {preview.teacher.name} · {dateTimeLabel(preview.starts_at)} 至{" "}
            {dateTimeLabel(preview.ends_at)}
          </p>
        </div>
      </div>
      {grouped.length > 0 && (
        <div className="max-h-72 overflow-y-auto divide-y">
          {grouped.map((group) => (
            <div key={group.date} className="px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground">{dateLabel(group.date)}</p>
              <div className="mt-2 space-y-2">
                {group.rows.map((row) => (
                  <p key={row.key} className="text-sm">
                    <span className="font-medium">
                      {row.item_name} · {row.target_name}
                    </span>
                    <span className="text-muted-foreground"> · {row.course_name}</span>
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type RecommendationChoice = {
  teacherId: number
  recommendations: SubstituteRecommendation[]
}

function LeaveDetailDialog({
  leaveId,
  semesterId,
  onClose,
  onChanged,
}: {
  leaveId: number | null
  semesterId: number | null
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [choices, setChoices] = useState<Record<string, RecommendationChoice>>({})
  const [loadingKeys, setLoadingKeys] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const detail = useQuery({
    queryKey: ["teacher-leave", semesterId, leaveId],
    queryFn: () =>
      api<TeacherLeaveDetail>(`/api/v1/semesters/${semesterId}/teacher-leaves/${leaveId}`),
    enabled: semesterId !== null && leaveId !== null,
  })
  useEffect(() => setChoices({}), [leaveId])

  const data = detail.data?.data
  const activeSubstitutions = useMemo(
    () =>
      new Map(
        (data?.leave.substitutions ?? [])
          .filter((item) => item.status === "active")
          .map((item) => [substitutionKey(item.original_entry_id, item.effective_date), item]),
      ),
    [data?.leave.substitutions],
  )
  const unresolved = (data?.affected ?? []).filter(
    (row) =>
      row.original_entry_id !== null &&
      !activeSubstitutions.has(substitutionKey(row.original_entry_id, row.date)),
  )

  const fetchRecommendations = async (row: DailyTimetableRow) => {
    if (!semesterId || !leaveId || row.original_entry_id === null) return []
    const query = new URLSearchParams({
      entry_id: String(row.original_entry_id),
      date: row.date,
    })
    const result = await api<SubstituteRecommendation[]>(
      `/api/v1/semesters/${semesterId}/teacher-leaves/${leaveId}/recommendations?${query}`,
    )
    return result.data
  }
  const loadOne = async (row: DailyTimetableRow) => {
    const key = rowKey(row)
    setLoadingKeys((current) => [...current, key])
    try {
      const recommendations = await fetchRecommendations(row)
      setChoices((current) => ({
        ...current,
        [key]: { teacherId: recommendations[0]?.teacher.id ?? 0, recommendations },
      }))
      if (recommendations.length === 0)
        toast.warning(`${row.target_name} · ${row.course_name} 暂无可用代课教师`)
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setLoadingKeys((current) => current.filter((value) => value !== key))
    }
  }
  const autoMatch = async () => {
    if (unresolved.length === 0) return
    setBusy(true)
    setLoadingKeys(unresolved.map(rowKey))
    try {
      const results = await Promise.all(
        unresolved.map(async (row) => ({ row, recommendations: await fetchRecommendations(row) })),
      )
      const next: Record<string, RecommendationChoice> = {}
      for (const result of results) {
        next[rowKey(result.row)] = {
          teacherId: result.recommendations[0]?.teacher.id ?? 0,
          recommendations: result.recommendations,
        }
      }
      setChoices(next)
      const unmatched = results.filter((result) => result.recommendations.length === 0).length
      if (unmatched > 0) toast.warning(`${unmatched} 节课程没有可用代课教师，需要另行处理`)
      else toast.success("已按资格、空闲情况、当天负荷和历史代课次数完成匹配")
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setLoadingKeys([])
      setBusy(false)
    }
  }
  const save = async () => {
    if (!semesterId || !leaveId || !detail.data?.etag) return
    const substitutions = unresolved
      .map((row) => ({ row, choice: choices[rowKey(row)] }))
      .filter((item) => item.choice?.teacherId)
      .map((item) => ({
        entry_id: item.row.original_entry_id,
        date: item.row.date,
        replacement_teacher_id: item.choice.teacherId,
        reason: data?.leave.reason ?? "教师请假代课",
      }))
    if (substitutions.length === 0) {
      toast.warning("请先为至少一节课程选择代课教师")
      return
    }
    setBusy(true)
    try {
      await api(`/api/v1/semesters/${semesterId}/teacher-leaves/${leaveId}/substitutions`, {
        method: "POST",
        etag: detail.data.etag,
        body: jsonBody({ substitutions }),
      })
      toast.success(`已保存 ${substitutions.length} 节代课安排`)
      setChoices({})
      await onChanged()
      await detail.refetch()
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const cancel = async () => {
    if (!semesterId || !leaveId || !detail.data?.etag) return
    setBusy(true)
    try {
      await api(`/api/v1/semesters/${semesterId}/teacher-leaves/${leaveId}/cancel`, {
        method: "POST",
        etag: detail.data.etag,
      })
      toast.success("请假及关联代课已取消")
      onClose()
      await onChanged()
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={leaveId !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b p-6 pr-16">
          <DialogTitle>请假影响与代课安排</DialogTitle>
          <DialogDescription>每条推荐都说明依据；保存后只覆盖对应实际日期。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {detail.isLoading ? (
            <LoadingState />
          ) : detail.isError || !data ? (
            <ErrorState retry={() => void detail.refetch()} />
          ) : (
            <div className="grid gap-5 p-6">
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <CircleUserRoundIcon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{data.leave.teacher.name}</p>
                      <Badge variant="outline">{leaveTypeLabels[data.leave.type]}</Badge>
                      <StatusBadge value={data.leave.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {dateTimeLabel(data.leave.starts_at)} 至 {dateTimeLabel(data.leave.ends_at)}
                    </p>
                    {data.leave.reason && <p className="mt-2 text-sm">{data.leave.reason}</p>}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div>
                  <h2 className="font-semibold">受影响课程</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    共 {data.affected_count} 节 · 已安排 {activeSubstitutions.size} 节 · 待处理{" "}
                    {unresolved.length} 节
                  </p>
                </div>
                {data.leave.status === "active" && unresolved.length > 0 && (
                  <Button
                    className="ml-auto"
                    variant="outline"
                    onClick={() => void autoMatch()}
                    disabled={busy}
                  >
                    {busy ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
                    智能匹配全部
                  </Button>
                )}
              </div>

              {data.affected.length === 0 ? (
                <EmptyList title="没有课程受影响" description="当前时间段无需安排代课。" />
              ) : (
                <div className="space-y-3">
                  {data.affected.map((row) => {
                    const key = rowKey(row)
                    const existing =
                      row.original_entry_id === null
                        ? undefined
                        : activeSubstitutions.get(substitutionKey(row.original_entry_id, row.date))
                    const choice = choices[key]
                    const selected = choice?.recommendations.find(
                      (item) => item.teacher.id === choice.teacherId,
                    )
                    const loading = loadingKeys.includes(key)
                    return (
                      <div key={key} className="rounded-xl border p-4">
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-muted-foreground">
                              {dateLabel(row.date)} · {row.item_name} · {shortTime(row.start_time)}–
                              {shortTime(row.end_time)}
                            </p>
                            <p className="mt-1 font-medium">
                              {row.target_name} · {row.course_name}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              原教师：{data.leave.teacher.name} · {row.room_name}
                            </p>
                          </div>
                          {existing && (
                            <Badge className="bg-emerald-600">
                              <UserRoundCheckIcon />
                              {existing.replacement_teacher.name} 代课
                            </Badge>
                          )}
                        </div>

                        {!existing &&
                          data.leave.status === "active" &&
                          row.original_entry_id !== null && (
                            <div className="mt-3 border-t pt-3">
                              {!choice ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={loading || busy}
                                  onClick={() => void loadOne(row)}
                                >
                                  {loading ? (
                                    <LoaderCircleIcon className="animate-spin" />
                                  ) : (
                                    <SparklesIcon />
                                  )}
                                  推荐代课教师
                                </Button>
                              ) : choice.recommendations.length === 0 ? (
                                <p className="flex gap-2 text-sm text-amber-700">
                                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                                  暂无同时满足学科资格、空闲和未请假条件的教师。
                                </p>
                              ) : (
                                <div className="grid gap-3">
                                  <TeacherPicker
                                    teachers={choice.recommendations.map((item) => item.teacher)}
                                    value={String(choice.teacherId)}
                                    onValueChange={(value) =>
                                      setChoices((current) => ({
                                        ...current,
                                        [key]: { ...choice, teacherId: Number(value) },
                                      }))
                                    }
                                  />
                                  {selected && (
                                    <div className="rounded-lg bg-muted/35 px-3 py-2.5 text-sm">
                                      <p className="font-medium">
                                        为什么推荐 {selected.teacher.name}
                                      </p>
                                      <ul className="mt-1.5 grid gap-1 text-muted-foreground sm:grid-cols-2">
                                        {selected.reasons.map((reason) => (
                                          <li key={reason} className="flex gap-1.5">
                                            <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                                            {reason}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        {!existing && row.original_entry_id === null && (
                          <p className="mt-3 border-t pt-3 text-sm text-amber-700">
                            这是日期例外生成的补课，请到“临时调课”中更换教师。
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        {data && (
          <DialogFooter className="flex-row flex-wrap justify-end border-t bg-background/95 p-6">
            {data.leave.status === "active" && (
              <Button
                variant="ghost"
                className="mr-auto"
                disabled={busy}
                onClick={() => void cancel()}
              >
                取消请假
              </Button>
            )}
            <Button variant="outline" onClick={onClose} disabled={busy}>
              关闭
            </Button>
            {data.leave.status === "active" && unresolved.length > 0 && (
              <Button
                disabled={busy || !Object.values(choices).some((choice) => choice.teacherId > 0)}
                onClick={() => void save()}
              >
                <UserRoundCheckIcon />
                保存代课安排
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function emptyLeaveForm(semester: Semester | null): LeaveForm {
  const date = semester
    ? clampDate(todayString(), semester.start_date, semester.end_date)
    : todayString()
  return {
    teacher_id: "",
    starts_at: `${date}T08:00`,
    ends_at: `${date}T17:00`,
    type: "sick",
    reason: "",
  }
}

function groupAffectedRows(rows: DailyTimetableRow[]) {
  const groups = new Map<string, DailyTimetableRow[]>()
  for (const row of rows) groups.set(row.date, [...(groups.get(row.date) ?? []), row])
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, groupRows]) => ({ date, rows: groupRows }))
}

function rowKey(row: DailyTimetableRow) {
  return substitutionKey(row.original_entry_id ?? 0, row.date)
}

function substitutionKey(entryId: number, date: string) {
  return `${entryId}@${date.slice(0, 10)}`
}

function paginationOf(meta?: Record<string, unknown>): PaginationMeta | null {
  const value = meta?.pagination
  if (!value || typeof value !== "object") return null
  return value as PaginationMeta
}

function dateParam(params: URLSearchParams, key: string) {
  const value = params.get(key)
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""
}

function todayString() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function clampDate(value: string, min: string, max: string) {
  if (value < min) return min
  if (value > max) return max
  return value
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`))
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
}

function shortTime(value: string) {
  return value.slice(0, 5)
}
