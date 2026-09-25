import { useMemo, useState, type ReactNode } from "react"
import { CheckCircle2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SimpleSelect } from "@/components/simple-select"
import { Field } from "@/components/page"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TeacherPicker, RoomPicker, ClassPicker } from "@/components/resource-picker"
import {
  AdjustmentActionTabs,
  AdjustmentSourceSummary,
  AdjustmentEditorLayout,
  AdjustmentTargetSection,
  AdjustmentCourseChoices,
} from "@/components/adjustments/workbench"
import { weekPatternName } from "@/components/timetable-grid"
import type { Room, SchoolClass, Semester, Teacher } from "@/lib/types"
import {
  applyOperations,
  changedEntries,
  matchesObject,
  placementProblem,
  weekdays,
  type ChangeFields,
  type ChangeOperation,
  type LongTermEntry,
  type LongTermSource,
  type LongTermSelection,
} from "@/lib/long-term-changes"
import {
  WeeklyLessonPicker,
  weeklyRoomName,
  weeklyTargetName,
  weeklyTeacherName,
} from "./lesson-picker"

type Action = "swap" | "move" | "teacher" | "room"
type Target = {
  key: string
  weekday: number
  itemId: number
  title: string
  detail: string
  reason: string | null
  updates: Record<number, Partial<ChangeFields>>
  entry?: LongTermEntry
}

export function LongTermEditor({
  source,
  semester,
  view,
  resourceId,
  resourceName,
  teachers,
  rooms,
  operations,
  onOperations,
  selection,
  onSelection,
  classes,
  scopeDescription,
  children,
  footer,
}: {
  source: LongTermSource
  classes: SchoolClass[]
  scopeDescription: string
  children?: ReactNode
  footer?: ReactNode
  semester: Semester
  view: string
  resourceId: string
  resourceName: string
  teachers: Teacher[]
  rooms: Room[]
  operations: ChangeOperation[]
  onOperations: (value: ChangeOperation[]) => void
  selection: LongTermSelection
  onSelection: (value: LongTermSelection) => void
}) {
  const selectedId = selection.entryId
  const action = selection.action
  const batch = selection.scope === "assignment"
  const [search, setSearch] = useState("")
  const [targetWeekday, setTargetWeekday] = useState(
    String(source.entries.find((entry) => entry.id === selection.entryId)?.weekday ?? 1),
  )
  const [targetPeriod, setTargetPeriod] = useState("")
  const [targetClass, setTargetClass] = useState(
    String(
      source.entries.find((entry) => entry.id === selection.entryId)?.school_classes[0]?.id ?? "",
    ),
  )
  const [choosing, setChoosing] = useState(false)
  const [reference, setReference] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const [appliedId, setAppliedId] = useState<number | null>(
    () => operations.findLast((operation) => operation.updates[selectedId])?.id ?? null,
  )
  const edited = useMemo(
    () => applyOperations(source.entries, operations),
    [source.entries, operations],
  )
  const first = edited.find((entry) => entry.id === selectedId)
  const original = source.entries.find((entry) => entry.id === selectedId)
  const originalAssignment = original
    ? source.entries.filter(
        (entry) => entry.teaching_assignment_id === original.teaching_assignment_id,
      )
    : []
  const related = useMemo(() => {
    const originalIds = new Set(
      source.entries
        .filter((entry) => matchesObject(entry, view, resourceId))
        .map((entry) => entry.id),
    )
    return edited.filter(
      (entry) => originalIds.has(entry.id) || matchesObject(entry, view, resourceId),
    )
  }, [source.entries, edited, view, resourceId])
  const assignment = first
    ? edited.filter((entry) => entry.teaching_assignment_id === first.teaching_assignment_id)
    : []
  const selected =
    batch && (action === "teacher" || action === "room") ? assignment : first ? [first] : []
  const selectedIds = selected.map((entry) => entry.id)
  const applied = operations.find((operation) => operation.id === appliedId)
  const appliedPartner = applied
    ? edited.find((entry) => entry.id !== selectedId && Object.hasOwn(applied.updates, entry.id))
    : undefined
  const changedCount = changedEntries(source.entries, edited).length
  const adding = (label: string, updates: Record<number, Partial<ChangeFields>>) => {
    const operation = { id: Date.now(), label, updates }
    const next = applyOperations(edited, [operation])
    const problem = placementProblem(next, Object.keys(updates).map(Number), semester)
    if (problem) return toast.error(problem)
    if (!changedEntries(edited, next).length) return toast.info("安排没有变化")
    onOperations([...operations, operation])
    setAppliedId(operation.id)
  }
  const targets: Target[] = useMemo(() => {
    if (
      !first ||
      batch ||
      (action !== "swap" && action !== "move") ||
      applied ||
      (action === "swap" && (!targetPeriod || !targetClass))
    )
      return []
    const candidates =
      action === "swap"
        ? edited
            .filter(
              (entry) =>
                entry.id !== first.id &&
                entry.weekday === Number(targetWeekday) &&
                (targetPeriod === "all" || entry.item_id === Number(targetPeriod)) &&
                entry.school_classes.some((schoolClass) => String(schoolClass.id) === targetClass),
            )
            .map((entry) => ({ weekday: entry.weekday, itemId: entry.item_id, entry }))
        : source.items.map((item) => ({
            weekday: Number(targetWeekday),
            itemId: item.id,
            entry: undefined as LongTermEntry | undefined,
          }))
    return candidates
      .map(({ weekday, itemId, entry }) => {
        const item = source.items.find((item) => item.id === itemId)
        const updates: Record<number, Partial<ChangeFields>> = {
          [first.id]: { weekday, item_id: itemId },
          ...(entry ? { [entry.id]: { weekday: first.weekday, item_id: first.item_id } } : {}),
        }
        const sameSlot = weekday === first.weekday && itemId === first.item_id
        return {
          key: entry ? String(entry.id) : `${weekday}:${itemId}`,
          entry,
          weekday,
          itemId,
          title: `${weekdays[weekday]} · ${item?.name}${entry ? ` · ${entry.course.name}` : ""}`,
          detail: entry
            ? `${weeklyTargetName(entry)} · ${weeklyTeacherName(entry, teachers)} · ${weeklyRoomName(entry, rooms)} · ${weekPatternName(entry)}`
            : `${item?.start_time.slice(0, 5)}–${item?.end_time.slice(0, 5)}`,
          reason: sameSlot
            ? "原课程所在课节"
            : placementProblem(
                applyOperations(edited, [{ id: 0, label: "", updates }]),
                Object.keys(updates).map(Number),
                semester,
              ),
          updates,
        }
      })
      .sort(
        (a, b) =>
          (source.items.find((item) => item.id === a.itemId)?.sort_order ?? 0) -
            (source.items.find((item) => item.id === b.itemId)?.sort_order ?? 0) ||
          a.key.localeCompare(b.key),
      )
  }, [
    first,
    action,
    batch,
    targetClass,
    targetWeekday,
    targetPeriod,
    source,
    edited,
    semester,
    teachers,
    rooms,
    applied,
  ])
  const visibleTargets = targets.filter((target) =>
    `${target.title} ${target.detail}`.includes(search.trim()),
  )
  const disabledResources = (kind: "teacher" | "room") =>
    Object.fromEntries(
      (kind === "teacher" ? teachers : rooms).flatMap((resource) => {
        const field = kind === "teacher" ? "teacher_id" : "actual_room_id"
        if (selected.every((entry) => entry[field] === resource.id))
          return [[resource.id, kind === "teacher" ? "与当前主讲老师相同" : "与当前教室相同"]]
        const updates = Object.fromEntries(
          selected.map((entry) => [entry.id, { [field]: resource.id }]),
        )
        const reason = placementProblem(
          applyOperations(edited, [{ id: 0, label: "", updates }]),
          selectedIds,
          semester,
        )
        return reason ? [[resource.id, reason]] : []
      }),
    )
  const replaceResource = (value: string) => {
    if (!value || !first) return
    const field = action === "teacher" ? "teacher_id" : "actual_room_id"
    const name = (action === "teacher" ? teachers : rooms).find(
      (resource) => resource.id === Number(value),
    )?.name
    adding(
      `${selected.length} 节${first.course.name} · ${action === "teacher" ? "老师" : "教室"}改为${name}`,
      Object.fromEntries(selected.map((entry) => [entry.id, { [field]: Number(value) }])),
    )
  }
  const changeAction = (value: string) => {
    onSelection({ ...selection, action: value as Action })
    setAppliedId(null)
    setSearch("")
    setTargetWeekday(String(first?.weekday ?? 1))
    setTargetPeriod("")
  }
  const chooseTarget = (target: Target) =>
    adding(
      `${first?.course.name} · ${action === "swap" ? "与" : "移至"}${target.title}${action === "swap" ? "互换" : ""}`,
      target.updates,
    )
  const chooseCourse = (entry: LongTermEntry, scope: LongTermSelection["scope"]) => {
    onSelection({ entryId: entry.id, scope, action: scope === "assignment" ? "teacher" : "swap" })
    setChoosing(false)
    setAppliedId(null)
    setSearch("")
    setTargetWeekday(String(entry.weekday))
    setTargetPeriod("")
    setTargetClass(String(entry.school_classes[0]?.id ?? ""))
  }
  const sourceSummary = original ? (
    <AdjustmentSourceSummary
      title={original.course.name}
      subtitle={weeklyTargetName(original)}
      date={
        batch ? `整项任课 · ${originalAssignment.length} 个固定课节` : weekPatternName(original)
      }
      time={
        batch
          ? originalAssignment
              .map(
                (entry) =>
                  `${weekdays[entry.weekday]} ${source.items.find((item) => item.id === entry.item_id)?.name}`,
              )
              .join("、")
          : `${weekdays[original.weekday]} ${source.items.find((item) => item.id === original.item_id)?.name}`
      }
      teachers={[
        ...new Set(originalAssignment.map((entry) => weeklyTeacherName(entry, teachers))),
      ].join("、")}
      room={
        batch
          ? [...new Set(originalAssignment.map((entry) => weeklyRoomName(entry, rooms)))].join("、")
          : weeklyRoomName(original, rooms)
      }
      detail={
        <>
          生效期间
          <br />
          {scopeDescription}
        </>
      }
      onReselect={() => setChoosing(true)}
    />
  ) : undefined
  const referenceAction = (
    <Button
      size="sm"
      variant="ghost"
      className="shrink-0 text-xs font-normal text-muted-foreground"
      onClick={() => setReference(true)}
    >
      查看周课表
    </Button>
  )
  return (
    <>
      <AdjustmentEditorLayout source={sourceSummary} footer={footer}>
        <div className="space-y-6">
          {first && original && (
            <>
              {selected.some((entry) => entry.is_locked) && (
                <p role="status" className="rounded-lg border p-3 text-sm text-muted-foreground">
                  所选课程含已锁定课节，不能持续调整。请重选课程；如确需修改，请先在编排课表中核对锁定及固定安排。
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <AdjustmentActionTabs
                    value={action}
                    onChange={changeAction}
                    options={[
                      { value: "swap", label: "换课", disabled: first.is_locked },
                      { value: "move", label: "改时间", disabled: first.is_locked },
                      { value: "teacher", label: "换老师", disabled: first.is_locked },
                      { value: "room", label: "换教室", disabled: first.is_locked },
                    ]}
                  />
                </div>
                {operations.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setChangesOpen(true)}>
                    <Undo2 />
                    本次已改 {changedCount} 节
                  </Button>
                )}
              </div>
              {applied ? (
                <div className="space-y-4 rounded-lg border p-5">
                  <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-4 text-[var(--timetable-success-accent)]" />
                    新安排已设置，尚未发布
                  </p>
                  {action === "swap" && appliedPartner ? (
                    <>
                      <p className="text-xs text-muted-foreground">目标课程</p>
                      <p className="text-lg font-semibold">
                        {appliedPartner.course.name} · {weeklyTargetName(appliedPartner)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {weekdays[first.weekday]}{" "}
                        {source.items.find((item) => item.id === first.item_id)?.name} ·{" "}
                        {weeklyTeacherName(appliedPartner, teachers)} ·{" "}
                        {weeklyRoomName(appliedPartner, rooms)}
                      </p>
                      <p className="text-sm">{applied.label}</p>
                    </>
                  ) : (
                    <p className="text-lg font-semibold">{applied.label}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setAppliedId(null)}>
                      继续修改本课
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setChoosing(true)}>
                      调整其他课程
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        onOperations(operations.filter((operation) => operation.id !== applied.id))
                      }
                    >
                      <Undo2 />
                      撤销这步
                    </Button>
                  </div>
                </div>
              ) : batch && (action === "swap" || action === "move") ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">要调整其中哪一个固定课节？</p>
                  <p className="text-xs text-muted-foreground">
                    每个课节单独选择新时间，其余课节保持当前安排。
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {assignment.map((entry) => (
                      <Button
                        key={entry.id}
                        variant="outline"
                        disabled={entry.is_locked}
                        onClick={() => {
                          onSelection({ ...selection, entryId: entry.id, scope: "entry" })
                          setTargetWeekday(String(entry.weekday))
                          setTargetPeriod("")
                        }}
                      >
                        {weekdays[entry.weekday]}{" "}
                        {source.items.find((item) => item.id === entry.item_id)?.name}
                        {entry.week_pattern !== "all" && ` · ${weekPatternName(entry)}`}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : action === "teacher" || action === "room" ? (
                <AdjustmentTargetSection
                  action={referenceAction}
                  title={action === "teacher" ? "换成哪位老师？" : "换到哪个教室？"}
                >
                  {assignment.length > 1 && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={batch}
                        onChange={(event) =>
                          onSelection({
                            ...selection,
                            scope: event.target.checked ? "assignment" : "entry",
                          })
                        }
                      />
                      调整整项任课的全部 {assignment.length} 个固定课节
                    </label>
                  )}
                  <p className="text-sm font-medium">
                    {action === "teacher" ? "选择新的主讲老师" : "选择新的上课教室"}
                  </p>
                  {action === "teacher" ? (
                    <TeacherPicker
                      className="[&>button]:h-10"
                      teachers={teachers}
                      value=""
                      onValueChange={replaceResource}
                      courseId={first.course_id}
                      requireQualification
                      disabledReasons={disabledResources("teacher")}
                    />
                  ) : (
                    <RoomPicker
                      className="[&>button]:h-10"
                      rooms={rooms}
                      value=""
                      onValueChange={replaceResource}
                      disabledReasons={disabledResources("room")}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    本次选择 {selected.length} 节课，按设定的生效期间执行。
                    {action === "teacher" && first.teachers.length > 1
                      ? "替换主讲老师，协同老师继续参与。"
                      : ""}
                  </p>
                </AdjustmentTargetSection>
              ) : (
                <AdjustmentTargetSection
                  action={referenceAction}
                  title={action === "swap" ? "与哪节课互换？" : "改到什么时间？"}
                  description={
                    action === "swap"
                      ? "指定星期、课节和班级即可。"
                      : "只移动所选课程，其余固定课节保持当前安排。"
                  }
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="星期">
                      <SimpleSelect
                        label="目标星期"
                        value={targetWeekday}
                        onValueChange={(value) => {
                          setTargetWeekday(value)
                          setTargetPeriod("")
                        }}
                        className="h-10 w-full data-[size=default]:h-10"
                      >
                        {source.days.map((day) => (
                          <option key={day.weekday} value={day.weekday}>
                            {weekdays[day.weekday]}
                          </option>
                        ))}
                      </SimpleSelect>
                    </Field>
                    <Field label="课节">
                      {action === "swap" ? (
                        <SimpleSelect
                          label="目标课节"
                          value={targetPeriod}
                          onValueChange={setTargetPeriod}
                          className="h-10 w-full data-[size=default]:h-10"
                        >
                          <option value="">请选择目标课节</option>
                          <option value="all">查看当天全部课节</option>
                          {source.items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · {item.start_time.slice(0, 5)}
                            </option>
                          ))}
                        </SimpleSelect>
                      ) : (
                        <SimpleSelect
                          label="新的上课课节"
                          value=""
                          onValueChange={(value) => {
                            const target = targets.find((item) => String(item.itemId) === value)
                            if (target && !target.reason) chooseTarget(target)
                          }}
                          className="h-10 w-full data-[size=default]:h-10"
                        >
                          <option value="">请选择课节</option>
                          {targets.map((target) => (
                            <option
                              key={target.key}
                              value={target.itemId}
                              disabled={Boolean(target.reason)}
                            >
                              {source.items.find((item) => item.id === target.itemId)?.name}
                              {target.reason ? `（${target.reason}）` : ""}
                            </option>
                          ))}
                        </SimpleSelect>
                      )}
                    </Field>
                    {action === "swap" && (
                      <Field label="班级">
                        <ClassPicker
                          className="[&>button]:h-10"
                          classes={classes}
                          value={targetClass}
                          onValueChange={(value) => {
                            setTargetClass(value)
                            setSearch("")
                          }}
                        />
                      </Field>
                    )}
                  </div>
                  {action === "swap" && (!targetPeriod || !targetClass) && (
                    <p className="rounded-lg bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                      请选择星期、课节和班级。
                    </p>
                  )}
                  {action === "swap" && targetPeriod && targetClass && (
                    <>
                      {(targetPeriod === "all" || search || targets.length > 1) && (
                        <Input
                          aria-label="搜索目标课程"
                          placeholder="按老师、课程或班级查找（可选）"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                        />
                      )}
                      {visibleTargets.length > 1 && (
                        <p className="text-xs text-muted-foreground">
                          {weekdays[Number(targetWeekday)]} · 共 {visibleTargets.length}{" "}
                          节匹配课程，点击要互换的那一节。
                        </p>
                      )}
                      <AdjustmentCourseChoices
                        choices={visibleTargets.flatMap((target) =>
                          target.entry
                            ? [
                                {
                                  key: target.key,
                                  period:
                                    source.items.find((item) => item.id === target.itemId)?.name ??
                                    "",
                                  time:
                                    source.items
                                      .find((item) => item.id === target.itemId)
                                      ?.start_time.slice(0, 5) ?? "",
                                  title: `${target.entry.course.name} · ${weeklyTargetName(target.entry)}`,
                                  teachers: weeklyTeacherName(target.entry, teachers),
                                  room: weeklyRoomName(target.entry, rooms),
                                  problem: target.reason ?? undefined,
                                },
                              ]
                            : [],
                        )}
                        onSelect={(key) => {
                          const target = targets.find((item) => item.key === key)
                          if (target && !target.reason) chooseTarget(target)
                        }}
                      />
                    </>
                  )}
                </AdjustmentTargetSection>
              )}
            </>
          )}
          {children}
        </div>
      </AdjustmentEditorLayout>
      <Dialog
        open={choosing || reference}
        onOpenChange={(open) => {
          if (!open) {
            setChoosing(false)
            setReference(false)
          }
        }}
      >
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{reference ? "周课表" : "选择课程"}</DialogTitle>
            <DialogDescription>
              {reference ? "查看本次修改后的每周安排。" : "已有修改会保留，可以继续调整其他课程。"}
            </DialogDescription>
          </DialogHeader>
          <WeeklyLessonPicker
            source={{ ...source, entries: edited }}
            entries={related}
            teachers={teachers}
            rooms={rooms}
            label={resourceName}
            initialGrid={reference}
            onSelect={reference ? undefined : (entry) => chooseCourse(entry, "entry")}
            onSelectAssignment={
              reference ? undefined : (entry) => chooseCourse(entry, "assignment")
            }
          />
        </DialogContent>
      </Dialog>
      <Dialog open={changesOpen} onOpenChange={setChangesOpen}>
        <DialogContent className="max-h-[80svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>本次修改</DialogTitle>
            <DialogDescription>尚未发布，可以逐步撤销。</DialogDescription>
          </DialogHeader>
          {operations.length ? (
            [...operations].reverse().map((operation) => (
              <div
                key={operation.id}
                className="flex items-center justify-between gap-3 border-b py-3 text-sm"
              >
                <p>{operation.label}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onOperations(operations.filter((candidate) => candidate.id !== operation.id))
                  }
                >
                  <Undo2 />
                  撤销
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">已撤销全部修改。</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
