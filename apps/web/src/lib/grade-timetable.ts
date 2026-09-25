import type { ClassSetting, TeachingAssignment, TimetableEntry } from "@/lib/types"

export interface GradeConflict {
  type: string
  message: string
  entry_id?: number
  existing_entry_id?: number
  assignment_id?: number
  weekday?: number
  item_id?: number
  item_name?: string
  fixed_placement_id?: number
  constraint_id?: number
}

export interface GradeValidation {
  draft_assignment_count?: number
  synchronization_issues?: Array<{
    message?: string
    assignment_ids?: number[]
    teaching_assignment_id?: number
    assignment_id?: number
    type?: string
  }>
  hard_conflicts: GradeConflict[]
  incomplete_assignments: { id: number; required: number; scheduled: number }[]
}

export function entryClassIds(entry: TimetableEntry) {
  return [
    ...new Set([
      ...(entry.school_classes ?? []).map((item) => item.id),
      ...(entry.school_class_id === null ? [] : [entry.school_class_id]),
    ]),
  ]
}

export function assignmentClassIds(assignment: TeachingAssignment) {
  return assignment.school_class_id === null
    ? (assignment.teaching_group?.school_classes.map((item) => item.id) ?? [])
    : [assignment.school_class_id]
}

export function activeGradeClasses(settings: ClassSetting[]) {
  return settings
    .filter((item) => item.status === "active" && item.school_class.status === "active")
    .map((item) => item.school_class)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }))
}

export function gradeRows(
  settings: ClassSetting[],
  gradeId: number,
  entries: TimetableEntry[],
  assignments: TeachingAssignment[],
  validation?: GradeValidation,
) {
  const classes = activeGradeClasses(settings).filter((item) => item.grade_id === gradeId)
  return classes.map((schoolClass) => {
    const classEntries = entries.filter((entry) => entryClassIds(entry).includes(schoolClass.id))
    const entryIds = new Set(classEntries.map((entry) => entry.id))
    const classAssignments = assignments.filter((assignment) =>
      assignmentClassIds(assignment).includes(schoolClass.id),
    )
    const assignmentIds = new Set(classAssignments.map((assignment) => assignment.id))
    const conflicts =
      validation?.hard_conflicts.filter(
        (conflict) =>
          (conflict.entry_id !== undefined && entryIds.has(conflict.entry_id)) ||
          (conflict.existing_entry_id !== undefined && entryIds.has(conflict.existing_entry_id)) ||
          (conflict.assignment_id !== undefined && assignmentIds.has(conflict.assignment_id)) ||
          (conflict.entry_id === undefined &&
            conflict.existing_entry_id === undefined &&
            conflict.assignment_id === undefined),
      ) ?? []
    const incomplete =
      validation?.incomplete_assignments.filter((item) => assignmentIds.has(item.id)) ?? []
    return {
      schoolClass,
      entries: classEntries,
      conflicts,
      remaining: incomplete.reduce(
        (sum, item) => sum + Math.max(0, item.required - item.scheduled),
        0,
      ),
      hasIssues: conflicts.length > 0 || incomplete.length > 0,
    }
  })
}

export function entryTeachers(entry: TimetableEntry) {
  return entry.teachers?.length ? entry.teachers : [entry.teacher]
}

export function timetableCsv(rows: string[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            const safe = /^[\s]*[=+\-@]/.test(value) ? "'" + value : value
            return '"' + safe.replaceAll('"', '""') + '"'
          })
          .join(","),
      )
      .join("\r\n")
  )
}
