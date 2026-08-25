import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRightLeftIcon, CopyIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { api, apiMessage, jsonBody } from "@/lib/api"
import { useResolvedSemesterId } from "@/lib/semester"
import type { ClassSetting, Semester, Course, Teacher, TeachingTask, Room } from "@/lib/types"
import { EmptyList, ErrorState, Field, LoadingState, PageHeader } from "@/components/page"
import { ListToolbar, ToolbarSelect } from "@/components/list-toolbar"
import { StatusBadge } from "@/components/status-badge"
import { TablePagination, useTablePagination } from "@/components/table-pagination"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function TeachingTasksPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const client = useQueryClient()
  const [editing, setEditing] = useState<TeachingTask | null | undefined>(undefined)
  const [migrating, setMigrating] = useState<TeachingTask | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [search, setSearch] = useState("")
  const [gradeFilter, setGradeFilter] = useState("all")
  const [courseFilter, setCourseFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const semester = useQuery({
    queryKey: ["semester", semesterId],
    queryFn: () => api<Semester>(`/api/v1/semesters/${semesterId}`),
    enabled: semesterId !== null,
  })
  const tasks = useQuery({
    queryKey: ["teaching-tasks", semesterId],
    queryFn: () => api<TeachingTask[]>(`/api/v1/semesters/${semesterId}/teaching-tasks`),
    enabled: semesterId !== null,
  })
  const settings = useQuery({
    queryKey: ["class-settings", semesterId],
    queryFn: () => api<ClassSetting[]>(`/api/v1/semesters/${semesterId}/class-settings`),
    enabled: semesterId !== null,
  })
  const courses = useQuery({
    queryKey: ["courses"],
    queryFn: () => api<Course[]>("/api/v1/courses"),
  })
  const teachers = useQuery({
    queryKey: ["teachers"],
    queryFn: () => api<Teacher[]>("/api/v1/teachers"),
  })
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => api<Room[]>("/api/v1/rooms"),
  })
  const yearId = semester.data?.data.academic_year_id
  const siblings = useQuery({
    queryKey: ["semesters", yearId],
    queryFn: async () => (await api<Semester[]>(`/api/v1/academic-years/${yearId}/semesters`)).data,
    enabled: Boolean(yearId),
  })
  const source = siblings.data?.find((item) => item.sequence < (semester.data?.data.sequence ?? 1))
  const sourceTasks = useQuery({
    queryKey: ["teaching-tasks", source?.id, "confirmed"],
    queryFn: () =>
      api<TeachingTask[]>(`/api/v1/semesters/${source?.id}/teaching-tasks?status=confirmed`),
    enabled: Boolean(source),
  })
  const filteredTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN")
    return (tasks.data?.data ?? []).filter((task) => {
      const matchesSearch =
        !query ||
        `${task.school_class.name} ${task.course.name} ${task.teacher.name}`
          .toLocaleLowerCase("zh-CN")
          .includes(query)
      const matchesGrade =
        gradeFilter === "all" || String(task.school_class.grade_id) === gradeFilter
      const matchesCourse = courseFilter === "all" || String(task.course_id) === courseFilter
      const matchesStatus = statusFilter === "all" || task.status === statusFilter
      return matchesSearch && matchesGrade && matchesCourse && matchesStatus
    })
  }, [gradeFilter, search, statusFilter, courseFilter, tasks.data?.data])
  const pagination = useTablePagination(filteredTasks)
  const refresh = async () => {
    setSelected([])
    await Promise.all([
      client.invalidateQueries({ queryKey: ["semester", semesterId] }),
      client.invalidateQueries({ queryKey: ["teaching-tasks", semesterId] }),
    ])
  }

  const action = async (path: string, body?: unknown, method = "POST") => {
    if (!tasks.data?.etag) return
    try {
      await api(`/api/v1/semesters/${semesterId}/teaching-tasks${path}`, {
        method,
        etag: tasks.data.etag,
        body: body === undefined ? undefined : jsonBody(body),
      })
      toast.success("教学任务已更新")
      await refresh()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  const copy = async () => {
    const ids = sourceTasks.data?.data.map((task) => task.id) ?? []
    if (!source || !ids.length) return
    await action("/copy", { source_semester_id: source.id, task_ids: ids })
  }
  if (!semesterId && !context.isLoading)
    return (
      <>
        <PageHeader title="教学任务" />
        <EmptyList title="尚未设置当前学期" description="请先从学年管理中设置当前开放学期。" />
      </>
    )
  if (
    semester.isLoading ||
    tasks.isLoading ||
    settings.isLoading ||
    courses.isLoading ||
    teachers.isLoading ||
    rooms.isLoading
  )
    return <LoadingState />
  if (semester.isError || tasks.isError || !semester.data || !tasks.data)
    return <ErrorState retry={() => void tasks.refetch()} />
  const current = semester.data.data
  const drafts = tasks.data.data.filter((task) => task.status === "draft")
  const taskActions = (
    <>
      {source && !tasks.data.data.length && (
        <Button
          variant="outline"
          onClick={() => void copy()}
          disabled={!sourceTasks.data?.data.length}
        >
          <CopyIcon />
          复制上学期
        </Button>
      )}
      <Button onClick={() => setEditing(null)} disabled={current.status === "closed"}>
        <PlusIcon />
        新增任务
      </Button>
    </>
  )

  return (
    <>
      <PageHeader
        title="教学任务"
        description="每条任务描述一个班级、课程、教师、周课时和教室规则；确认后才可排课。"
      />
      <div className="space-y-4 p-5 md:p-7">
        <div className="surface-panel overflow-hidden">
          <ListToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="搜索班级、课程或教师"
            summary={
              <>
                <span>共 {filteredTasks.length} 条</span>
                <span>·</span>
                <span className="text-emerald-600">
                  已确认 {tasks.data.data.length - drafts.length} 条
                </span>
              </>
            }
            actions={taskActions}
          >
            <ToolbarSelect value={gradeFilter} onChange={setGradeFilter} label="年级筛选">
              <option value="all">全部年级</option>
              {Array.from(
                new Map(
                  tasks.data.data.map((task) => [
                    task.school_class.grade_id,
                    task.school_class.grade,
                  ]),
                ).values(),
              ).map((grade) => (
                <option key={grade.id} value={grade.id}>
                  {grade.name}
                </option>
              ))}
            </ToolbarSelect>
            <ToolbarSelect value={courseFilter} onChange={setCourseFilter} label="课程筛选">
              <option value="all">全部课程</option>
              {(courses.data?.data ?? []).map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </ToolbarSelect>
            <ToolbarSelect value={statusFilter} onChange={setStatusFilter} label="状态筛选">
              <option value="all">全部状态</option>
              <option value="draft">草稿</option>
              <option value="confirmed">已确认</option>
              <option value="inactive">已停用</option>
            </ToolbarSelect>
          </ListToolbar>
          {!tasks.data.data.length ? (
            <EmptyList
              title="还没有教学任务"
              description="先完成班级配置和作息模板，再逐条新增或从上学期复制。"
            />
          ) : (
            <>
              <div className="flex min-h-14 items-center gap-4 border-b px-4 py-3">
                <Checkbox
                  checked={
                    selected.length > 0 &&
                    filteredTasks
                      .filter((task) => task.status === "draft")
                      .every((task) => selected.includes(task.id))
                  }
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked
                        ? filteredTasks
                            .filter((task) => task.status === "draft")
                            .map((task) => task.id)
                        : [],
                    )
                  }
                />
                <Button
                  size="sm"
                  disabled={!selected.length || current.status !== "open"}
                  onClick={() => void action("/confirm", { task_ids: selected })}
                >
                  确认所选 {selected.length || ""}
                </Button>
                <p className="text-sm text-muted-foreground">仅草稿任务可批量确认</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>班级 · 课程</TableHead>
                    <TableHead>教师</TableHead>
                    <TableHead>周课时</TableHead>
                    <TableHead>教室规则</TableHead>
                    <TableHead>进度</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination.items.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell>
                        <Checkbox
                          disabled={task.status !== "draft"}
                          checked={selected.includes(task.id)}
                          onCheckedChange={(checked) =>
                            setSelected((current) =>
                              checked
                                ? [...current, task.id]
                                : current.filter((id) => id !== task.id),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{task.school_class.name}</p>
                        <p className="text-xs text-muted-foreground">{task.course.name}</p>
                      </TableCell>
                      <TableCell>{task.teacher.name}</TableCell>
                      <TableCell>{task.weekly_items}</TableCell>
                      <TableCell>
                        {task.room_mode === "class_default"
                          ? "班级固定教室"
                          : (task.specified_room?.name ?? "指定教室")}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-28 items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-emerald-500"
                              style={{
                                width: `${Math.min(100, ((task.scheduled ?? 0) / task.weekly_items) * 100)}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs tabular-nums">
                            {task.scheduled ?? 0}/{task.weekly_items}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={task.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary"
                          onClick={() => setEditing(task)}
                          disabled={current.status === "closed"}
                        >
                          编辑
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon-sm" aria-label="更多任务操作" />
                            }
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {(task.scheduled ?? 0) > 0 && (
                              <DropdownMenuItem
                                disabled={current.status === "closed"}
                                onClick={() => setMigrating(task)}
                              >
                                <ArrowRightLeftIcon />
                                迁移教室
                              </DropdownMenuItem>
                            )}
                            {task.status === "confirmed" && (
                              <DropdownMenuItem
                                onClick={() => void action(`/${task.id}/unconfirm`)}
                              >
                                退回草稿
                              </DropdownMenuItem>
                            )}
                            {task.status !== "inactive" ? (
                              <DropdownMenuItem
                                onClick={() => void action(`/${task.id}/deactivate`)}
                              >
                                停用任务
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => void action(`/${task.id}/restore`)}>
                                恢复任务
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination {...pagination} />
            </>
          )}
        </div>
      </div>
      <TaskDialog
        open={editing !== undefined}
        task={editing}
        semesterId={current.id}
        etag={tasks.data.etag}
        settings={settings.data?.data ?? []}
        courses={courses.data?.data ?? []}
        teachers={teachers.data?.data ?? []}
        rooms={rooms.data?.data ?? []}
        onClose={() => setEditing(undefined)}
        onSaved={refresh}
      />
      <TaskRoomMigrationDialog
        task={migrating}
        semesterId={current.id}
        etag={tasks.data.etag}
        rooms={rooms.data?.data ?? []}
        onClose={() => setMigrating(null)}
        onSaved={refresh}
      />
    </>
  )
}

function TaskRoomMigrationDialog({
  task,
  semesterId,
  etag,
  rooms,
  onClose,
  onSaved,
}: {
  task: TeachingTask | null
  semesterId: number
  etag: string | null
  rooms: Room[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [roomId, setRoomId] = useState("")
  useEffect(() => {
    setRoomId(String(task?.specified_room_id ?? rooms.find((item) => item.is_active)?.id ?? ""))
  }, [task, rooms])
  const migrate = async () => {
    if (!task || !etag || !roomId) return
    try {
      const result = await api<{ migrated_entries: number }>(
        `/api/v1/semesters/${semesterId}/teaching-tasks/${task.id}/migrate-room`,
        {
          method: "POST",
          etag,
          body: jsonBody({ target_room_id: Number(roomId) }),
        },
      )
      toast.success(`任务教室已更新，并迁移 ${result.data.migrated_entries} 节已排课程`)
      onClose()
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }

  return (
    <Dialog open={task !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>迁移教学任务教室</DialogTitle>
          <DialogDescription>
            {task?.school_class.name} · {task?.course.name}{" "}
            的教室规则和全部已排课程会一并改为指定教室；存在冲突或锁定课程时整批取消。
          </DialogDescription>
        </DialogHeader>
        <Field label="目标教室">
          <select
            className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
          >
            {rooms
              .filter((item) => item.is_active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!roomId} onClick={() => void migrate()}>
            确认迁移
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TaskDialog({
  open,
  task,
  semesterId,
  etag,
  settings,
  courses,
  teachers,
  rooms,
  onClose,
  onSaved,
}: {
  open: boolean
  task: TeachingTask | null | undefined
  semesterId: number
  etag: string | null
  settings: ClassSetting[]
  courses: Course[]
  teachers: Teacher[]
  rooms: Room[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState({
    school_class_id: "",
    course_id: "",
    teacher_id: "",
    weekly_items: "1",
    room_mode: "class_default",
    specified_room_id: "",
  })
  useEffect(() => {
    if (open)
      setForm({
        school_class_id: String(task?.school_class_id ?? settings[0]?.school_class_id ?? ""),
        course_id: String(task?.course_id ?? courses.find((item) => item.is_active)?.id ?? ""),
        teacher_id: String(task?.teacher_id ?? teachers.find((item) => item.is_active)?.id ?? ""),
        weekly_items: String(task?.weekly_items ?? 1),
        room_mode: task?.room_mode ?? "class_default",
        specified_room_id: String(task?.specified_room_id ?? ""),
      })
  }, [open, task, settings, courses, teachers])
  const save = async () => {
    if (!etag) return
    const body = {
      school_class_id: Number(form.school_class_id),
      course_id: Number(form.course_id),
      teacher_id: Number(form.teacher_id),
      weekly_items: Number(form.weekly_items),
      room_mode: form.room_mode,
      specified_room_id: form.room_mode === "specified" ? Number(form.specified_room_id) : null,
    }
    try {
      await api(
        task
          ? `/api/v1/semesters/${semesterId}/teaching-tasks/${task.id}`
          : `/api/v1/semesters/${semesterId}/teaching-tasks`,
        { method: task ? "PATCH" : "POST", etag, body: jsonBody(body) },
      )
      toast.success("教学任务已保存")
      onClose()
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task ? "编辑教学任务" : "新增教学任务"}</DialogTitle>
          <DialogDescription>
            同一学期同班同科只能有一条任务。已有排课后，班级、课程、教师和教室规则不可修改。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="班级">
            <select
              className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
              value={form.school_class_id}
              onChange={(event) => setForm({ ...form, school_class_id: event.target.value })}
            >
              {settings
                .filter((item) => item.status === "active")
                .map((item) => (
                  <option key={item.school_class_id} value={item.school_class_id}>
                    {item.school_class.name}
                  </option>
                ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="课程">
              <select
                className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
                value={form.course_id}
                onChange={(event) => setForm({ ...form, course_id: event.target.value })}
              >
                {courses
                  .filter((item) => item.is_active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="教师">
              <select
                className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
                value={form.teacher_id}
                onChange={(event) => setForm({ ...form, teacher_id: event.target.value })}
              >
                {teachers
                  .filter((item) => item.is_active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <Field label="每周课时">
            <Input
              type="number"
              min="1"
              max="100"
              value={form.weekly_items}
              onChange={(event) => setForm({ ...form, weekly_items: event.target.value })}
            />
          </Field>
          <Field label="教室规则">
            <select
              className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
              value={form.room_mode}
              onChange={(event) => setForm({ ...form, room_mode: event.target.value })}
            >
              <option value="class_default">使用班级固定教室</option>
              <option value="specified">指定教室</option>
            </select>
          </Field>
          {form.room_mode === "specified" && (
            <Field label="指定教室">
              <select
                className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
                value={form.specified_room_id}
                onChange={(event) => setForm({ ...form, specified_room_id: event.target.value })}
              >
                <option value="">请选择</option>
                {rooms
                  .filter((item) => item.is_active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => void save()}
            disabled={
              !form.school_class_id ||
              !form.course_id ||
              !form.teacher_id ||
              (form.room_mode === "specified" && !form.specified_room_id)
            }
          >
            保存草稿
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
