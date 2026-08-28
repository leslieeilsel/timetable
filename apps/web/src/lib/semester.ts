import { useParams } from "react-router"
import { useSchoolContext } from "@/lib/queries"
import type { Role, TimetableVersion } from "@/lib/types"

export type SemesterDestination =
  | "setup"
  | "preparation"
  | "assignments"
  | "constraints"
  | "generate"
  | "timetable"
  | "adjustments"
  | "leaves"

const currentSemesterEntries: Record<SemesterDestination, string> = {
  setup: "/semester/setup",
  preparation: "/scheduling/preparation",
  assignments: "/scheduling/assignments",
  constraints: "/scheduling/constraints",
  generate: "/scheduling/generate",
  timetable: "/scheduling/timetable",
  adjustments: "/daily/adjustments",
  leaves: "/daily/leaves",
}

const destinationByCurrentEntry = new Map<string, SemesterDestination>([
  ...Object.entries(currentSemesterEntries).map(
    ([destination, path]) => [path, destination as SemesterDestination] as const,
  ),
  ["/semester/assignments", "assignments"],
  ["/semester/timetable", "timetable"],
])

const schedulingDestinations = new Set<SemesterDestination>([
  "setup",
  "preparation",
  "assignments",
  "constraints",
  "generate",
  "timetable",
])

const dailyDestinations = new Set<SemesterDestination>(["adjustments", "leaves"])

export function semesterPath(semesterId: number, destination: SemesterDestination) {
  if (!Number.isSafeInteger(semesterId) || semesterId <= 0) {
    throw new Error("semesterId must be a positive safe integer")
  }
  return `/semesters/${semesterId}/${destination}`
}

export function currentSemesterEntryPath(destination: SemesterDestination) {
  return currentSemesterEntries[destination]
}

export function semesterPathOrCurrent(semesterId: number | null, destination: SemesterDestination) {
  return semesterId === null
    ? currentSemesterEntryPath(destination)
    : semesterPath(semesterId, destination)
}

export function semesterDestinationForPath(path: string): SemesterDestination | null {
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/"
  const currentDestination = destinationByCurrentEntry.get(pathname)
  if (currentDestination) return currentDestination
  const match =
    /^\/semesters\/[1-9]\d*\/(setup|preparation|assignments|constraints|generate|timetable|adjustments|leaves)$/.exec(
      pathname,
    )
  return (match?.[1] as SemesterDestination | undefined) ?? null
}

export function isSchedulingSemesterPath(path: string) {
  const destination = semesterDestinationForPath(path)
  return destination !== null && schedulingDestinations.has(destination)
}

export function isDailySemesterPath(path: string) {
  const destination = semesterDestinationForPath(path)
  return destination !== null && dailyDestinations.has(destination)
}

export function withSemesterId(semesterId: number, path: string) {
  const destination = semesterDestinationForPath(path)
  if (!destination || path.startsWith("/semesters/")) return path
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/"
  return `${semesterPath(semesterId, destination)}${path.slice(pathname.length)}`
}

export function resolveSemesterId(
  routeSemesterId: string | undefined,
  currentSemesterId: number | null | undefined,
) {
  if (routeSemesterId === undefined) return currentSemesterId ?? null
  if (!/^[1-9]\d*$/.test(routeSemesterId)) return null
  const parsed = Number(routeSemesterId)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function resolveTimetableVersionSelection(
  versions: Pick<TimetableVersion, "id" | "status">[],
  selectedVersionId: string,
  currentTimetableVersionId: number | null | undefined,
  role: Role | null | undefined,
) {
  const selectable = timetableVersionsForRole(versions, role)
  if (selectable.some((version) => String(version.id) === selectedVersionId)) {
    return selectedVersionId
  }

  const current = selectable.find((version) => version.id === currentTimetableVersionId)
  if (role !== "admin" && role !== "scheduler") {
    return current ? String(current.id) : ""
  }

  const editable = selectable.find((version) => version.status === "draft")
  const preferred = editable ?? current ?? selectable[0]
  return preferred ? String(preferred.id) : ""
}

export function timetableVersionsForRole<T extends Pick<TimetableVersion, "status">>(
  versions: T[],
  role: Role | null | undefined,
) {
  return role === "admin" || role === "scheduler"
    ? versions
    : versions.filter((version) => version.status !== "draft")
}

export function useResolvedSemesterId() {
  const params = useParams()
  const context = useSchoolContext()
  const semesterId = resolveSemesterId(params.semesterId, context.data?.current_semester?.id)
  return { semesterId, context, isExplicitSemester: params.semesterId !== undefined }
}
