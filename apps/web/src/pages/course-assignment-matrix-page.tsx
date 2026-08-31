import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  CheckIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ClipboardCopyIcon,
  ClipboardPasteIcon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
  MoveHorizontalIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api, apiAllPages, apiMessage, jsonBody } from "@/lib/api"
import { useResolvedSemesterId } from "@/lib/semester"
import type {
  ClassSetting,
  Course,
  PaginationMeta,
  Room,
  Semester,
  Teacher,
  TeachingAssignment,
  TeachingGroup,
  WeekPattern,
} from "@/lib/types"
import { AssignmentEditorDialog, type AssignmentEditorSeed } from "@/components/assignment-editor"
import { GridSelectionOverlay } from "@/components/grid-selection-frame"
import {
  buildAssignmentGroups,
  filterAssignmentGroups,
  GroupedAssignmentsTable,
  type GroupedAssignmentView,
} from "@/components/grouped-assignments-view"
import { ListToolbar, ToolbarSelect } from "@/components/list-toolbar"
import { RoomPicker, TeacherPicker } from "@/components/resource-picker"
import { SimpleSelect } from "@/components/simple-select"
import { EmptyList, ErrorState, Field, LoadingState, PageHeader } from "@/components/page"
import { SchedulingWorkflow } from "@/components/scheduling-workflow"
import { StatusBadge } from "@/components/status-badge"
import { TableActionButton } from "@/components/table-action-button"
import { TablePagination } from "@/components/table-pagination"
import { TeachingGroupManager } from "@/components/teaching-group-manager"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
  enumParam,
  mergeSearchParams,
  positiveIntegerParam,
  useHashPreservingSearchParams,
} from "@/lib/url-state"

type View = "matrix" | "class" | "teacher" | "course" | "room" | "table"
const viewValues = ["matrix", "class", "teacher", "course", "room", "table"] as const
const groupedViewValues = ["class", "teacher", "course", "room"] as const

interface MatrixCell {
  key: string
  row: number
  column: number
  classSetting: ClassSetting
  course: Course
  assignment: TeachingAssignment | undefined
}

interface AssignmentTemplate {
  teacherId: number
  collaboratorIds: number[]
  weeklyItems: number
  itemsPerSession: number
  weekPattern: WeekPattern
  activeWeeks: number[] | null
  roomMode: "class_default" | "specified"
  specifiedRoomId: number | null
  allowsSubstitution: boolean
}

const viewLabels: Record<View, string> = {
  matrix: "班级 × 课程矩阵",
  class: "班级视角",
  teacher: "教师视角",
  course: "课程视角",
  room: "教室视角",
  table: "全部明细",
}

const groupedViewUnits: Record<GroupedAssignmentView, string> = {
  class: "个班级",
  teacher: "位教师",
  course: "门课程",
  room: "个教室分组",
}

const groupedSearchPlaceholders: Record<GroupedAssignmentView, string> = {
  class: "搜索班级、课程或教师",
  teacher: "搜索教师、班级或课程",
  course: "搜索课程、班级或教师",
  room: "搜索教室、班级或课程",
}

export function CourseAssignmentMatrixPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const client = useQueryClient()
  const [urlParams, setUrlParams] = useHashPreservingSearchParams()
  const [view, setView] = useState<View>(() => enumParam(urlParams, "view", viewValues, "matrix"))
  const [search, setSearch] = useState(() => urlParams.get("q") ?? "")
  const [gradeFilter, setGradeFilter] = useState(() => numericFilterParam(urlParams, "grade", ""))
  const [courseFilter, setCourseFilter] = useState(() => numericFilterParam(urlParams, "course"))
  const [statusFilter, setStatusFilter] = useState(() =>
    enumParam(urlParams, "status", ["all", "draft", "confirmed", "inactive"], "all"),
  )
  const [draftReview, setDraftReview] = useState(() => urlParams.get("review") === "draft")
  const [page, setPage] = useState(() => positiveIntegerParam(urlParams, "page", 1))
  const [pageSize, setPageSize] = useState(() =>
    positiveIntegerParam(urlParams, "per_page", 20, [20, 50, 100]),
  )
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<number[]>([])
  const [anchorKey, setAnchorKey] = useState<string | null>(null)
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState<AssignmentTemplate | null>(null)
  const [editor, setEditor] = useState<AssignmentEditorSeed | undefined>(undefined)
  const [batchOpen, setBatchOpen] = useState(false)
  const [groupsOpen, setGroupsOpen] = useState(false)
  const groupedView = isGroupedAssignmentView(view) ? view : null
  const isDraftReview = draftReview && view === "class" && statusFilter === "draft"

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
  const courses = useQuery({
    queryKey: ["courses"],
    queryFn: () => apiAllPages<Course>("/api/v1/courses"),
  })
  const teachers = useQuery({
    queryKey: ["teachers"],
    queryFn: () => apiAllPages<Teacher>("/api/v1/teachers"),
  })
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => apiAllPages<Room>("/api/v1/rooms"),
  })
  const groups = useQuery({
    queryKey: ["teaching-groups", semesterId],
    queryFn: () => apiAllPages<TeachingGroup>(`/api/v1/semesters/${semesterId}/teaching-groups`),
    enabled: semesterId !== null,
  })
  const grades = useMemo(
    () =>
      Array.from(
        new Map(
          (settings.data?.data ?? []).map((setting) => [
            setting.school_class.grade_id,
            setting.school_class.grade,
          ]),
        ).values(),
      ),
    [settings.data?.data],
  )
  useEffect(() => {
    if (grades[0] && !grades.some((grade) => String(grade.id) === gradeFilter)) {
      setGradeFilter(String(grades[0].id))
    }
  }, [gradeFilter, grades])

  const matrixAssignments = useQuery({
    queryKey: ["teaching-assignments", semesterId, "matrix", gradeFilter],
    queryFn: () =>
      apiAllPages<TeachingAssignment>(
        `/api/v1/semesters/${semesterId}/teaching-assignments?grade_id=${gradeFilter}`,
      ),
    enabled: semesterId !== null && Boolean(gradeFilter),
  })
  const tablePath = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), per_page: String(pageSize) })
    if (search.trim()) params.set("search", search.trim())
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (isDraftReview && gradeFilter) params.set("grade_id", gradeFilter)
    return `/api/v1/semesters/${semesterId}/teaching-assignments?${params}`
  }, [gradeFilter, isDraftReview, page, pageSize, search, semesterId, statusFilter])
  const tableAssignments = useQuery({
    queryKey: ["teaching-assignments", semesterId, "table", tablePath],
    queryFn: () => api<TeachingAssignment[]>(tablePath),
    enabled: semesterId !== null && (view === "table" || isDraftReview),
  })
  const groupedPath = useMemo(() => {
    const params = new URLSearchParams()
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (view === "class" && gradeFilter) params.set("grade_id", gradeFilter)
    return `/api/v1/semesters/${semesterId}/teaching-assignments?${params}`
  }, [gradeFilter, semesterId, statusFilter, view])
  const groupedAssignments = useQuery({
    queryKey: ["teaching-assignments", semesterId, "grouped", groupedPath],
    queryFn: () => apiAllPages<TeachingAssignment>(groupedPath),
    enabled: semesterId !== null && groupedView !== null && !isDraftReview,
  })
  const yearId = semester.data?.data.academic_year_id
  const siblings = useQuery({
    queryKey: ["semesters", yearId],
    queryFn: async () => (await api<Semester[]>(`/api/v1/academic-years/${yearId}/semesters`)).data,
    enabled: Boolean(yearId),
  })
  const sourceSemester = siblings.data
    ?.filter((item) => item.sequence < (semester.data?.data.sequence ?? 1))
    .sort((a, b) => b.sequence - a.sequence)[0]

  const didMountFilters = useRef(false)
  useEffect(() => {
    if (!didMountFilters.current) {
      didMountFilters.current = true
      return
    }
    setPage(1)
  }, [courseFilter, draftReview, gradeFilter, search, statusFilter, view])
  useEffect(() => {
    setUrlParams(
      (current) =>
        mergeSearchParams(current, {
          view: view === "matrix" ? null : view,
          review: isDraftReview ? "draft" : null,
          q: search.trim() || null,
          grade: gradeFilter || null,
          course: courseFilter === "all" ? null : courseFilter,
          status: statusFilter === "all" ? null : statusFilter,
          page: page === 1 ? null : page,
          per_page: pageSize === 20 ? null : pageSize,
        }),
      { replace: true },
    )
  }, [
    courseFilter,
    gradeFilter,
    isDraftReview,
    page,
    pageSize,
    search,
    setUrlParams,
    statusFilter,
    view,
  ])
  useEffect(() => {
    setSelectedKeys([])
    setAnchorKey(null)
    setFocusedKey(null)
  }, [gradeFilter])
  useEffect(() => {
    setSelectedAssignmentIds([])
  }, [draftReview, gradeFilter, page, search, statusFilter, view])

  const tableMeta = paginationFrom(
    tableAssignments.data?.meta,
    tableAssignments.data?.data.length ?? 0,
  )
  useEffect(() => {
    if ((view === "table" || isDraftReview) && page > tableMeta.last_page) {
      setPage(tableMeta.last_page)
    }
  }, [isDraftReview, page, tableMeta.last_page, view])

  const assignmentEtag =
    view === "matrix"
      ? matrixAssignments.data?.etag
      : groupedView && !isDraftReview
        ? groupedAssignments.data?.etag
        : tableAssignments.data?.etag
  const etag = assignmentEtag ?? groups.data?.etag ?? semester.data?.etag ?? null
  const refresh = async () => {
    setSelectedKeys([])
    setSelectedAssignmentIds([])
    await Promise.all([
      client.invalidateQueries({ queryKey: ["semester", semesterId] }),
      client.invalidateQueries({ queryKey: ["teaching-assignments", semesterId] }),
      client.invalidateQueries({ queryKey: ["teaching-groups", semesterId] }),
      client.invalidateQueries({ queryKey: ["preparation-check", semesterId] }),
    ])
  }

  const activeCourses = useMemo(
    () =>
      (courses.data?.data ?? []).filter(
        (course) =>
          course.is_active && (courseFilter === "all" || String(course.id) === courseFilter),
      ),
    [courseFilter, courses.data?.data],
  )
  const matrixClasses = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN")
    const assignments = matrixAssignments.data?.data ?? []
    return (settings.data?.data ?? [])
      .filter(
        (setting) =>
          setting.status === "active" &&
          String(setting.school_class.grade_id) === gradeFilter &&
          (!query ||
            setting.school_class.name.toLocaleLowerCase("zh-CN").includes(query) ||
            assignments.some(
              (assignment) =>
                assignment.school_class_id === setting.school_class_id &&
                `${assignment.course.name} ${assignment.teacher.name} ${assignment.collaborators.map((item) => item.name).join(" ")}`
                  .toLocaleLowerCase("zh-CN")
                  .includes(query),
            )),
      )
      .sort((a, b) => a.school_class.name.localeCompare(b.school_class.name, "zh-CN"))
  }, [gradeFilter, matrixAssignments.data?.data, search, settings.data?.data])
  const assignmentMap = useMemo(
    () =>
      new Map(
        (matrixAssignments.data?.data ?? [])
          .filter((assignment) => assignment.school_class_id !== null)
          .map((assignment) => [
            `${assignment.school_class_id}:${assignment.course_id}`,
            assignment,
          ]),
      ),
    [matrixAssignments.data?.data],
  )
  const cells = useMemo(
    () =>
      matrixClasses.flatMap((classSetting, row) =>
        activeCourses.map((course, column) => ({
          key: `${classSetting.school_class_id}:${course.id}`,
          row,
          column,
          classSetting,
          course,
          assignment: assignmentMap.get(`${classSetting.school_class_id}:${course.id}`),
        })),
      ),
    [activeCourses, assignmentMap, matrixClasses],
  )
  const cellMap = useMemo(() => new Map(cells.map((cell) => [cell.key, cell])), [cells])
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys])
  const selectedCells = selectedKeys
    .map((key) => cellMap.get(key))
    .filter((cell): cell is MatrixCell => cell !== undefined)
  const selectedDraftIds = selectedCells
    .map((cell) => cell.assignment)
    .filter((assignment): assignment is TeachingAssignment => assignment?.status === "draft")
    .map((assignment) => assignment.id)
  const gradeDrafts = (matrixAssignments.data?.data ?? []).filter(
    (assignment) => assignment.status === "draft",
  )
  const assignmentGroups = useMemo(
    () =>
      groupedView
        ? buildAssignmentGroups(
            groupedView,
            groupedAssignments.data?.data ?? [],
            settings.data?.data ?? [],
          )
        : [],
    [groupedAssignments.data?.data, groupedView, settings.data?.data],
  )
  const visibleAssignmentGroups = useMemo(
    () => filterAssignmentGroups(assignmentGroups, search),
    [assignmentGroups, search],
  )
  const visibleGroupedAssignments = useMemo(
    () =>
      new Map(
        visibleAssignmentGroups.flatMap((group) =>
          group.entries.map((entry) => [entry.assignment.id, entry.assignment] as const),
        ),
      ),
    [visibleAssignmentGroups],
  )
  const groupedDraftCount = [...visibleGroupedAssignments.values()].filter(
    (assignment) => assignment.status === "draft",
  ).length
  const groupedAssignmentCount = visibleGroupedAssignments.size
  const draftReviewScope = view === "class" ? "本年级" : "当前学期"
  const selectCell = (cell: MatrixCell, event: MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey && anchorKey) {
      const anchor = cellMap.get(anchorKey)
      if (anchor) {
        const rowStart = Math.min(anchor.row, cell.row)
        const rowEnd = Math.max(anchor.row, cell.row)
        const columnStart = Math.min(anchor.column, cell.column)
        const columnEnd = Math.max(anchor.column, cell.column)
        setSelectedKeys(
          cells
            .filter(
              (item) =>
                item.row >= rowStart &&
                item.row <= rowEnd &&
                item.column >= columnStart &&
                item.column <= columnEnd,
            )
            .map((item) => item.key),
        )
      }
    } else if (event.metaKey || event.ctrlKey) {
      setSelectedKeys((current) =>
        current.includes(cell.key)
          ? current.filter((key) => key !== cell.key)
          : [...current, cell.key],
      )
      setAnchorKey(cell.key)
    } else {
      setSelectedKeys([cell.key])
      setAnchorKey(cell.key)
    }
    setFocusedKey(cell.key)
  }
  const focusCell = (row: number, column: number) => {
    const target = cells.find((cell) => cell.row === row && cell.column === column)
    if (!target) return
    setFocusedKey(target.key)
    setSelectedKeys([target.key])
    setAnchorKey(target.key)
    requestAnimationFrame(() => document.getElementById(`assignment-cell-${target.key}`)?.focus())
  }
  const copySelection = () => {
    const cell = selectedCells[0]
    if (selectedCells.length !== 1 || !cell?.assignment) {
      toast.info("先选择一个已设置的单元格作为复制来源")
      return
    }
    setCopied(templateFromAssignment(cell.assignment))
    toast.success("已复制任课设置；选择目标单元格后可粘贴")
  }
  const pasteSelection = async () => {
    if (!copied || !selectedCells.length || !etag) return
    try {
      await api(`/api/v1/semesters/${semesterId}/teaching-assignments/bulk`, {
        method: "POST",
        etag,
        body: jsonBody({
          operations: selectedCells.map((cell) => operationFromTemplate(cell, copied)),
        }),
      })
      const created = selectedCells.filter((cell) => !cell.assignment).length
      toast.success(`已批量更新 ${selectedCells.length} 个单元格，其中新增 ${created} 条`)
      await refresh()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  const handleCellKey = (event: KeyboardEvent<HTMLButtonElement>, cell: MatrixCell) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
      event.preventDefault()
      copySelection()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
      event.preventDefault()
      void pasteSelection()
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      setEditor({
        assignment: cell.assignment,
        schoolClassId: cell.classSetting.school_class_id,
        courseId: cell.course.id,
      })
      return
    }
    const movement = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }[event.key]
    if (movement) {
      event.preventDefault()
      focusCell(cell.row + movement[0], cell.column + movement[1])
    }
  }
  const assignmentAction = async (path: string, success: string, body?: unknown) => {
    if (!etag) return
    try {
      await api(`/api/v1/semesters/${semesterId}/teaching-assignments${path}`, {
        method: "POST",
        etag,
        body: body === undefined ? undefined : jsonBody(body),
      })
      toast.success(success)
      await refresh()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  const changeView = (nextView: View) => {
    setDraftReview(false)
    setView(nextView)
    if (nextView !== "matrix") setCourseFilter("all")
  }
  const changeStatusFilter = (value: string) => {
    setStatusFilter(value as typeof statusFilter)
    if (value !== "draft") setDraftReview(false)
  }
  const openDraftReview = () => {
    setSearch("")
    setDraftReview(true)
    setStatusFilter("draft")
    setView("class")
    setPage(1)
    setSelectedAssignmentIds([])
  }
  const closeDraftReview = () => {
    setDraftReview(false)
    setStatusFilter("all")
    setView("matrix")
    setPage(1)
    setSelectedAssignmentIds([])
  }
  const confirmAssignments = (assignmentIds: number[]) => {
    if (!assignmentIds.length) return
    void assignmentAction(
      "/confirm",
      assignmentIds.length === 1 ? "任课关系已确认" : `已确认 ${assignmentIds.length} 条任课关系`,
      { assignment_ids: assignmentIds },
    )
  }
  const copyPreviousGrade = async () => {
    if (!sourceSemester || !gradeFilter || !etag) return
    try {
      const source = await apiAllPages<TeachingAssignment>(
        `/api/v1/semesters/${sourceSemester.id}/teaching-assignments?grade_id=${gradeFilter}&status=confirmed`,
      )
      const missingIds = source.data
        .filter((assignment) => {
          if (assignment.school_class_id === null) return true
          return !assignmentMap.has(`${assignment.school_class_id}:${assignment.course_id}`)
        })
        .map((assignment) => assignment.id)
      if (!missingIds.length) {
        toast.info("本年级没有可从上学期补充的任课关系")
        return
      }
      await api(`/api/v1/semesters/${semesterId}/teaching-assignments/copy`, {
        method: "POST",
        etag,
        body: jsonBody({ source_semester_id: sourceSemester.id, assignment_ids: missingIds }),
      })
      toast.success(`已从上学期复制 ${missingIds.length} 条任课关系，均保存为草稿`)
      await refresh()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }

  if (!semesterId && !context.isLoading)
    return (
      <>
        <PageHeader title="课程与任课矩阵" />
        <EmptyList title="尚未设置当前学期" description="请先设置当前开放学期。" />
      </>
    )
  if (
    semester.isLoading ||
    settings.isLoading ||
    courses.isLoading ||
    teachers.isLoading ||
    rooms.isLoading ||
    groups.isLoading
  )
    return <LoadingState />
  if (
    semester.isError ||
    settings.isError ||
    courses.isError ||
    teachers.isError ||
    rooms.isError ||
    groups.isError ||
    !semester.data
  )
    return <ErrorState retry={() => void refresh()} />

  const current = semester.data.data
  const toolbarActions = (
    <>
      <Button variant="outline" onClick={() => setGroupsOpen(true)}>
        <UsersIcon />
        教学组
      </Button>
      {sourceSemester && gradeFilter && (
        <Button variant="outline" onClick={() => void copyPreviousGrade()}>
          <CopyIcon />
          复制上学期本年级
        </Button>
      )}
      <Button
        disabled={current.status === "closed"}
        onClick={() => setEditor({ schoolClassId: matrixClasses[0]?.school_class_id })}
      >
        <PlusIcon />
        新增任课关系
      </Button>
    </>
  )

  return (
    <>
      <PageHeader
        title="课程与任课矩阵"
        description="按班级和课程批量维护教师、周课时、周型、连排和教室方式。"
      />
      <SchedulingWorkflow />
      <div className="p-4 md:p-6">
        <div className="surface-panel overflow-hidden">
          <ListToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={
              groupedView ? groupedSearchPlaceholders[groupedView] : "搜索班级、课程或教师"
            }
            summary={
              view === "matrix" ? (
                <>
                  <span>{matrixClasses.length} 个班级</span>
                  <span>·</span>
                  <span>{activeCourses.length} 门课程</span>
                  <span>·</span>
                  {gradeDrafts.length ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`查看本年级 ${gradeDrafts.length} 条待确认任课关系`}
                      onClick={openDraftReview}
                    >
                      <CircleAlertIcon className="text-amber-600" />
                      {gradeDrafts.length} 条待确认
                      <span aria-hidden="true">→</span>
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-emerald-700">
                      <CheckCircle2Icon className="size-4" />
                      本年级已全部确认
                    </span>
                  )}
                </>
              ) : isDraftReview ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <CircleAlertIcon className="size-4 text-amber-600" />
                  待确认 {tableMeta.total} 条
                </span>
              ) : groupedView ? (
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <span>
                    {visibleAssignmentGroups.length} {groupedViewUnits[groupedView]}
                  </span>
                  <span>·</span>
                  <span>{groupedAssignmentCount} 条任课关系</span>
                  {groupedDraftCount > 0 && (
                    <span className="inline-flex items-center gap-2">
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <CircleAlertIcon className="size-4" />
                        {groupedDraftCount} 条待确认
                      </span>
                    </span>
                  )}
                </span>
              ) : (
                <span>共 {tableMeta.total} 条任课关系</span>
              )
            }
            actions={isDraftReview ? undefined : toolbarActions}
          >
            <ToolbarSelect
              value={view}
              onChange={(value) => changeView(value as View)}
              label="视角"
            >
              {Object.entries(viewLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </ToolbarSelect>
            {(view === "matrix" || view === "class") && (
              <ToolbarSelect value={gradeFilter} onChange={setGradeFilter} label="年级">
                {grades.map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name}
                  </option>
                ))}
              </ToolbarSelect>
            )}
            {view === "matrix" && (
              <ToolbarSelect value={courseFilter} onChange={setCourseFilter} label="课程列">
                <option value="all">全部课程</option>
                {(courses.data?.data ?? [])
                  .filter((item) => item.is_active)
                  .map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
              </ToolbarSelect>
            )}
            {view !== "matrix" && (
              <ToolbarSelect value={statusFilter} onChange={changeStatusFilter} label="状态">
                <option value="all">全部状态</option>
                <option value="draft">待确认</option>
                <option value="confirmed">已确认</option>
                <option value="inactive">已停用</option>
              </ToolbarSelect>
            )}
          </ListToolbar>

          {isDraftReview && (
            <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2.5 text-sm">
              <Button size="sm" variant="ghost" onClick={closeDraftReview}>
                <ArrowLeftIcon />
                返回矩阵
              </Button>
              <span className="text-muted-foreground">已选 {selectedAssignmentIds.length} 条</span>
              <Button
                size="sm"
                variant="outline"
                disabled={!tableAssignments.data?.data.length}
                onClick={() => {
                  const pageIds =
                    tableAssignments.data?.data.map((assignment) => assignment.id) ?? []
                  const allSelected =
                    pageIds.length > 0 && pageIds.every((id) => selectedAssignmentIds.includes(id))
                  setSelectedAssignmentIds(allSelected ? [] : pageIds)
                }}
              >
                {tableAssignments.data?.data.length &&
                tableAssignments.data.data.every((assignment) =>
                  selectedAssignmentIds.includes(assignment.id),
                )
                  ? "取消本页选择"
                  : "选择本页"}
              </Button>
              <Button
                size="sm"
                disabled={!selectedAssignmentIds.length}
                onClick={() => confirmAssignments(selectedAssignmentIds)}
              >
                确认所选{selectedAssignmentIds.length ? ` ${selectedAssignmentIds.length} 条` : ""}
              </Button>
            </div>
          )}

          {view === "matrix" ? (
            <>
              {selectedCells.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-b bg-primary/[0.025] px-4 py-2.5 text-sm">
                  <span className="mr-1 font-medium">已选 {selectedCells.length} 格</span>
                  <Button size="sm" variant="outline" onClick={copySelection}>
                    <ClipboardCopyIcon />
                    复制
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!copied}
                    onClick={() => void pasteSelection()}
                  >
                    <ClipboardPasteIcon />
                    粘贴设置
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setBatchOpen(true)}>
                    批量设置
                  </Button>
                  {selectedDraftIds.length > 0 && (
                    <Button size="sm" onClick={() => confirmAssignments(selectedDraftIds)}>
                      <CheckIcon />
                      确认所选 {selectedDraftIds.length} 条
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => setSelectedKeys([])}
                  >
                    清除选择
                  </Button>
                </div>
              )}
              {matrixAssignments.isLoading ? (
                <LoadingState label="正在加载本年级矩阵…" />
              ) : matrixAssignments.isError ? (
                <ErrorState retry={() => void matrixAssignments.refetch()} />
              ) : !matrixClasses.length ? (
                <EmptyList
                  title="本年级还没有启用班级"
                  description="先到学期配置中启用班级，再维护课程与任课关系。"
                />
              ) : !activeCourses.length ? (
                <EmptyList
                  title="没有可显示的课程"
                  description="请调整课程筛选或先维护课程资料。"
                />
              ) : (
                <div className="grid min-h-[520px] xl:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="min-w-0">
                    <div
                      aria-hidden="true"
                      className="flex items-center justify-between border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground md:hidden"
                    >
                      <span>左右滑动查看完整矩阵</span>
                      <MoveHorizontalIcon className="size-4" />
                    </div>
                    <div
                      role="region"
                      aria-label="可横向滚动的任课矩阵"
                      tabIndex={0}
                      className="max-h-[calc(100vh-250px)] min-h-[520px] overflow-auto focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/30"
                    >
                      <div className="relative inline-block min-w-full align-top">
                        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
                          <thead>
                            <tr>
                              <th
                                scope="col"
                                className="sticky top-0 left-0 z-30 h-14 min-w-44 border-r border-b bg-muted px-4 text-left font-semibold shadow-[2px_2px_5px_-5px_rgba(0,0,0,.4)]"
                              >
                                班级
                              </th>
                              {activeCourses.map((course) => (
                                <th
                                  key={course.id}
                                  scope="col"
                                  className="sticky top-0 z-20 h-14 min-w-40 border-r border-b bg-muted px-3 text-left font-semibold"
                                >
                                  <span className="block">{course.name}</span>
                                  {course.short_name && (
                                    <span className="text-xs font-normal text-muted-foreground">
                                      课表简称：{course.short_name}
                                    </span>
                                  )}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {matrixClasses.map((classSetting, row) => (
                              <tr key={classSetting.school_class_id}>
                                <th
                                  scope="row"
                                  className="sticky left-0 z-10 h-24 border-r border-b bg-background px-4 text-left shadow-[2px_0_5px_-5px_rgba(0,0,0,.4)]"
                                >
                                  <span className="block font-semibold">
                                    {classSetting.school_class.name}
                                  </span>
                                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                                    {classSetting.fixed_room?.name ?? "未设固定教室"}
                                  </span>
                                </th>
                                {activeCourses.map((course, column) => {
                                  const key = `${classSetting.school_class_id}:${course.id}`
                                  const cell = cellMap.get(key)
                                  if (!cell) return null
                                  const assignment = cell.assignment
                                  const selected = selectedKeySet.has(key)
                                  const statusMuted =
                                    statusFilter !== "all" && assignment?.status !== statusFilter
                                  const cellTone =
                                    assignment?.status === "draft"
                                      ? selected
                                        ? "bg-amber-100 ring-1 ring-inset ring-amber-400/80 dark:bg-amber-950/55 dark:ring-amber-700"
                                        : "bg-amber-100/80 ring-1 ring-inset ring-amber-400/80 hover:bg-amber-100 dark:bg-amber-950/45 dark:ring-amber-700 dark:hover:bg-amber-950/60"
                                      : selected
                                        ? "bg-primary/[0.055]"
                                        : assignment
                                          ? "bg-background hover:bg-muted/50"
                                          : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                                  return (
                                    <td
                                      key={key}
                                      data-grid-selection-cell=""
                                      data-grid-row={row}
                                      data-grid-column={column}
                                      data-grid-selected={selected ? "true" : undefined}
                                      className={cn(
                                        "relative z-0 h-24 border-r border-b p-0 transition-colors has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-inset has-[button:focus-visible]:ring-ring/35",
                                        cellTone,
                                      )}
                                    >
                                      <button
                                        id={`assignment-cell-${key}`}
                                        type="button"
                                        tabIndex={
                                          focusedKey === key ||
                                          (!focusedKey && row === 0 && column === 0)
                                            ? 0
                                            : -1
                                        }
                                        aria-pressed={selected}
                                        className={cn(
                                          "group relative z-10 flex size-full min-h-24 flex-col items-start bg-transparent px-3 py-2 text-left outline-none transition-opacity",
                                          statusMuted && "opacity-35",
                                        )}
                                        onClick={(event) => selectCell(cell, event)}
                                        onDoubleClick={() =>
                                          setEditor({
                                            assignment,
                                            schoolClassId: classSetting.school_class_id,
                                            courseId: course.id,
                                          })
                                        }
                                        onFocus={() => setFocusedKey(key)}
                                        onKeyDown={(event) => handleCellKey(event, cell)}
                                      >
                                        <span className="sr-only">
                                          {classSetting.school_class.name}，{course.name}。
                                        </span>
                                        {assignment ? (
                                          <>
                                            <span className="flex w-full items-start gap-2">
                                              <span className="line-clamp-1 font-semibold text-foreground">
                                                {assignment.teacher.name}
                                              </span>
                                              {assignment.status === "draft" ? (
                                                <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-200/80 px-1.5 py-0.5 text-xs font-medium text-amber-950 ring-1 ring-inset ring-amber-300/80 dark:bg-amber-900/70 dark:text-amber-100 dark:ring-amber-700">
                                                  <CircleAlertIcon className="size-3" />
                                                  待确认
                                                </span>
                                              ) : assignment.status === "inactive" ? (
                                                <span className="mt-1.5 ml-auto size-2 shrink-0 rounded-full bg-slate-400" />
                                              ) : null}
                                            </span>
                                            <span className="mt-1 text-xs text-muted-foreground">
                                              周 {assignment.weekly_items} 节
                                              {assignment.items_per_session > 1
                                                ? ` · ${assignment.items_per_session} 连排`
                                                : ""}
                                              {assignment.week_pattern !== "all"
                                                ? ` · ${weekPatternLabel(assignment.week_pattern)}`
                                                : ""}
                                            </span>
                                            <span className="mt-auto line-clamp-1 text-xs text-muted-foreground">
                                              {assignment.collaborators.length
                                                ? `协同：${assignment.collaborators.map((item) => item.name).join("、")}`
                                                : roomLabel(assignment)}
                                            </span>
                                          </>
                                        ) : (
                                          <>
                                            <PlusIcon className="mb-2 size-4 opacity-45 transition-opacity group-hover:opacity-90" />
                                            <span className="text-xs">未设置</span>
                                            <span className="mt-auto text-[11px] opacity-0 transition-opacity group-hover:opacity-100">
                                              双击或按 Enter 新增
                                            </span>
                                          </>
                                        )}
                                        <span className="sr-only">
                                          ，
                                          {assignment?.status === "draft"
                                            ? "待确认"
                                            : assignment?.status === "confirmed"
                                              ? "已确认"
                                              : assignment?.status === "inactive"
                                                ? "已停用"
                                                : "未设置"}
                                          {selected ? "，已选中" : ""}
                                        </span>
                                      </button>
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <GridSelectionOverlay selectionKey={selectedKeys.join("|")} />
                      </div>
                    </div>
                  </div>
                  <MatrixDetailPanel
                    cells={selectedCells}
                    copied={copied}
                    onEdit={(cell) =>
                      setEditor({
                        assignment: cell.assignment,
                        schoolClassId: cell.classSetting.school_class_id,
                        courseId: cell.course.id,
                      })
                    }
                    onCopy={copySelection}
                    onPaste={() => void pasteSelection()}
                    onBatch={() => setBatchOpen(true)}
                    onConfirm={confirmAssignments}
                  />
                </div>
              )}
            </>
          ) : groupedView && !isDraftReview ? (
            groupedAssignments.isLoading ? (
              <LoadingState label={`正在整理${viewLabels[groupedView]}…`} />
            ) : groupedAssignments.isError ? (
              <ErrorState retry={() => void groupedAssignments.refetch()} />
            ) : !visibleAssignmentGroups.length ? (
              <EmptyList title="没有匹配的分组" description="请调整搜索词、年级或状态筛选。" />
            ) : (
              <GroupedAssignmentsTable
                key={`${groupedView}:${gradeFilter}:${statusFilter}:${search}`}
                view={groupedView}
                groups={visibleAssignmentGroups}
                onEdit={(assignment) => setEditor({ assignment })}
                onAction={(path, message, body) => void assignmentAction(path, message, body)}
              />
            )
          ) : tableAssignments.isLoading ? (
            <LoadingState />
          ) : tableAssignments.isError ? (
            <ErrorState retry={() => void tableAssignments.refetch()} />
          ) : !tableAssignments.data?.data.length ? (
            isDraftReview ? (
              <EmptyList
                title={`${draftReviewScope}已全部确认`}
                description="没有待确认任课关系，可以返回矩阵继续维护。"
                actions={
                  <Button variant="outline" onClick={closeDraftReview}>
                    <ArrowLeftIcon />
                    返回矩阵
                  </Button>
                }
              />
            ) : (
              <EmptyList title="没有匹配的任课关系" description="请调整当前视角的筛选条件。" />
            )
          ) : (
            <>
              <AssignmentsTable
                items={tableAssignments.data.data}
                selectable={isDraftReview}
                selectedIds={selectedAssignmentIds}
                onSelectionChange={setSelectedAssignmentIds}
                onEdit={(assignment) => setEditor({ assignment })}
                onAction={(path, message, body) => void assignmentAction(path, message, body)}
              />
              <TablePagination
                page={tableMeta.page}
                pageSize={tableMeta.per_page}
                totalItems={tableMeta.total}
                totalPages={tableMeta.last_page}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size)
                  setPage(1)
                }}
              />
            </>
          )}
        </div>
      </div>

      <AssignmentEditorDialog
        seed={editor}
        semesterId={current.id}
        etag={etag}
        settings={settings.data?.data ?? []}
        groups={groups.data?.data ?? []}
        courses={courses.data?.data ?? []}
        teachers={teachers.data?.data ?? []}
        rooms={rooms.data?.data ?? []}
        onClose={() => setEditor(undefined)}
        onSaved={refresh}
      />
      <BatchAssignmentDialog
        open={batchOpen}
        cells={selectedCells}
        semesterId={current.id}
        etag={etag}
        teachers={teachers.data?.data ?? []}
        rooms={rooms.data?.data ?? []}
        onClose={() => setBatchOpen(false)}
        onSaved={async () => {
          setBatchOpen(false)
          await refresh()
        }}
      />
      <TeachingGroupManager
        open={groupsOpen}
        semesterId={current.id}
        etag={etag}
        settings={settings.data?.data ?? []}
        onClose={() => setGroupsOpen(false)}
        onSaved={refresh}
      />
    </>
  )
}

function MatrixDetailPanel({
  cells,
  copied,
  onEdit,
  onCopy,
  onPaste,
  onBatch,
  onConfirm,
}: {
  cells: MatrixCell[]
  copied: AssignmentTemplate | null
  onEdit: (cell: MatrixCell) => void
  onCopy: () => void
  onPaste: () => void
  onBatch: () => void
  onConfirm: (assignmentIds: number[]) => void
}) {
  if (!cells.length)
    return (
      <aside className="hidden border-l bg-muted/30 p-5 xl:block">
        <p className="text-sm text-muted-foreground">选择单元格查看详情</p>
      </aside>
    )
  const draftAssignmentIds = cells
    .map((cell) => cell.assignment)
    .filter((assignment): assignment is TeachingAssignment => assignment?.status === "draft")
    .map((assignment) => assignment.id)
  if (cells.length > 1)
    return (
      <aside className="hidden border-l bg-muted/30 p-5 xl:block">
        <p className="font-semibold">已选择 {cells.length} 个单元格</p>
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border bg-background p-3 text-sm">
          <span className="text-muted-foreground">已有设置</span>
          <span className="text-right font-medium">
            {cells.filter((cell) => cell.assignment).length}
          </span>
          <span className="text-muted-foreground">将新增</span>
          <span className="text-right font-medium">
            {cells.filter((cell) => !cell.assignment).length}
          </span>
        </div>
        <div className="mt-4 grid gap-2">
          {draftAssignmentIds.length > 0 && (
            <Button onClick={() => onConfirm(draftAssignmentIds)}>
              <CheckIcon />
              确认待确认项（{draftAssignmentIds.length}）
            </Button>
          )}
          <Button variant="outline" onClick={onBatch}>
            批量设置
          </Button>
          <Button variant="outline" disabled={!copied} onClick={onPaste}>
            <ClipboardPasteIcon />
            粘贴已复制设置
          </Button>
        </div>
      </aside>
    )
  const cell = cells[0]
  const assignment = cell.assignment
  return (
    <aside className="hidden border-l bg-muted/30 p-5 xl:block">
      <h2 className="text-base font-semibold">
        {cell.classSetting.school_class.name} · {cell.course.name}
      </h2>
      {assignment ? (
        <>
          <div className="mt-4 space-y-3 rounded-xl border bg-background p-4 text-sm">
            <Detail label="主讲教师" value={assignment.teacher.name} />
            <Detail
              label="协同教师"
              value={assignment.collaborators.map((teacher) => teacher.name).join("、") || "无"}
            />
            <Detail
              label="课时"
              value={`每周 ${assignment.weekly_items} 节${assignment.items_per_session > 1 ? `，每次 ${assignment.items_per_session} 连排` : ""}`}
            />
            <Detail label="周型" value={weekPatternLabel(assignment.week_pattern)} />
            <Detail label="教室" value={roomLabel(assignment)} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">状态</span>
              <StatusBadge
                value={assignment.status}
                label={assignment.status === "draft" ? "待确认" : undefined}
              />
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            {assignment.status === "draft" && (
              <Button onClick={() => onConfirm([assignment.id])}>
                <CheckIcon />
                确认任课关系
              </Button>
            )}
            <Button
              variant={assignment.status === "draft" ? "outline" : "default"}
              onClick={() => onEdit(cell)}
            >
              <PencilIcon />
              编辑任课关系
            </Button>
            <Button variant="outline" onClick={onCopy}>
              <ClipboardCopyIcon />
              复制此设置
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed bg-background p-4 text-sm">
          <p className="font-medium">尚未设置任课关系</p>
          <Button className="mt-4 w-full" onClick={() => onEdit(cell)}>
            <PlusIcon />
            设置任课关系
          </Button>
          {copied && (
            <Button className="mt-2 w-full" variant="outline" onClick={onPaste}>
              <ClipboardPasteIcon />
              粘贴已复制设置
            </Button>
          )}
        </div>
      )}
    </aside>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}

function AssignmentsTable({
  items,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  onEdit,
  onAction,
}: {
  items: TeachingAssignment[]
  selectable?: boolean
  selectedIds?: number[]
  onSelectionChange?: (ids: number[]) => void
  onEdit: (assignment: TeachingAssignment) => void
  onAction: (path: string, message: string, body?: unknown) => void
}) {
  const itemIds = items.map((assignment) => assignment.id)
  const selectedOnPage = itemIds.filter((id) => selectedIds.includes(id))
  const allSelected = itemIds.length > 0 && selectedOnPage.length === itemIds.length
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selectable && (
            <TableHead className="w-10">
              <Checkbox
                aria-label={allSelected ? "取消选择本页待确认任课关系" : "选择本页待确认任课关系"}
                checked={allSelected}
                indeterminate={selectedOnPage.length > 0 && !allSelected}
                onCheckedChange={(checked) =>
                  onSelectionChange?.(
                    checked
                      ? [...new Set([...selectedIds, ...itemIds])]
                      : selectedIds.filter((id) => !itemIds.includes(id)),
                  )
                }
              />
            </TableHead>
          )}
          <TableHead>授课对象 · 课程</TableHead>
          <TableHead>教师</TableHead>
          <TableHead>课时与周型</TableHead>
          <TableHead>教室</TableHead>
          <TableHead>排课进度</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((assignment) => (
          <TableRow
            key={assignment.id}
            data-state={selectedIds.includes(assignment.id) ? "selected" : undefined}
          >
            {selectable && (
              <TableCell>
                <Checkbox
                  aria-label={`选择${assignmentTarget(assignment)}的${assignment.course.name}任课关系`}
                  checked={selectedIds.includes(assignment.id)}
                  onCheckedChange={(checked) =>
                    onSelectionChange?.(
                      checked
                        ? [...new Set([...selectedIds, assignment.id])]
                        : selectedIds.filter((id) => id !== assignment.id),
                    )
                  }
                />
              </TableCell>
            )}
            <TableCell>
              <p className="font-medium">{assignmentTarget(assignment)}</p>
              <p className="text-xs text-muted-foreground">{assignment.course.name}</p>
            </TableCell>
            <TableCell>
              <p>{assignment.teacher.name}</p>
              {assignment.collaborators.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  协同：{assignment.collaborators.map((item) => item.name).join("、")}
                </p>
              )}
            </TableCell>
            <TableCell>
              <p>
                周 {assignment.weekly_items} 节
                {assignment.items_per_session > 1 ? ` · ${assignment.items_per_session} 连排` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {weekPatternLabel(assignment.week_pattern)}
              </p>
            </TableCell>
            <TableCell>{roomLabel(assignment)}</TableCell>
            <TableCell>
              <span className="tabular-nums">
                {assignment.scheduled ?? 0}/{assignment.weekly_items}
              </span>
            </TableCell>
            <TableCell>
              <StatusBadge
                value={assignment.status}
                label={assignment.status === "draft" ? "待确认" : undefined}
              />
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-0.5">
                {assignment.status === "draft" && (
                  <TableActionButton
                    intent="activate"
                    onClick={() =>
                      onAction("/confirm", "任课关系已确认", {
                        assignment_ids: [assignment.id],
                      })
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
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function BatchAssignmentDialog({
  open,
  cells,
  semesterId,
  etag,
  teachers,
  rooms,
  onClose,
  onSaved,
}: {
  open: boolean
  cells: MatrixCell[]
  semesterId: number
  etag: string | null
  teachers: Teacher[]
  rooms: Room[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const first = cells.find((cell) => cell.assignment)?.assignment
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    teacherId: "",
    weeklyItems: "1",
    itemsPerSession: "1",
    weekPattern: "all" as WeekPattern,
    activeWeeks: "",
    roomMode: "class_default" as "class_default" | "specified",
    specifiedRoomId: "",
  })
  useEffect(() => {
    if (!open) return
    setForm({
      teacherId: String(first?.teacher_id ?? teachers.find((item) => item.is_active)?.id ?? ""),
      weeklyItems: String(first?.weekly_items ?? 1),
      itemsPerSession: String(first?.items_per_session ?? 1),
      weekPattern: first?.week_pattern ?? "all",
      activeWeeks: first?.active_weeks?.join("、") ?? "",
      roomMode: first?.room_mode ?? "class_default",
      specifiedRoomId: String(
        first?.specified_room_id ?? rooms.find((item) => item.is_active)?.id ?? "",
      ),
    })
  }, [first, open, rooms, teachers])
  const activeWeeks = form.activeWeeks
    .split(/[、,，\s]+/)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0)
  const invalid =
    !form.teacherId ||
    Number(form.itemsPerSession) > Number(form.weeklyItems) ||
    (form.weekPattern === "specified" && !activeWeeks.length) ||
    (form.roomMode === "specified" && !form.specifiedRoomId)
  const save = async () => {
    if (!etag || invalid || !cells.length) return
    setSaving(true)
    try {
      const template: AssignmentTemplate = {
        teacherId: Number(form.teacherId),
        collaboratorIds: [],
        weeklyItems: Number(form.weeklyItems),
        itemsPerSession: Number(form.itemsPerSession),
        weekPattern: form.weekPattern,
        activeWeeks: form.weekPattern === "specified" ? [...new Set(activeWeeks)] : null,
        roomMode: form.roomMode,
        specifiedRoomId: form.roomMode === "specified" ? Number(form.specifiedRoomId) : null,
        allowsSubstitution: true,
      }
      await api(`/api/v1/semesters/${semesterId}/teaching-assignments/bulk`, {
        method: "POST",
        etag,
        body: jsonBody({
          operations: cells.map((cell) =>
            operationFromTemplate(cell, {
              ...template,
              collaboratorIds:
                cell.assignment?.collaborators
                  .map((teacher) => teacher.id)
                  .filter((id) => id !== template.teacherId) ?? [],
              allowsSubstitution:
                cell.assignment?.allows_substitution ?? template.allowsSubstitution,
            }),
          ),
        }),
      })
      toast.success(`已批量设置 ${cells.length} 个单元格`)
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>批量设置 {cells.length} 个单元格</DialogTitle>
          <DialogDescription>
            将新增 {cells.filter((cell) => !cell.assignment).length} 条、修改{" "}
            {cells.filter((cell) => cell.assignment).length} 条；任一项失败时整批不保存。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="主讲教师">
            <TeacherPicker
              teachers={teachers}
              value={form.teacherId}
              onValueChange={(value) => setForm((current) => ({ ...current, teacherId: value }))}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="周课时">
              <Input
                type="number"
                min="1"
                value={form.weeklyItems}
                onChange={(event) =>
                  setForm((current) => ({ ...current, weeklyItems: event.target.value }))
                }
              />
            </Field>
            <Field label="每次连排">
              <Input
                type="number"
                min="1"
                value={form.itemsPerSession}
                onChange={(event) =>
                  setForm((current) => ({ ...current, itemsPerSession: event.target.value }))
                }
              />
            </Field>
            <Field label="周型">
              <SimpleSelect
                className="w-full"
                value={form.weekPattern}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    weekPattern: value as WeekPattern,
                  }))
                }
              >
                <option value="all">每周</option>
                <option value="a">单周 / A 周</option>
                <option value="b">双周 / B 周</option>
                <option value="specified">指定周</option>
              </SimpleSelect>
            </Field>
          </div>
          {form.weekPattern === "specified" && (
            <Field label="教学周">
              <Input
                value={form.activeWeeks}
                placeholder="1、3、5、7"
                onChange={(event) =>
                  setForm((current) => ({ ...current, activeWeeks: event.target.value }))
                }
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="教室方式">
              <SimpleSelect
                className="w-full"
                value={form.roomMode}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    roomMode: value as "class_default" | "specified",
                  }))
                }
              >
                <option value="class_default">班级固定教室</option>
                <option value="specified">指定教室</option>
              </SimpleSelect>
            </Field>
            {form.roomMode === "specified" && (
              <Field label="指定教室">
                <RoomPicker
                  rooms={rooms}
                  value={form.specifiedRoomId}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, specifiedRoomId: value }))
                  }
                />
              </Field>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={saving || invalid} onClick={() => void save()}>
            {saving ? "正在批量保存…" : "确认批量设置"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function templateFromAssignment(assignment: TeachingAssignment): AssignmentTemplate {
  return {
    teacherId: assignment.teacher_id,
    collaboratorIds: assignment.collaborators.map((item) => item.id),
    weeklyItems: assignment.weekly_items,
    itemsPerSession: assignment.items_per_session,
    weekPattern: assignment.week_pattern,
    activeWeeks: assignment.active_weeks,
    roomMode: assignment.room_mode,
    specifiedRoomId: assignment.specified_room_id,
    allowsSubstitution: assignment.allows_substitution,
  }
}

function operationFromTemplate(cell: MatrixCell, template: AssignmentTemplate) {
  return {
    assignment_id: cell.assignment?.id,
    school_class_id: cell.classSetting.school_class_id,
    course_id: cell.course.id,
    teacher_id: template.teacherId,
    collaborator_ids: template.collaboratorIds,
    weekly_items: template.weeklyItems,
    items_per_session: template.itemsPerSession,
    week_pattern: template.weekPattern,
    active_weeks: template.activeWeeks,
    room_mode: template.roomMode,
    specified_room_id: template.roomMode === "specified" ? template.specifiedRoomId : null,
    allows_substitution: template.allowsSubstitution,
  }
}

function assignmentTarget(assignment: TeachingAssignment) {
  return assignment.school_class?.name ?? assignment.teaching_group?.name ?? "未设置授课对象"
}

function roomLabel(assignment: TeachingAssignment) {
  return assignment.room_mode === "class_default"
    ? "班级固定教室"
    : (assignment.specified_room?.name ?? "指定教室")
}

function weekPatternLabel(pattern: WeekPattern) {
  return { all: "每周", a: "单周 / A 周", b: "双周 / B 周", specified: "指定教学周" }[pattern]
}

function paginationFrom(
  meta: Record<string, unknown> | undefined,
  fallbackTotal: number,
): PaginationMeta {
  const value = meta?.pagination
  if (value && typeof value === "object") {
    const pagination = value as Partial<PaginationMeta>
    return {
      page: Number(pagination.page) || 1,
      per_page: Number(pagination.per_page) || 20,
      total: Number(pagination.total) || 0,
      last_page: Math.max(1, Number(pagination.last_page) || 1),
      from: pagination.from ?? null,
      to: pagination.to ?? null,
    }
  }
  return {
    page: 1,
    per_page: 20,
    total: fallbackTotal,
    last_page: Math.max(1, Math.ceil(fallbackTotal / 20)),
    from: fallbackTotal ? 1 : null,
    to: fallbackTotal || null,
  }
}

function isGroupedAssignmentView(value: View): value is GroupedAssignmentView {
  return groupedViewValues.includes(value as GroupedAssignmentView)
}

function numericFilterParam(params: URLSearchParams, key: string, fallback = "all") {
  const value = params.get(key)
  return value && /^\d+$/.test(value) ? value : fallback
}
