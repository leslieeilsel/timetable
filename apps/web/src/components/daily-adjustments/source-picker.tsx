import { useQueries } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { api, apiMessage } from "@/lib/api"
import { enumParam, mergeSearchParams, useHashPreservingSearchParams } from "@/lib/url-state"
import {
  addDays,
  clampDate,
  dailyStatusLabels,
  dateLabel,
  emptyDailyFilters,
  localDate,
  matchesDailyFilters,
  matchesObject,
  rowIdentity,
  shortTime,
  validDate,
  weekDates,
  type DailyFilters,
  type ObjectKind,
} from "@/lib/daily-adjustments"
import type {
  DailyTimetable,
  DailyTimetableRow,
  Item,
  Room,
  SchoolClass,
  Semester,
  Teacher,
} from "@/lib/types"
import {
  AdjustmentStepHeader,
  AdjustmentObjectPicker,
  AdjustmentLessonToolbar,
} from "@/components/adjustments/workbench"
import { DatePicker } from "@/components/date-picker"
import { Button } from "@/components/ui/button"
import { EmptyList, LoadingState } from "@/components/page"
import { AdjustmentFilters, AppliedAdjustmentFilters } from "./filters"
import { DailyGrid, NoFilterResults } from "./daily-grid"

export function AdjustmentSourcePicker({
  semester,
  classes,
  teachers,
  rooms,
  items,
  onSelect,
  onBack,
  onMakeup,
  canEdit,
}: {
  semester: Semester
  classes: SchoolClass[]
  teachers: Teacher[]
  rooms: Room[]
  items: Item[]
  onBack: () => void
  onSelect: (row: DailyTimetableRow) => void
  onMakeup: (date: string, itemId?: number) => void
  canEdit: boolean
}) {
  const [params, setParams] = useHashPreservingSearchParams()
  const kind = enumParam(params, "object", ["teacher", "class", "room"], "teacher")
  const resource = params.get("resource") ?? ""
  const date = clampDate(
    validDate(params.get("date")) ? params.get("date")! : localDate(),
    semester.start_date,
    semester.end_date,
  )
  const range = enumParam(params, "range", ["day", "week"], "day")
  const grid = params.get("pick") === "grid"
  const update = (values: Record<string, string | null>) =>
    setParams((previous) => mergeSearchParams(previous, { date, ...values }))
  const filters: DailyFilters = {
    q: params.get("q") ?? "",
    courses: (params.get("courses") ?? "").split(",").filter((id) => /^\d+$/.test(id)),
    period: enumParam(params, "period", ["all", "am", "pm"], "all"),
    status: enumParam(params, "changed", ["all", "changed"], "all"),
  }
  const changeFilters = (next: DailyFilters) =>
    update({
      q: next.q || null,
      courses: next.courses.join(",") || null,
      period: next.period === "all" ? null : next.period,
      changed: next.status === "all" ? null : next.status,
    })
  const dates =
    range === "week" || grid ? weekDates(date, semester.start_date, semester.end_date) : [date]
  const label = (kind === "class" ? classes : kind === "teacher" ? teachers : rooms).find(
    (item) => String(item.id) === resource,
  )?.name
  const queries = useQueries({
    queries: dates.map((day) => ({
      queryKey: ["daily-timetable", semester.id, day],
      queryFn: () =>
        api<DailyTimetable>(`/api/v1/semesters/${semester.id}/daily-timetable?date=${day}`),
      enabled: Boolean(label),
      staleTime: 15_000,
    })),
  })
  const days = queries.flatMap((query) => (query.data ? [query.data.data] : []))
  const rows = days
    .flatMap((day) => day.rows)
    .filter((row) => matchesObject(row, kind, resource))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time))
  const visible = rows.filter((row) => matchesDailyFilters(row, filters))
  const failure = queries.find((query) => query.isError)
  const chooseObject = (nextKind: ObjectKind, id: string) =>
    update({ object: nextKind, resource: id, q: null, courses: null, period: null, changed: null })
  return (
    <section className="flex w-full flex-col gap-6" aria-label="选择原课">
      <AdjustmentStepHeader
        step={1}
        description="临时调课 · 选择要调整的那一次课程。"
        onBack={onBack}
      />
      <div className="space-y-5 rounded-xl border bg-card p-5 lg:p-7">
        <div className={cn("flex flex-wrap items-center gap-3", label && "border-b pb-5")}>
          <AdjustmentObjectPicker
            kind={kind}
            resource={resource}
            onChange={(nextKind, id) => chooseObject(nextKind as ObjectKind, id)}
            classes={classes}
            teachers={teachers}
            rooms={rooms}
          />
          <div className="flex items-center gap-0.5">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="查找更早课程"
              disabled={dates[0] <= semester.start_date}
              onClick={() =>
                update({
                  date: clampDate(
                    addDays(date, range === "week" || grid ? -7 : -1),
                    semester.start_date,
                    semester.end_date,
                  ),
                })
              }
            >
              <ChevronLeft />
            </Button>
            <DatePicker
              label="原课程日期"
              value={date}
              min={semester.start_date}
              max={semester.end_date}
              required
              onValueChange={(value) => update({ date: value })}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="查找更晚课程"
              disabled={dates.at(-1)! >= semester.end_date}
              onClick={() =>
                update({
                  date: clampDate(
                    addDays(date, range === "week" || grid ? 7 : 1),
                    semester.start_date,
                    semester.end_date,
                  ),
                })
              }
            >
              <ChevronRight />
            </Button>
          </div>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="没有原课，安排补课"
              onClick={() => onMakeup(date)}
            >
              <Plus />
              安排补课
            </Button>
          )}
        </div>
        {label ? (
          <>
            <AdjustmentLessonToolbar
              label={label}
              count={visible.length}
              search={filters.q}
              onSearch={(q) => changeFilters({ ...filters, q })}
              searchLabel="查找当前对象的课程"
              grid={grid}
              onToggleGrid={() => update({ pick: grid ? null : "grid" })}
              leading={
                !grid && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => update({ range: range === "day" ? "week" : "day" })}
                  >
                    {range === "day" ? "查看整周" : "只看当天"}
                  </Button>
                )
              }
            >
              <AdjustmentFilters value={filters} rows={rows} onChange={changeFilters} />
            </AdjustmentLessonToolbar>
            <AppliedAdjustmentFilters value={filters} rows={rows} onChange={changeFilters} />
            {queries.some((query) => query.isLoading) ? (
              <LoadingState label="正在查找实际课程…" />
            ) : failure ? (
              <div role="alert" className="space-y-3 rounded-lg border p-6">
                <p>{apiMessage(failure.error)}</p>
                <Button
                  variant="outline"
                  onClick={() => queries.forEach((query) => void query.refetch())}
                >
                  重新加载
                </Button>
              </div>
            ) : !visible.length && rows.length ? (
              <NoFilterResults
                count={rows.length}
                onReset={() => changeFilters(emptyDailyFilters)}
              />
            ) : grid ? (
              <div className="flex h-[min(660px,70svh)] min-h-80 flex-col">
                <DailyGrid
                  days={days.filter(
                    (day) =>
                      day.weekday <= 5 ||
                      day.rows.some((row) => matchesObject(row, kind, resource)),
                  )}
                  rows={rows}
                  items={items}
                  filters={filters}
                  objectKind={kind}
                  canEdit={canEdit}
                  onSelect={(row) => {
                    if (
                      !row.exception_id &&
                      !row.substitution_id &&
                      !row.is_cancelled &&
                      row.original_entry_id
                    )
                      onSelect(row)
                  }}
                  onEmpty={(day, item) => onMakeup(day, item.id)}
                />
              </div>
            ) : visible.length ? (
              <div
                className="overflow-hidden rounded-lg border bg-card"
                aria-label="可选择的课程列表"
              >
                <div
                  aria-hidden="true"
                  className="hidden grid-cols-[130px_minmax(0,1fr)_minmax(0,.7fr)_minmax(0,1fr)_100px] gap-4 bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground lg:grid"
                >
                  <span>课节 / 时间</span>
                  <span>课程</span>
                  <span>老师</span>
                  <span>教室</span>
                  <span />
                </div>
                {visible.map((row) => {
                  const changed = Boolean(
                    row.exception_id ||
                    row.substitution_id ||
                    row.is_cancelled ||
                    !row.original_entry_id,
                  )
                  return (
                    <button
                      type="button"
                      key={rowIdentity(row)}
                      disabled={!canEdit || changed}
                      onClick={() => onSelect(row)}
                      aria-label={`选择 ${dateLabel(row.date)} ${row.item_name} ${row.course_name} ${row.target_name}`}
                      className="group grid w-full grid-cols-[85px_minmax(0,1fr)_20px] items-center gap-4 border-b border-l-2 border-l-transparent px-4 py-3 text-left last:border-b-0 hover:enabled:border-l-foreground hover:enabled:bg-muted/50 focus-visible:border-l-foreground focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:text-muted-foreground lg:grid-cols-[130px_minmax(0,1fr)_minmax(0,.7fr)_minmax(0,1fr)_100px]"
                    >
                      <span className="text-sm">
                        <span className="block font-medium">
                          {range === "week" ? `${dateLabel(row.date)} · ` : ""}
                          {row.item_name}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {shortTime(row.start_time)}–{shortTime(row.end_time)}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{row.course_name}</span>
                        {(kind !== "class" || row.class_names.length > 1) && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {row.target_name}
                          </span>
                        )}
                        <span className="mt-1 block text-xs text-muted-foreground lg:hidden">
                          {row.teacher_names.join("、")} · {row.room_name}
                        </span>
                        {changed && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {dailyStatusLabels[row.status]} · 请先处理原调整
                          </span>
                        )}
                      </span>
                      <span className="hidden text-sm lg:block">
                        {row.teacher_names.join("、")}
                      </span>
                      <span className="hidden text-sm text-muted-foreground lg:block">
                        {row.room_name}
                      </span>
                      <span className="flex items-center justify-end gap-1 text-xs">
                        {!changed && (
                          <>
                            <span className="hidden whitespace-nowrap font-medium group-hover:lg:block group-focus-visible:lg:block">
                              调整这节课
                            </span>
                            <ChevronRight className="size-4 shrink-0" />
                          </>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <EmptyList
                title="这段时间没有课程"
                description="试试其他日期，或查看这一周的课程。"
                actions={
                  <>
                    <Button variant="outline" onClick={() => update({ range: "week" })}>
                      查看整周
                    </Button>
                    <Button
                      variant="outline"
                      disabled={date >= semester.end_date}
                      onClick={() =>
                        update({
                          date: clampDate(addDays(date, 1), semester.start_date, semester.end_date),
                          range: "day",
                        })
                      }
                    >
                      查看下一天
                    </Button>
                  </>
                }
              />
            )}
          </>
        ) : null}
      </div>
    </section>
  )
}
