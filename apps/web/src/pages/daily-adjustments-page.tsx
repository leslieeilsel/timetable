import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router"
import { CalendarClock, MoreHorizontal } from "lucide-react"
import { toast } from "sonner"
import { api, apiAllPages } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useResolvedSemesterId } from "@/lib/semester"
import { enumParam, useHashPreservingSearchParams } from "@/lib/url-state"
import {
  clampDate,
  localDate,
  newAdjustment,
  validDate,
  type AdjustmentForm,
} from "@/lib/daily-adjustments"
import type {
  ClassSetting,
  DailyTimetableRow,
  Room,
  ScheduleTemplate,
  Semester,
  Teacher,
  TeachingAssignment,
} from "@/lib/types"
import { AdjustmentPanel } from "@/components/daily-adjustments/adjustment-panel"
import { AdjustmentHistory } from "@/components/daily-adjustments/adjustment-history"
import { AdjustmentSourcePicker } from "@/components/daily-adjustments/source-picker"
import { ErrorState, LoadingState } from "@/components/page"
import {
  AdjustmentPageHeader,
  AdjustmentDraftNotice,
  adjustmentPageClass,
  adjustmentContentClass,
} from "@/components/adjustments/workbench"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Editor = {
  id: number
  source: DailyTimetableRow | null
  form: AdjustmentForm
  published?: boolean
}
function readDraft(key: string): Editor | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null")
    return value?.id && validDate(value.form?.effective_date) ? value : null
  } catch {
    return null
  }
}
function storeDraft(key: string, value: Editor | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value))
    else localStorage.removeItem(key)
    return true
  } catch {
    toast.error("浏览器存储不可用，草稿未保存，请保持页面打开")
    return false
  }
}
function hasChanges(editor: Editor) {
  return Boolean(
    editor.form.reason ||
    editor.form.title ||
    editor.form.related_entry_id ||
    editor.form.replacement_teacher_id ||
    editor.form.replacement_room_id ||
    editor.form.replacement_assignment_id ||
    editor.form.replacement_item_id ||
    (editor.source && editor.form.type !== "swap"),
  )
}

export function DailyAdjustmentsPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const { user } = useAuth()
  const client = useQueryClient()
  const [params, setParams] = useHashPreservingSearchParams()
  const stage = enumParam(params, "step", ["records", "source"], "records")
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState<Editor | null>(null)
  const [editorBusy, setEditorBusy] = useState(false)
  const [closePrompt, setClosePrompt] = useState(false)
  const closeDestination = useRef<"records" | "source">("records")
  const storageKey = `daily-adjustments:${user?.id ?? "guest"}:${semesterId ?? "none"}:draft`
  const onExit = useRef({ editor, storageKey })
  onExit.current = { editor, storageKey }
  useEffect(() => {
    const persist = () => {
      const value = onExit.current
      if (value.editor && !value.editor.published && hasChanges(value.editor))
        storeDraft(value.storageKey, value.editor)
    }
    window.addEventListener("beforeunload", persist)
    return () => {
      persist()
      window.removeEventListener("beforeunload", persist)
    }
  }, [])
  useEffect(() => {
    setDraft(readDraft(storageKey))
    setEditor(null)
    setEditorBusy(false)
    setClosePrompt(false)
  }, [storageKey])
  const semester = useQuery({
    queryKey: ["semester", semesterId],
    queryFn: () => api<Semester>(`/api/v1/semesters/${semesterId}`),
    enabled: semesterId !== null,
  })
  const current = semester.data?.data
  const working = stage === "source" || Boolean(editor)
  const template = useQuery({
    queryKey: ["schedule-template", semesterId],
    queryFn: () => api<ScheduleTemplate>(`/api/v1/semesters/${semesterId}/schedule-template`),
    enabled: semesterId !== null && working,
  })
  const settings = useQuery({
    queryKey: ["class-settings", semesterId, "daily-operations"],
    queryFn: () => apiAllPages<ClassSetting>(`/api/v1/semesters/${semesterId}/class-settings`),
    enabled: semesterId !== null && working,
  })
  const teachers = useQuery({
    queryKey: ["teachers", "all", "daily-operations"],
    queryFn: () => apiAllPages<Teacher>("/api/v1/teachers"),
    enabled: working,
  })
  const rooms = useQuery({
    queryKey: ["rooms", "all", "daily-operations"],
    queryFn: () => apiAllPages<Room>("/api/v1/rooms"),
    enabled: working,
  })
  const assignments = useQuery({
    queryKey: ["teaching-assignments", semesterId, "confirmed", "daily-operations"],
    queryFn: () =>
      apiAllPages<TeachingAssignment>(
        `/api/v1/semesters/${semesterId}/teaching-assignments?status=confirmed`,
      ),
    enabled: semesterId !== null && editor?.form.type === "makeup",
  })
  const canEdit = Boolean(
    current?.status === "open" && (user?.role === "admin" || user?.role === "scheduler"),
  )
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["daily-timetable", semesterId] }),
      client.invalidateQueries({ queryKey: ["calendar-exceptions", semesterId] }),
      client.invalidateQueries({ queryKey: ["adjustment-options", semesterId] }),
      client.invalidateQueries({ queryKey: ["context"] }),
    ])
  }
  const navigate = (next: "records" | "source") =>
    setParams((previous) => {
      const nextParams = new URLSearchParams(previous)
      if (next === "records") nextParams.delete("step")
      else nextParams.set("step", next)
      return nextParams
    })
  const saveDraft = () => {
    if (!editor || editor.published || !storeDraft(storageKey, editor)) return false
    setDraft(editor)
    toast.success("方案已暂存，尚未发布")
    return true
  }
  const clearOwnDraft = () => {
    if (readDraft(storageKey)?.id === editor?.id) {
      if (storeDraft(storageKey, null)) setDraft(null)
    }
  }
  const finishClose = () => {
    setEditor(null)
    setEditorBusy(false)
    setClosePrompt(false)
    navigate(closeDestination.current)
  }
  const close = (destination: "records" | "source" = "records") => {
    if (editorBusy) return
    closeDestination.current = destination
    if (editor && !editor.published && hasChanges(editor)) setClosePrompt(true)
    else finishClose()
  }
  const start = (source: DailyTimetableRow | null, date: string, itemId?: number) => {
    if (!canEdit) return
    setEditor({ id: Date.now(), source, form: newAdjustment(date, source ?? undefined, itemId) })
  }
  if (!semesterId && !context.isLoading) return <p className="p-6">请先选择学期。</p>
  if (semester.isLoading || (!current && !semester.isError)) return <LoadingState />
  if (semester.isError || !current) return <ErrorState retry={() => void semester.refetch()} />
  const resourcesFailed =
    [template, settings, teachers, rooms].some((query) => query.isError) ||
    (editor?.form.type === "makeup" && assignments.isError)
  const resourcesLoading =
    [template, settings, teachers, rooms].some((query) => query.isLoading) ||
    (editor?.form.type === "makeup" && assignments.isLoading)
  return (
    <>
      <div className={adjustmentPageClass}>
        {!working ? (
          <>
            <AdjustmentPageHeader
              title="临时调课"
              description="调整指定日期的课程，查看每次调整的执行情况。"
              onNew={canEdit ? () => navigate("source") : undefined}
            >
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" aria-label="更多调课操作" />}
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!canEdit}
                    onClick={() =>
                      start(null, clampDate(localDate(), current.start_date, current.end_date))
                    }
                  >
                    安排补课
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link to={`/semesters/${semesterId}/leaves`} />}>
                    <CalendarClock />
                    请假与代课
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </AdjustmentPageHeader>
            {!canEdit && <p className="text-sm text-muted-foreground">当前仅可查看调整记录。</p>}
            {draft && canEdit && (
              <AdjustmentDraftNotice
                description={`${draft.source ? `${draft.source.course_name} · ${draft.source.target_name}` : "补课安排"} · ${draft.form.effective_date}`}
                onContinue={() => setEditor(draft)}
                onDelete={() => {
                  if (storeDraft(storageKey, null)) setDraft(null)
                }}
              />
            )}
            <AdjustmentHistory semesterId={semesterId!} canEdit={canEdit} onChanged={refresh} />
          </>
        ) : (
          <>
            {resourcesFailed ? (
              <ErrorState
                retry={() => {
                  void template.refetch()
                  void settings.refetch()
                  void teachers.refetch()
                  void rooms.refetch()
                  if (editor?.form.type === "makeup") void assignments.refetch()
                }}
              />
            ) : resourcesLoading ? (
              <LoadingState />
            ) : editor ? (
              <div className={adjustmentContentClass}>
                <AdjustmentPanel
                  key={editor.id}
                  semester={current}
                  source={editor.source}
                  form={editor.form}
                  onChange={(form) => setEditor({ ...editor, form })}
                  items={template.data?.data.items ?? []}
                  teachers={teachers.data?.data ?? []}
                  rooms={rooms.data?.data ?? []}
                  classes={
                    settings.data?.data
                      .filter((setting) => setting.status === "active")
                      .map((setting) => setting.school_class) ?? []
                  }
                  assignments={assignments.data?.data ?? []}
                  onClose={() => close()}
                  onChangeSource={() => close("source")}
                  onBusyChange={setEditorBusy}
                  onDraft={() => {
                    if (saveDraft()) {
                      closeDestination.current = "records"
                      finishClose()
                    }
                  }}
                  onSaved={async () => {
                    clearOwnDraft()
                    setEditor((value) => (value ? { ...value, published: true } : null))
                    await refresh()
                  }}
                />
              </div>
            ) : (
              <AdjustmentSourcePicker
                semester={current}
                classes={
                  settings.data?.data
                    .filter((setting) => setting.status === "active")
                    .map((setting) => setting.school_class) ?? []
                }
                teachers={teachers.data?.data ?? []}
                rooms={rooms.data?.data ?? []}
                items={template.data?.data.items ?? []}
                onBack={() => close()}
                onSelect={(row) => start(row, row.date)}
                onMakeup={(date, itemId) => start(null, date, itemId)}
                canEdit={canEdit}
              />
            )}
          </>
        )}
      </div>
      <Dialog open={closePrompt} onOpenChange={setClosePrompt}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保留这次未发布的方案？</DialogTitle>
            <DialogDescription>暂存后可以继续处理，老师课表不会改变。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                clearOwnDraft()
                finishClose()
              }}
            >
              放弃方案
            </Button>
            <Button variant="outline" onClick={() => setClosePrompt(false)}>
              继续编辑
            </Button>
            <Button
              onClick={() => {
                if (saveDraft()) finishClose()
              }}
            >
              暂存并返回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
