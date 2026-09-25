import { useState, type ReactNode } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { Link, Navigate } from "react-router"
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "lucide-react"
import { api, apiAllPages, apiMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { semesterPath, useResolvedSemesterId } from "@/lib/semester"
import { useSchoolToday } from "@/lib/semester-phase"
import { enumParam, mergeSearchParams, useHashPreservingSearchParams } from "@/lib/url-state"
import {
  addDays,
  clampDate,
  dailyStatusLabels,
  dateLabel,
  matchesObject,
  validDate,
  weekDates,
} from "@/lib/daily-adjustments"
import { courseColorStyle } from "@/lib/course-colors"
import type {
  ClassSetting,
  Course,
  DailyTimetable,
  DailyTimetableRow,
  Room,
  ScheduleTemplate,
  Semester,
  Teacher,
} from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { ClassPicker, GradePicker, RoomPicker, TeacherPicker } from "@/components/resource-picker"
import { DatePicker } from "@/components/date-picker"
import { EmptyList, ErrorState, LoadingState } from "@/components/page"
import { AdjustmentScopeDialog } from "@/components/adjustments/adjustment-scope-dialog"
import { TimetablePage } from "@/pages/timetable-page"

export function PublishedTimetablePage() {
  const { semesterId, context } = useResolvedSemesterId()
  const { user } = useAuth()
  const [params, setParams] = useHashPreservingSearchParams()
  const mode = params.get("mode") === "standard" ? "standard" : "date"
  const semester = useQuery({
    queryKey: ["semester", semesterId],
    queryFn: () => api<Semester>(`/api/v1/semesters/${semesterId}`),
    enabled: semesterId !== null,
  })
  // Existing bookmarked draft links still open the editing workspace.
  if (params.has("version") && user && ["admin", "scheduler"].includes(user.role) && semesterId)
    return <Navigate replace to={`${semesterPath(semesterId, "planning")}?${params}`} />
  if (!semesterId && !context.isLoading)
    return (
      <EmptyList
        title="尚未选择学期"
        description="请在工作台选择学期。"
        actions={
          <Button nativeButton={false} render={<Link to="/" />}>
            返回工作台
          </Button>
        }
      />
    )
  if (semester.isPending) return <LoadingState />
  if (!semester.data || semester.isError)
    return <ErrorState retry={() => void semester.refetch()} />
  const viewModeControl = (
    <Tabs
      value={mode}
      onValueChange={(value) =>
        setParams((previous) =>
          mergeSearchParams(previous, { mode: value === "standard" ? "standard" : null }),
        )
      }
    >
      <TabsList aria-label="课表时间模式">
        <TabsTrigger value="date">按日期</TabsTrigger>
        <TabsTrigger value="standard">标准周</TabsTrigger>
      </TabsList>
    </Tabs>
  )
  return (
    <>
      {mode === "standard" ? (
        semester.data.data.current_timetable_version_id ? (
          <TimetablePage readOnly viewModeControl={viewModeControl} />
        ) : (
          <div className="space-y-4 p-4 md:p-7">
            {viewModeControl}
            <EmptyList
              title="尚未发布课表"
              description="本学期课表发布后，会显示在这里。"
              actions={
                user && ["admin", "scheduler"].includes(user.role) ? (
                  <Button
                    nativeButton={false}
                    render={<Link to={semesterPath(semester.data.data.id, "preparation")} />}
                  >
                    前往学期排课
                  </Button>
                ) : undefined
              }
            />
          </div>
        )
      ) : (
        <PublishedCalendar
          key={semesterId}
          semester={semester.data.data}
          viewModeControl={viewModeControl}
        />
      )}
    </>
  )
}

function PublishedCalendar({
  semester,
  viewModeControl,
}: {
  semester: Semester
  viewModeControl: ReactNode
}) {
  const { user } = useAuth()
  const { context } = useResolvedSemesterId()
  const today = useSchoolToday(context.data?.timezone)
  const [params, setParams] = useHashPreservingSearchParams()
  const view = enumParam(params, "view", ["class", "grade", "teacher", "room"], "class")
  const date = clampDate(
    validDate(params.get("date")) ? params.get("date")! : today,
    semester.start_date,
    semester.end_date,
  )
  const dates = view === "grade" ? [date] : weekDates(date, semester.start_date, semester.end_date)
  const [selected, setSelected] = useState<DailyTimetableRow | null>(null)
  const [adjustment, setAdjustment] = useState<DailyTimetableRow | null>(null)
  const canEdit =
    semester.status === "open" && Boolean(user && ["admin", "scheduler"].includes(user.role))
  const resources = useQuery({
    queryKey: ["published-timetable-resources", semester.id],
    queryFn: async () => {
      const [settings, teachers, rooms, courses, template] = await Promise.all([
        apiAllPages<ClassSetting>(`/api/v1/semesters/${semester.id}/class-settings`),
        apiAllPages<Teacher>("/api/v1/teachers"),
        apiAllPages<Room>("/api/v1/rooms"),
        apiAllPages<Course>("/api/v1/courses"),
        api<ScheduleTemplate | null>(`/api/v1/semesters/${semester.id}/schedule-template`),
      ])
      return {
        classes: settings.data
          .filter((item) => item.status === "active")
          .map((item) => item.school_class),
        teachers: teachers.data,
        rooms: rooms.data,
        courses: courses.data,
        template: template.data,
      }
    },
  })
  const classes = resources.data?.classes ?? []
  const grades = Array.from(
    new Map(
      classes.map((item) => [
        item.grade_id,
        {
          id: item.grade_id,
          name: item.grade.name,
          classCount: classes.filter((other) => other.grade_id === item.grade_id).length,
        },
      ]),
    ).values(),
  )
  const teachers = resources.data?.teachers ?? []
  const rooms = resources.data?.rooms ?? []
  const choices =
    view === "grade" ? grades : view === "class" ? classes : view === "teacher" ? teachers : rooms
  const resourceId = choices.some((item) => String(item.id) === params.get("resource"))
    ? params.get("resource")!
    : String(choices[0]?.id ?? "")
  const resourceIndex = choices.findIndex((item) => String(item.id) === resourceId)
  const resourceName = choices[resourceIndex]?.name ?? ""
  const change = (values: Record<string, string | null>) => {
    setSelected(null)
    setParams((previous) => mergeSearchParams(previous, { date, ...values }))
  }
  const queries = useQueries({
    queries: dates.map((day) => ({
      queryKey: ["daily-timetable", semester.id, day],
      queryFn: () =>
        api<DailyTimetable>(`/api/v1/semesters/${semester.id}/daily-timetable?date=${day}`),
      enabled: Boolean(resourceId),
      staleTime: 15_000,
    })),
  })
  const gradeClasses = classes.filter((item) => String(item.grade_id) === resourceId)
  const rows = queries
    .flatMap((query) => query.data?.data.rows ?? [])
    .filter((row) =>
      view === "grade"
        ? row.class_ids.some((id) => gradeClasses.some((item) => item.id === id))
        : matchesObject(row, view, resourceId),
    )
  const days = dates.filter((day) => {
    const weekday = new Date(`${day}T12:00:00`).getDay() || 7
    return (
      view === "grade" ||
      resources.data?.template?.days.some((item) => item.weekday === weekday && item.is_enabled) ||
      rows.some((row) => row.date === day)
    )
  })
  const items = (resources.data?.template?.items ?? [])
    .filter((item) => item.is_active && item.allows_course)
    .sort((a, b) => a.sort_order - b.sort_order)
  const failure = queries.find((query) => query.isError)
  const loading = queries.some((query) => query.isPending)
  const exportRows = () => {
    const cells = [
      ["日期", "班级", "课节", "课程", "教师", "教室", "状态"],
      ...rows.map((row) => [
        row.date,
        row.target_name,
        row.item_name,
        row.course_name,
        row.teacher_names.join("、"),
        row.room_name,
        dailyStatusLabels[row.status],
      ]),
    ]
    const csv = cells
      .map((line) =>
        line
          .map(
            (cell) =>
              `"${String(cell)
                .replace(/^[=+@\-\t\r]/, "'$&")
                .replaceAll('"', '""')}"`,
          )
          .join(","),
      )
      .join("\r\n")
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${resourceName}-${date}-实际课表.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const card = (row: DailyTimetableRow) => (
    <button
      key={row.key}
      type="button"
      onClick={() => setSelected(row)}
      style={courseColorStyle(
        resources.data?.courses.find((course) => course.id === row.course_id) ?? { color: null },
      )}
      className={`course-color-card timetable-lesson transition-colors ${row.is_cancelled ? "opacity-60" : ""}`}
    >
      <span className="flex flex-wrap items-center justify-between gap-1">
        <span className={`text-sm font-medium ${row.is_cancelled ? "line-through" : ""}`}>
          {row.course_name}
        </span>
        {row.status !== "base" && (
          <span className="rounded bg-background/70 px-1 text-[10px]">
            {dailyStatusLabels[row.status]}
          </span>
        )}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">
        {view === "teacher" ? row.target_name : row.teacher_names.join("、")}
        {view !== "grade" && ` · ${view === "room" ? row.target_name : row.room_name}`}
      </span>
    </button>
  )
  const previous = clampDate(
    addDays(date, view === "grade" ? -1 : -7),
    semester.start_date,
    semester.end_date,
  )
  const next = clampDate(
    addDays(date, view === "grade" ? 1 : 7),
    semester.start_date,
    semester.end_date,
  )
  return (
    <div className="space-y-4 p-4 md:p-7">
      <h1 className="sr-only">查看课表</h1>
      <section aria-label="课表选择" className="overflow-hidden rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={view} onValueChange={(value) => change({ view: value, resource: null })}>
              <TabsList>
                <TabsTrigger value="class">班级</TabsTrigger>
                <TabsTrigger value="grade">年级</TabsTrigger>
                <TabsTrigger value="teacher">教师</TabsTrigger>
                <TabsTrigger value="room">教室</TabsTrigger>
              </TabsList>
            </Tabs>
            <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
            {viewModeControl}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label={view === "grade" ? "前一天" : "上一周"}
              disabled={previous === date}
              onClick={() => change({ date: previous })}
            >
              <ChevronLeftIcon />
            </Button>
            <DatePicker
              label="课表日期"
              value={date}
              min={semester.start_date}
              max={semester.end_date}
              required
              onValueChange={(value) => change({ date: value })}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label={view === "grade" ? "后一天" : "下一周"}
              disabled={next === date}
              onClick={() => change({ date: next })}
            >
              <ChevronRightIcon />
            </Button>
            {today >= semester.start_date && today <= semester.end_date && (
              <Button variant="ghost" onClick={() => change({ date: today })}>
                今天
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 p-4">
          <div className="flex max-w-full items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="上一个对象"
              disabled={resourceIndex <= 0}
              onClick={() => change({ resource: String(choices[resourceIndex - 1].id) })}
            >
              <ChevronLeftIcon />
            </Button>
            {view === "class" ? (
              <ClassPicker
                className="w-64 max-w-[calc(100vw-10rem)]"
                classes={classes}
                value={resourceId}
                onValueChange={(value) => change({ resource: value })}
              />
            ) : view === "grade" ? (
              <GradePicker
                className="w-64 max-w-[calc(100vw-10rem)]"
                grades={grades}
                value={resourceId}
                onValueChange={(value) => change({ resource: value })}
              />
            ) : view === "teacher" ? (
              <TeacherPicker
                className="w-64 max-w-[calc(100vw-10rem)]"
                teachers={teachers}
                value={resourceId}
                onValueChange={(value) => change({ resource: value })}
              />
            ) : (
              <RoomPicker
                className="w-64 max-w-[calc(100vw-10rem)]"
                rooms={rooms}
                value={resourceId}
                onValueChange={(value) => change({ resource: value })}
              />
            )}
            <Button
              variant="outline"
              size="icon"
              aria-label="下一个对象"
              disabled={resourceIndex < 0 || resourceIndex >= choices.length - 1}
              onClick={() => change({ resource: String(choices[resourceIndex + 1].id) })}
            >
              <ChevronRightIcon />
            </Button>
          </div>
          <Button
            variant="outline"
            disabled={loading || Boolean(failure) || !rows.length}
            onClick={exportRows}
          >
            <DownloadIcon />
            导出
          </Button>
        </div>
      </section>
      {resources.isError ? (
        <ErrorState retry={() => void resources.refetch()} />
      ) : resources.isPending ? (
        <LoadingState />
      ) : !choices.length ? (
        <EmptyList title="暂无可查看的对象" description="本学期尚未配置相关资料。" />
      ) : loading ? (
        <LoadingState />
      ) : failure ? (
        <EmptyList
          title="暂时无法查看该日期的课表"
          description={apiMessage(failure.error)}
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => queries.forEach((query) => void query.refetch())}
              >
                重试
              </Button>
              {canEdit && (
                <Button
                  nativeButton={false}
                  render={<Link to={semesterPath(semester.id, "planning")} />}
                >
                  前往学期排课
                </Button>
              )}
            </>
          }
        />
      ) : !items.length ? (
        <EmptyList title="尚未设置作息" description="配置作息后即可查看课表。" />
      ) : (
        <div
          className="overflow-auto rounded-xl border"
          tabIndex={0}
          role="region"
          aria-label={view === "grade" ? "年级日课表" : "实际周课表"}
        >
          {view === "grade" ? (
            <table
              className="w-full table-fixed border-collapse text-sm"
              style={{ minWidth: 128 + items.length * 116 }}
            >
              <thead>
                <tr className="bg-muted">
                  <th className="sticky left-0 z-10 w-32 border-r bg-muted p-3 text-left">班级</th>
                  {items.map((item) => (
                    <th key={item.id} className="border-r p-3 font-medium last:border-r-0">
                      {item.name}
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        {item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gradeClasses.map((schoolClass) => (
                  <tr key={schoolClass.id}>
                    <th className="sticky left-0 z-10 border-t border-r bg-background px-3 text-left font-medium">
                      <button
                        className="flex w-full items-center justify-between gap-2 py-4 hover:underline"
                        onClick={() => change({ view: "class", resource: String(schoolClass.id) })}
                      >
                        {schoolClass.name}
                        <ArrowRightIcon className="size-3 text-muted-foreground" />
                      </button>
                    </th>
                    {items.map((item) => (
                      <td
                        key={item.id}
                        className="h-18 border-t border-r p-0 align-top last:border-r-0"
                      >
                        <div className="grid h-full divide-y divide-border">
                          {rows
                            .filter(
                              (row) =>
                                row.item_id === item.id && row.class_ids.includes(schoolClass.id),
                            )
                            .map(card)}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[840px] table-fixed border-collapse text-sm">
              <thead>
                <tr className="bg-muted">
                  <th className="sticky left-0 z-10 w-28 border-r bg-muted p-3">课节</th>
                  {days.map((day) => (
                    <th key={day} className="border-r p-3 font-medium last:border-r-0">
                      {dateLabel(day)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <th className="sticky left-0 z-10 border-t border-r bg-background p-3 font-medium">
                      {item.name}
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        {item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}
                      </span>
                    </th>
                    {days.map((day) => (
                      <td
                        key={day}
                        className="h-24 border-t border-r p-0 align-top last:border-r-0"
                      >
                        <div className="grid h-full divide-y divide-border">
                          {rows
                            .filter((row) => row.date === day && row.item_id === item.id)
                            .map(card)}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{selected?.course_name}</DialogTitle>
            <DialogDescription>
              {selected &&
                `${dateLabel(selected.date)} · ${selected.item_name} · ${selected.start_time.slice(0, 5)}–${selected.end_time.slice(0, 5)}`}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <dl className="grid grid-cols-[4rem_1fr] gap-x-4 gap-y-4 py-3 text-sm">
              <dt className="text-muted-foreground">班级</dt>
              <dd>{selected.target_name}</dd>
              <dt className="text-muted-foreground">教师</dt>
              <dd>{selected.teacher_names.join("、")}</dd>
              <dt className="text-muted-foreground">教室</dt>
              <dd>{selected.room_name}</dd>
              <dt className="text-muted-foreground">状态</dt>
              <dd>{dailyStatusLabels[selected.status]}</dd>
            </dl>
          )}
          {canEdit &&
            selected &&
            (selected.date < today ||
              !selected.original_entry_id ||
              selected.exception_id ||
              selected.substitution_id ||
              selected.is_cancelled) && (
              <p role="status" className="text-sm text-muted-foreground">
                {selected.date < today
                  ? "历史日期只供核对，不能从这里发起新的调课。"
                  : selected.substitution_id
                    ? "这节课已有代课安排，请进入请假代课记录核对后处理。"
                    : selected.exception_id
                      ? "这节课已有临时调整，请先在调整记录中核对或撤回，避免重复覆盖。"
                      : selected.is_cancelled
                        ? "这节课已停课，请先核对原调整记录。"
                        : "该活动没有基础课程，不能按普通课程发起调课。"}
              </p>
            )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              关闭
            </Button>
            {canEdit &&
              selected &&
              (selected.date >= today &&
              selected.original_entry_id &&
              !selected.exception_id &&
              !selected.substitution_id &&
              !selected.is_cancelled ? (
                <Button
                  onClick={() => {
                    setAdjustment(selected)
                    setSelected(null)
                  }}
                >
                  发起调课
                </Button>
              ) : selected.exception_id || selected.substitution_id ? (
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      to={`${semesterPath(semester.id, selected.substitution_id ? "leaves" : "adjustments")}?date=${selected.date}`}
                    />
                  }
                >
                  查看调整记录
                </Button>
              ) : null)}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {adjustment && (
        <AdjustmentScopeDialog
          semester={semester}
          row={adjustment}
          onClose={() => setAdjustment(null)}
        />
      )}
    </div>
  )
}
