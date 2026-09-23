import { useMemo, useState } from "react"
import { ChevronRight, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AdjustmentLessonToolbar } from "@/components/adjustments/workbench"
import { SimpleSelect } from "@/components/simple-select"
import { weekPatternName } from "@/components/timetable-grid"
import { courseColorStyle } from "@/lib/course-colors"
import {
  effectiveTeacherIds,
  groupAssignments,
  weekdays,
  type LongTermEntry,
  type LongTermSource,
} from "@/lib/long-term-changes"
import type { Room, Teacher } from "@/lib/types"

export function weeklyTeacherName(entry: LongTermEntry, teachers: Teacher[]) {
  return effectiveTeacherIds(entry)
    .map(
      (id) =>
        teachers.find((teacher) => teacher.id === id)?.name ??
        entry.teachers.find((teacher) => teacher.id === id)?.name ??
        entry.teacher.name,
    )
    .join("、")
}
export function weeklyRoomName(entry: LongTermEntry, rooms: Room[]) {
  return rooms.find((room) => room.id === entry.actual_room_id)?.name ?? entry.actual_room.name
}
export function weeklyTargetName(entry: LongTermEntry) {
  return entry.school_classes.map((schoolClass) => schoolClass.name).join("、")
}

export function WeeklyLessonPicker({
  source,
  entries,
  teachers,
  rooms,
  label,
  onSelect,
  onSelectAssignment,
  initialGrid = false,
}: {
  source: LongTermSource
  entries: LongTermEntry[]
  teachers: Teacher[]
  rooms: Room[]
  label: string
  onSelect?: (entry: LongTermEntry) => void
  onSelectAssignment?: (entry: LongTermEntry) => void
  initialGrid?: boolean
}) {
  const [search, setSearch] = useState("")
  const [course, setCourse] = useState("")
  const [grid, setGrid] = useState(initialGrid)
  const courses = [...new Map(entries.map((entry) => [entry.course_id, entry.course])).values()]
  const visible = useMemo(
    () =>
      entries
        .filter(
          (entry) =>
            (!course || String(entry.course_id) === course) &&
            `${entry.course.name} ${weeklyTargetName(entry)} ${weeklyTeacherName(entry, teachers)} ${weeklyRoomName(entry, rooms)}`.includes(
              search.trim(),
            ),
        )
        .sort(
          (a, b) =>
            a.weekday - b.weekday ||
            (source.items.find((item) => item.id === a.item_id)?.sort_order ?? 0) -
              (source.items.find((item) => item.id === b.item_id)?.sort_order ?? 0),
        ),
    [entries, course, search, source.items, teachers, rooms],
  )
  const content = (entry: LongTermEntry) => (
    <>
      <p className="text-sm font-medium">
        {entry.course.name}
        <span className="ml-2 font-normal">{weeklyTargetName(entry)}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {weeklyTeacherName(entry, teachers)} · {weeklyRoomName(entry, rooms)}
      </p>
    </>
  )
  const groups = groupAssignments(source.entries, visible)
  return (
    <div className="space-y-3">
      <AdjustmentLessonToolbar
        label={label}
        count={visible.length}
        countLabel={!grid && onSelectAssignment ? `${groups.length} 项任课` : undefined}
        search={search}
        onSearch={setSearch}
        searchLabel="查找每周课程"
        grid={grid}
        onToggleGrid={() => setGrid(!grid)}
      >
        <SimpleSelect label="按课程筛选" value={course} onValueChange={setCourse}>
          <option value="">全部课程</option>
          {courses.map((item) => (
            <option key={item.id} value={String(item.id)}>
              {item.name}
            </option>
          ))}
        </SimpleSelect>
      </AdjustmentLessonToolbar>
      {!visible.length ? (
        <div className="rounded-lg border py-12 text-center text-sm">
          <p>{entries.length ? "没有符合条件的课程" : "这个对象在生效日期对应的课表中没有课程"}</p>
          {(search || course) && (
            <Button
              variant="link"
              onClick={() => {
                setSearch("")
                setCourse("")
              }}
            >
              清空筛选
            </Button>
          )}
        </div>
      ) : !grid && onSelectAssignment ? (
        <div
          className="divide-y overflow-hidden rounded-lg border bg-card"
          aria-label="按任课选择整组课程"
        >
          <div
            aria-hidden="true"
            className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_110px] gap-4 bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground sm:grid"
          >
            <span>课程 / 班级</span>
            <span>老师</span>
            <span>调整范围</span>
          </div>
          {groups.map((group) => {
            const first = group[0]!
            const locked = group.some((entry) => entry.is_locked)
            const names = [
              ...new Set(group.map((entry) => weeklyTeacherName(entry, teachers))),
            ].join("、")
            return (
              <div key={first.teaching_assignment_id} className="px-4 py-2.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_110px]">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {first.course.name}
                      {weeklyTargetName(first) !== label && ` · ${weeklyTargetName(first)}`}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                      {names}
                      {locked ? " · 含锁定课节" : ""}
                    </p>
                  </div>
                  <p className="hidden text-sm text-muted-foreground sm:block">
                    {names}
                    {locked ? " · 含锁定课节" : ""}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={locked}
                    aria-label={`${group.length > 1 ? "调整整组" : "调整课程"} ${first.course.name} ${weeklyTargetName(first)} ${group.length} 个固定课节`}
                    onClick={() =>
                      group.length > 1 ? onSelectAssignment(first) : onSelect?.(first)
                    }
                  >
                    {group.length > 1 ? "调整整组" : "调整课程"}
                    <ChevronRight />
                  </Button>
                </div>
                <details className="text-xs">
                  <summary className="w-fit cursor-pointer rounded py-1 text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    查看 {group.length} 个课节 / 只调一节
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {group.map((entry) => (
                      <Button
                        key={entry.id}
                        size="sm"
                        variant="outline"
                        disabled={entry.is_locked}
                        onClick={() => onSelect?.(entry)}
                      >
                        {weekdays[entry.weekday]}{" "}
                        {source.items.find((item) => item.id === entry.item_id)?.name}
                        {entry.week_pattern !== "all" && ` · ${weekPatternName(entry)}`}
                        {entry.is_locked && <Lock />}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-2 text-muted-foreground">
                    整组包含这项任课的全部课节，按各自单双周规则执行。
                  </p>
                </details>
              </div>
            )
          })}
        </div>
      ) : grid ? (
        <div
          className="overflow-auto rounded-lg border"
          role="region"
          aria-label="每周课程参考课表"
          tabIndex={0}
        >
          <table
            className="w-full table-fixed border-collapse text-sm"
            style={{ minWidth: 76 + source.days.length * 170 }}
          >
            <thead>
              <tr className="bg-muted/40">
                <th className="sticky left-0 z-10 w-[76px] border-r bg-background p-2 text-xs font-normal">
                  课节
                </th>
                {source.days.map((day) => (
                  <th key={day.weekday} className="border-r p-3 font-medium last:border-r-0">
                    {weekdays[day.weekday]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {source.items.map((item) => (
                <tr key={item.id}>
                  <th className="sticky left-0 z-10 border-t border-r bg-background p-2 align-top text-xs font-normal">
                    {item.name}
                    <p className="mt-1 text-muted-foreground">{item.start_time.slice(0, 5)}</p>
                  </th>
                  {source.days.map((day) => (
                    <td
                      key={day.weekday}
                      className="h-24 border-t border-r p-0 align-top last:border-r-0"
                    >
                      <div className="grid h-full divide-y divide-border">
                        {visible
                          .filter(
                            (entry) => entry.weekday === day.weekday && entry.item_id === item.id,
                          )
                          .map((entry) =>
                            onSelect ? (
                              <button
                                key={entry.id}
                                disabled={entry.is_locked}
                                onClick={() => onSelect(entry)}
                                aria-label={`选择 ${weekdays[entry.weekday]} ${item.name} ${entry.course.name} ${weeklyTargetName(entry)}`}
                                style={courseColorStyle(entry.course)}
                                className="course-color-card timetable-lesson transition-colors disabled:text-muted-foreground"
                              >
                                {content(entry)}
                                {entry.week_pattern !== "all" && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {weekPatternName(entry)}
                                  </p>
                                )}
                              </button>
                            ) : (
                              <div
                                key={entry.id}
                                style={courseColorStyle(entry.course)}
                                className="course-color-card timetable-lesson"
                              >
                                {content(entry)}
                              </div>
                            ),
                          )}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card" aria-label="可选择的课程列表">
          {visible.map((entry) => {
            const item = source.items.find((item) => item.id === entry.item_id)
            return (
              <button
                key={entry.id}
                disabled={!onSelect || entry.is_locked}
                onClick={() => onSelect?.(entry)}
                aria-label={`选择 ${weekdays[entry.weekday]} ${item?.name} ${entry.course.name} ${weeklyTargetName(entry)}`}
                className="flex w-full items-center gap-4 border-b px-4 py-3 text-left last:border-b-0 hover:enabled:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:text-muted-foreground"
              >
                <div className="w-28 shrink-0 text-sm">
                  <p className="font-medium">
                    {weekdays[entry.weekday]} · {item?.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {weekPatternName(entry)} · {item?.start_time.slice(0, 5)}
                  </p>
                </div>
                <div className="min-w-0 flex-1">{content(entry)}</div>
                {entry.is_locked ? (
                  <span className="flex items-center gap-1 text-xs">
                    <Lock className="size-3" />
                    已锁定
                  </span>
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
