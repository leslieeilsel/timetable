import { useHashPreservingSearchParams } from "@/lib/url-state"
import { clampDate, validDate } from "@/lib/daily-adjustments"
import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DatePicker } from "@/components/date-picker"
import {
  AdjustmentPageHeader,
  AdjustmentStepHeader,
  AdjustmentDraftNotice,
  AdjustmentFooter,
  AdjustmentObjectPicker,
  adjustmentPageClass,
  adjustmentContentClass,
} from "@/components/adjustments/workbench"
import { WeeklyLessonPicker } from "@/components/long-term-changes/lesson-picker"
import { SimpleSelect } from "@/components/simple-select"
import { ErrorState, LoadingState } from "@/components/page"
import { LongTermEditor } from "@/components/long-term-changes/editor"
import { LongTermHistory } from "@/components/long-term-changes/history"
import { WeeklyComparison } from "@/components/long-term-changes/comparison"
import { api, apiAllPages, apiMessage, ApiError, type ApiResult } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useResolvedSemesterId } from "@/lib/semester"
import {
  applyOperations,
  arrangement,
  changedEntries,
  changeFields,
  defaultStart,
  localDate,
  matchesObject,
} from "@/lib/long-term-changes"
import type {
  ChangeOperation,
  LongTermEntry,
  LongTermPreview,
  LongTermSource,
  LongTermSelection,
} from "@/lib/long-term-changes"
import type { Room, SchoolClass, Semester, Teacher } from "@/lib/types"

interface SavedDraft {
  id: string
  view: string
  resourceId: string
  from: string
  to: string
  reason: string
  notify: boolean
  operations: ChangeOperation[]
  originals: LongTermEntry[]
  selection?: Omit<LongTermSelection, "entryId"> & { entryKey: string }
}
function readDraft(key: string): SavedDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null")
    return value &&
      Array.isArray(value.operations) &&
      Array.isArray(value.originals) &&
      typeof value.from === "string"
      ? { ...value, id: typeof value.id === "string" ? value.id : String(Date.now()) }
      : null
  } catch {
    return null
  }
}
export function LongTermAdjustmentsPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const { user } = useAuth()
  const semester = useQuery({
    queryKey: ["semester", semesterId],
    queryFn: () => api<Semester>(`/api/v1/semesters/${semesterId}`),
    enabled: semesterId !== null,
  })
  if (semesterId === null)
    return context.isLoading ? <LoadingState /> : <div className="p-7">请先设置当前学期。</div>
  if (semester.isLoading) return <LoadingState />
  if (semester.isError || !semester.data)
    return <ErrorState retry={() => void semester.refetch()} />
  return (
    <LongTermWorkbench
      key={`${semesterId}:${user?.id}`}
      semester={semester.data.data}
      userId={user?.id ?? 0}
      canEdit={Boolean(
        user && ["admin", "scheduler"].includes(user.role) && semester.data.data.status === "open",
      )}
    />
  )
}
function LongTermWorkbench({
  semester,
  userId,
  canEdit,
}: {
  semester: Semester
  userId: number
  canEdit: boolean
}) {
  const client = useQueryClient()
  const draftKey = `long-term-changes:${userId}:${semester.id}:draft`
  const [saved, setSaved] = useState<SavedDraft | null>(() => readDraft(draftKey))
  const draftId = useRef(String(Date.now()))
  const [params, setParams] = useHashPreservingSearchParams()
  const [step, setStep] = useState(() => (params.get("step") === "source" ? 1 : 0))
  const [view, setView] = useState(() => (params.get("object") === "class" ? "class" : "teacher"))
  const [selection, setSelection] = useState<LongTermSelection>({
    entryId: 0,
    scope: "entry",
    action: "swap",
  })
  const [resourceId, setResourceId] = useState(() => params.get("resource") ?? "")
  const [from, setFrom] = useState(() =>
    validDate(params.get("date"))
      ? clampDate(
          params.get("date")!,
          localDate() > semester.start_date ? localDate() : semester.start_date,
          semester.end_date,
        )
      : defaultStart(semester),
  )
  const [to, setTo] = useState(semester.end_date)
  const [customEnd, setCustomEnd] = useState(() => params.get("scope") === "range")
  const [reason, setReason] = useState("")
  const [notify, setNotify] = useState(true)
  const [operations, setOperations] = useState<ChangeOperation[]>([])
  const [source, setSource] = useState<ApiResult<LongTermSource> | null>(null)
  const [preview, setPreview] = useState<ApiResult<LongTermPreview> | null>(null)
  const [busy, setBusy] = useState(false)
  const publishing = useRef(false)
  const [error, setError] = useState("")
  const [details, setDetails] = useState<string[]>([])
  const [leave, setLeave] = useState<"home" | "scope" | "new" | null>(null)
  const [result, setResult] = useState<LongTermPreview | null>(null)
  const [draftWarning, setDraftWarning] = useState(false)
  const resources = useQuery({
    queryKey: ["long-term-resources", semester.id],
    enabled: step > 0,
    queryFn: async () => {
      const [teachers, rooms, classes] = await Promise.all([
        apiAllPages<Teacher>("/api/v1/teachers"),
        apiAllPages<Room>("/api/v1/rooms"),
        apiAllPages<SchoolClass>(`/api/v1/academic-years/${semester.academic_year_id}/classes`),
      ])
      return { teachers: teachers.data, rooms: rooms.data, classes: classes.data }
    },
  })
  const data = resources.data ?? { teachers: [], rooms: [], classes: [] }
  const resourceName =
    (view === "class" ? data.classes : view === "teacher" ? data.teachers : data.rooms).find(
      (item) => String(item.id) === resourceId,
    )?.name ?? "已选对象"
  const edited = useMemo(
    () => (source ? applyOperations(source.data.entries, operations) : []),
    [source, operations],
  )
  const patches = useMemo(
    () => (source ? changedEntries(source.data.entries, edited) : []),
    [source, edited],
  )
  const today = source?.data.today ?? localDate()
  const minDate = today > semester.start_date ? today : semester.start_date
  const availableSource = useQuery({
    queryKey: ["long-term-source", semester.id, from],
    enabled:
      step === 1 && Boolean(resourceId) && from >= minDate && from <= to && to <= semester.end_date,
    queryFn: () =>
      api<LongTermSource>(`/api/v1/semesters/${semester.id}/long-term-changes/source?date=${from}`),
  })
  const setStart = (value: string) => {
    setFrom(value)
    if (to < value) setTo(value)
  }
  const selectedEntryId = params.get("entry")
  const linkedEntry = availableSource.data?.data.entries.find(
    (entry) => String(entry.id) === selectedEntryId,
  )
  const selectCourse = (entry: LongTermEntry, scope: LongTermSelection["scope"] = "entry") => {
    if (!availableSource.data) return
    setSource(availableSource.data)
    setSelection({ entryId: entry.id, scope, action: scope === "assignment" ? "teacher" : "swap" })
    setOperations([])
    setPreview(null)
    setStep(2)
    clearError()
  }
  const clearError = () => {
    setError("")
    setDetails([])
  }
  const setCaught = (caught: unknown) => {
    setError(apiMessage(caught))
    setDetails([])
    if (caught instanceof ApiError) {
      const conflicts = caught.details.hard_conflicts
      if (Array.isArray(conflicts))
        setDetails([
          ...new Set(
            conflicts
              .map((conflict) => (typeof conflict?.message === "string" ? conflict.message : ""))
              .filter(Boolean),
          ),
        ])
    }
  }
  useEffect(() => {
    if (!source) return
    if (!patches.length) {
      if (readDraft(draftKey)?.id === draftId.current) {
        try {
          localStorage.removeItem(draftKey)
          setSaved(null)
        } catch {
          setDraftWarning(true)
        }
      }
      return
    }
    const draft: SavedDraft = {
      id: draftId.current,
      view,
      resourceId,
      from,
      to,
      reason,
      notify,
      operations,
      selection: {
        entryKey:
          source.data.entries.find((entry) => entry.id === selection.entryId)?.entry_key ?? "",
        scope: selection.scope,
        action: selection.action,
      },
      originals: source.data.entries.filter((entry) =>
        operations.some((operation) => entry.id in operation.updates),
      ),
    }
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft))
      setSaved(draft)
      setDraftWarning(false)
    } catch {
      setDraftWarning(true)
    }
  }, [
    source,
    patches.length,
    view,
    resourceId,
    from,
    to,
    reason,
    notify,
    operations,
    draftKey,
    selection,
  ])
  useEffect(() => {
    if (!patches.length) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [patches.length])
  const loadSource = async (draft?: SavedDraft) => {
    if (busy) return
    setBusy(true)
    clearError()
    try {
      const start = draft?.from ?? from
      const value = await api<LongTermSource>(
        `/api/v1/semesters/${semester.id}/long-term-changes/source?date=${start}`,
      )
      let restored: ChangeOperation[] = []
      if (draft) {
        const ids = new Map<number, number>()
        for (const original of draft.originals) {
          const current = value.data.entries.find((entry) => entry.entry_key === original.entry_key)
          if (!current || changeFields.some((field) => current[field] !== original[field]))
            throw new Error("草稿涉及的课程已经变化，请重新选择课程。原草稿仍保留。")
          ids.set(original.id, current.id)
        }
        restored = draft.operations.map((operation) => ({
          ...operation,
          updates: Object.fromEntries(
            Object.entries(operation.updates).map(([id, fields]) => [ids.get(Number(id))!, fields]),
          ),
        }))
        setView(draft.view)
        setResourceId(draft.resourceId)
        setFrom(draft.from)
        setTo(draft.to)
        setCustomEnd(draft.to !== semester.end_date)
        setReason(draft.reason)
        setNotify(draft.notify)
        draftId.current = draft.id
      }
      setSource(value)
      setOperations(restored)
      setSelection({
        entryId:
          value.data.entries.find((entry) => entry.entry_key === draft?.selection?.entryKey)?.id ??
          (Number(Object.keys(restored.at(-1)?.updates ?? {})[0]) ||
            value.data.entries[0]?.id ||
            0),
        scope: draft?.selection?.scope === "assignment" ? "assignment" : "entry",
        action:
          draft?.selection && ["swap", "move", "teacher", "room"].includes(draft.selection.action)
            ? draft.selection.action
            : "swap",
      })
      setPreview(null)
      setStep(2)
    } catch (caught) {
      setCaught(caught)
    } finally {
      setBusy(false)
    }
  }
  const startNew = () => {
    draftId.current = String(Date.now())
    setLeave(null)
    setStep(1)
    setSource(null)
    setOperations([])
    setPreview(null)
    setResult(null)
    setReason("")
    clearError()
  }
  const exit = () => {
    setStep(0)
    setParams({}, { replace: true })
    setSource(null)
    setOperations([])
    setPreview(null)
    setLeave(null)
    clearError()
  }
  const changeScope = () => {
    draftId.current = String(Date.now())
    setSource(null)
    setOperations([])
    setPreview(null)
    setStep(1)
    setLeave(null)
    clearError()
  }
  const publish = async (confirm: boolean) => {
    if (publishing.current || !source || !patches.length || !reason.trim()) return
    publishing.current = true
    setBusy(true)
    clearError()
    try {
      const value = await api<LongTermPreview>(
        `/api/v1/semesters/${semester.id}/long-term-changes${confirm ? "" : "/preview"}`,
        {
          method: "POST",
          etag: confirm ? preview?.etag : source.etag,
          body: JSON.stringify({
            source_version_id: source.data.version_id,
            effective_from: from,
            effective_to: to,
            reason: reason.trim(),
            notify_teachers: notify,
            changes: patches,
          }),
        },
      )
      if (confirm) {
        try {
          localStorage.removeItem(draftKey)
        } catch {
          setDraftWarning(true)
        }
        setSaved(null)
        setResult(value.data)
        setSource(null)
        setOperations([])
        setPreview(null)
        setStep(4)
        await client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "me" })
      } else {
        setPreview(value)
        setStep(3)
      }
    } catch (caught) {
      setCaught(caught)
    } finally {
      publishing.current = false
      setBusy(false)
    }
  }
  const saveAndExit = () => {
    if (!patches.length) return toast.info("请先设置新安排")
    if (draftWarning) return toast.error("浏览器暂存失败，请保持页面打开")
    toast.success("草稿已暂存，尚未发布")
    exit()
  }
  return (
    <div className={adjustmentPageClass}>
      <div className={step === 0 ? "space-y-5" : adjustmentContentClass}>
        {step === 0 ? (
          <AdjustmentPageHeader title="调课与代课" description="查看持续生效的课程调整。" />
        ) : (
          <AdjustmentStepHeader
            step={step}
            title={step === 1 && linkedEntry ? "确认生效时间" : undefined}
            description={`持续调课 · ${from} 至 ${to}，按周执行。`}
            onBack={step < 4 ? () => (patches.length ? setLeave("home") : exit()) : undefined}
            busy={busy}
          />
        )}
        {error && (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm"
          >
            <p className="font-medium text-destructive">{error}</p>
            {details.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {step === 0 && (
          <>
            {saved && canEdit && (
              <AdjustmentDraftNotice
                description={`${saved.from} 至 ${saved.to} · ${saved.operations.length} 次修改`}
                busy={busy}
                onContinue={() => void loadSource(saved)}
                onDelete={() => {
                  try {
                    localStorage.removeItem(draftKey)
                    setSaved(null)
                  } catch {
                    toast.error("删除草稿失败，请保持页面打开")
                  }
                }}
              />
            )}
            <LongTermHistory
              semesterId={semester.id}
              canEdit={canEdit}
              onNew={canEdit ? () => (saved ? setLeave("new") : startNew()) : undefined}
            />
          </>
        )}
        {step > 0 && step < 4 && !canEdit && (
          <p role="alert" className="text-destructive">
            当前账号或学期只允许查看，不能发布调整。
          </p>
        )}
        {step === 1 && (
          <div className="space-y-5 rounded-xl border bg-card p-5 lg:p-7">
            {linkedEntry && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4">
                <div>
                  <p className="text-sm font-medium">
                    {linkedEntry.course.name} ·{" "}
                    {linkedEntry.school_classes.map((item) => item.name).join("、")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    每周{["", "一", "二", "三", "四", "五", "六", "日"][linkedEntry.weekday]} ·{" "}
                    {linkedEntry.item.name}
                  </p>
                  {linkedEntry.is_locked && (
                    <p role="status" className="mt-2 text-sm text-muted-foreground">
                      这节课已锁定，不能持续调整。请重选课程；如确需修改，请先在编排课表中核对锁定及固定安排。
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setParams(
                        (previous) => {
                          const next = new URLSearchParams(previous)
                          next.delete("entry")
                          return next
                        },
                        { replace: true },
                      )
                    }
                  >
                    重选课程
                  </Button>
                  <Button
                    disabled={
                      !canEdit ||
                      linkedEntry.is_locked ||
                      availableSource.isFetching ||
                      from < minDate ||
                      from > to ||
                      to > semester.end_date
                    }
                    onClick={() => selectCourse(linkedEntry)}
                  >
                    设置新安排
                  </Button>
                </div>
              </div>
            )}

            {resources.isError ? (
              <ErrorState retry={() => void resources.refetch()} />
            ) : resources.isLoading ? (
              <LoadingState label="正在载入选择器…" />
            ) : (
              <>
                <div
                  className={`flex flex-wrap items-center gap-3 ${resourceId ? "border-b pb-5" : ""}`}
                >
                  {!linkedEntry && (
                    <AdjustmentObjectPicker
                      kind={view}
                      resource={resourceId}
                      onChange={(kind, id) => {
                        setView(kind)
                        setResourceId(id)
                      }}
                      classes={data.classes}
                      teachers={data.teachers}
                      rooms={data.rooms}
                    />
                  )}
                  <span className="text-xs text-muted-foreground">从</span>
                  <DatePicker
                    label="开始生效日期"
                    value={from}
                    min={minDate}
                    max={semester.end_date}
                    required
                    onValueChange={setStart}
                  />
                  <SimpleSelect
                    label="调整持续时间"
                    value={customEnd ? "custom" : "semester"}
                    onValueChange={(value) => {
                      setCustomEnd(value === "custom")
                      if (value === "semester") setTo(semester.end_date)
                    }}
                  >
                    <option value="semester">至学期结束</option>
                    <option value="custom">指定结束日期</option>
                  </SimpleSelect>
                  {customEnd && (
                    <DatePicker
                      label="结束生效日期"
                      value={to}
                      min={from}
                      max={semester.end_date}
                      required
                      onValueChange={setTo}
                    />
                  )}
                </div>
                {from < minDate || from > to || to > semester.end_date ? (
                  <p role="alert" className="text-sm text-destructive">
                    请选择本学期内、从今天或未来开始的有效日期范围。
                  </p>
                ) : !resourceId ? null : availableSource.isFetching ? (
                  <LoadingState label="正在查找每周课程…" />
                ) : availableSource.isError ? (
                  <ErrorState retry={() => void availableSource.refetch()} />
                ) : (
                  !linkedEntry &&
                  availableSource.data && (
                    <WeeklyLessonPicker
                      key={`${view}:${resourceId}:${from}`}
                      source={availableSource.data.data}
                      entries={availableSource.data.data.entries.filter((entry) =>
                        matchesObject(entry, view, resourceId),
                      )}
                      teachers={data.teachers}
                      rooms={data.rooms}
                      label={resourceName}
                      onSelect={canEdit ? (entry) => selectCourse(entry) : undefined}
                      onSelectAssignment={
                        canEdit ? (entry) => selectCourse(entry, "assignment") : undefined
                      }
                    />
                  )
                )}
              </>
            )}
          </div>
        )}
        {(step === 2 || step === 3) && source && (
          <div hidden={step !== 2} className="space-y-4">
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              {resources.isLoading ? (
                <LoadingState />
              ) : resources.isError ? (
                <ErrorState retry={() => void resources.refetch()} />
              ) : (
                <LongTermEditor
                  classes={data.classes}
                  scopeDescription={`${from} 至 ${to}`}
                  footer={
                    <AdjustmentFooter
                      onBack={() => (patches.length ? setLeave("scope") : changeScope())}
                      backLabel="上一步：选择课程"
                      onDraft={saveAndExit}
                      onPrimary={() => void publish(false)}
                      primaryLabel="下一步：核对"
                      busy={busy}
                      disabled={!canEdit || !patches.length || reason.trim().length < 2}
                      hint={
                        draftWarning ? (
                          <span className="text-destructive">浏览器暂存失败，请保持页面打开</span>
                        ) : !patches.length ? (
                          "请先填写新的安排"
                        ) : reason.trim().length < 2 ? (
                          "请填写调整原因（至少 2 字）"
                        ) : (
                          "下一步检查冲突并核对调整结果"
                        )
                      }
                    />
                  }
                  source={source.data}
                  selection={selection}
                  onSelection={setSelection}
                  semester={semester}
                  view={view}
                  resourceId={resourceId}
                  resourceName={resourceName}
                  teachers={data.teachers}
                  rooms={data.rooms}
                  operations={operations}
                  onOperations={(value) => {
                    setOperations(value)
                    setPreview(null)
                    clearError()
                  }}
                >
                  <label className="block text-sm">
                    <span className="mb-2 block font-medium">
                      调整原因 <span className="font-normal text-muted-foreground">（必填）</span>
                    </span>
                    <Textarea
                      aria-label="调整原因"
                      required
                      value={reason}
                      onChange={(event) => {
                        setReason(event.target.value)
                        setPreview(null)
                      }}
                      placeholder="例如：任课老师调整、固定教研时间变更"
                      maxLength={500}
                      rows={1}
                      className="min-h-10"
                    />
                  </label>
                </LongTermEditor>
              )}
            </fieldset>
          </div>
        )}
        {step === 3 && preview && (
          <div className="space-y-5 rounded-xl border bg-card p-5 lg:p-7">
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
              <CheckCircle2Icon className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="font-medium">
                  检查通过 · {from} 至 {to}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  涉及{" "}
                  {new Set(preview.data.changes.flatMap(({ before }) => before.class_ids)).size}{" "}
                  个班、
                  {
                    new Set(
                      preview.data.changes.flatMap(({ before, after }) => [
                        ...before.teacher_ids,
                        ...after.teacher_ids,
                      ]),
                    ).size
                  }{" "}
                  位老师
                  {preview.data.checked_temporary_count
                    ? `；已有 ${preview.data.checked_temporary_count} 项临时调整 / 代课已衔接并检查`
                    : ""}
                  。
                </p>
              </div>
            </div>
            <WeeklyComparison changes={preview.data.changes} />
            {to < semester.end_date && (
              <div className="space-y-2 rounded-xl bg-muted/40 p-4">
                <p className="text-sm font-medium">区间结束后，接着执行以下安排</p>
                {preview.data.following?.length ? (
                  preview.data.following.map((row) => (
                    <p key={row.entry_key} className="text-sm text-muted-foreground">
                      {row.effective_from} 起 · {row.target_name} {row.course_name}：
                      {arrangement(row)}
                    </p>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">所选课程在后续课表中没有安排。</p>
                )}
              </div>
            )}
            <div className="space-y-3 text-sm">
              <p>调整原因：{reason}</p>
              <label className="flex items-center gap-2">
                <Checkbox
                  disabled={busy}
                  checked={notify}
                  onCheckedChange={(checked) => setNotify(checked === true)}
                />
                向涉及老师发送站内变更消息
              </label>
              <p className="text-xs text-muted-foreground">
                老师按对应日期查看新课表，无需确认或审批。
              </p>
            </div>
            <AdjustmentFooter
              onBack={() => {
                setStep(2)
                clearError()
              }}
              backLabel="上一步：修改安排"
              onPrimary={() => void publish(true)}
              primaryLabel="确认发布"
              busy={busy}
              disabled={!canEdit}
              hint="核对无误后确认发布，课表才会更新"
            />
          </div>
        )}
        {step === 4 && result && (
          <div className="space-y-5 rounded-xl border bg-card p-5 lg:p-7">
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2Icon className="size-5 text-emerald-600 dark:text-emerald-400" />
                已保存并安排生效
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {result.record.effective_from} 至 {result.record.effective_to}
                ，自动执行新的每周安排。
              </p>
            </div>
            <WeeklyComparison changes={result.changes} />
            <AdjustmentFooter onPrimary={exit} primaryLabel="返回调整记录" />
          </div>
        )}
        <Dialog
          open={leave !== null}
          onOpenChange={(open) => {
            if (!open) setLeave(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {leave === "new"
                  ? "开始一份新的调整？"
                  : leave === "scope"
                    ? "重新选择对象和时间？"
                    : "离开这次调整？"}
              </DialogTitle>
              <DialogDescription>
                {leave === "new"
                  ? "本浏览器每学期保留一份草稿。开始修改新方案后，将替换已有草稿。"
                  : leave === "scope"
                    ? "重新载入课表后需要重新选择修改。当前方案已暂存，可从首页继续。"
                    : "当前方案已暂存到本浏览器，下次可继续调整。"}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLeave(null)}>
                继续编辑
              </Button>
              <Button onClick={leave === "new" ? startNew : leave === "scope" ? changeScope : exit}>
                {leave === "new" ? "开始新调整" : leave === "scope" ? "重新选择" : "暂存并返回"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
