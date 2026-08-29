import type { ClassSetting, Semester, TeachingAssignment, TimetableVersion } from "@/lib/types"

export type TimetableResourceView = "class" | "teacher" | "room"

export function isTimetableVersionStale(
  semester: Pick<Semester, "input_revision">,
  version: Pick<TimetableVersion, "input_revision"> | null | undefined,
) {
  return Boolean(version && String(version.input_revision) !== String(semester.input_revision))
}

export function pendingItemsForResource(
  assignments: TeachingAssignment[],
  view: TimetableResourceView,
  resourceId: number,
  classSettings: ClassSetting[],
) {
  return assignments
    .filter(
      (assignment) =>
        assignment.status === "confirmed" &&
        remainingItems(assignment) > 0 &&
        assignmentMatchesResource(assignment, view, resourceId, classSettings),
    )
    .reduce((sum, assignment) => sum + remainingItems(assignment), 0)
}

export function assignmentMatchesResource(
  assignment: TeachingAssignment,
  view: TimetableResourceView,
  resourceId: number,
  classSettings: ClassSetting[],
) {
  if (view === "class") {
    if (assignment.school_class_id !== null) return assignment.school_class_id === resourceId
    return Boolean(
      assignment.teaching_group?.school_classes.some(
        (schoolClass) => schoolClass.id === resourceId,
      ),
    )
  }

  if (view === "teacher") {
    return (
      assignment.teacher_id === resourceId ||
      assignment.collaborators.some((teacher) => teacher.id === resourceId)
    )
  }

  const roomId =
    assignment.room_mode === "specified"
      ? assignment.specified_room_id
      : classSettings.find((setting) => setting.school_class_id === assignment.school_class_id)
          ?.fixed_room_id
  return roomId === resourceId
}

function remainingItems(assignment: TeachingAssignment) {
  return Math.max(0, assignment.remaining ?? assignment.weekly_items - (assignment.scheduled ?? 0))
}
