import { courseColorStyle } from "@/lib/course-colors"
import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  LockIcon,
  AlertTriangleIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api, apiAllPages, apiDownload, apiMessage, saveDownload } from "@/lib/api"
import {
  activeGradeClasses,
  entryTeachers,
  gradeRows,
  timetableCsv,
  type GradeValidation,
} from "@/lib/grade-timetable"
import { isTimetableVersionStale } from "@/lib/timetable-state"
import { cn } from "@/lib/utils"
import type {
  ClassSetting,
  Grade,
  Semester,
  TeachingAssignment,
  TimetableEntry,
  TimetableVersion,
} from "@/lib/types"
import { weekdayName, weekPatternName, type TimetableGridData } from "@/components/timetable-grid"
import { EmptyList, ErrorState, LoadingState } from "@/components/page"
import { SimpleSelect } from "@/components/simple-select"
import { GradePicker } from "@/components/resource-picker"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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

export function GradeTimetable({
  toolbarContainer,
  visible,
  semester,
  version,
  settings,
  assignments,
  assignmentsReady,
  full,
  today,
  onFullChange,
  onOpenClass,
}: {
  toolbarContainer: HTMLDivElement | null
  visible: boolean
  semester: Semester
  version: TimetableVersion | undefined
  settings: ClassSetting[]
  assignments: TeachingAssignment[]
  assignmentsReady: boolean
  full: boolean
  today: string
  onFullChange: (full: boolean) => void
  onOpenClass: (classId: number, gradeName: string) => void
}) {
  const classes = useMemo(() => activeGradeClasses(settings), [settings])
  const gradeCatalog = useQuery({
    queryKey: ["grades"],
    queryFn: () => apiAllPages<Grade>("/api/v1/grades"),
    enabled: visible,
  })
  const grades = [...new Map(classes.map((item) => [item.grade_id, item.grade])).values()].sort(
    (a, b) => {
      const order = (id: number) =>
        gradeCatalog.data?.data.find((item) => item.id === id)?.sort_order ?? id
      return order(a.id) - order(b.id) || a.id - b.id
    },
  )
  const [chosenGrade, setChosenGrade] = useState("")
  const gradeId = grades.some((item) => String(item.id) === chosenGrade)
    ? chosenGrade
    : String(grades[0]?.id ?? "")
  const gradeName = grades.find((item) => String(item.id) === gradeId)?.name ?? "年级"
  const [day, setDay] = useState(() =>
    today >= semester.start_date && today <= semester.end_date
      ? String(new Date(`${today}T00:00:00Z`).getUTCDay() || 7)
      : "1",
  )
  const [teacher, setTeacher] = useState("")
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<{ entry: TimetableEntry; classId: number } | null>(null)
  const gradeIndex = grades.findIndex((grade) => String(grade.id) === gradeId)
  const selectGrade = (value: string) => {
    setChosenGrade(value)
    setTeacher("")
  }
  const stale = isTimetableVersionStale(semester, version)
  const timetable = useQuery({
    queryKey: ["timetable", semester.id, "grade-overview", full, version?.id],
    queryFn: () =>
      api<TimetableGridData>(
        `/api/v1/semesters/${semester.id}/timetable?view=class&mode=${full ? "full" : "official"}&version_id=${version!.id}`,
      ),
    enabled: visible && !!version,
  })
  const validation = useQuery({
    queryKey: [
      "timetable-validation",
      semester.id,
      version?.id,
      semester.input_revision,
      semester.timetable_revision,
    ],
    queryFn: () =>
      api<GradeValidation>(
        `/api/v1/semesters/${semester.id}/timetable/validation?version_id=${version!.id}`,
      ),
    enabled: visible && !!version && !stale,
  })
  const data = timetable.data?.data
  const reviewed = !stale && validation.isSuccess && assignmentsReady
  const rows = useMemo(
    () =>
      gradeRows(
        settings,
        Number(gradeId),
        data?.entries ?? [],
        assignments,
        reviewed ? validation.data?.data : undefined,
      ),
    [settings, gradeId, data, assignments, reviewed, validation.data],
  )
  const entries = [
    ...new Map(rows.flatMap((row) => row.entries).map((entry) => [entry.id, entry])).values(),
  ]
  const teachers = [
    ...new Map(entries.flatMap(entryTeachers).map((item) => [item.id, item])).values(),
  ]
  const activeTeacher = teachers.some((item) => String(item.id) === teacher) ? teacher : ""
  const selectedDay =
    data?.days.find((item) => String(item.weekday) === day)?.weekday ?? data?.days[0]?.weekday ?? 1
  const slotEntries = new Map<string, TimetableEntry[]>()
  for (const row of rows)
    for (const entry of row.entries) {
      const key = `${row.schoolClass.id}/${entry.weekday}/${entry.item_id}`
      slotEntries.set(key, [...(slotEntries.get(key) ?? []), entry])
    }
  const at = (classId: number, weekday: number, itemId: number) =>
    slotEntries.get(`${classId}/${weekday}/${itemId}`) ?? []
  const openClass = (id: number) => {
    setSelected(null)
    onOpenClass(id, gradeName)
  }
  const exportCsv = () => {
    const content = timetableCsv([
      [
        semester.academic_year?.name ?? "",
        semester.name,
        gradeName,
        `v${version?.version_no} · ${version?.name}`,
        stale ? "历史快照：资料已变化，需复核" : "标准周课表",
        full ? "完整作息" : "正式课程",
      ],
      [
        "班级",
        ...(data?.items ?? []).map(
          (item) =>
            `${weekdayName[selectedDay]} ${item.name} ${item.start_time.slice(0, 5)}–${item.end_time.slice(0, 5)}`,
        ),
      ],
      ...rows.map((row) => [
        row.schoolClass.name,
        ...(data?.items ?? []).map((item) =>
          at(row.schoolClass.id, selectedDay, item.id)
            .map(
              (entry) =>
                `${entry.course.name} / ${entryTeachers(entry)
                  .map((person) => person.name)
                  .join(
                    "、",
                  )} / ${entry.actual_room.name} / ${entry.week_pattern === "specified" ? `第 ${(entry.active_weeks ?? []).join("、")} 周` : weekPatternName(entry)}`,
            )
            .join("\n"),
        ),
      ]),
    ])
    saveDownload(
      { blob: new Blob([content], { type: "text/csv;charset=utf-8" }), filename: null },
      `${gradeName}-${weekdayName[selectedDay]}-v${version?.version_no}.csv`,
    )
  }
  const exportClasses = async () => {
    if (!version || busy) return
    setBusy(true)
    try {
      const download = await apiDownload(`/api/v1/semesters/${semester.id}/timetable/export.zip`, {
        method: "POST",
        body: JSON.stringify({
          class_ids: rows.map((row) => row.schoolClass.id),
          teacher_ids: [],
          version_id: version.id,
          mode: full ? "full" : "official",
        }),
      })
      saveDownload(download, `${gradeName}-各班课表.zip`)
      toast.success(`已导出${gradeName} ${rows.length} 个班的课表`)
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const lesson = (entry: TimetableEntry, classId: number) => {
    const row = rows.find((item) => item.schoolClass.id === classId)
    const conflict = row?.conflicts.some(
      (item) =>
        item.entry_id === entry.id ||
        item.existing_entry_id === entry.id ||
        (item.entry_id === undefined && item.assignment_id === entry.teaching_assignment_id),
    )
    const dim =
      activeTeacher && !entryTeachers(entry).some((person) => String(person.id) === activeTeacher)
    return (
      <button
        key={entry.id}
        type="button"
        aria-label={`${row?.schoolClass.name} ${weekdayName[entry.weekday]} ${entry.item.name} ${entry.course.name} ${entryTeachers(
          entry,
        )
          .map((person) => person.name)
          .join("、")} ${weekPatternName(entry)}${conflict ? "，有冲突" : ""}`}
        className={cn(
          "course-color-card timetable-lesson text-sm leading-5 transition-colors",
          dim && "course-color-dimmed",
        )}
        style={courseColorStyle(entry.course)}
        onClick={() => setSelected({ entry, classId })}
      >
        <span className="flex items-start justify-between gap-1">
          <span className="font-medium">{entry.course.name}</span>
          {conflict ? (
            <AlertTriangleIcon className="size-3.5 shrink-0 text-destructive" />
          ) : entry.is_locked ? (
            <LockIcon className="size-3 shrink-0" />
          ) : null}
        </span>
        <span className="mt-1 block text-xs leading-4 text-muted-foreground">
          {entryTeachers(entry)
            .map((person) => person.name)
            .join("、")}
        </span>
        {entry.week_pattern !== "all" && (
          <span className="mt-1 block text-xs">{weekPatternName(entry)}</span>
        )}
      </button>
    )
  }
  if (!classes.length)
    return (
      <section hidden={!visible}>
        <EmptyList title="暂无年级班级" description="请先在本学期配置参与排课的班级。" />
      </section>
    )
  return (
    <section aria-label="年级课表总览" hidden={!visible}>
      {visible &&
        toolbarContainer &&
        createPortal(
          <div className="flex flex-wrap items-center gap-3 border-t bg-muted/30 p-3 lg:p-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="flex min-w-0 items-center gap-1" role="group" aria-label="切换年级">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="上一个年级"
                  disabled={gradeIndex <= 0}
                  onClick={() => selectGrade(String(grades[gradeIndex - 1].id))}
                >
                  <ChevronLeftIcon />
                </Button>
                <GradePicker
                  className="min-w-0 flex-1 sm:min-w-64 sm:flex-none"
                  grades={grades.map((grade) => ({
                    ...grade,
                    classCount: classes.filter((item) => item.grade_id === grade.id).length,
                  }))}
                  value={gradeId}
                  onValueChange={selectGrade}
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="下一个年级"
                  disabled={gradeIndex < 0 || gradeIndex >= grades.length - 1}
                  onClick={() => selectGrade(String(grades[gradeIndex + 1].id))}
                >
                  <ChevronRightIcon />
                </Button>
              </div>
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm transition-colors hover:bg-muted/50">
                <Switch checked={full} onCheckedChange={onFullChange} />
                完整作息
              </label>
              {data && (
                <>
                  <div className="flex flex-wrap gap-1" role="group" aria-label="选择课表星期">
                    {data.days.map((item) => (
                      <Button
                        key={item.weekday}
                        size="sm"
                        variant={selectedDay === item.weekday ? "secondary" : "ghost"}
                        aria-pressed={selectedDay === item.weekday}
                        onClick={() => setDay(String(item.weekday))}
                      >
                        {weekdayName[item.weekday]}
                      </Button>
                    ))}
                  </div>
                  <SimpleSelect
                    value={activeTeacher}
                    label="高亮教师"
                    surface="filter"
                    className="min-w-36"
                    onValueChange={setTeacher}
                  >
                    <option value="">高亮教师：全部</option>
                    {teachers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </SimpleSelect>
                </>
              )}
            </div>
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
              <span className="inline-flex min-h-8 items-center rounded-xl border bg-background px-3 text-xs text-muted-foreground">
                本年级 {rows.length} 个班
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      disabled={!data || !version || !rows.length || busy || timetable.isFetching}
                    />
                  }
                >
                  <DownloadIcon />
                  {busy ? "正在导出…" : "导出"}
                  <ChevronDownIcon className="text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={exportCsv}>
                      全年级{weekdayName[selectedDay]}总表（CSV）
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={rows.length > 200}
                      onClick={() => void exportClasses()}
                    >
                      本年级各班周课表（Excel 压缩包）
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>,
          toolbarContainer,
        )}
      {!version ? (
        <EmptyList
          title="暂无可查看的课表版本"
          description="请先选择已发布的课表或创建排课方案。"
        />
      ) : timetable.isPending ? (
        <LoadingState label="正在载入年级课表…" />
      ) : timetable.isError || !data ? (
        <ErrorState retry={() => void timetable.refetch()} />
      ) : (
        <>
          {entries.length === 0 && (
            <p className="mb-4 text-sm text-muted-foreground">
              {gradeName}在此版本中暂无排课记录。可切换课表版本，或进入自动排课安排课程。
            </p>
          )}
          {!data.items.length || !data.days.length ? (
            <EmptyList
              title="暂无可显示的课节"
              description="请检查本学期作息模板，或切换完整作息。"
            />
          ) : !rows.length ? (
            <EmptyList
              title="本年级暂无参与排课的班级"
              description="请先在本学期配置参与排课的班级。"
            />
          ) : (
            <section aria-label={`${weekdayName[selectedDay]}课表`}>
              <div
                className="hidden overflow-auto rounded-lg border focus-visible:outline-2 focus-visible:outline-ring md:block"
                role="region"
                aria-label={`${gradeName}${weekdayName[selectedDay]}可滚动的课表总览`}
                tabIndex={0}
              >
                <table
                  className="w-full table-fixed border-separate border-spacing-0 text-sm"
                  style={{ minWidth: 128 + data.items.length * 116 }}
                >
                  <caption className="sr-only">
                    {gradeName} · {weekdayName[selectedDay]} · 标准周课表
                  </caption>
                  <colgroup>
                    <col className="w-32" />
                    {data.items.map((item) => (
                      <col key={item.id} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="sticky left-0 z-20 border-r border-b bg-muted px-3 py-3 text-left font-medium"
                      >
                        班级
                      </th>
                      {data.items.map((item) => (
                        <th
                          key={item.id}
                          scope="col"
                          className="border-r border-b bg-muted px-2 py-3 font-medium last:border-r-0"
                        >
                          <span className="block">{item.name}</span>
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">
                            {item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.schoolClass.id}
                        className="[&:last-child>td]:border-b-0 [&:last-child>th]:border-b-0"
                      >
                        <th
                          scope="row"
                          className="sticky left-0 z-10 border-r border-b bg-background px-3 py-3 text-left align-middle font-medium"
                        >
                          <button
                            type="button"
                            className="group flex w-full items-center justify-between gap-2 rounded text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                            onClick={() => openClass(row.schoolClass.id)}
                          >
                            <span>{row.schoolClass.name}</span>
                            <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                          </button>
                          {reviewed && row.hasIssues && (
                            <span className="mt-2 block text-xs font-normal text-[var(--timetable-notice-foreground)]">
                              {row.remaining > 0 ? `待排 ${row.remaining} 节` : "需复核"}
                              {row.conflicts.length > 0 ? " · 有冲突" : ""}
                            </span>
                          )}
                        </th>
                        {data.items.map((item) => (
                          <td
                            key={item.id}
                            className="h-18 border-r border-b p-0 align-top last:border-r-0"
                          >
                            <div className="grid h-full divide-y divide-border">
                              {at(row.schoolClass.id, selectedDay, item.id).length ? (
                                at(row.schoolClass.id, selectedDay, item.id).map((entry) =>
                                  lesson(entry, row.schoolClass.id),
                                )
                              ) : (
                                <span
                                  className="flex min-h-15 items-center justify-center text-muted-foreground"
                                  aria-label="未安排课程"
                                >
                                  —
                                </span>
                              )}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-6 md:hidden">
                {rows.map((row) => (
                  <section key={row.schoolClass.id} className="border-b pb-5">
                    <Button
                      variant="ghost"
                      className="mb-2"
                      onClick={() => openClass(row.schoolClass.id)}
                    >
                      {row.schoolClass.name}
                      <ArrowRightIcon />
                    </Button>
                    {reviewed && row.hasIssues && (
                      <p className="mb-3 text-xs text-[var(--timetable-notice-foreground)]">
                        {row.remaining > 0 ? `待排 ${row.remaining} 节` : "需复核"}
                        {row.conflicts.length > 0 ? " · 有冲突" : ""}
                      </p>
                    )}
                    <div className="overflow-hidden rounded-lg border divide-y divide-border">
                      {data.items.map((item) => (
                        <div key={item.id} className="grid grid-cols-[5rem_1fr] items-stretch">
                          <div className="border-r bg-muted p-3 text-sm">
                            {item.name}
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {item.start_time.slice(0, 5)}
                            </span>
                          </div>
                          <div className="grid divide-y divide-border">
                            {at(row.schoolClass.id, selectedDay, item.id).length ? (
                              at(row.schoolClass.id, selectedDay, item.id).map((entry) =>
                                lesson(entry, row.schoolClass.id),
                              )
                            ) : (
                              <span className="py-2 text-sm text-muted-foreground">未安排课程</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          )}
          {!stale && (
            <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
              <span className="text-xs text-muted-foreground" role="status">
                {reviewed
                  ? `本年级：${rows.filter((row) => row.remaining > 0).length} 个班待排 · ${rows.filter((row) => row.conflicts.length > 0).length} 个班有冲突`
                  : validation.isError
                    ? "校验暂不可用"
                    : !assignmentsReady
                      ? "任课资料暂不可用"
                      : "正在校验本年级…"}
              </span>
              {validation.isError && (
                <Button variant="ghost" size="sm" onClick={() => void validation.refetch()}>
                  重试校验
                </Button>
              )}
            </div>
          )}
        </>
      )}
      <Dialog
        open={visible && selected !== null && selected.entry.timetable_version_id === version?.id}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 p-0 sm:max-w-[480px]">
          <DialogHeader className="border-b p-6 pr-14">
            <DialogTitle>{selected?.entry.course.name ?? "课程详情"}</DialogTitle>
            <DialogDescription>
              {selected &&
                `${weekdayName[selected.entry.weekday]} · ${selected.entry.item.name} · ${selected.entry.item.start_time.slice(0, 5)}–${selected.entry.item.end_time.slice(0, 5)}`}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="min-h-0 space-y-5 overflow-y-auto p-6">
              <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-4 text-sm">
                <dt className="text-muted-foreground">班级</dt>
                <dd>
                  {selected.entry.school_classes?.map((item) => item.name).join("、") ||
                    selected.entry.school_class?.name}
                </dd>
                <dt className="text-muted-foreground">教师</dt>
                <dd>
                  {entryTeachers(selected.entry)
                    .map((item) => item.name)
                    .join("、")}
                </dd>
                <dt className="text-muted-foreground">教室</dt>
                <dd>{selected.entry.actual_room.name}</dd>
                <dt className="text-muted-foreground">周次</dt>
                <dd>
                  {selected.entry.week_pattern === "specified"
                    ? `第 ${(selected.entry.active_weeks ?? []).join("、")} 周`
                    : weekPatternName(selected.entry)}
                </dd>
                <dt className="text-muted-foreground">版本</dt>
                <dd>
                  v{version?.version_no} · {version?.name}
                </dd>
                <dt className="text-muted-foreground">锁定</dt>
                <dd>{selected.entry.is_locked ? "已锁定" : "未锁定"}</dd>
              </dl>
              {stale ? (
                <p className="text-sm text-[var(--timetable-notice-foreground)]">
                  资料已变化，此课程来自旧版本，需重新复核。
                </p>
              ) : (
                <ul className="space-y-2 text-sm text-destructive">
                  {rows
                    .find((row) => row.schoolClass.id === selected.classId)
                    ?.conflicts.filter(
                      (item) =>
                        item.entry_id === selected.entry.id ||
                        item.existing_entry_id === selected.entry.id ||
                        (item.entry_id === undefined &&
                          item.assignment_id === selected.entry.teaching_assignment_id),
                    )
                    .map((item, index) => (
                      <li key={index}>{item.message}</li>
                    ))}
                </ul>
              )}
            </div>
          )}
          {selected && (
            <DialogFooter className="border-t px-6 py-4">
              <Button variant="outline" onClick={() => openClass(selected.classId)}>
                查看该班周课表
                <ArrowRightIcon />
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
