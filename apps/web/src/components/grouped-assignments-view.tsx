import { CircleAlertIcon } from "lucide-react"
import type { ClassSetting, TeachingAssignment } from "@/lib/types"
import { StatusBadge } from "@/components/status-badge"
import { TableActionButton } from "@/components/table-action-button"
import { TablePagination, useTablePagination } from "@/components/table-pagination"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type GroupedAssignmentView = "class" | "teacher" | "course" | "room"

export interface AssignmentGroupEntry {
  assignment: TeachingAssignment
  contextLabel: string | null
  resolvedRoomName: string
}

export interface AssignmentGroup {
  key: string
  name: string
  subtitle: string
  sortRank: number
  entries: AssignmentGroupEntry[]
  weeklyItems: number
  scheduledItems: number
  draftCount: number
  inactiveCount: number
}

interface MutableAssignmentGroup {
  key: string
  name: string
  subtitle: string
  sortRank: number
  entries: Map<number, AssignmentGroupEntry>
}

interface RoomResolution {
  key: string
  name: string
  subtitle: string
  contextLabel: string
  sortRank: number
}

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" })

const groupLabels: Record<GroupedAssignmentView, string> = {
  class: "班级",
  teacher: "教师",
  course: "课程",
  room: "教室",
}

const roomTypeLabels: Record<string, string> = {
  classroom: "普通教室",
  standard: "普通教室",
  playground: "操场",
  sports: "体育场地",
  music_room: "音乐教室",
  music: "音乐教室",
  art_room: "美术教室",
  art: "美术教室",
  laboratory: "实验室",
  computer_room: "计算机教室",
  computer: "计算机教室",
  other: "其他",
}

export function buildAssignmentGroups(
  view: GroupedAssignmentView,
  assignments: TeachingAssignment[],
  settings: ClassSetting[],
) {
  const groups = new Map<string, MutableAssignmentGroup>()
  const settingMap = new Map(settings.map((setting) => [setting.school_class_id, setting]))

  const add = (
    descriptor: Omit<MutableAssignmentGroup, "entries">,
    assignment: TeachingAssignment,
    contextLabel: string | null,
  ) => {
    const group = groups.get(descriptor.key) ?? { ...descriptor, entries: new Map() }
    const existing = group.entries.get(assignment.id)
    if (!existing || contextLabel === "主讲") {
      group.entries.set(assignment.id, {
        assignment,
        contextLabel,
        resolvedRoomName: resolveRoom(assignment, settingMap).name,
      })
    }
    groups.set(group.key, group)
  }

  for (const assignment of assignments) {
    if (view === "class") {
      if (assignment.school_class) {
        const setting = settingMap.get(assignment.school_class.id)
        add(
          {
            key: `class:${assignment.school_class.id}`,
            name: assignment.school_class.name,
            subtitle: `${assignment.school_class.grade.name} · ${setting?.fixed_room?.name ?? "未设固定教室"}`,
            sortRank: assignment.school_class.grade_id,
          },
          assignment,
          null,
        )
        continue
      }

      const memberClasses = assignment.teaching_group?.school_classes ?? []
      if (memberClasses.length) {
        for (const schoolClass of memberClasses) {
          const setting = settingMap.get(schoolClass.id)
          add(
            {
              key: `class:${schoolClass.id}`,
              name: schoolClass.name,
              subtitle: `${schoolClass.grade.name} · ${setting?.fixed_room?.name ?? "未设固定教室"}`,
              sortRank: schoolClass.grade_id,
            },
            assignment,
            `教学组 · ${assignment.teaching_group?.name ?? "未命名教学组"}`,
          )
        }
      } else {
        add(
          {
            key: `teaching-group:${assignment.teaching_group_id ?? assignment.id}`,
            name: assignment.teaching_group?.name ?? "未关联班级",
            subtitle: "教学组 · 尚未关联成员班级",
            sortRank: 999,
          },
          assignment,
          "教学组",
        )
      }
      continue
    }

    if (view === "teacher") {
      add(
        {
          key: `teacher:${assignment.teacher.id}`,
          name: assignment.teacher.name,
          subtitle: assignment.teacher.employee_no
            ? `工号 ${assignment.teacher.employee_no}`
            : "主讲教师",
          sortRank: 0,
        },
        assignment,
        "主讲",
      )
      for (const teacher of assignment.collaborators) {
        add(
          {
            key: `teacher:${teacher.id}`,
            name: teacher.name,
            subtitle: teacher.employee_no ? `工号 ${teacher.employee_no}` : "协同教师",
            sortRank: 0,
          },
          assignment,
          "协同",
        )
      }
      continue
    }

    if (view === "course") {
      add(
        {
          key: `course:${assignment.course.id}`,
          name: assignment.course.name,
          subtitle: assignment.course.short_name
            ? `课表简称：${assignment.course.short_name}`
            : "课程",
          sortRank: 0,
        },
        assignment,
        null,
      )
      continue
    }

    const room = resolveRoom(assignment, settingMap)
    add(
      {
        key: room.key,
        name: room.name,
        subtitle: room.subtitle,
        sortRank: room.sortRank,
      },
      assignment,
      room.contextLabel,
    )
  }

  return [...groups.values()]
    .map<AssignmentGroup>((group) => {
      const entries = [...group.entries.values()].sort((a, b) => compareEntries(view, a, b))
      return {
        key: group.key,
        name: group.name,
        subtitle: group.subtitle,
        sortRank: group.sortRank,
        entries,
        weeklyItems: entries.reduce((sum, entry) => sum + entry.assignment.weekly_items, 0),
        scheduledItems: entries.reduce((sum, entry) => sum + (entry.assignment.scheduled ?? 0), 0),
        draftCount: entries.filter((entry) => entry.assignment.status === "draft").length,
        inactiveCount: entries.filter((entry) => entry.assignment.status === "inactive").length,
      }
    })
    .sort(
      (a, b) =>
        a.sortRank - b.sortRank ||
        Number(a.key.includes("unassigned")) - Number(b.key.includes("unassigned")) ||
        collator.compare(a.name, b.name),
    )
}

export function filterAssignmentGroups(groups: AssignmentGroup[], search: string) {
  const query = search.trim().toLocaleLowerCase("zh-CN")
  if (!query) return groups
  return groups.filter((group) => {
    const groupText = `${group.name} ${group.subtitle}`.toLocaleLowerCase("zh-CN")
    if (groupText.includes(query)) return true
    return group.entries.some(({ assignment, contextLabel, resolvedRoomName }) =>
      [
        assignmentTarget(assignment),
        assignment.course.name,
        assignment.course.short_name,
        assignment.teacher.name,
        assignment.collaborators.map((teacher) => teacher.name).join(" "),
        contextLabel,
        resolvedRoomName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(query),
    )
  })
}

export function GroupedAssignmentsTable({
  view,
  groups,
  onEdit,
  onAction,
}: {
  view: GroupedAssignmentView
  groups: AssignmentGroup[]
  onEdit: (assignment: TeachingAssignment) => void
  onAction: (path: string, message: string, body?: unknown) => void
}) {
  const pagination = useTablePagination(groups, 10)
  const secondaryHeader =
    view === "class" ? "教师" : view === "teacher" ? "课程" : view === "course" ? "教师" : "课程"
  const tertiaryHeader = view === "teacher" ? "角色" : view === "room" ? "教师" : null

  return (
    <>
      <Table className="min-w-[1120px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-56">{groupLabels[view]}</TableHead>
            <TableHead>{view === "class" ? "课程" : "授课对象"}</TableHead>
            <TableHead>{secondaryHeader}</TableHead>
            {tertiaryHeader && <TableHead>{tertiaryHeader}</TableHead>}
            <TableHead>课时与周型</TableHead>
            {view !== "room" && <TableHead>教室</TableHead>}
            <TableHead>排课进度</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagination.items.map((group, groupIndex) =>
            group.entries.map((entry, entryIndex) => {
              const assignment = entry.assignment
              return (
                <TableRow
                  key={`${group.key}:${assignment.id}`}
                  className={cn(
                    entryIndex === 0 && groupIndex > 0 && "border-t-2",
                    assignment.status === "draft" &&
                      "bg-amber-50/65 hover:bg-amber-50 dark:bg-amber-950/45 dark:hover:bg-amber-950/60",
                    assignment.status === "inactive" && "text-muted-foreground",
                  )}
                >
                  {entryIndex === 0 && (
                    <th
                      scope="rowgroup"
                      rowSpan={group.entries.length}
                      className="w-56 border-r border-b bg-muted/30 p-4 text-left align-top font-normal whitespace-normal"
                    >
                      <p className="font-semibold text-foreground [overflow-wrap:anywhere]">
                        {group.name}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                        {group.subtitle}
                      </p>
                      <div className="mt-4 grid gap-1 text-sm text-muted-foreground">
                        <p>
                          {group.entries.length} 项任课 · 周 {group.weeklyItems} 节
                        </p>
                        <p className="tabular-nums">
                          已排 {group.scheduledItems}/{group.weeklyItems}
                        </p>
                        {group.draftCount > 0 && (
                          <p className="inline-flex items-center gap-1 font-medium text-amber-700">
                            <CircleAlertIcon className="size-4" />
                            {group.draftCount} 条待确认
                          </p>
                        )}
                      </div>
                    </th>
                  )}
                  <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                    <p className="font-medium text-foreground">
                      {view === "class" ? assignment.course.name : assignmentTarget(assignment)}
                    </p>
                    {view === "class" && entry.contextLabel && (
                      <p className="mt-0.5 text-sm text-muted-foreground">{entry.contextLabel}</p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                    {view === "class" || view === "course"
                      ? teacherLabel(assignment)
                      : assignment.course.name}
                  </TableCell>
                  {view === "teacher" && (
                    <TableCell>
                      <span className="font-medium">{entry.contextLabel}</span>
                    </TableCell>
                  )}
                  {view === "room" && (
                    <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                      {teacherLabel(assignment)}
                    </TableCell>
                  )}
                  <TableCell>
                    <p>
                      周 {assignment.weekly_items} 节
                      {assignment.items_per_session > 1
                        ? ` · ${assignment.items_per_session} 连排`
                        : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {weekPatternLabel(assignment.week_pattern)}
                    </p>
                  </TableCell>
                  {view !== "room" && (
                    <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                      {entry.resolvedRoomName}
                    </TableCell>
                  )}
                  <TableCell className="tabular-nums">
                    {assignment.scheduled ?? 0}/{assignment.weekly_items}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      value={assignment.status}
                      label={assignment.status === "draft" ? "待确认" : undefined}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <AssignmentActions
                      assignment={assignment}
                      onEdit={onEdit}
                      onAction={onAction}
                    />
                  </TableCell>
                </TableRow>
              )
            }),
          )}
        </TableBody>
      </Table>
      <div className="[&>div>div:last-child]:max-w-full [&>div>div:last-child]:flex-wrap [&>div>div:last-child]:self-stretch [&>div>div:last-child]:justify-end sm:[&>div>div:last-child]:flex-nowrap sm:[&>div>div:last-child]:self-auto">
        <TablePagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          totalPages={pagination.totalPages}
          unit={groupLabels[view]}
          pageSizeOptions={[10, 20, 50]}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
        />
      </div>
    </>
  )
}

function AssignmentActions({
  assignment,
  onEdit,
  onAction,
}: {
  assignment: TeachingAssignment
  onEdit: (assignment: TeachingAssignment) => void
  onAction: (path: string, message: string, body?: unknown) => void
}) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      {assignment.status === "draft" && (
        <TableActionButton
          intent="activate"
          onClick={() =>
            onAction("/confirm", "任课关系已确认", { assignment_ids: [assignment.id] })
          }
        >
          确认
        </TableActionButton>
      )}
      <TableActionButton intent="edit" onClick={() => onEdit(assignment)}>
        编辑
      </TableActionButton>
      {assignment.status === "confirmed" && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onAction(`/${assignment.id}/unconfirm`, "已退回待确认")}
        >
          退回待确认
        </Button>
      )}
      {assignment.status === "inactive" ? (
        <TableActionButton
          intent="activate"
          onClick={() => onAction(`/${assignment.id}/restore`, "已恢复为待确认")}
        >
          恢复
        </TableActionButton>
      ) : (
        <TableActionButton
          intent="deactivate"
          onClick={() => onAction(`/${assignment.id}/deactivate`, "任课关系已停用")}
        >
          停用
        </TableActionButton>
      )}
    </div>
  )
}

function compareEntries(
  view: GroupedAssignmentView,
  a: AssignmentGroupEntry,
  b: AssignmentGroupEntry,
) {
  const aPrimary = view === "class" ? a.assignment.course.name : assignmentTarget(a.assignment)
  const bPrimary = view === "class" ? b.assignment.course.name : assignmentTarget(b.assignment)
  return (
    collator.compare(aPrimary, bPrimary) ||
    collator.compare(a.assignment.course.name, b.assignment.course.name)
  )
}

function resolveRoom(
  assignment: TeachingAssignment,
  settings: Map<number, ClassSetting>,
): RoomResolution {
  if (assignment.room_mode === "specified") {
    return {
      key: `room:${assignment.specified_room_id ?? "unassigned"}`,
      name: assignment.specified_room?.name ?? "未指定教室",
      subtitle: assignment.specified_room
        ? roomTypeLabel(assignment.specified_room.type)
        : "需要补充指定教室",
      contextLabel: "指定教室",
      sortRank: assignment.specified_room ? 0 : 998,
    }
  }

  if (assignment.school_class_id !== null) {
    const room = settings.get(assignment.school_class_id)?.fixed_room
    return room
      ? {
          key: `room:${room.id}`,
          name: room.name,
          subtitle: roomTypeLabel(room.type),
          contextLabel: "班级固定教室",
          sortRank: 0,
        }
      : {
          key: "room:unassigned",
          name: "未指定教室",
          subtitle: "班级尚未设置固定教室",
          contextLabel: "班级固定教室未设置",
          sortRank: 999,
        }
  }

  return {
    key: "room:class-default",
    name: "随班级固定教室",
    subtitle: "教学组按成员班级分配",
    contextLabel: assignment.teaching_group?.name
      ? `教学组 · ${assignment.teaching_group.name}`
      : "教学组",
    sortRank: 997,
  }
}

function assignmentTarget(assignment: TeachingAssignment) {
  return assignment.school_class?.name ?? assignment.teaching_group?.name ?? "未指定授课对象"
}

function teacherLabel(assignment: TeachingAssignment) {
  return assignment.collaborators.length
    ? `${assignment.teacher.name} · 协同 ${assignment.collaborators.map((teacher) => teacher.name).join("、")}`
    : assignment.teacher.name
}

function weekPatternLabel(value: TeachingAssignment["week_pattern"]) {
  if (value === "a") return "A 周"
  if (value === "b") return "B 周"
  if (value === "specified") return "指定周"
  return "每周"
}

function roomTypeLabel(value: string) {
  return roomTypeLabels[value] ?? (value || "其他教室")
}
