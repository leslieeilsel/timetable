import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Bell, CheckCircle2, LoaderCircle, Search } from "lucide-react"
import { api, apiMessage, ApiError } from "@/lib/api"
import {
  adjustmentLabels,
  adjustmentPayload,
  adjustmentReady,
  dateLabel,
  shortTime,
  type AdjustmentForm,
} from "@/lib/daily-adjustments"
import type {
  AdjustmentOption,
  CalendarException,
  CalendarExceptionPreview,
  DailyTimetableRow,
  DailyTimetable,
  Item,
  Room,
  SchoolClass,
  Semester,
  Teacher,
  TimetableChange,
} from "@/lib/types"
import { DatePicker } from "@/components/date-picker"
import { ClassPicker, RoomPicker, TeacherPicker } from "@/components/resource-picker"
import { Field } from "@/components/page"
import { SimpleSelect } from "@/components/simple-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { AdjustmentComparison } from "./comparison"
import {
  AdjustmentStepHeader,
  AdjustmentFooter,
  AdjustmentSourceSummary,
  AdjustmentActionTabs,
  AdjustmentComparisonItem,
  AdjustmentEditorLayout,
  AdjustmentTargetSection,
  AdjustmentCourseChoices,
} from "@/components/adjustments/workbench"

export function AdjustmentPanel({
  semester,
  source,
  form,
  onChange,
  items,
  teachers,
  rooms,
  classes,
  onClose,
  onDraft,
  onSaved,
  onChangeSource,
  onBusyChange,
}: {
  semester: Semester
  source: DailyTimetableRow
  form: AdjustmentForm
  onChange: (form: AdjustmentForm) => void
  items: Item[]
  teachers: Teacher[]
  rooms: Room[]
  classes: SchoolClass[]
  onClose: () => void
  onDraft: () => void
  onSaved: (result: CalendarException) => Promise<void>
  onBusyChange: (busy: boolean) => void
  onChangeSource: () => void
}) {
  const [target, setTarget] = useState<DailyTimetableRow | null>(null)
  const [preview, setPreview] = useState<CalendarExceptionPreview | null>(null)
  const [etag, setEtag] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<CalendarException | null>(null)
  const [targetDate, setTargetDate] = useState(form.replacement_date)
  const [targetClass, setTargetClass] = useState(String(source?.class_ids[0] ?? ""))
  const [targetItem, setTargetItem] = useState("")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [optionPage, setOptionPage] = useState(1)
  const inFlight = useRef(false)
  const fingerprint = JSON.stringify({ ...adjustmentPayload(form), notify_teachers: undefined })
  useEffect(() => {
    setPreview(null)
    setEtag(null)
    setError("")
  }, [fingerprint])
  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])
  useEffect(() => {
    setOptionPage(1)
  }, [debouncedSearch, targetClass, targetDate, targetItem, form.type])
  const candidateType = ["swap", "move"].includes(form.type)
  const options = useQuery({
    queryKey: [
      "adjustment-options",
      semester.id,
      source?.original_entry_id,
      form.effective_date,
      form.type,
      targetDate,
      targetItem,
      targetClass,
      debouncedSearch,
      optionPage,
    ],
    queryFn: () =>
      api<AdjustmentOption[]>(
        `/api/v1/semesters/${semester.id}/calendar-exceptions/options?${new URLSearchParams({ type: form.type, effective_date: form.effective_date, original_entry_id: form.original_entry_id, from: targetDate, to: targetDate, scope: "school", ...(targetClass ? { target_class_id: targetClass } : {}), q: form.type === "swap" ? debouncedSearch : "", page: String(optionPage), per_page: "60", ...(form.type === "swap" && targetItem && targetItem !== "all" ? { target_item_id: targetItem } : {}) })}`,
      ),
    enabled:
      form.type === "swap" &&
      Boolean(targetClass) &&
      Boolean(targetItem) &&
      Boolean(source) &&
      !preview &&
      !result,
    retry: false,
    staleTime: 15_000,
  })
  const savedTarget = useQuery({
    queryKey: ["daily-timetable", semester.id, form.replacement_date],
    queryFn: () =>
      api<DailyTimetable>(
        `/api/v1/semesters/${semester.id}/daily-timetable?date=${form.replacement_date}`,
      ),
    enabled: form.type === "swap" && Boolean(form.related_entry_id) && !target && !result,
    staleTime: 15_000,
  })
  const allOptions = options.data?.data ?? []
  const pagination = options.data?.meta?.pagination as
    | { page: number; last_page: number; total: number }
    | undefined
  const update = (changes: Partial<AdjustmentForm>) => {
    onChange({ ...form, ...changes })
    setPreview(null)
    setEtag(null)
    setError("")
  }
  const choose = (option: AdjustmentOption) => {
    const fields = Object.fromEntries(
      Object.entries(option.payload)
        .filter(([key]) => !["type", "reason", "effective_date", "original_entry_id"].includes(key))
        .map(([key, value]) => [key, String(value)]),
    )
    update(fields)
    setTarget(option.row ?? null)
  }
  const changeTargetDate = (date: string) => {
    setTargetDate(date)
    setTarget(null)
    update({ replacement_date: date, related_entry_id: "", replacement_item_id: "" })
  }
  const selectedOption = (option: AdjustmentOption) =>
    form.type === "swap"
      ? Number(form.related_entry_id) === option.row?.original_entry_id &&
        form.replacement_date === option.date
      : form.type === "move"
        ? Number(form.replacement_item_id) === option.item?.id &&
          form.replacement_date === option.date
        : Number(form.replacement_teacher_id) === option.teacher?.id
  const check = async () => {
    if (!adjustmentReady(form) || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError("")
    try {
      const checked = await api<CalendarExceptionPreview>(
        `/api/v1/semesters/${semester.id}/calendar-exceptions/preview`,
        { method: "POST", body: JSON.stringify(adjustmentPayload(form)) },
      )
      setPreview(checked.data)
      setEtag(checked.etag)
    } catch (caught) {
      setError(apiMessage(caught))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const publish = async () => {
    if (!preview?.allowed || !etag || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError("")
    try {
      const saved = await api<CalendarException>(
        `/api/v1/semesters/${semester.id}/calendar-exceptions`,
        { method: "POST", etag, body: JSON.stringify(adjustmentPayload(form)) },
      )
      setResult(saved.data)
      await onSaved(saved.data)
    } catch (caught) {
      setError(
        caught instanceof ApiError && [409, 412].includes(caught.status)
          ? `${apiMessage(caught)}。你的选择已保留，请重新检查后发布。`
          : apiMessage(caught),
      )
      setPreview(null)
      setEtag(null)
      void options.refetch()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    if (source?.exception_id || source?.substitution_id || source?.is_cancelled)
      setError("这节课已有调整。请在调整记录中查看并撤回原调整，或在请假与代课中处理代课安排。")
  }, [source])
  const blockedSource = Boolean(
    source &&
    (source.exception_id ||
      source.substitution_id ||
      source.is_cancelled ||
      !source.original_entry_id),
  )
  const hasSelection = Boolean(
    form.type === "swap"
      ? form.related_entry_id
      : form.type === "move"
        ? form.replacement_item_id
        : form.type === "teacher_change"
          ? form.replacement_teacher_id
          : "",
  )
  const selectedRow =
    target ??
    savedTarget.data?.data.rows.find(
      (row) => row.original_entry_id === Number(form.related_entry_id),
    ) ??
    allOptions.find(selectedOption)?.row
  useEffect(() => {
    if (form.type !== "swap" || !form.related_entry_id || !selectedRow) return
    if (!targetItem) setTargetItem(String(selectedRow.item_id))
    if (!selectedRow.class_ids.includes(Number(targetClass)))
      setTargetClass(String(selectedRow.class_ids[0] ?? ""))
  }, [form.type, form.related_entry_id, selectedRow, targetItem, targetClass])
  const selectionLabel =
    form.type === "swap"
      ? `${dateLabel(form.replacement_date)} ${selectedRow?.item_name ?? ""} ${selectedRow?.course_name ?? "已选交换课"}`
      : form.type === "move"
        ? `${dateLabel(form.replacement_date)} ${items.find((item) => String(item.id) === form.replacement_item_id)?.name ?? ""}`
        : teachers.find((teacher) => String(teacher.id) === form.replacement_teacher_id)?.name
  const changeAction = (type: AdjustmentForm["type"]) => {
    if (form.type === type) return
    update({
      type,
      related_entry_id: "",
      replacement_teacher_id: "",
      replacement_room_id: "",
      replacement_item_id: "",
      replacement_date: form.effective_date,
    })
    setTarget(null)
    setSearch("")
    setDebouncedSearch("")
    setTargetItem("")
    setOptionPage(1)
    setTargetDate(form.effective_date)
  }
  const sourceSummary = source ? (
    <AdjustmentSourceSummary
      title={source.course_name}
      subtitle={source.target_name}
      date={dateLabel(source.date)}
      time={`${source.item_name} · ${shortTime(source.start_time)}–${shortTime(source.end_time)}`}
      teachers={source.teacher_names.join("、")}
      room={source.room_name}
      detail={
        source.class_names.length > 1
          ? `合班课程，${source.class_names.join("、")}一起调整。`
          : undefined
      }
      onReselect={onChangeSource}
    />
  ) : undefined
  const footer = (
    <AdjustmentFooter
      onBack={
        result
          ? undefined
          : preview
            ? () => {
                setPreview(null)
                setEtag(null)
              }
            : source
              ? onChangeSource
              : onClose
      }
      backLabel={preview ? "上一步：修改安排" : "上一步：选择课程"}
      onDraft={!result && !preview ? onDraft : undefined}
      onPrimary={result ? onClose : preview ? () => void publish() : () => void check()}
      primaryLabel={result ? "返回调整记录" : preview ? "确认发布" : "下一步：核对"}
      busy={busy}
      disabled={
        result
          ? false
          : preview
            ? !preview.allowed
            : Boolean(blockedSource) || !adjustmentReady(form)
      }
      hint={
        result
          ? undefined
          : preview
            ? preview.allowed
              ? "核对无误后确认发布，课表才会更新"
              : "存在冲突，请返回修改安排"
            : form.type === "swap" && !form.related_entry_id
              ? targetItem
                ? "请选择要互换的目标课程"
                : "请选择目标日期和课节"
              : form.type === "move" && !form.replacement_item_id
                ? "请选择新的上课课节"
                : form.type === "teacher_change" && !form.replacement_teacher_id
                  ? "请选择新的主讲老师"
                  : form.type === "room_change" && !form.replacement_room_id
                    ? "请选择新的教室"
                    : form.reason.trim().length < 2
                      ? "请填写调整原因（至少 2 字）"
                      : "下一步检查冲突并核对调整结果"
      }
    />
  )
  return (
    <div className="space-y-6" aria-label="临时调整操作面板">
      <AdjustmentStepHeader
        step={result ? 4 : preview ? 3 : 2}
        description={`临时调课 · ${dateLabel(form.effective_date)}，仅作用于指定日期。`}
        onBack={!result ? onClose : undefined}
        busy={busy}
      />
      <AdjustmentEditorLayout
        source={!result && !preview ? sourceSummary : undefined}
        footer={footer}
        busy={busy}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-6">
          {result ? (
            <>
              <div className="rounded-xl border border-[var(--timetable-success-border)] bg-[var(--timetable-success-background)] p-4">
                <CheckCircle2 className="mb-2 size-7 text-[var(--timetable-success-accent)]" />
                <p className="font-medium">{preview?.changes.length ?? 1} 节课程调整已生效</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  仅作用于本次指定日期。老师课表会按新安排显示。
                </p>
              </div>
              {preview && <ChangesReview changes={preview.changes} />}
              <div className="rounded-lg border p-3 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <Bell className="size-4" />
                  站内消息
                </div>
                {result.messages?.length ? (
                  result.messages.map((message) => (
                    <div key={message.id} className="flex items-center justify-between py-1">
                      <span>{message.name}</span>
                      <span className="text-xs text-muted-foreground">
                        已生成 · {message.read_at ? "已查看" : "未查看"}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">本次未发送站内消息，实际课表已更新。</p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  “已查看”仅在老师打开消息详情后记录，可在调整记录中刷新查看。
                </p>
              </div>
            </>
          ) : preview ? (
            <>
              <div
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  preview.allowed
                    ? ["cancel", "activity"].includes(form.type)
                      ? "border-[var(--timetable-amber-border)] bg-[var(--timetable-amber-background)]"
                      : "border-[var(--timetable-success-border)] bg-[var(--timetable-success-background)]"
                    : "border-[var(--timetable-rose-border)] bg-[var(--timetable-rose-background)]",
                )}
              >
                <p className="font-medium">
                  {preview.allowed
                    ? ["cancel", "activity"].includes(form.type)
                      ? "将停上原课程，请确认学生安排"
                      : "班级、教师、教室及请假检查通过"
                    : "暂不能发布，请处理以下冲突"}
                </p>
                {preview.allowed && ["cancel", "activity"].includes(form.type) && (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {form.type === "activity"
                      ? "活动仅作为标记。下方教师与教室来自原课，不表示已安排看班老师或预留活动教室。"
                      : "原时段将空出，不会自动安排自习或看班老师。"}
                  </p>
                )}
                {preview.conflicts.map((conflict, index) => (
                  <p key={index} className="mt-2">
                    {conflict.message}
                  </p>
                ))}
              </div>
              <ChangesReview changes={preview.changes} />
              <div className="space-y-2 border-t pt-3 text-sm">
                <p className="font-medium">调整原因</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{form.reason}</p>
              </div>
              <div className="space-y-2 border-t pt-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={form.notify_teachers}
                    disabled={busy}
                    onChange={(event) =>
                      onChange({ ...form, notify_teachers: event.target.checked })
                    }
                  />
                  向涉及老师发送站内变更消息
                </label>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {preview.recipients.map((teacher) => teacher.name).join("、") || "没有教师接收人"}{" "}
                  · 共 {preview.recipients.length} 位。
                </p>
              </div>
            </>
          ) : (
            <>
              {source && !blockedSource && (
                <AdjustmentActionTabs
                  value={form.type}
                  onChange={(value) => changeAction(value as AdjustmentForm["type"])}
                  options={[
                    { value: "swap", label: "换课" },
                    { value: "move", label: "改时间" },
                    { value: "teacher_change", label: "换老师" },
                    { value: "room_change", label: "换教室" },
                  ]}
                  more={[
                    { value: "cancel", label: adjustmentLabels.cancel },
                    { value: "activity", label: adjustmentLabels.activity },
                  ]}
                />
              )}
              {!blockedSource && (
                <>
                  <AdjustmentTargetSection
                    title={
                      form.type === "swap"
                        ? "与哪节课互换？"
                        : form.type === "move"
                          ? "改到什么时间？"
                          : form.type === "teacher_change"
                            ? "换成哪位老师？"
                            : form.type === "room_change"
                              ? "换到哪个教室？"
                              : form.type === "activity"
                                ? "填写活动安排"
                                : "确认本次停课"
                    }
                    description={form.type === "swap" ? "指定日期、课节和班级即可。" : undefined}
                    action={
                      source && !["cancel", "activity"].includes(form.type) ? (
                        <AdjustmentComparison
                          semester={semester}
                          source={source}
                          target={selectedRow ?? null}
                          items={items}
                        />
                      ) : undefined
                    }
                  >
                    {form.type === "room_change" && (
                      <Field label="新的上课教室">
                        <RoomPicker
                          className="[&>button]:h-10"
                          rooms={rooms}
                          disabledReasons={
                            source ? { [source.room_id]: "当前教室，请选择其他教室" } : undefined
                          }
                          value={form.replacement_room_id}
                          onValueChange={(value) => update({ replacement_room_id: value })}
                          contextDescription="选择目标教室后，预览会检查该课节的实际占用。"
                        />
                      </Field>
                    )}
                    {form.type === "teacher_change" && source && (
                      <Field label="新的主讲老师">
                        <TeacherPicker
                          className="[&>button]:h-10"
                          teachers={teachers}
                          value={form.replacement_teacher_id}
                          onValueChange={(value) => update({ replacement_teacher_id: value })}
                          courseId={source.course_id}
                          requireQualification
                          disabledReasons={{ [source.primary_teacher_id]: "与原主讲老师相同" }}
                        />
                        <p className="mt-2 text-xs text-muted-foreground">
                          上课时间和教室保持不变，下一步检查老师是否有课或请假。
                        </p>
                      </Field>
                    )}
                    {source && candidateType && (
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr]">
                          <Field label="日期">
                            <DatePicker
                              label="目标日期"
                              required
                              value={targetDate}
                              min={semester.start_date}
                              max={semester.end_date}
                              onValueChange={changeTargetDate}
                              className="h-10 w-full data-[size=default]:h-10"
                            />
                          </Field>
                          <Field label="课节">
                            {form.type === "swap" ? (
                              <SimpleSelect
                                label="目标课节"
                                value={targetItem}
                                onValueChange={(value) => {
                                  setTargetItem(value)
                                  setTarget(null)
                                  update({ related_entry_id: "" })
                                }}
                                className="h-10 w-full data-[size=default]:h-10"
                              >
                                <option value="">请选择目标课节</option>
                                <option value="all">查看当天全部课节</option>
                                {items
                                  .filter((item) => item.is_active && item.allows_course)
                                  .map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name} · {shortTime(item.start_time)}
                                    </option>
                                  ))}
                              </SimpleSelect>
                            ) : (
                              <SimpleSelect
                                label="新的上课课节"
                                value={form.replacement_item_id}
                                onValueChange={(value) =>
                                  update({
                                    replacement_item_id: value,
                                    replacement_date: targetDate,
                                  })
                                }
                                className="h-10 w-full data-[size=default]:h-10"
                              >
                                <option value="">请选择课节</option>
                                {items
                                  .filter((item) => item.is_active && item.allows_course)
                                  .map((item) => (
                                    <option
                                      key={item.id}
                                      value={item.id}
                                      disabled={
                                        targetDate === source.date && item.id === source.item_id
                                      }
                                    >
                                      {item.name} · {shortTime(item.start_time)}
                                      {targetDate === source.date && item.id === source.item_id
                                        ? "（原课节）"
                                        : ""}
                                    </option>
                                  ))}
                              </SimpleSelect>
                            )}
                          </Field>
                          {form.type === "swap" && (
                            <Field label="班级">
                              <ClassPicker
                                className="[&>button]:h-10"
                                classes={classes}
                                value={targetClass}
                                onValueChange={(value) => {
                                  setTargetClass(value)
                                  setTarget(null)
                                  setSearch("")
                                  setDebouncedSearch("")
                                  update({ related_entry_id: "" })
                                }}
                              />
                            </Field>
                          )}
                        </div>
                        {form.type === "swap" &&
                          targetItem &&
                          (targetItem === "all" || search || (pagination?.total ?? 0) > 1) && (
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                              <Input
                                aria-label="搜索目标课程"
                                placeholder="按老师、课程或班级查找（可选）"
                                className="pl-9"
                                maxLength={100}
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                              />
                            </div>
                          )}
                        {form.type === "move" ? (
                          <p className="text-xs text-muted-foreground">
                            选好新课节后，下一步检查班级、老师和教室是否冲突。
                          </p>
                        ) : !targetItem || !targetClass ? (
                          <p className="rounded-lg bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                            请选择日期、课节和班级。
                          </p>
                        ) : options.isFetching ? (
                          <p
                            role="status"
                            className="flex items-center gap-2 py-3 text-sm text-muted-foreground"
                          >
                            <LoaderCircle className="size-4 animate-spin" />
                            正在读取当天课程…
                          </p>
                        ) : options.isError ? (
                          <div role="alert" className="text-sm text-destructive">
                            {apiMessage(options.error)}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void options.refetch()}
                            >
                              重新加载
                            </Button>
                          </div>
                        ) : form.type === "swap" ? (
                          <>
                            {allOptions.length > 1 && (
                              <p className="text-xs text-muted-foreground">
                                共 {pagination?.total ?? allOptions.length}{" "}
                                节匹配课程，选择要互换的那一节。
                              </p>
                            )}
                            <AdjustmentCourseChoices
                              choices={allOptions.flatMap((option) =>
                                option.row
                                  ? [
                                      {
                                        key: option.key,
                                        period: option.row.item_name,
                                        time: shortTime(option.row.start_time),
                                        title: `${option.row.course_name} · ${option.row.target_name}`,
                                        teachers: option.row.teacher_names.join("、"),
                                        room: option.row.room_name,
                                        selected: selectedOption(option),
                                        problem: option.allowed
                                          ? undefined
                                          : option.conflicts
                                              .map((conflict) => conflict.message)
                                              .join(" ") || "当前课程不可交换",
                                      },
                                    ]
                                  : [],
                              )}
                              onSelect={(key) => {
                                const option = allOptions.find((item) => item.key === key)
                                if (option?.allowed) choose(option)
                              }}
                            />
                            {pagination && pagination.last_page > 1 && (
                              <div className="flex items-center justify-end gap-2 text-xs">
                                <span>
                                  {pagination.page} / {pagination.last_page} 页
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={pagination.page <= 1}
                                  onClick={() => setOptionPage(pagination.page - 1)}
                                >
                                  上一页课程
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={pagination.page >= pagination.last_page}
                                  onClick={() => setOptionPage(pagination.page + 1)}
                                >
                                  下一页课程
                                </Button>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">选好目标后继续核对。</p>
                        )}
                      </div>
                    )}
                    {form.type === "activity" && (
                      <Field label="活动名称（必填）">
                        <Input
                          maxLength={120}
                          value={form.title}
                          onChange={(event) => update({ title: event.target.value })}
                          placeholder="如：年级主题活动"
                        />
                      </Field>
                    )}
                    {["move", "cancel", "activity"].includes(form.type) && (
                      <p className="rounded-lg border border-[var(--timetable-amber-border)] bg-[var(--timetable-amber-background)] p-3 text-xs leading-relaxed">
                        {form.type === "activity"
                          ? "活动会停掉原课程并标记活动名称，不会自动安排看班老师或占用教室。"
                          : "原时段将空出，不会自动安排自习或看班老师。请在发布前确认学生安排。"}
                      </p>
                    )}
                  </AdjustmentTargetSection>
                  {source &&
                    (hasSelection ||
                      form.replacement_room_id ||
                      ["cancel", "activity"].includes(form.type)) && (
                      <p aria-label="本次调整摘要" className="text-sm leading-relaxed">
                        {form.type === "swap" && selectedRow
                          ? `${source.course_name}调至${dateLabel(form.replacement_date)}${selectedRow.item_name}，${selectedRow.course_name}调至${dateLabel(source.date)}${source.item_name}。`
                          : form.type === "move"
                            ? `${source.course_name}调至${selectionLabel}，老师和教室不变。`
                            : form.type === "teacher_change"
                              ? `主讲老师改为${selectionLabel}，上课时间和教室不变。`
                              : form.type === "room_change"
                                ? `教室改为${rooms.find((room) => String(room.id) === form.replacement_room_id)?.name ?? "已选教室"}，上课时间和老师不变。`
                                : form.type === "cancel"
                                  ? "本次停课，原时段空出。"
                                  : `原时段标记为${form.title || "活动"}。`}
                      </p>
                    )}

                  <div className="space-y-2 border-t pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="adjustment-reason" className="text-sm font-medium">
                        调整原因 <span className="font-normal text-muted-foreground">（必填）</span>
                      </label>
                    </div>
                    <textarea
                      id="adjustment-reason"
                      aria-label="调整原因"
                      rows={1}
                      minLength={2}
                      maxLength={1000}
                      className="min-h-10 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={form.reason}
                      onChange={(event) => update({ reason: event.target.value })}
                      placeholder="说明本次调整的原因（至少 2 字）"
                    />
                  </div>
                </>
              )}
            </>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-[var(--timetable-rose-border)] bg-[var(--timetable-rose-background)] p-3 text-sm"
            >
              {error}
            </div>
          )}
        </fieldset>
      </AdjustmentEditorLayout>
    </div>
  )
}

export function ChangesReview({ changes }: { changes: TimetableChange[] }) {
  return (
    <div className="space-y-3" aria-label="调整前后对照">
      {changes.map((change, index) => (
        <AdjustmentComparisonItem
          key={index}
          title={`${change.before?.course_name ?? change.after?.course_name} · ${change.before?.target_name ?? change.after?.target_name}`}
          before={<ChangeSide row={change.before} label="原安排" />}
          after={<ChangeSide row={change.after} label="新安排" />}
        />
      ))}
    </div>
  )
}

function ChangeSide({ row, label }: { row: DailyTimetableRow | null; label: string }) {
  return (
    <div className="text-sm">
      {row ? (
        <>
          <p className="mt-1 font-medium">
            {row.date} · {row.item_name}
          </p>
          <p className="mt-1 text-xs">
            {shortTime(row.start_time)}–{shortTime(row.end_time)} · {row.title ?? row.course_name}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {row.teacher_names.join("、")} · {row.room_name}
          </p>
          {row.class_names.length > 1 && (
            <p className="mt-1 text-xs text-muted-foreground">{row.class_names.join("、")}</p>
          )}
          {row.is_cancelled && <p className="mt-1 text-xs text-muted-foreground">原课程停上</p>}
        </>
      ) : (
        <p className="mt-1 text-muted-foreground">
          {label === "原安排" ? "无课程安排" : "停课，原时段空出"}
        </p>
      )}
    </div>
  )
}
