import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRightLeftIcon, CopyIcon, PlusIcon, Settings2Icon } from "lucide-react"
import { toast } from "sonner"
import { api, apiMessage, jsonBody } from "@/lib/api"
import { useResolvedSemesterId } from "@/lib/semester"
import type {
  ClassSetting,
  ScheduleTemplate,
  SchoolClass,
  Semester,
  Teacher,
  Room,
} from "@/lib/types"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

export function SemesterSetupPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const client = useQueryClient()
  const [settingOpen, setSettingOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [migratingSetting, setMigratingSetting] = useState<ClassSetting | null>(null)
  const [search, setSearch] = useState("")
  const [gradeFilter, setGradeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const semester = useQuery({
    queryKey: ["semester", semesterId],
    queryFn: () => api<Semester>(`/api/v1/semesters/${semesterId}`),
    enabled: semesterId !== null,
  })
  const yearId = semester.data?.data.academic_year_id
  const classes = useQuery({
    queryKey: ["classes", yearId],
    queryFn: () => api<SchoolClass[]>(`/api/v1/academic-years/${yearId}/classes`),
    enabled: Boolean(yearId),
  })
  const settings = useQuery({
    queryKey: ["class-settings", semesterId],
    queryFn: () => api<ClassSetting[]>(`/api/v1/semesters/${semesterId}/class-settings`),
    enabled: semesterId !== null,
  })
  const template = useQuery({
    queryKey: ["schedule-template", semesterId],
    queryFn: () =>
      api<ScheduleTemplate | null>(`/api/v1/semesters/${semesterId}/schedule-template`),
    enabled: semesterId !== null,
  })
  const teachers = useQuery({
    queryKey: ["teachers"],
    queryFn: () => api<Teacher[]>("/api/v1/teachers"),
  })
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => api<Room[]>("/api/v1/rooms"),
  })
  const siblings = useQuery({
    queryKey: ["semesters", yearId],
    queryFn: async () => (await api<Semester[]>(`/api/v1/academic-years/${yearId}/semesters`)).data,
    enabled: Boolean(yearId),
  })
  const filteredSettings = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN")
    return (settings.data?.data ?? []).filter((item) => {
      const matchesSearch =
        !query || item.school_class.name.toLocaleLowerCase("zh-CN").includes(query)
      const matchesGrade =
        gradeFilter === "all" || String(item.school_class.grade_id) === gradeFilter
      const matchesStatus = statusFilter === "all" || item.status === statusFilter
      return matchesSearch && matchesGrade && matchesStatus
    })
  }, [gradeFilter, search, settings.data?.data, statusFilter])
  const settingsPagination = useTablePagination(filteredSettings)
  const source = siblings.data?.find((item) => item.sequence < (semester.data?.data.sequence ?? 1))
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["semester", semesterId] }),
      client.invalidateQueries({ queryKey: ["class-settings", semesterId] }),
      client.invalidateQueries({ queryKey: ["schedule-template", semesterId] }),
    ])
  }
  const copy = async (type: "class-settings" | "schedule-template") => {
    const etag = type === "class-settings" ? settings.data?.etag : template.data?.etag
    if (!source || !etag) return
    try {
      await api(`/api/v1/semesters/${semesterId}/${type}/copy`, {
        method: "POST",
        etag,
        body: jsonBody({ source_semester_id: source.id }),
      })
      toast.success("已从上学期复制")
      await refresh()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  if (!semesterId && !context.isLoading)
    return (
      <>
        <PageHeader title="学期配置" />
        <EmptyList title="尚未设置当前学期" description="请从学年管理中开放学期并设为当前学期。" />
      </>
    )
  if (
    semester.isLoading ||
    classes.isLoading ||
    settings.isLoading ||
    template.isLoading ||
    teachers.isLoading ||
    rooms.isLoading
  )
    return <LoadingState />
  if (semester.isError || !semester.data)
    return <ErrorState retry={() => void semester.refetch()} />
  const current = semester.data.data

  return (
    <>
      <PageHeader
        title={`${current.academic_year?.name ?? "当前学年"} · ${current.name}配置`}
        description="先确定参与排课的班级和固定教室，再维护统一作息。"
      />
      <div className="p-5 md:p-7">
        <Tabs defaultValue="classes">
          <TabsList>
            <TabsTrigger value="classes">班级配置（{settings.data?.data.length ?? 0}）</TabsTrigger>
            <TabsTrigger value="template">作息模板</TabsTrigger>
          </TabsList>
          <TabsContent
            value="classes"
            className="mt-5 overflow-hidden rounded-xl border bg-background"
          >
            <div className="flex items-center justify-between border-b p-3">
              <div>
                <p className="font-medium">参与本学期排课的班级</p>
                <p className="text-sm text-muted-foreground">
                  固定教室是“使用班级默认教室”教学任务的实际教室。
                </p>
              </div>
              <div className="flex gap-2">
                {source && !settings.data?.data.length && (
                  <Button variant="outline" onClick={() => void copy("class-settings")}>
                    <CopyIcon />
                    复制上学期
                  </Button>
                )}
                <Button onClick={() => setSettingOpen(true)} disabled={current.status === "closed"}>
                  <PlusIcon />
                  添加班级
                </Button>
              </div>
            </div>
            {!settings.data?.data.length ? (
              <EmptyList
                title="还没有班级配置"
                description="从本学年班级中选择本学期实际参与排课的班级。"
              />
            ) : (
              <>
                <ListToolbar
                  search={search}
                  onSearchChange={setSearch}
                  searchPlaceholder="搜索班级"
                  summary={
                    <>
                      <span>
                        固定教室 {settings.data.data.filter((item) => item.fixed_room).length}/
                        {settings.data.data.length}
                      </span>
                      <span>·</span>
                      <span>
                        班主任 {settings.data.data.filter((item) => item.homeroom_teacher).length}/
                        {settings.data.data.length}
                      </span>
                    </>
                  }
                >
                  <ToolbarSelect value={gradeFilter} onChange={setGradeFilter} label="年级筛选">
                    <option value="all">全部年级</option>
                    {Array.from(
                      new Map(
                        (settings.data?.data ?? []).map((item) => [
                          item.school_class.grade_id,
                          item.school_class.grade,
                        ]),
                      ).values(),
                    ).map((grade) => (
                      <option key={grade.id} value={grade.id}>
                        {grade.name}
                      </option>
                    ))}
                  </ToolbarSelect>
                  <ToolbarSelect value={statusFilter} onChange={setStatusFilter} label="状态筛选">
                    <option value="all">全部状态</option>
                    <option value="active">已启用</option>
                    <option value="inactive">已停用</option>
                  </ToolbarSelect>
                </ListToolbar>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>班级</TableHead>
                      <TableHead>固定教室</TableHead>
                      <TableHead>班主任</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {settingsPagination.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.school_class.name}</TableCell>
                        <TableCell>
                          {item.fixed_room?.name ?? (
                            <span className="text-destructive">未设置</span>
                          )}
                        </TableCell>
                        <TableCell>{item.homeroom_teacher?.name ?? "—"}</TableCell>
                        <TableCell>
                          <StatusBadge value={item.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setMigratingSetting(item)}
                            disabled={current.status === "closed"}
                          >
                            <ArrowRightLeftIcon />
                            迁移教室
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setSettingOpen(true)}>
                            <Settings2Icon />
                            调整
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <TablePagination {...settingsPagination} />
              </>
            )}
          </TabsContent>
          <TabsContent
            value="template"
            className="mt-5 overflow-hidden rounded-xl border bg-background"
          >
            <div className="flex items-center justify-between border-b p-3">
              <div>
                <p className="font-medium">全学期统一作息</p>
                <p className="text-sm text-muted-foreground">
                  只有课表使用二维网格，作息本身用列表维护。
                </p>
              </div>
              <div className="flex gap-2">
                {source && !template.data?.data && (
                  <Button variant="outline" onClick={() => void copy("schedule-template")}>
                    <CopyIcon />
                    复制上学期
                  </Button>
                )}
                <Button
                  onClick={() => setTemplateOpen(true)}
                  disabled={current.status === "closed"}
                >
                  {template.data?.data ? "编辑作息" : "创建作息"}
                </Button>
              </div>
            </div>
            {!template.data?.data ? (
              <EmptyList
                title="还没有作息模板"
                description="开放学期前至少启用一天和一个可排课程课节。"
              />
            ) : (
              <div className="grid gap-5 p-4 lg:grid-cols-[1fr_2fr]">
                <div>
                  <p className="mb-2 text-sm font-medium">上课日</p>
                  <div className="flex flex-wrap gap-2">
                    {template.data.data.days.map((day) => (
                      <span
                        key={day.weekday}
                        className={`rounded-xl px-3 py-1.5 text-sm ${day.is_enabled ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                      >
                        {weekdays[day.weekday - 1]}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">课节列表</p>
                  <div className="divide-y rounded-2xl border">
                    {template.data.data.items.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 p-3">
                        <span className="w-12 text-sm tabular-nums text-muted-foreground">
                          {item.sort_order}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}
                          </p>
                        </div>
                        <StatusBadge value={item.is_active ? "active" : "inactive"} />
                        {item.allows_course && (
                          <span className="text-xs text-muted-foreground">可排课</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <ClassSettingDialog
        open={settingOpen}
        semesterId={current.id}
        etag={settings.data?.etag ?? null}
        classes={classes.data?.data ?? []}
        settings={settings.data?.data ?? []}
        teachers={teachers.data?.data ?? []}
        rooms={rooms.data?.data ?? []}
        onClose={() => setSettingOpen(false)}
        onSaved={refresh}
      />
      <TemplateDialog
        open={templateOpen}
        semesterId={current.id}
        etag={template.data?.etag ?? null}
        template={template.data?.data ?? null}
        onClose={() => setTemplateOpen(false)}
        onSaved={refresh}
      />
      <ClassRoomMigrationDialog
        setting={migratingSetting}
        semesterId={current.id}
        etag={settings.data?.etag ?? null}
        rooms={rooms.data?.data ?? []}
        onClose={() => setMigratingSetting(null)}
        onSaved={refresh}
      />
    </>
  )
}

function ClassRoomMigrationDialog({
  setting,
  semesterId,
  etag,
  rooms,
  onClose,
  onSaved,
}: {
  setting: ClassSetting | null
  semesterId: number
  etag: string | null
  rooms: Room[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [roomId, setRoomId] = useState("")
  useEffect(() => {
    setRoomId(String(setting?.fixed_room_id ?? rooms.find((item) => item.is_active)?.id ?? ""))
  }, [setting, rooms])
  const migrate = async () => {
    if (!setting || !etag || !roomId) return
    try {
      const result = await api<{ migrated_entries: number }>(
        `/api/v1/semesters/${semesterId}/class-settings/${setting.school_class_id}/migrate-room`,
        {
          method: "POST",
          etag,
          body: jsonBody({ target_room_id: Number(roomId) }),
        },
      )
      toast.success(`固定教室已更新，并迁移 ${result.data.migrated_entries} 节已排课程`)
      onClose()
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }

  return (
    <Dialog open={setting !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>迁移班级固定教室</DialogTitle>
          <DialogDescription>
            {setting?.school_class.name}{" "}
            的默认教室与所有“使用班级默认教室”的已排课程会在同一事务中更新；存在冲突或锁定课程时整批取消。
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

function ClassSettingDialog({
  open,
  semesterId,
  etag,
  classes,
  settings,
  teachers,
  rooms,
  onClose,
  onSaved,
}: {
  open: boolean
  semesterId: number
  etag: string | null
  classes: SchoolClass[]
  settings: ClassSetting[]
  teachers: Teacher[]
  rooms: Room[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [classId, setClassId] = useState("")
  const [roomId, setRoomId] = useState("")
  const [teacherId, setTeacherId] = useState("")
  const [status, setStatus] = useState("active")
  const available = useMemo(
    () =>
      classes.filter((item) => !settings.some((setting) => setting.school_class_id === item.id)),
    [classes, settings],
  )
  useEffect(() => {
    if (open) {
      setClassId(String(available[0]?.id ?? settings[0]?.school_class_id ?? ""))
      setRoomId("")
      setTeacherId("")
      setStatus("active")
    }
  }, [available, open, settings])
  useEffect(() => {
    const existing = settings.find((setting) => setting.school_class_id === Number(classId))
    if (existing) {
      setRoomId(String(existing.fixed_room_id ?? ""))
      setTeacherId(String(existing.homeroom_teacher_id ?? ""))
      setStatus(existing.status)
    }
  }, [classId, settings])
  const save = async () => {
    if (!classId || !etag) return
    try {
      await api(`/api/v1/semesters/${semesterId}/class-settings/${classId}`, {
        method: "PUT",
        etag,
        body: jsonBody({
          fixed_room_id: roomId ? Number(roomId) : null,
          homeroom_teacher_id: teacherId ? Number(teacherId) : null,
          status,
        }),
      })
      toast.success("班级配置已保存")
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
          <DialogTitle>班级配置</DialogTitle>
          <DialogDescription>选择已有配置可调整；选择未配置班级可新增。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="班级">
            <select
              className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
              value={classId}
              onChange={(event) => setClassId(event.target.value)}
            >
              <optgroup label="未配置">
                {available.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="已配置">
                {settings.map((item) => (
                  <option key={item.school_class_id} value={item.school_class_id}>
                    {item.school_class.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>
          <Field label="固定教室">
            <select
              className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
            >
              <option value="">未设置</option>
              {rooms
                .filter((item) => item.is_active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="班主任（可选）">
            <select
              className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
              value={teacherId}
              onChange={(event) => setTeacherId(event.target.value)}
            >
              <option value="">未设置</option>
              {teachers
                .filter((item) => item.is_active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="状态">
            <select
              className="h-8 rounded-2xl bg-input/50 px-3 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!classId} onClick={() => void save()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ItemForm {
  id?: number
  name: string
  type: "course" | "fixed_non_course" | "self_study"
  start_time: string
  end_time: string
  sort_order: number
  is_active: boolean
  allows_teacher?: boolean
  show_in_official?: boolean
}
function TemplateDialog({
  open,
  semesterId,
  etag,
  template,
  onClose,
  onSaved,
}: {
  open: boolean
  semesterId: number
  etag: string | null
  template: ScheduleTemplate | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState("标准作息")
  const [days, setDays] = useState<boolean[]>([true, true, true, true, true, false, false])
  const [items, setItems] = useState<ItemForm[]>([
    {
      name: "第 1 节",
      type: "course",
      start_time: "08:00",
      end_time: "08:40",
      sort_order: 1,
      is_active: true,
    },
  ])
  useEffect(() => {
    if (!open) return
    setName(template?.name ?? "标准作息")
    setDays(
      template
        ? weekdays.map((_, index) =>
            Boolean(template.days.find((day) => day.weekday === index + 1)?.is_enabled),
          )
        : [true, true, true, true, true, false, false],
    )
    setItems(
      template?.items.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        start_time: item.start_time.slice(0, 5),
        end_time: item.end_time.slice(0, 5),
        sort_order: item.sort_order,
        is_active: item.is_active,
        allows_teacher: item.allows_teacher,
        show_in_official: item.show_in_official,
      })) ?? [
        {
          name: "第 1 节",
          type: "course",
          start_time: "08:00",
          end_time: "08:40",
          sort_order: 1,
          is_active: true,
        },
      ],
    )
  }, [open, template])
  const update = (index: number, next: Partial<ItemForm>) =>
    setItems((current) =>
      current.map((item, currentIndex) => (currentIndex === index ? { ...item, ...next } : item)),
    )
  const save = async () => {
    if (!etag) return
    try {
      await api(`/api/v1/semesters/${semesterId}/schedule-template`, {
        method: "PUT",
        etag,
        body: jsonBody({
          name,
          days: days.map((is_enabled, index) => ({ weekday: index + 1, is_enabled })),
          items,
        }),
      })
      toast.success("作息模板已保存")
      onClose()
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{template ? "编辑作息模板" : "创建作息模板"}</DialogTitle>
          <DialogDescription>
            课节不能重叠；已被课表使用的课节不能删除或改为不可排课。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <Field label="模板名称">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="启用星期">
            <div className="flex flex-wrap gap-2">
              {weekdays.map((label, index) => (
                <label
                  key={label}
                  className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={days[index]}
                    onCheckedChange={(checked) =>
                      setDays((current) =>
                        current.map((value, currentIndex) =>
                          currentIndex === index ? Boolean(checked) : value,
                        ),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </Field>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">课节列表</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setItems((current) => [
                    ...current,
                    {
                      name: `第 ${current.length + 1} 节`,
                      type: "course",
                      start_time: "",
                      end_time: "",
                      sort_order: current.length + 1,
                      is_active: true,
                    },
                  ])
                }
              >
                <PlusIcon />
                添加课节
              </Button>
            </div>
            <div className="max-h-80 space-y-2 overflow-auto pr-1">
              {items.map((item, index) => (
                <div
                  key={item.id ?? `new-${index}`}
                  className="grid grid-cols-[60px_1fr_150px_110px_110px_70px] items-end gap-2 rounded-2xl border p-3"
                >
                  <Field label="序号">
                    <Input
                      type="number"
                      min="0"
                      value={item.sort_order}
                      onChange={(event) =>
                        update(index, { sort_order: Number(event.target.value) })
                      }
                    />
                  </Field>
                  <Field label="名称">
                    <Input
                      value={item.name}
                      onChange={(event) => update(index, { name: event.target.value })}
                    />
                  </Field>
                  <Field label="类型">
                    <select
                      className="h-8 w-full rounded-2xl bg-input/50 px-3 text-sm"
                      value={item.type}
                      onChange={(event) =>
                        update(index, { type: event.target.value as ItemForm["type"] })
                      }
                    >
                      <option value="course">课程</option>
                      <option value="fixed_non_course">固定非课程</option>
                      <option value="self_study">自习</option>
                    </select>
                  </Field>
                  <Field label="开始">
                    <Input
                      type="time"
                      value={item.start_time}
                      onChange={(event) => update(index, { start_time: event.target.value })}
                    />
                  </Field>
                  <Field label="结束">
                    <Input
                      type="time"
                      value={item.end_time}
                      onChange={(event) => update(index, { end_time: event.target.value })}
                    />
                  </Field>
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">状态</span>
                    <Checkbox
                      checked={item.is_active}
                      onCheckedChange={(checked) => update(index, { is_active: Boolean(checked) })}
                    />
                  </div>
                  {!item.id && (
                    <Button
                      className="col-span-full justify-self-end"
                      size="xs"
                      variant="destructive"
                      onClick={() =>
                        setItems((current) =>
                          current.filter((_, currentIndex) => currentIndex !== index),
                        )
                      }
                    >
                      移除
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={!name || !items.length}>
            保存作息
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
