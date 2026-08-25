import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  LockIcon,
  PlusIcon,
  UnlockIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api, ApiError, apiMessage, jsonBody } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useResolvedSemesterId } from "@/lib/semester"
import type {
  ClassSetting,
  ScheduleDay,
  Item,
  Semester,
  TeachingTask,
  TimetableEntry,
  Room,
} from "@/lib/types"
import { EmptyList, ErrorState, Field, LoadingState, PageHeader } from "@/components/page"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type View = "class" | "teacher" | "room"
interface TimetableData {
  view: View
  resource_id: number | null
  mode: "official" | "full"
  days: ScheduleDay[]
  items: Item[]
  entries: TimetableEntry[]
}
const weekdayName = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"]

export function TimetablePage() {
  const { user } = useAuth()
  const { semesterId, context } = useResolvedSemesterId()
  const client = useQueryClient()
  const [view, setView] = useState<View>("class")
  const [resourceId, setResourceId] = useState("")
  const [full, setFull] = useState(false)
  const [slot, setSlot] = useState<{
    weekday: number
    itemId: number
    entry?: TimetableEntry
  } | null>(null)
  const semester = useQuery({
    queryKey: ["semester", semesterId],
    queryFn: () => api<Semester>(`/api/v1/semesters/${semesterId}`),
    enabled: semesterId !== null,
  })
  const settings = useQuery({
    queryKey: ["class-settings", semesterId],
    queryFn: () => api<ClassSetting[]>(`/api/v1/semesters/${semesterId}/class-settings`),
    enabled: semesterId !== null,
  })
  const tasks = useQuery({
    queryKey: ["teaching-tasks", semesterId, "confirmed"],
    queryFn: () =>
      api<TeachingTask[]>(`/api/v1/semesters/${semesterId}/teaching-tasks?status=confirmed`),
    enabled: semesterId !== null,
  })
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => api<Room[]>("/api/v1/rooms"),
  })
  const resources = useMemo(() => {
    if (view === "class")
      return (settings.data?.data ?? []).map((item) => ({
        id: item.school_class_id,
        name: item.school_class.name,
      }))
    if (view === "teacher")
      return Array.from(
        new Map(
          (tasks.data?.data ?? []).map((task) => [
            task.teacher_id,
            { id: task.teacher_id, name: task.teacher.name },
          ]),
        ).values(),
      )
    return (rooms.data?.data ?? []).map((room) => ({ id: room.id, name: room.name }))
  }, [settings.data, tasks.data, rooms.data, view])
  useEffect(() => {
    setResourceId((current) =>
      resources.some((item) => String(item.id) === current)
        ? current
        : String(resources[0]?.id ?? ""),
    )
  }, [resources])
  const timetable = useQuery({
    queryKey: ["timetable", semesterId, view, resourceId, full],
    queryFn: () =>
      api<TimetableData>(
        `/api/v1/semesters/${semesterId}/timetable?view=${view}&resource_id=${resourceId}&mode=${full ? "full" : "official"}`,
      ),
    enabled: semesterId !== null && Boolean(resourceId),
  })
  const completeness = useQuery({
    queryKey: ["completeness", semesterId],
    queryFn: async () =>
      (
        await api<
          {
            required: number
            scheduled: number
            remaining: number
            completed: boolean
          }[]
        >(`/api/v1/semesters/${semesterId}/timetable/completeness`)
      ).data,
    enabled: semesterId !== null,
  })
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["semester", semesterId] }),
      client.invalidateQueries({ queryKey: ["timetable", semesterId] }),
      client.invalidateQueries({ queryKey: ["teaching-tasks", semesterId] }),
      client.invalidateQueries({ queryKey: ["completeness", semesterId] }),
    ])
  }
  if (!semesterId && !context.isLoading)
    return (
      <>
        <PageHeader title="排课工作台" />
        <EmptyList title="尚未设置当前学期" description="请先设置当前开放学期。" />
      </>
    )
  if (semester.isLoading || settings.isLoading || tasks.isLoading || rooms.isLoading)
    return <LoadingState />
  if (semester.isError || !semester.data)
    return <ErrorState retry={() => void semester.refetch()} />
  const current = semester.data.data
  const canEdit = user?.role !== "viewer" && current.status === "open"
  const remaining = completeness.data?.reduce((sum, item) => sum + item.remaining, 0) ?? 0
  const scheduled = completeness.data?.reduce((sum, item) => sum + item.scheduled, 0) ?? 0
  const required = completeness.data?.reduce((sum, item) => sum + item.required, 0) ?? 0
  const resourceIndex = resources.findIndex((item) => String(item.id) === resourceId)
  const moveResource = (direction: -1 | 1) => {
    const next = resources[resourceIndex + direction]
    if (next) setResourceId(String(next.id))
  }
  const exportUrl = `/api/v1/semesters/${semesterId}/timetable/export.csv?view=${view}&resource_id=${resourceId}&mode=${full ? "full" : "official"}`

  return (
    <>
      <PageHeader
        title={`${current.academic_year ? `${current.academic_year.name} · ` : ""}${current.name}课表`}
        description="二维网格只用于真实排课；切换班级、教师和教室可从不同角度检查结果。"
      />
      <div className="p-4 md:p-7">
        <div className="mb-5 flex flex-col gap-3 border-b pb-5 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={view} onValueChange={(value) => setView(value as View)}>
              <TabsList>
                <TabsTrigger value="class">班级</TabsTrigger>
                <TabsTrigger value="teacher">教师</TabsTrigger>
                <TabsTrigger value="room">教室</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              variant="outline"
              size="icon"
              aria-label="上一个资源"
              disabled={resourceIndex <= 0}
              onClick={() => moveResource(-1)}
            >
              <ChevronLeftIcon />
            </Button>
            <select
              className="h-11 min-w-64 rounded-lg border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
              value={resourceId}
              aria-label={`选择${view === "class" ? "班级" : view === "teacher" ? "教师" : "教室"}`}
              onChange={(event) => setResourceId(event.target.value)}
            >
              {resources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon"
              aria-label="下一个资源"
              disabled={resourceIndex < 0 || resourceIndex >= resources.length - 1}
              onClick={() => moveResource(1)}
            >
              <ChevronRightIcon />
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={full} onCheckedChange={(checked) => setFull(Boolean(checked))} />
              完整作息
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={exportUrl} download />}
              disabled={!resourceId}
            >
              <DownloadIcon />
              导出 CSV
            </Button>
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            <span className="font-medium text-emerald-600">
              已排 {scheduled}/{required}
            </span>
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            <span className="text-muted-foreground">未排 {remaining}</span>
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            <span className="font-medium text-emerald-600">冲突 0</span>
          </div>
        </div>
        {!resourceId ? (
          <div className="overflow-hidden rounded-2xl border bg-background">
            <EmptyList title="没有可查看的资源" description="请先配置班级、教学任务或教室。" />
          </div>
        ) : timetable.isLoading ? (
          <LoadingState />
        ) : timetable.isError || !timetable.data ? (
          <ErrorState retry={() => void timetable.refetch()} />
        ) : (
          <>
            <TimetableGrid data={timetable.data.data} editable={canEdit} onSlot={setSlot} />
            <p className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <LockIcon className="size-4" /> 已锁定课程不会被移动
              </span>
              <span className="h-4 w-px bg-border" aria-hidden="true" />
              <span>点击课程查看详情，点击空白课节安排课程</span>
            </p>
          </>
        )}
      </div>
      <SlotDialog
        slot={slot}
        semesterId={current.id}
        etag={timetable.data?.etag ?? null}
        tasks={tasks.data?.data ?? []}
        items={timetable.data?.data.items ?? []}
        days={timetable.data?.data.days ?? []}
        view={view}
        resourceId={Number(resourceId)}
        readOnly={!canEdit}
        onClose={() => setSlot(null)}
        onSaved={refresh}
      />
    </>
  )
}

function TimetableGrid({
  data,
  editable,
  onSlot,
}: {
  data: TimetableData
  editable: boolean
  onSlot: (slot: { weekday: number; itemId: number; entry?: TimetableEntry }) => void
}) {
  return (
    <div className="overflow-auto rounded-xl border bg-background">
      <table className="w-full min-w-[920px] border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className="sticky left-0 z-10 w-32 border-r border-b bg-muted/80 p-3 text-center font-medium">
              课节
            </th>
            {data.days.map((day) => (
              <th key={day.weekday} className="min-w-40 border-b p-3 text-center font-medium">
                {weekdayName[day.weekday]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.id}>
              <th className="sticky left-0 z-10 border-r border-b bg-background p-3 text-center align-middle">
                <p className="font-medium">{item.name}</p>
                <p className="mt-1 text-xs font-normal text-muted-foreground">
                  {item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}
                </p>
              </th>
              {data.days.map((day) => {
                const entry = data.entries.find(
                  (item) => item.weekday === day.weekday && item.item_id === item.id,
                )
                return (
                  <td
                    key={day.weekday}
                    className="h-24 border-r border-b p-1.5 align-top last:border-r-0"
                  >
                    {entry ? (
                      <button
                        type="button"
                        className={`h-full w-full rounded-lg border p-2 text-left transition hover:border-primary/30 ${courseTone(entry.course.name)}`}
                        onClick={() => onSlot({ weekday: day.weekday, itemId: item.id, entry })}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="font-medium">{entry.course.name}</span>
                          {entry.is_locked && <LockIcon className="size-3 text-muted-foreground" />}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {entry.teacher.name} · {entry.actual_room.name}
                        </p>
                      </button>
                    ) : editable && item.allows_course ? (
                      <button
                        type="button"
                        aria-label={`${weekdayName[day.weekday]}${item.name}添加课程`}
                        className="flex h-full min-h-20 w-full items-center justify-center rounded-xl border border-dashed text-muted-foreground opacity-0 transition hover:bg-muted hover:opacity-100 focus:opacity-100"
                        onClick={() => onSlot({ weekday: day.weekday, itemId: item.id })}
                      >
                        <PlusIcon className="size-4" />
                      </button>
                    ) : null}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function courseTone(course: string) {
  const tones = [
    "border-blue-100 bg-blue-50/80",
    "border-emerald-100 bg-emerald-50/80",
    "border-amber-100 bg-amber-50/80",
    "border-violet-100 bg-violet-50/80",
    "border-rose-100 bg-rose-50/80",
    "border-cyan-100 bg-cyan-50/80",
  ]
  const index = Array.from(course).reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return tones[index % tones.length]
}

function SlotDialog({
  slot,
  semesterId,
  etag,
  tasks,
  items,
  days,
  view,
  resourceId,
  readOnly,
  onClose,
  onSaved,
}: {
  slot: { weekday: number; itemId: number; entry?: TimetableEntry } | null
  semesterId: number
  etag: string | null
  tasks: TeachingTask[]
  items: Item[]
  days: ScheduleDay[]
  view: View
  resourceId: number
  readOnly: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [taskId, setTaskId] = useState("")
  const [weekday, setWeekday] = useState(1)
  const [itemId, setItemId] = useState(0)
  const entry = slot?.entry
  const candidates = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status === "confirmed" &&
          (task.remaining ?? 1) > 0 &&
          (view === "class"
            ? task.school_class_id === resourceId
            : view === "teacher"
              ? task.teacher_id === resourceId
              : true),
      ),
    [resourceId, tasks, view],
  )
  useEffect(() => {
    if (slot) {
      setTaskId(String(candidates[0]?.id ?? ""))
      setWeekday(slot.weekday)
      setItemId(slot.itemId)
    }
  }, [candidates, slot])
  const mutate = async (action: "save" | "delete" | "lock") => {
    if (!etag || !slot) return
    try {
      if (action === "delete" && entry)
        await api(`/api/v1/semesters/${semesterId}/timetable/entries/${entry.id}`, {
          method: "DELETE",
          etag,
        })
      else if (action === "lock" && entry)
        await api(`/api/v1/semesters/${semesterId}/timetable/entries/${entry.id}/lock`, {
          method: entry.is_locked ? "DELETE" : "PUT",
          etag,
        })
      else if (entry)
        await api(`/api/v1/semesters/${semesterId}/timetable/entries/${entry.id}`, {
          method: "PATCH",
          etag,
          body: jsonBody({ weekday, item_id: itemId }),
        })
      else
        await api(`/api/v1/semesters/${semesterId}/timetable/entries`, {
          method: "POST",
          etag,
          body: jsonBody({
            teaching_task_id: Number(taskId),
            weekday,
            item_id: itemId,
          }),
        })
      toast.success(
        action === "delete" ? "课程已移除" : action === "lock" ? "锁定状态已更新" : "课程已保存",
      )
      onClose()
      await onSaved()
    } catch (error) {
      if (error instanceof ApiError && Array.isArray(error.details.conflicts)) {
        const names = (error.details.conflicts as { resource_name?: string }[])
          .map((conflict) => conflict.resource_name)
          .filter(Boolean)
          .join("、")
        toast.error(names ? `该课节与 ${names} 冲突` : error.message)
      } else toast.error(apiMessage(error))
    }
  }
  return (
    <Dialog open={slot !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? "课程详情" : "安排课程"}</DialogTitle>
          <DialogDescription>
            {entry
              ? readOnly
                ? "只读查看课程详情。"
                : "可移动、锁定或移除这节课。锁定后必须先解锁才能移动。"
              : `${weekdayName[slot?.weekday ?? 0]} · ${items.find((item) => item.id === slot?.itemId)?.name ?? ""}`}
          </DialogDescription>
        </DialogHeader>
        {entry ? (
          <div className="rounded-2xl bg-muted/50 p-4">
            <p className="font-medium">
              {entry.school_class.name} · {entry.course.name}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {entry.teacher.name} · {entry.actual_room.name}
            </p>
          </div>
        ) : (
          <Field label="教学任务">
            <select
              className="h-9 rounded-2xl bg-input/50 px-3 text-sm"
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
            >
              {candidates.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.school_class.name} · {task.course.name} · {task.teacher.name}（余{" "}
                  {task.remaining ?? task.weekly_items}）
                </option>
              ))}
            </select>
          </Field>
        )}
        {entry && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="星期">
              <select
                className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
                value={weekday}
                disabled={readOnly}
                onChange={(event) => setWeekday(Number(event.target.value))}
              >
                {days.map((day) => (
                  <option key={day.weekday} value={day.weekday}>
                    {weekdayName[day.weekday]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="课节">
              <select
                className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
                value={itemId}
                disabled={readOnly}
                onChange={(event) => setItemId(Number(event.target.value))}
              >
                {items
                  .filter((item) => item.allows_course)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
        )}
        <DialogFooter>
          {entry ? (
            <>
              <Button
                variant="destructive"
                disabled={readOnly || entry.is_locked}
                onClick={() => void mutate("delete")}
              >
                移除
              </Button>
              <Button variant="outline" disabled={readOnly} onClick={() => void mutate("lock")}>
                {entry.is_locked ? <UnlockIcon /> : <LockIcon />}
                {entry.is_locked ? "解锁" : "锁定"}
              </Button>
              <Button disabled={readOnly || entry.is_locked} onClick={() => void mutate("save")}>
                保存位置
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button disabled={readOnly || !taskId} onClick={() => void mutate("save")}>
                安排课程
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
