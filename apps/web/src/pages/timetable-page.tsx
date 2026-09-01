import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router"
import {
  AlertTriangleIcon,
  ArrowRightLeftIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FilePlus2Icon,
  LoaderCircleIcon,
  LockIcon,
  Redo2Icon,
  SparklesIcon,
  Undo2Icon,
  UnlockIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api, apiAllPages, ApiError, apiMessage, jsonBody } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import {
  resolveTimetableVersionSelection,
  semesterPath,
  timetableVersionsForRole,
  useResolvedSemesterId,
} from "@/lib/semester"
import {
  assignmentMatchesResource,
  isTimetableVersionStale,
  pendingItemsForResource,
} from "@/lib/timetable-state"
import { mergeSearchParams, useHashPreservingSearchParams } from "@/lib/url-state"
import { cn } from "@/lib/utils"
import type {
  ClassSetting,
  ScheduleDay,
  Item,
  Semester,
  ScheduleRun,
  TeachingAssignment,
  TimetableEntry,
  TimetableVersion,
  Room,
  Teacher,
  PaginationMeta,
} from "@/lib/types"
import { EmptyList, ErrorState, Field, LoadingState, PageHeader } from "@/components/page"
import { BulkTimetableExportDialog } from "@/components/bulk-timetable-export-dialog"
import {
  AssignmentPicker,
  ClassPicker,
  RoomPicker,
  TeacherPicker,
  teachersWithAssignmentCourses,
} from "@/components/resource-picker"
import { SimpleSelect } from "@/components/simple-select"
import {
  entryTargetName,
  TimetableGrid,
  type TimetableView,
  weekPatternName,
  weekdayName,
} from "@/components/timetable-grid"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { TablePagination } from "@/components/table-pagination"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type View = TimetableView
interface TimetableData {
  view: View
  resource_id: number | null
  mode: "official" | "full"
  days: ScheduleDay[]
  items: Item[]
  entries: TimetableEntry[]
  version: TimetableVersion | null
}
interface TimetableVersionComparisonEntry {
  entry_id: number
  weekday: number
  item_id: number
  item_name: string
  item_sort_order: number
  time: string
  teacher_ids: number[]
  teacher_names: string[]
  room_id: number
  room_name: string
  week_pattern: TimetableEntry["week_pattern"]
  active_weeks: number[] | null
  is_locked: boolean
}
interface TimetableVersionChange {
  assignment_id: number
  target: string
  course: string
  change_types: Array<
    | "added"
    | "removed"
    | "moved"
    | "teacher_changed"
    | "room_changed"
    | "week_pattern_changed"
    | "lock_changed"
  >
  description: string
  before: TimetableVersionComparisonEntry | null
  after: TimetableVersionComparisonEntry | null
}
interface TimetableVersionComparison {
  left_version: TimetableVersion
  right_version: TimetableVersion
  summary: Record<
    | "total_changes"
    | "unchanged"
    | "added"
    | "removed"
    | "moved"
    | "teacher_changed"
    | "room_changed"
    | "week_pattern_changed"
    | "lock_changed",
    number
  >
  changes: TimetableVersionChange[]
}
interface TimetableDiagnosis {
  allowed: boolean
  summary: string
  hard_conflicts: Array<{
    type: string
    message: string
    resource_name?: string
    existing_entry_id?: number
  }>
  soft_warnings: string[]
  soft_penalty: number
  estimated_quality_delta: number
  assignment: {
    id: number
    target: string
    course: string
    teachers: string
    room: string
  }
  target: { weekday: number; item_id: number; item_name: string }
  alternatives: Array<{
    weekday: number
    item_id: number
    item_name: string
    soft_penalty: number
    explanations: string[]
  }>
}
interface TimetableSwapDiagnosis {
  allowed: boolean
  summary: string
  entry: TimetableDiagnosis
  target: TimetableDiagnosis
}
type TimetablePosition = { weekday: number; itemId: number }
type TimetableEditAction =
  | {
      type: "move"
      label: string
      entryId: number
      before: TimetablePosition
      after: TimetablePosition
    }
  | {
      type: "swap"
      label: string
      entryId: number
      targetEntryId: number
    }
  | {
      type: "lock"
      label: string
      entryId: number
      before: boolean
      after: boolean
    }
  | {
      type: "create" | "delete"
      label: string
      entryId: number
      assignmentId: number
      position: TimetablePosition
      weekPattern: TimetableEntry["week_pattern"]
    }
export function TimetablePage() {
  const { user } = useAuth()
  const { semesterId, context } = useResolvedSemesterId()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [params, setParams] = useHashPreservingSearchParams()
  const [view, setView] = useState<View>("class")
  const [resourceId, setResourceId] = useState("")
  const [selectedVersionId, setSelectedVersionId] = useState(() => params.get("version") ?? "")
  const [full, setFull] = useState(false)
  const [history, setHistory] = useState<TimetableEditAction[]>([])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [replanStarting, setReplanStarting] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [bulkExportOpen, setBulkExportOpen] = useState(false)
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
    queryFn: () => apiAllPages<ClassSetting>(`/api/v1/semesters/${semesterId}/class-settings`),
    enabled: semesterId !== null,
  })
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => apiAllPages<Room>("/api/v1/rooms"),
  })
  const allTeachers = useQuery({
    queryKey: ["teachers"],
    queryFn: () => apiAllPages<Teacher>("/api/v1/teachers"),
    enabled: bulkExportOpen,
  })
  const versions = useQuery({
    queryKey: ["timetable-versions", semesterId],
    queryFn: () =>
      apiAllPages<TimetableVersion>(`/api/v1/semesters/${semesterId}/timetable-versions`),
    enabled: semesterId !== null,
  })
  const availableVersions = useMemo(() => versions.data?.data ?? [], [versions.data?.data])
  const selectableVersions = useMemo(
    () => timetableVersionsForRole(availableVersions, user?.role),
    [availableVersions, user?.role],
  )
  const selectedVersionExists = selectableVersions.some(
    (version) => String(version.id) === selectedVersionId,
  )
  const canDefaultToNoVersion =
    (user?.role === "admin" || user?.role === "scheduler") &&
    versions.isSuccess &&
    availableVersions.length === 0
  const versionSelectionReady = selectedVersionExists || canDefaultToNoVersion
  const assignments = useQuery({
    queryKey: ["teaching-assignments", semesterId, "confirmed", selectedVersionId],
    queryFn: () =>
      apiAllPages<TeachingAssignment>(
        `/api/v1/semesters/${semesterId}/teaching-assignments?status=confirmed${selectedVersionId ? `&version_id=${selectedVersionId}` : ""}`,
      ),
    enabled: semesterId !== null && versions.isSuccess && versionSelectionReady,
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
          (assignments.data?.data ?? [])
            .flatMap((assignment) => [assignment.teacher, ...assignment.collaborators])
            .map((teacher) => [teacher.id, { id: teacher.id, name: teacher.name }]),
        ).values(),
      )
    return (rooms.data?.data ?? []).map((room) => ({ id: room.id, name: room.name }))
  }, [settings.data, assignments.data, rooms.data, view])
  const assignmentTeachers = useMemo(
    () =>
      Array.from(
        new Map(
          (assignments.data?.data ?? [])
            .flatMap((assignment) => [assignment.teacher, ...assignment.collaborators])
            .map((teacher) => [teacher.id, teacher]),
        ).values(),
      ),
    [assignments.data],
  )
  const scheduledTeacherIds = useMemo(
    () => new Set(assignmentTeachers.map((teacher) => teacher.id)),
    [assignmentTeachers],
  )
  const bulkExportClasses = useMemo(
    () =>
      (settings.data?.data ?? [])
        .filter((item) => item.status === "active" && item.school_class.status === "active")
        .map((item) => ({
          id: item.school_class.id,
          name: item.school_class.name,
          gradeName: item.school_class.grade.name,
        })),
    [settings.data],
  )
  const bulkExportTeachers = useMemo(() => {
    const source = allTeachers.data?.data ?? assignmentTeachers
    return source
      .filter((teacher) => teacher.is_active)
      .map((teacher) => ({
        id: teacher.id,
        name: teacher.name,
        hasSchedule: scheduledTeacherIds.has(teacher.id),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
  }, [allTeachers.data, assignmentTeachers, scheduledTeacherIds])
  useEffect(() => {
    setResourceId((current) =>
      resources.some((item) => String(item.id) === current)
        ? current
        : String(resources[0]?.id ?? ""),
    )
  }, [resources])
  useEffect(() => {
    if (!versions.isSuccess) return
    setSelectedVersionId((current) =>
      resolveTimetableVersionSelection(
        availableVersions,
        current,
        semester.data?.data.current_timetable_version_id,
        user?.role,
      ),
    )
  }, [
    availableVersions,
    semester.data?.data.current_timetable_version_id,
    user?.role,
    versions.isSuccess,
  ])
  const selectVersion = (value: string, clearCreated = true) => {
    setSelectedVersionId(value)
    setParams(
      (current) =>
        mergeSearchParams(current, {
          version: value || null,
          created: clearCreated ? null : current.get("created"),
        }),
      { replace: true },
    )
  }
  useEffect(() => {
    setHistory([])
    setHistoryIndex(0)
  }, [selectedVersionId])
  const timetable = useQuery({
    queryKey: ["timetable", semesterId, view, resourceId, full, selectedVersionId],
    queryFn: () =>
      api<TimetableData>(
        `/api/v1/semesters/${semesterId}/timetable?view=${view}&resource_id=${resourceId}&mode=${full ? "full" : "official"}${selectedVersionId ? `&version_id=${selectedVersionId}` : ""}`,
      ),
    enabled:
      semesterId !== null && Boolean(resourceId) && versions.isSuccess && versionSelectionReady,
  })
  const completeness = useQuery({
    queryKey: ["completeness", semesterId, selectedVersionId],
    queryFn: async () =>
      (
        await api<
          {
            required: number
            scheduled: number
            remaining: number
            completed: boolean
          }[]
        >(
          `/api/v1/semesters/${semesterId}/timetable/completeness${selectedVersionId ? `?version_id=${selectedVersionId}` : ""}`,
        )
      ).data,
    enabled: semesterId !== null && versions.isSuccess && versionSelectionReady,
  })
  const refresh = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["semester", semesterId] }),
      client.invalidateQueries({ queryKey: ["timetable", semesterId] }),
      client.invalidateQueries({ queryKey: ["teaching-assignments", semesterId] }),
      client.invalidateQueries({ queryKey: ["completeness", semesterId] }),
      client.invalidateQueries({ queryKey: ["timetable-versions", semesterId] }),
    ])
  }, [client, semesterId])
  const recordAction = useCallback(
    (action: TimetableEditAction) => {
      setHistory((current) => [...current.slice(0, historyIndex), action])
      setHistoryIndex(historyIndex + 1)
    },
    [historyIndex],
  )
  const applyHistory = useCallback(
    async (direction: "undo" | "redo") => {
      if (!semesterId || !selectedVersionId || historyBusy) return
      const action = direction === "undo" ? history[historyIndex - 1] : history[historyIndex]
      const etag = timetable.data?.etag
      if (!action || !etag) return
      setHistoryBusy(true)
      try {
        let replacement: { from: number; to: number } | null = null
        if (action.type === "move") {
          const position = direction === "undo" ? action.before : action.after
          await api("/api/v1/semesters/" + semesterId + "/timetable/entries/" + action.entryId, {
            method: "PATCH",
            etag,
            body: jsonBody({ weekday: position.weekday, item_id: position.itemId }),
          })
        } else if (action.type === "swap") {
          await api("/api/v1/semesters/" + semesterId + "/timetable/swap", {
            method: "POST",
            etag,
            body: jsonBody({
              entry_id: action.entryId,
              target_entry_id: action.targetEntryId,
              version_id: Number(selectedVersionId),
            }),
          })
        } else if (action.type === "lock") {
          const locked = direction === "undo" ? action.before : action.after
          await api(
            "/api/v1/semesters/" + semesterId + "/timetable/entries/" + action.entryId + "/lock",
            {
              method: locked ? "PUT" : "DELETE",
              etag,
            },
          )
        } else {
          const shouldCreate =
            (action.type === "create" && direction === "redo") ||
            (action.type === "delete" && direction === "undo")
          if (shouldCreate) {
            const result = await api<TimetableEntry>(
              "/api/v1/semesters/" + semesterId + "/timetable/entries",
              {
                method: "POST",
                etag,
                body: jsonBody({
                  teaching_assignment_id: action.assignmentId,
                  weekday: action.position.weekday,
                  item_id: action.position.itemId,
                  week_pattern: action.weekPattern,
                  version_id: Number(selectedVersionId),
                }),
              },
            )
            replacement = { from: action.entryId, to: result.data.id }
          } else {
            await api("/api/v1/semesters/" + semesterId + "/timetable/entries/" + action.entryId, {
              method: "DELETE",
              etag,
            })
          }
        }
        if (replacement) {
          setHistory((current) =>
            current.map((item) => remapHistoryEntry(item, replacement.from, replacement.to)),
          )
        }
        setHistoryIndex((current) => current + (direction === "undo" ? -1 : 1))
        await refresh()
        toast.success((direction === "undo" ? "已撤销：" : "已重做：") + action.label)
      } catch (error) {
        toast.error(apiMessage(error))
      } finally {
        setHistoryBusy(false)
      }
    },
    [
      history,
      historyBusy,
      historyIndex,
      refresh,
      selectedVersionId,
      semesterId,
      timetable.data?.etag,
    ],
  )
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable) ||
        !(event.metaKey || event.ctrlKey)
      )
        return
      if (event.key.toLowerCase() === "z") {
        const direction = event.shiftKey ? "redo" : "undo"
        if (
          (direction === "undo" && historyIndex > 0) ||
          (direction === "redo" && historyIndex < history.length)
        ) {
          event.preventDefault()
          void applyHistory(direction)
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [applyHistory, history.length, historyIndex])
  if (semesterId === null) {
    if (context.isLoading) return <LoadingState label="正在载入学期…" />
    return (
      <>
        <PageHeader title="排课工作台" />
        <EmptyList title="尚未设置当前学期" description="请先设置当前开放学期。" />
      </>
    )
  }
  if (
    semester.isLoading ||
    settings.isLoading ||
    (view !== "class" && assignments.isLoading) ||
    rooms.isLoading ||
    versions.isLoading
  )
    return <LoadingState />
  if (semester.isError || versions.isError || !semester.data)
    return <ErrorState retry={() => void semester.refetch()} />
  const current = semester.data.data
  const selectedVersion = selectableVersions.find(
    (version) => String(version.id) === selectedVersionId,
  )
  const canMutate = user?.role !== "viewer" && current.status === "open"
  const remaining = completeness.data?.reduce((sum, item) => sum + item.remaining, 0) ?? 0
  const scheduled = completeness.data?.reduce((sum, item) => sum + item.scheduled, 0) ?? 0
  const required = completeness.data?.reduce((sum, item) => sum + item.required, 0) ?? 0
  const versionIsStale = isTimetableVersionStale(current, selectedVersion)
  const assignmentsReady = assignments.isSuccess
  const canEdit =
    assignmentsReady &&
    canMutate &&
    (!selectedVersion || (selectedVersion.status === "draft" && !versionIsStale))
  const resourcePendingItems = pendingItemsForResource(
    assignments.data?.data ?? [],
    view,
    Number(resourceId),
    settings.data?.data ?? [],
  )
  const hardConflictCount = selectedVersion?.hard_conflict_count ?? 0
  const softWarningCount = selectedVersion?.soft_warning_count ?? 0
  const resourceIndex = resources.findIndex((item) => String(item.id) === resourceId)
  const moveResource = (direction: -1 | 1) => {
    const next = resources[resourceIndex + direction]
    if (next) setResourceId(String(next.id))
  }
  const exportQuery = `view=${view}&resource_id=${resourceId}&mode=${full ? "full" : "official"}${selectedVersionId ? `&version_id=${selectedVersionId}` : ""}`
  const xlsxExportUrl = `/api/v1/semesters/${semesterId}/timetable/export.xlsx?${exportQuery}`
  const createDraft = async () => {
    const etag = timetable.data?.etag ?? semester.data.etag
    if (!etag) return
    try {
      const result = await api<TimetableVersion>(
        `/api/v1/semesters/${semesterId}/timetable-versions`,
        {
          method: "POST",
          etag,
          body: jsonBody({
            base_version_id: selectedVersion?.id ?? null,
            name: selectedVersion
              ? `基于 v${selectedVersion.version_no} 的调整草稿`
              : "手工排课草稿",
          }),
        },
      )
      selectVersion(String(result.data.id))
      toast.success("编辑草稿已创建")
      await refresh()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  const startClassGeneration = async ({
    keepCurrent,
    successMessage,
  }: {
    keepCurrent: boolean
    successMessage: string
  }) => {
    if (
      !semesterId ||
      view !== "class" ||
      !resourceId ||
      !selectedVersionId ||
      !timetable.data?.etag
    )
      return
    setReplanStarting(true)
    try {
      const result = await api<ScheduleRun>("/api/v1/semesters/" + semesterId + "/schedule-runs", {
        method: "POST",
        etag: timetable.data.etag,
        body: jsonBody({
          scope: { type: "class", ids: [Number(resourceId)] },
          preservation: {
            keep_locked: true,
            keep_current: keepCurrent,
            base_version_id: Number(selectedVersionId),
          },
          strategy: { profile: "balanced" },
          candidate_count: keepCurrent ? 1 : 3,
        }),
      })
      toast.success(successMessage)
      void navigate(`${semesterPath(semesterId, "generate")}?run=${result.data.id}`)
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setReplanStarting(false)
    }
  }
  const startLocalReplan = () =>
    startClassGeneration({
      keepCurrent: false,
      successMessage: "已开始仅重排当前班级，其他范围和锁定课程保持不变",
    })
  const fillPendingForCurrentClass = () =>
    startClassGeneration({
      keepCurrent: true,
      successMessage: `已开始自动补齐当前班级的 ${resourcePendingItems} 节待排课程，现有安排保持不动`,
    })

  return (
    <>
      <PageHeader
        title={`${current.academic_year ? `${current.academic_year.name} · ` : ""}${current.name}课表`}
        description="二维网格只用于真实排课；切换班级、教师和教室可从不同角度检查结果。"
      />
      <div className="p-4 md:p-7">
        {params.get("created") && params.get("version") === selectedVersionId && (
          <div
            role="status"
            className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-200"
          >
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
            <span>
              {params.get("created") === "current"
                ? "新方案已设为当前课表，并已自动打开。"
                : "新草稿已创建并自动打开，可以立即继续调整与诊断。"}
            </span>
          </div>
        )}
        <section
          aria-label="课表查看与操作"
          className="mb-5 overflow-hidden rounded-2xl border bg-background"
        >
          <div className="flex flex-col gap-3 p-3 lg:p-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Tabs value={view} onValueChange={(value) => setView(value as View)}>
                <TabsList>
                  <TabsTrigger value="class">班级</TabsTrigger>
                  <TabsTrigger value="teacher">教师</TabsTrigger>
                  <TabsTrigger value="room">教室</TabsTrigger>
                </TabsList>
              </Tabs>
              <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
              <SimpleSelect
                className="min-w-52 max-w-[min(36rem,calc(100vw-2rem))]"
                contentClassName="w-max min-w-(--anchor-width) max-w-[calc(100vw-2rem)]"
                value={selectedVersionId}
                label="选择课表版本"
                surface="filter"
                onValueChange={selectVersion}
              >
                {user?.role === "viewer" && !selectedVersionId && (
                  <option value="">暂无已发布的当前课表</option>
                )}
                {user?.role !== "viewer" && selectableVersions.length === 0 && (
                  <option value="">尚未创建课表版本</option>
                )}
                {selectableVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.version_no} · {version.name} · {versionStatusName(version.status)}
                    {isTimetableVersionStale(current, version) ? " · 数据已变化" : ""}
                  </option>
                ))}
              </SimpleSelect>
              {selectedVersion && selectedVersion.status !== "draft" && (
                <Badge variant="outline">只读版本</Badge>
              )}
            </div>
            <div
              className="flex flex-wrap items-center gap-2 xl:justify-end"
              role="group"
              aria-label="版本操作"
            >
              {canMutate && (!selectedVersion || selectedVersion.status !== "draft") && (
                <Button onClick={() => void createDraft()}>
                  <FilePlus2Icon />
                  创建调整草稿
                </Button>
              )}
              <Button
                variant="outline"
                disabled={!selectedVersion || selectableVersions.length < 2}
                onClick={() => setCompareOpen(true)}
              >
                <ArrowRightLeftIcon />
                比较版本
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t bg-muted/30 p-3 lg:p-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div
                className="flex min-w-0 items-center gap-1"
                role="group"
                aria-label={`切换${view === "class" ? "班级" : view === "teacher" ? "教师" : "教室"}`}
              >
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="上一个资源"
                  disabled={resourceIndex <= 0}
                  onClick={() => moveResource(-1)}
                >
                  <ChevronLeftIcon />
                </Button>
                {view === "class" ? (
                  <ClassPicker
                    className="min-w-0 flex-1 sm:min-w-64 sm:flex-none"
                    classes={(settings.data?.data ?? []).map((item) => item.school_class)}
                    value={resourceId}
                    onValueChange={setResourceId}
                  />
                ) : view === "teacher" ? (
                  <TeacherPicker
                    className="min-w-0 flex-1 sm:min-w-64 sm:flex-none"
                    teachers={teachersWithAssignmentCourses(assignments.data?.data ?? [])}
                    value={resourceId}
                    onValueChange={setResourceId}
                  />
                ) : (
                  <RoomPicker
                    className="min-w-0 flex-1 sm:min-w-64 sm:flex-none"
                    rooms={rooms.data?.data ?? []}
                    value={resourceId}
                    onValueChange={setResourceId}
                  />
                )}
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="下一个资源"
                  disabled={resourceIndex < 0 || resourceIndex >= resources.length - 1}
                  onClick={() => moveResource(1)}
                >
                  <ChevronRightIcon />
                </Button>
              </div>
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm transition-colors hover:bg-muted/50">
                <Switch checked={full} onCheckedChange={(checked) => setFull(Boolean(checked))} />
                完整作息
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <dl className="flex min-h-8 items-center divide-x divide-border rounded-xl border bg-background px-1 text-xs whitespace-nowrap">
                <div className="flex items-baseline gap-1 px-2">
                  <dt className="text-muted-foreground">已排</dt>
                  <dd className="font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                    {scheduled}/{required}
                  </dd>
                </div>
                <div className="flex items-baseline gap-1 px-2">
                  <dt className="text-muted-foreground">未排</dt>
                  <dd className="font-semibold tabular-nums">{remaining}</dd>
                </div>
                <div className="flex items-baseline gap-1 px-2">
                  <dt className="text-muted-foreground">冲突</dt>
                  <dd
                    className={cn(
                      "font-semibold tabular-nums",
                      hardConflictCount > 0
                        ? "text-destructive"
                        : "text-emerald-700 dark:text-emerald-400",
                    )}
                  >
                    {hardConflictCount}
                  </dd>
                </div>
                <div className="flex items-baseline gap-1 px-2">
                  <dt className="text-muted-foreground">提醒</dt>
                  <dd
                    className={cn(
                      "font-semibold tabular-nums",
                      softWarningCount > 0
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-muted-foreground",
                    )}
                  >
                    {softWarningCount}
                  </dd>
                </div>
              </dl>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" disabled={!versionSelectionReady} />}
                >
                  <DownloadIcon />
                  导出
                  <ChevronDownIcon className="text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-max min-w-52">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>导出当前</DropdownMenuLabel>
                    <DropdownMenuItem
                      disabled={!resourceId}
                      className="whitespace-nowrap"
                      onClick={() => window.location.assign(xlsxExportUrl)}
                    >
                      当前
                      {view === "class" ? "班级" : view === "teacher" ? "教师" : "教室"}
                      课表（Excel · A4 竖向）
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>批量导出</DropdownMenuLabel>
                    <DropdownMenuItem
                      className="whitespace-nowrap"
                      onClick={() => setBulkExportOpen(true)}
                    >
                      选择班级和教师…
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </section>
        {canEdit && (
          <div className="mb-3 flex min-h-11 flex-wrap items-center gap-2 border-b pb-3">
            <Button
              size="sm"
              variant="outline"
              disabled={historyBusy || historyIndex === 0}
              title="撤销（Ctrl/Cmd+Z）"
              onClick={() => void applyHistory("undo")}
            >
              <Undo2Icon />
              撤销
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={historyBusy || historyIndex >= history.length}
              title="重做（Shift+Ctrl/Cmd+Z）"
              onClick={() => void applyHistory("redo")}
            >
              <Redo2Icon />
              重做
            </Button>
            {view === "class" && selectedVersionId && (
              <>
                <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={replanStarting || historyBusy}
                  onClick={() => void startLocalReplan()}
                >
                  {replanStarting ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : (
                    <SparklesIcon />
                  )}
                  仅重排当前班级
                </Button>
              </>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {historyBusy
                ? "正在恢复课表…"
                : historyIndex > 0
                  ? "最近操作：" + history[historyIndex - 1].label
                  : "本次编辑可逐步撤销"}
            </span>
          </div>
        )}
        {selectedVersion && versionIsStale && (
          <div className="mb-3 flex flex-col gap-3 rounded-lg border border-[var(--timetable-notice-border)] bg-[var(--timetable-notice-background)] px-4 py-3 text-sm text-[var(--timetable-notice-foreground)] lg:flex-row lg:items-center">
            <AlertTriangleIcon className="size-5 shrink-0 text-[var(--timetable-notice-accent)]" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">此课表生成后，任课或排课规则又发生了变化</p>
              <p className="mt-0.5 text-[var(--timetable-notice-muted)]">
                它仍可作为历史快照查看，但不代表当前完整课表
                {remaining > 0 ? `；当前还有 ${remaining} 节课程待排。` : "。"}
              </p>
            </div>
            {canMutate && (
              <div className="flex shrink-0 flex-wrap gap-2">
                {selectedVersion.status !== "draft" && (
                  <Button size="sm" variant="outline" onClick={() => void createDraft()}>
                    <FilePlus2Icon />
                    创建调整草稿
                  </Button>
                )}
                {view === "class" && resourcePendingItems > 0 ? (
                  <Button
                    size="sm"
                    disabled={replanStarting}
                    onClick={() => void fillPendingForCurrentClass()}
                  >
                    {replanStarting ? (
                      <LoaderCircleIcon className="animate-spin" />
                    ) : (
                      <SparklesIcon />
                    )}
                    自动补齐当前班级
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => void navigate(semesterPath(semesterId, "generate"))}
                  >
                    <SparklesIcon />
                    重新生成完整方案
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {selectedVersion && !versionIsStale && remaining > 0 && (
          <div className="mb-3 flex flex-col gap-3 rounded-lg border border-[var(--timetable-notice-border)] bg-[var(--timetable-notice-background)] px-4 py-3 text-sm text-[var(--timetable-notice-foreground)] lg:flex-row lg:items-center">
            <AlertTriangleIcon className="size-5 shrink-0 text-[var(--timetable-notice-accent)]" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">这份课表还没有排完整</p>
              <p className="mt-0.5 text-[var(--timetable-notice-muted)]">
                还有 {remaining} 节课程待排；标有“可安排”的空白课节可以手工检查，也可以自动补齐。
              </p>
            </div>
            {canMutate && view === "class" && resourcePendingItems > 0 && (
              <Button
                size="sm"
                disabled={replanStarting}
                onClick={() => void fillPendingForCurrentClass()}
              >
                {replanStarting ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
                自动补齐当前班级
              </Button>
            )}
          </div>
        )}
        {!versionSelectionReady ? (
          <div className="overflow-hidden rounded-2xl border bg-background">
            <EmptyList
              title="暂无已发布的当前课表"
              description="当前没有可默认打开的版本；如有历史版本，可从上方版本列表显式选择查看。"
            />
          </div>
        ) : !resourceId ? (
          <div className="overflow-hidden rounded-2xl border bg-background">
            <EmptyList title="没有可查看的资源" description="请先配置班级、任课关系或教室。" />
          </div>
        ) : timetable.isLoading ? (
          <LoadingState />
        ) : timetable.isError || !timetable.data ? (
          <ErrorState retry={() => void timetable.refetch()} />
        ) : (
          <>
            {selectedVersion &&
              selectedVersion.status !== "draft" &&
              canMutate &&
              !versionIsStale && (
                <div className="mb-3 rounded-lg border border-[var(--timetable-notice-border)] bg-[var(--timetable-notice-background)] px-4 py-3 text-sm text-[var(--timetable-notice-foreground)]">
                  <span>当前是只读版本。创建调整草稿后才能移动、锁定或新增课程。</span>
                </div>
              )}
            <div data-print-area>
              <div data-print-heading className="hidden border-b pb-3">
                <h1 className="text-xl font-semibold">
                  {current.academic_year?.name} · {current.name} · {resources[resourceIndex]?.name}
                  课表
                </h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  {view === "class" ? "班级" : view === "teacher" ? "教师" : "教室"}视角 ·
                  {full ? "完整作息" : "正式课程"} · 版本 v{selectedVersion?.version_no ?? "—"} ·
                  打印时间 {new Date().toLocaleString("zh-CN")}
                </p>
              </div>
              <TimetableGrid
                data={timetable.data.data}
                editable={canEdit}
                pendingCount={resourcePendingItems}
                onSlot={setSlot}
              />
            </div>
            <p className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <LockIcon className="size-4" /> 已锁定课程不会被移动
              </span>
              <span className="h-4 w-px bg-border" aria-hidden="true" />
              <span>
                {!assignmentsReady
                  ? "正在载入待排课程与编辑状态…"
                  : canEdit && resourcePendingItems > 0
                    ? `当前资源还有 ${resourcePendingItems} 节待排；标有“可安排”的空白课节可检查并安排`
                    : canEdit
                      ? "当前资源已排完整，其余空白是正常空堂"
                      : versionIsStale
                        ? "输入数据已变化，旧版本不能继续手工编辑；请自动补齐或重新生成"
                        : "空白格表示该课节未安排课程；只读版本不能直接编辑"}
              </span>
            </p>
          </>
        )}
      </div>
      <SlotDialog
        slot={slot}
        semesterId={current.id}
        etag={timetable.data?.etag ?? null}
        assignments={assignments.data?.data ?? []}
        entries={timetable.data?.data.entries ?? []}
        classSettings={settings.data?.data ?? []}
        items={timetable.data?.data.items ?? []}
        days={timetable.data?.data.days ?? []}
        versionId={timetable.data?.data.version?.id ?? null}
        view={view}
        resourceId={Number(resourceId)}
        readOnly={!canEdit}
        onClose={() => setSlot(null)}
        onSaved={refresh}
        onOperation={recordAction}
      />
      <VersionComparisonDialog
        open={compareOpen}
        semesterId={current.id}
        versions={selectableVersions}
        selectedVersion={selectedVersion ?? null}
        onClose={() => setCompareOpen(false)}
      />
      <BulkTimetableExportDialog
        open={bulkExportOpen}
        onOpenChange={setBulkExportOpen}
        semesterId={current.id}
        versionId={selectedVersionId}
        versionLabel={
          selectedVersion
            ? "v" + selectedVersion.version_no + " · " + selectedVersion.name
            : "当前课表"
        }
        mode={full ? "full" : "official"}
        classes={bulkExportClasses}
        teachers={bulkExportTeachers}
        teachersLoading={bulkExportOpen && (allTeachers.isPending || assignments.isPending)}
        teachersError={allTeachers.isError || assignments.isError}
      />
    </>
  )
}

function VersionComparisonDialog({
  open,
  semesterId,
  versions,
  selectedVersion,
  onClose,
}: {
  open: boolean
  semesterId: number
  versions: TimetableVersion[]
  selectedVersion: TimetableVersion | null
  onClose: () => void
}) {
  const [otherVersionId, setOtherVersionId] = useState("")
  const [changeType, setChangeType] = useState("all")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const alternatives = versions.filter((version) => version.id !== selectedVersion?.id)

  useEffect(() => {
    if (!open) return
    setOtherVersionId((current) =>
      alternatives.some((version) => String(version.id) === current)
        ? current
        : String(alternatives[0]?.id ?? ""),
    )
  }, [alternatives, open])
  useEffect(() => setPage(1), [changeType, otherVersionId, selectedVersion?.id])

  const comparison = useQuery({
    queryKey: [
      "timetable-version-comparison",
      semesterId,
      otherVersionId,
      selectedVersion?.id,
      changeType,
      page,
      pageSize,
    ],
    queryFn: () => {
      const query = new URLSearchParams({
        left_version_id: otherVersionId,
        right_version_id: String(selectedVersion?.id ?? ""),
        page: String(page),
        per_page: String(pageSize),
      })
      if (changeType !== "all") query.set("change_type", changeType)
      return api<TimetableVersionComparison>(
        `/api/v1/semesters/${semesterId}/timetable-versions/compare?${query}`,
      )
    },
    enabled: open && Boolean(otherVersionId) && selectedVersion !== null,
  })
  const pagination = comparison.data?.meta?.pagination as PaginationMeta | undefined
  const data = comparison.data?.data

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b p-6 pr-16">
          <DialogTitle>比较课表版本</DialogTitle>
          <DialogDescription>
            逐条解释两个版本的差异；比较只读，不会改变任何课程安排。
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="比较基准">
              <SimpleSelect
                className="w-full"
                value={otherVersionId}
                onValueChange={setOtherVersionId}
              >
                {alternatives.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.version_no} · {version.name} · {versionStatusName(version.status)}
                  </option>
                ))}
              </SimpleSelect>
            </Field>
            <Field label="目标版本">
              <div className="flex h-10 items-center rounded-lg border bg-muted px-3 text-sm">
                {selectedVersion
                  ? `v${selectedVersion.version_no} · ${selectedVersion.name}`
                  : "未选择版本"}
              </div>
            </Field>
          </div>

          {comparison.isLoading ? (
            <LoadingState label="正在计算版本差异…" />
          ) : comparison.isError ? (
            <ErrorState retry={() => void comparison.refetch()} />
          ) : data ? (
            <>
              <div className="overflow-hidden rounded-xl border">
                <div className="grid grid-cols-2 divide-x border-b sm:grid-cols-4">
                  <ComparisonMetric label="变化课程" value={data.summary.total_changes} />
                  <ComparisonMetric label="位置变化" value={data.summary.moved} />
                  <ComparisonMetric
                    label="新增 / 移除"
                    value={`${data.summary.added} / ${data.summary.removed}`}
                  />
                  <ComparisonMetric label="保持不变" value={data.summary.unchanged} />
                </div>
                <div className="flex flex-wrap items-center gap-2 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                  <span>教师变化 {data.summary.teacher_changed}</span>
                  <span>·</span>
                  <span>教室变化 {data.summary.room_changed}</span>
                  <span>·</span>
                  <span>周型变化 {data.summary.week_pattern_changed}</span>
                  <span>·</span>
                  <span>锁定变化 {data.summary.lock_changed}</span>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                  <p className="text-sm font-medium">差异明细</p>
                  <SimpleSelect
                    label="差异类型"
                    className="w-auto"
                    value={changeType}
                    onValueChange={setChangeType}
                    surface="filter"
                  >
                    <option value="all">全部变化</option>
                    {Object.entries(versionChangeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SimpleSelect>
                </div>
                {data.changes.length === 0 ? (
                  <EmptyList
                    title={data.summary.total_changes === 0 ? "两个版本完全一致" : "没有该类型变化"}
                    description="可以切换差异类型或选择另一个比较基准。"
                  />
                ) : (
                  <div className="divide-y">
                    {data.changes.map((change, index) => (
                      <div
                        key={`${change.assignment_id}-${change.before?.entry_id ?? "new"}-${change.after?.entry_id ?? "removed"}-${index}`}
                        className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">
                            {change.target} · {change.course}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {change.change_types.map((type) => (
                              <Badge key={type} variant="outline" className="bg-background text-xs">
                                {versionChangeLabels[type]}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="min-w-0 text-sm">
                          <p>{change.description}</p>
                          <div className="mt-1.5 grid gap-1 text-xs text-muted-foreground">
                            {change.before && <p>原：{versionEntryLabel(change.before)}</p>}
                            {change.after && <p>新：{versionEntryLabel(change.after)}</p>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {pagination && (
                  <TablePagination
                    page={pagination.page}
                    pageSize={pagination.per_page}
                    totalItems={pagination.total}
                    totalPages={pagination.last_page}
                    onPageChange={setPage}
                    onPageSizeChange={(value) => {
                      setPageSize(value)
                      setPage(1)
                    }}
                  />
                )}
              </div>
            </>
          ) : null}
        </div>
        <DialogFooter className="border-t p-6">
          <Button variant="outline" onClick={onClose}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ComparisonMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

const versionChangeLabels: Record<TimetableVersionChange["change_types"][number], string> = {
  added: "新增",
  removed: "移除",
  moved: "移动",
  teacher_changed: "教师变化",
  room_changed: "教室变化",
  week_pattern_changed: "周型变化",
  lock_changed: "锁定变化",
}

function versionEntryLabel(entry: TimetableVersionComparisonEntry) {
  return `${weekdayName[entry.weekday]} ${entry.item_name} · ${entry.teacher_names.join("、")} · ${entry.room_name}${entry.is_locked ? " · 已锁定" : ""}`
}

function versionStatusName(status: TimetableVersion["status"]) {
  return status === "draft" ? "草稿" : status === "active" ? "当前" : "历史"
}

function remapHistoryEntry(
  action: TimetableEditAction,
  from: number,
  to: number,
): TimetableEditAction {
  if (action.type === "swap")
    return {
      ...action,
      entryId: action.entryId === from ? to : action.entryId,
      targetEntryId: action.targetEntryId === from ? to : action.targetEntryId,
    }
  return { ...action, entryId: action.entryId === from ? to : action.entryId }
}

function SlotDialog({
  slot,
  semesterId,
  etag,
  assignments,
  entries,
  classSettings,
  items,
  days,
  versionId,
  view,
  resourceId,
  readOnly,
  onClose,
  onSaved,
  onOperation,
}: {
  slot: { weekday: number; itemId: number; entry?: TimetableEntry } | null
  semesterId: number
  etag: string | null
  assignments: TeachingAssignment[]
  entries: TimetableEntry[]
  classSettings: ClassSetting[]
  items: Item[]
  days: ScheduleDay[]
  versionId: number | null
  view: View
  resourceId: number
  readOnly: boolean
  onClose: () => void
  onSaved: () => Promise<void>
  onOperation: (action: TimetableEditAction) => void
}) {
  const [assignmentId, setAssignmentId] = useState("")
  const [weekday, setWeekday] = useState(1)
  const [itemId, setItemId] = useState(0)
  const [swapTargetId, setSwapTargetId] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const entry = slot?.entry
  const candidates = useMemo(
    () =>
      assignments.filter(
        (assignment) =>
          assignment.status === "confirmed" &&
          Math.max(
            0,
            assignment.remaining ?? assignment.weekly_items - (assignment.scheduled ?? 0),
          ) > 0 &&
          assignmentMatchesResource(assignment, view, resourceId, classSettings),
      ),
    [resourceId, assignments, classSettings, view],
  )
  const swapTargets = useMemo(
    () =>
      entry
        ? entries
            .filter(
              (candidate) =>
                candidate.id !== entry.id &&
                candidate.teaching_assignment_id !== entry.teaching_assignment_id &&
                !candidate.is_locked,
            )
            .sort((left, right) => left.weekday - right.weekday || left.item_id - right.item_id)
        : [],
    [entries, entry],
  )
  useEffect(() => {
    if (slot) {
      setAssignmentId(String(slot.entry?.teaching_assignment_id ?? candidates[0]?.id ?? ""))
      setWeekday(slot.weekday)
      setItemId(slot.itemId)
      setSwapTargetId("")
      setConfirmDelete(false)
    }
  }, [candidates, slot])
  const diagnosis = useQuery({
    queryKey: [
      "timetable-diagnosis",
      semesterId,
      versionId,
      entry?.id ?? null,
      assignmentId,
      weekday,
      itemId,
    ],
    queryFn: () =>
      api<TimetableDiagnosis>(`/api/v1/semesters/${semesterId}/timetable/diagnose`, {
        method: "POST",
        body: jsonBody({
          ...(entry ? { entry_id: entry.id } : { teaching_assignment_id: Number(assignmentId) }),
          weekday,
          item_id: itemId,
          ...(versionId ? { version_id: versionId } : {}),
        }),
      }),
    enabled: slot !== null && !readOnly && itemId > 0 && (Boolean(entry) || Boolean(assignmentId)),
    retry: false,
  })
  const swapDiagnosis = useQuery({
    queryKey: ["timetable-swap-diagnosis", semesterId, versionId, entry?.id, swapTargetId],
    queryFn: () =>
      api<TimetableSwapDiagnosis>(`/api/v1/semesters/${semesterId}/timetable/swap/diagnose`, {
        method: "POST",
        body: jsonBody({
          entry_id: entry?.id,
          target_entry_id: Number(swapTargetId),
          version_id: versionId,
        }),
      }),
    enabled:
      Boolean(entry) &&
      Boolean(swapTargetId) &&
      Boolean(versionId) &&
      !readOnly &&
      !entry?.is_locked,
    retry: false,
  })
  const mutate = async (action: "save" | "delete" | "lock" | "swap") => {
    if (!etag || !slot) return
    if (action === "save" && !diagnosis.data?.data.allowed) {
      toast.error("请先处理诊断中列出的硬冲突")
      return
    }
    if (action === "swap" && !swapDiagnosis.data?.data.allowed) {
      toast.error("当前两节课程不能安全交换")
      return
    }
    try {
      let operation: TimetableEditAction | null = null
      if (action === "swap" && entry) {
        const target = swapTargets.find((candidate) => candidate.id === Number(swapTargetId))
        if (!target) return
        await api(`/api/v1/semesters/${semesterId}/timetable/swap`, {
          method: "POST",
          etag,
          body: jsonBody({
            entry_id: entry.id,
            target_entry_id: Number(swapTargetId),
            version_id: versionId,
          }),
        })
        operation = {
          type: "swap",
          label: "交换 " + entry.course.name + " 与 " + target.course.name,
          entryId: entry.id,
          targetEntryId: target.id,
        }
      } else if (action === "delete" && entry) {
        await api(`/api/v1/semesters/${semesterId}/timetable/entries/${entry.id}`, {
          method: "DELETE",
          etag,
        })
        operation = {
          type: "delete",
          label: "移除 " + entry.course.name,
          entryId: entry.id,
          assignmentId: entry.teaching_assignment_id,
          position: { weekday: entry.weekday, itemId: entry.item_id },
          weekPattern: entry.week_pattern,
        }
      } else if (action === "lock" && entry) {
        await api(`/api/v1/semesters/${semesterId}/timetable/entries/${entry.id}/lock`, {
          method: entry.is_locked ? "DELETE" : "PUT",
          etag,
        })
        operation = {
          type: "lock",
          label: (entry.is_locked ? "解锁 " : "锁定 ") + entry.course.name,
          entryId: entry.id,
          before: entry.is_locked,
          after: !entry.is_locked,
        }
      } else if (entry) {
        if (weekday === entry.weekday && itemId === entry.item_id) {
          toast.info("课程位置没有变化")
          return
        }
        await api(`/api/v1/semesters/${semesterId}/timetable/entries/${entry.id}`, {
          method: "PATCH",
          etag,
          body: jsonBody({ weekday, item_id: itemId }),
        })
        operation = {
          type: "move",
          label: "移动 " + entry.course.name,
          entryId: entry.id,
          before: { weekday: entry.weekday, itemId: entry.item_id },
          after: { weekday, itemId },
        }
      } else {
        const result = await api<TimetableEntry>(
          `/api/v1/semesters/${semesterId}/timetable/entries`,
          {
            method: "POST",
            etag,
            body: jsonBody({
              teaching_assignment_id: Number(assignmentId),
              weekday,
              item_id: itemId,
              ...(versionId ? { version_id: versionId } : {}),
            }),
          },
        )
        const assignment = assignments.find((candidate) => candidate.id === Number(assignmentId))
        operation = {
          type: "create",
          label: "安排 " + (assignment?.course.name ?? "课程"),
          entryId: result.data.id,
          assignmentId: Number(assignmentId),
          position: { weekday, itemId },
          weekPattern: result.data.week_pattern,
        }
      }
      if (operation) onOperation(operation)
      toast.success(
        action === "delete"
          ? "课程已移除"
          : action === "lock"
            ? "锁定状态已更新"
            : action === "swap"
              ? "两节课程已交换"
              : "课程已保存",
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
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]">
        <DialogHeader className="border-b p-6 pr-16">
          <DialogTitle>{entry ? "课程详情与诊断" : "安排课程"}</DialogTitle>
          <DialogDescription>
            {entry
              ? readOnly
                ? "只读查看课程详情。"
                : "可移动、锁定或移除这节课。锁定后必须先解锁才能移动。"
              : `${weekdayName[slot?.weekday ?? 0]} · ${items.find((item) => item.id === slot?.itemId)?.name ?? ""}`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-6">
          {entry ? (
            <div className="rounded-2xl bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">
                  {entryTargetName(entry)} · {entry.course.name}
                </p>
                <Badge variant="outline">{weekPatternName(entry)}</Badge>
                {entry.is_locked && <Badge variant="secondary">已锁定</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {(entry.teachers?.length ? entry.teachers : [entry.teacher])
                  .map((teacher) => teacher.name)
                  .join("、")}{" "}
                · {entry.actual_room.name}
              </p>
            </div>
          ) : (
            <Field label="任课关系">
              <AssignmentPicker
                assignments={candidates}
                requireConfirmed
                value={assignmentId}
                onValueChange={setAssignmentId}
              />
              {candidates.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  当前视角下没有仍有未排课时的任课关系。
                </span>
              )}
            </Field>
          )}
          {(entry || assignmentId) && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="星期">
                <SimpleSelect
                  className="w-full"
                  value={String(weekday)}
                  disabled={readOnly}
                  onValueChange={(value) => setWeekday(Number(value))}
                >
                  {days.map((day) => (
                    <option key={day.weekday} value={day.weekday}>
                      {weekdayName[day.weekday]}
                    </option>
                  ))}
                </SimpleSelect>
              </Field>
              <Field label="课节">
                <SimpleSelect
                  className="w-full"
                  value={String(itemId)}
                  disabled={readOnly}
                  onValueChange={(value) => setItemId(Number(value))}
                >
                  {items
                    .filter((item) => item.allows_course)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </SimpleSelect>
              </Field>
            </div>
          )}
          {!readOnly && (entry || assignmentId) && (
            <PlacementDiagnosis
              diagnosis={diagnosis.data?.data}
              loading={diagnosis.isLoading || diagnosis.isFetching}
              error={diagnosis.isError ? apiMessage(diagnosis.error) : null}
              onAlternative={(alternative) => {
                setWeekday(alternative.weekday)
                setItemId(alternative.item_id)
              }}
            />
          )}
          {entry && !readOnly && !entry.is_locked && swapTargets.length > 0 && (
            <div className="grid gap-3 border-t pt-4">
              <div className="flex items-center gap-2">
                <ArrowRightLeftIcon className="size-4 text-muted-foreground" />
                <p className="font-medium">与另一节课交换</p>
              </div>
              <Field label="目标课程">
                <SimpleSelect
                  className="w-full"
                  value={swapTargetId}
                  onValueChange={setSwapTargetId}
                >
                  <option value="">选择当前视角中的另一节课</option>
                  {swapTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {weekdayName[target.weekday]} ·{" "}
                      {items.find((item) => item.id === target.item_id)?.name ?? "未知课节"} ·{" "}
                      {target.course.name} · {entryTargetName(target)}
                    </option>
                  ))}
                </SimpleSelect>
              </Field>
              {swapTargetId && (
                <SwapDiagnosisPanel
                  diagnosis={swapDiagnosis.data?.data}
                  loading={swapDiagnosis.isLoading || swapDiagnosis.isFetching}
                  error={swapDiagnosis.isError ? apiMessage(swapDiagnosis.error) : null}
                />
              )}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  disabled={
                    !swapTargetId || swapDiagnosis.isFetching || !swapDiagnosis.data?.data.allowed
                  }
                  onClick={() => void mutate("swap")}
                >
                  <ArrowRightLeftIcon />
                  交换两节课
                </Button>
              </div>
            </div>
          )}
          {entry && confirmDelete && (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3">
              <p className="font-medium text-destructive">从课表中移除“{entry.course.name}”</p>
              <p className="mt-1 text-sm text-muted-foreground">
                将移除 {weekdayName[entry.weekday]} ·{" "}
                {items.find((item) => item.id === entry.item_id)?.name}{" "}
                的安排。完成后仍可通过撤销恢复。
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>
                  保留课程
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void mutate("delete")}>
                  确认移除
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="flex-row flex-wrap justify-end border-t p-6">
          {entry ? (
            <>
              <Button
                variant="outline"
                disabled={readOnly || entry.is_locked}
                onClick={() => setConfirmDelete(true)}
              >
                移除
              </Button>
              <Button variant="outline" disabled={readOnly} onClick={() => void mutate("lock")}>
                {entry.is_locked ? <UnlockIcon /> : <LockIcon />}
                {entry.is_locked ? "解锁" : "锁定"}
              </Button>
              <Button
                disabled={
                  readOnly ||
                  entry.is_locked ||
                  diagnosis.isFetching ||
                  !diagnosis.data?.data.allowed
                }
                onClick={() => void mutate("save")}
              >
                保存位置
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button
                disabled={
                  readOnly || !assignmentId || diagnosis.isFetching || !diagnosis.data?.data.allowed
                }
                onClick={() => void mutate("save")}
              >
                安排课程
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PlacementDiagnosis({
  diagnosis,
  loading,
  error,
  onAlternative,
}: {
  diagnosis?: TimetableDiagnosis
  loading: boolean
  error: string | null
  onAlternative: (alternative: TimetableDiagnosis["alternatives"][number]) => void
}) {
  if (loading)
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        正在检查班级、教师、教室和排课规则…
      </div>
    )
  if (error)
    return (
      <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
        <span>暂时无法完成位置诊断：{error}</span>
      </div>
    )
  if (!diagnosis) return null

  return (
    <div
      className={
        diagnosis.allowed
          ? "rounded-xl border border-[var(--timetable-success-border)] bg-[var(--timetable-success-background)] px-4 py-3"
          : "rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3"
      }
    >
      <div className="flex items-start gap-2">
        {diagnosis.allowed ? (
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-[var(--timetable-success-accent)]" />
        ) : (
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{diagnosis.summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {weekdayName[diagnosis.target.weekday]} · {diagnosis.target.item_name} ·{" "}
            {diagnosis.assignment.room}
            {diagnosis.allowed && diagnosis.estimated_quality_delta !== 0 && (
              <> · 预计质量 {diagnosis.estimated_quality_delta}</>
            )}
          </p>
        </div>
      </div>
      {diagnosis.hard_conflicts.length > 0 && (
        <ul className="mt-3 grid gap-1.5 border-t border-destructive/15 pt-3 text-sm text-destructive">
          {diagnosis.hard_conflicts.map((conflict, index) => (
            <li key={conflict.type + "-" + (conflict.existing_entry_id ?? index)}>
              · {conflict.message}
            </li>
          ))}
        </ul>
      )}
      {diagnosis.soft_warnings.length > 0 && (
        <ul className="mt-3 grid gap-1 border-t border-[var(--timetable-notice-border)] pt-3 text-sm text-[var(--timetable-notice-muted)]">
          {diagnosis.soft_warnings.map((warning) => (
            <li key={warning}>· {warning}</li>
          ))}
        </ul>
      )}
      {diagnosis.alternatives.length > 0 && (!diagnosis.allowed || diagnosis.soft_penalty > 0) && (
        <div className="mt-3 border-t border-current/10 pt-3">
          <p className="text-xs font-medium text-muted-foreground">更合适的位置</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {diagnosis.alternatives.slice(0, 5).map((alternative) => (
              <Button
                key={alternative.weekday + "-" + alternative.item_id}
                size="sm"
                variant="outline"
                onClick={() => onAlternative(alternative)}
              >
                {weekdayName[alternative.weekday]} · {alternative.item_name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SwapDiagnosisPanel({
  diagnosis,
  loading,
  error,
}: {
  diagnosis?: TimetableSwapDiagnosis
  loading: boolean
  error: string | null
}) {
  if (loading)
    return (
      <div className="flex items-center gap-2 rounded-xl bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        正在同时检查两节课程交换后的安排…
      </div>
    )
  if (error)
    return (
      <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    )
  if (!diagnosis) return null
  const conflicts = [...diagnosis.entry.hard_conflicts, ...diagnosis.target.hard_conflicts].filter(
    (conflict, index, items) =>
      items.findIndex(
        (item) => item.type === conflict.type && item.message === conflict.message,
      ) === index,
  )

  return (
    <div
      className={
        diagnosis.allowed
          ? "rounded-xl border border-[var(--timetable-success-border)] bg-[var(--timetable-success-background)] px-4 py-3"
          : "rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3"
      }
    >
      <p className="flex items-center gap-2 font-medium">
        {diagnosis.allowed ? (
          <CheckCircle2Icon className="size-4 text-[var(--timetable-success-accent)]" />
        ) : (
          <AlertTriangleIcon className="size-4 text-destructive" />
        )}
        {diagnosis.summary}
      </p>
      {conflicts.length > 0 && (
        <ul className="mt-2 grid gap-1 text-sm text-destructive">
          {conflicts.map((conflict, index) => (
            <li key={conflict.type + "-" + index}>· {conflict.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
