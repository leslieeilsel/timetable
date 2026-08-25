import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AtomIcon,
  BookOpenIcon,
  Building2Icon,
  CalculatorIcon,
  Clock3Icon,
  DoorOpenIcon,
  DumbbellIcon,
  FlaskConicalIcon,
  Globe2Icon,
  LanguagesIcon,
  LeafIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  MusicIcon,
  PaletteIcon,
  PlusIcon,
  ScaleIcon,
  Trash2Icon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api, ApiError, apiMessage, jsonBody } from "@/lib/api"
import type { Grade, Course, Teacher, Room } from "@/lib/types"
import { PageHeader, EmptyList, ErrorState, LoadingState, Field } from "@/components/page"
import { ListToolbar, ToolbarSelect } from "@/components/list-toolbar"
import { StatusBadge } from "@/components/status-badge"
import { TablePagination, useTablePagination } from "@/components/table-pagination"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Kind = "grades" | "teachers" | "courses" | "rooms"
type Resource = Grade | Teacher | Course | Room

const titles: Record<Kind, string> = {
  grades: "年级",
  teachers: "教师",
  courses: "课程",
  rooms: "教室",
}
const descriptions: Record<Kind, string> = {
  grades: "维护学校年级和业务排序；停用优先于删除，避免破坏历史班级与课表。",
  teachers: "维护教师、工号和任教课程；停用教师后不能继续用于新教学任务。",
  courses: "维护全校共用课程及课表简称；历史教学任务会保留原有课程信息。",
  rooms: "维护普通教室和专用教室；停用教室前请先检查开放学期中的排课。",
}
const roomTypes = [
  ["classroom", "普通教室"],
  ["playground", "操场"],
  ["music_room", "音乐教室"],
  ["art_room", "美术教室"],
  ["laboratory", "实验室"],
  ["computer_room", "计算机教室"],
  ["other", "其他"],
]

export function GradesPage() {
  return <ResourcesPage kind="grades" />
}

export function TeachersPage() {
  return <ResourcesPage kind="teachers" />
}

export function CoursesPage() {
  return <ResourcesPage kind="courses" />
}

export function RoomsPage() {
  return <ResourcesPage kind="rooms" />
}

function ResourcesPage({ kind }: { kind: Kind }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState<Resource | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Resource | null>(null)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [category, setCategory] = useState("all")
  const resources = useQuery({
    queryKey: [kind],
    queryFn: () => api<Resource[]>(`/api/v1/${kind}`),
  })
  const courses = useQuery({
    queryKey: ["courses"],
    queryFn: () => api<Course[]>("/api/v1/courses"),
    enabled: kind === "teachers",
  })
  const currentEtag = resources.data?.etag
  const filteredResources = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN")
    return (resources.data?.data ?? []).filter((item) => {
      const searchable = [
        resourceName(item),
        "employee_no" in item ? item.employee_no : null,
        "short_name" in item ? item.short_name : null,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("zh-CN")
      const matchesSearch = !query || searchable.includes(query)
      const matchesStatus = status === "all" || (status === "active") === item.is_active
      const matchesCategory =
        category === "all" ||
        (kind === "teachers"
          ? (item as Teacher).courses?.some((course) => String(course.id) === category)
          : kind === "rooms"
            ? (item as Room).type === category
            : true)
      return matchesSearch && matchesStatus && matchesCategory
    })
  }, [category, kind, resources.data?.data, search, status])
  const pagination = useTablePagination(filteredResources)
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: [kind] })
  }
  const remove = async () => {
    if (!deleting || !currentEtag) return
    try {
      await api(`/api/v1/${kind}/${deleting.id}`, { method: "DELETE", etag: currentEtag })
      toast.success(`${titles[kind]}已删除`)
      setDeleting(null)
      await refresh()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }
  const addButton = (
    <Button onClick={() => setEditing(null)}>
      <PlusIcon />
      新增{titles[kind]}
    </Button>
  )

  return (
    <>
      <PageHeader title={titles[kind]} description={descriptions[kind]} />
      <div className="p-5 md:p-7">
        <div className="surface-panel overflow-hidden">
          {resources.isLoading || (kind === "teachers" && courses.isLoading) ? (
            <LoadingState />
          ) : resources.isError || (kind === "teachers" && courses.isError) ? (
            <ErrorState
              retry={() => {
                void resources.refetch()
                if (kind === "teachers") void courses.refetch()
              }}
            />
          ) : !resources.data?.data.length ? (
            <EmptyList
              title={`还没有${titles[kind]}资料`}
              description="新增后，班级、任务和排课都会复用这些资料。"
              actions={addButton}
            />
          ) : (
            <>
              {kind === "grades" ? (
                <ListToolbar actions={addButton} />
              ) : (
                <ListToolbar
                  search={search}
                  onSearchChange={setSearch}
                  searchPlaceholder={
                    kind === "teachers"
                      ? "搜索姓名或工号"
                      : kind === "courses"
                        ? "搜索课程名称或简称"
                        : "搜索教室名称"
                  }
                  summary={
                    <>
                      <span>
                        共 {filteredResources.length} 个{titles[kind]}
                      </span>
                      {kind === "courses" && <span>简称将显示在课表格中</span>}
                      {kind === "rooms" && <span>教室停用不会影响历史课表</span>}
                    </>
                  }
                  actions={addButton}
                >
                  {kind === "teachers" && (
                    <ToolbarSelect value={category} onChange={setCategory} label="任教课程筛选">
                      <option value="all">全部课程</option>
                      {(courses.data?.data ?? []).map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.name}
                        </option>
                      ))}
                    </ToolbarSelect>
                  )}
                  {kind === "rooms" && (
                    <ToolbarSelect value={category} onChange={setCategory} label="教室类型筛选">
                      <option value="all">全部类型</option>
                      {roomTypes.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </ToolbarSelect>
                  )}
                  <ToolbarSelect value={status} onChange={setStatus} label="状态筛选">
                    <option value="all">全部状态</option>
                    <option value="active">已启用</option>
                    <option value="inactive">已停用</option>
                  </ToolbarSelect>
                </ListToolbar>
              )}
              {filteredResources.length ? (
                <ResourceTable
                  kind={kind}
                  items={pagination.items}
                  onEdit={setEditing}
                  onDelete={setDeleting}
                />
              ) : (
                <div className="grid min-h-64 place-items-center px-6 text-center">
                  <div>
                    <p className="font-medium">没有匹配的{titles[kind]}</p>
                    <p className="mt-1 text-sm text-muted-foreground">请调整搜索词或筛选条件。</p>
                  </div>
                </div>
              )}
            </>
          )}
          <TablePagination {...pagination} />
        </div>
      </div>
      <ResourceDialog
        kind={kind}
        item={editing}
        open={editing !== undefined}
        etag={currentEtag}
        courses={courses.data?.data ?? []}
        onOpenChange={(open) => !open && setEditing(undefined)}
        onSaved={refresh}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={`删除${titles[kind]}`}
        description={`确定删除“${resourceName(deleting)}”吗？已被业务数据引用时系统会拒绝删除。`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </>
  )
}

function ResourceTable({
  kind,
  items,
  onEdit,
  onDelete,
}: {
  kind: Kind
  items: Resource[]
  onEdit: (item: Resource) => void
  onDelete: (item: Resource) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          {kind === "grades" && <TableHead>排序</TableHead>}
          {kind === "teachers" && (
            <>
              <TableHead>工号</TableHead>
              <TableHead>任教课程</TableHead>
            </>
          )}
          {kind === "courses" && <TableHead>简称</TableHead>}
          {kind === "rooms" && <TableHead>类型</TableHead>}
          <TableHead>状态</TableHead>
          <TableHead className="w-44 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-medium">
              <span className="inline-flex items-center gap-3">
                {kind === "teachers" && (
                  <span
                    className={`flex size-9 items-center justify-center rounded-full text-sm font-medium ${resourceAvatarTone(item.id)}`}
                  >
                    {resourceName(item).slice(0, 1)}
                  </span>
                )}
                {kind === "courses" && (
                  <span className="flex size-8 items-center justify-center rounded-md border text-muted-foreground">
                    <CourseGlyph name={resourceName(item)} />
                  </span>
                )}
                {kind === "rooms" && (
                  <span className="flex size-8 items-center justify-center text-muted-foreground">
                    <RoomGlyph type={(item as Room).type} />
                  </span>
                )}
                {resourceName(item)}
              </span>
            </TableCell>
            {kind === "grades" && <TableCell>{(item as Grade).sort_order}</TableCell>}
            {kind === "teachers" && (
              <>
                <TableCell>{(item as Teacher).employee_no || "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {(item as Teacher).courses?.map((course) => course.name).join("、") || "未设置"}
                </TableCell>
              </>
            )}
            {kind === "courses" && <TableCell>{(item as Course).short_name || "—"}</TableCell>}
            {kind === "rooms" && (
              <TableCell>
                <span className="rounded-md bg-muted px-2 py-1 text-xs text-foreground/80">
                  {roomTypes.find(([value]) => value === (item as Room).type)?.[1] ??
                    (item as Room).type}
                </span>
              </TableCell>
            )}
            <TableCell>
              <StatusBadge value={item.is_active ? "active" : "inactive"} />
            </TableCell>
            <TableCell className="text-right">
              <Button
                size="sm"
                variant="ghost"
                className="text-primary"
                onClick={() => onEdit(item)}
              >
                编辑
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`${resourceName(item)}更多操作`}
                    />
                  }
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem variant="destructive" onClick={() => onDelete(item)}>
                    <Trash2Icon />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function CourseGlyph({ name }: { name: string }) {
  const Icon = name.includes("数学")
    ? CalculatorIcon
    : name.includes("英语") || name.includes("语文")
      ? LanguagesIcon
      : name.includes("道德")
        ? ScaleIcon
        : name.includes("历史")
          ? Clock3Icon
          : name.includes("地理")
            ? Globe2Icon
            : name.includes("生物")
              ? LeafIcon
              : name.includes("物理")
                ? AtomIcon
                : name.includes("化学") || name.includes("实验")
                  ? FlaskConicalIcon
                  : name.includes("体育")
                    ? DumbbellIcon
                    : name.includes("音乐")
                      ? MusicIcon
                      : name.includes("美术")
                        ? PaletteIcon
                        : name.includes("信息")
                          ? MonitorIcon
                          : name.includes("班会")
                            ? UsersIcon
                            : BookOpenIcon
  return <Icon className="size-4" />
}

function RoomGlyph({ type }: { type: string }) {
  const Icon =
    type === "classroom"
      ? DoorOpenIcon
      : type === "playground"
        ? TrophyIcon
        : type === "music_room"
          ? MusicIcon
          : type === "art_room"
            ? PaletteIcon
            : type === "laboratory"
              ? FlaskConicalIcon
              : type === "computer_room"
                ? MonitorIcon
                : Building2Icon
  return <Icon className="size-5" />
}

function resourceAvatarTone(id: number) {
  const tones = [
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-violet-100 text-violet-700",
    "bg-amber-100 text-amber-700",
    "bg-rose-100 text-rose-700",
  ]
  return tones[id % tones.length]
}

function resourceName(item: Resource | null) {
  return item?.name ?? "这条资料"
}

function ResourceDialog({
  kind,
  item,
  open,
  etag,
  courses,
  onOpenChange,
  onSaved,
}: {
  kind: Kind
  item: Resource | null | undefined
  open: boolean
  etag?: string | null
  courses: Course[]
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState("")
  const [secondary, setSecondary] = useState("")
  const [active, setActive] = useState(true)
  const [courseIds, setCourseIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setName(item?.name ?? "")
    setActive(item?.is_active ?? true)
    setSecondary(
      kind === "grades"
        ? String((item as Grade | null)?.sort_order ?? "")
        : kind === "teachers"
          ? ((item as Teacher | null)?.employee_no ?? "")
          : kind === "courses"
            ? ((item as Course | null)?.short_name ?? "")
            : ((item as Room | null)?.type ?? "classroom"),
    )
    setCourseIds(
      kind === "teachers"
        ? ((item as Teacher | null)?.courses?.map((course) => course.id) ?? [])
        : [],
    )
  }, [item, kind, open])

  const save = async () => {
    if (!name.trim() || !etag) return
    const body: Record<string, unknown> = { name: name.trim(), is_active: active }
    if (kind === "grades") body.sort_order = Number(secondary)
    if (kind === "teachers") body.employee_no = secondary.trim() || null
    if (kind === "courses") body.short_name = secondary.trim() || null
    if (kind === "rooms") body.type = secondary
    setSaving(true)
    try {
      const endpoint = item ? `/api/v1/${kind}/${item.id}` : `/api/v1/${kind}`
      const persist = (extra: Record<string, unknown> = {}) =>
        api<Resource>(endpoint, {
          method: item ? "PATCH" : "POST",
          etag,
          body: jsonBody({ ...body, ...extra }),
        })
      let result
      try {
        result = await persist()
      } catch (error) {
        const hash = error instanceof ApiError ? error.details.impact_hash : null
        if (
          !(error instanceof ApiError) ||
          error.code !== "ACTIVE_RESOURCE_IN_USE" ||
          typeof hash !== "string" ||
          !window.confirm(
            "该资料正在开放学期中使用。停用后历史课表仍会保留，但不能继续用于新排课。确认停用吗？",
          )
        )
          throw error
        result = await persist({ confirm_open_impact: true, impact_hash: hash })
      }
      if (kind === "teachers") {
        await api(`/api/v1/teachers/${result.data.id}/courses`, {
          method: "PUT",
          etag: result.etag,
          body: jsonBody({ course_ids: courseIds }),
        })
      }
      toast.success(`${titles[kind]}已保存`)
      onOpenChange(false)
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {item ? "编辑" : "新增"}
            {titles[kind]}
          </DialogTitle>
          <DialogDescription>保存后会更新全局资料版本，其他打开的页面需刷新。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="名称">
            <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          {kind === "grades" && (
            <Field label="排序">
              <Input
                type="number"
                min="0"
                value={secondary}
                onChange={(event) => setSecondary(event.target.value)}
              />
            </Field>
          )}
          {kind === "teachers" && (
            <Field label="工号（可选）">
              <Input value={secondary} onChange={(event) => setSecondary(event.target.value)} />
            </Field>
          )}
          {kind === "courses" && (
            <Field label="简称（可选）">
              <Input value={secondary} onChange={(event) => setSecondary(event.target.value)} />
            </Field>
          )}
          {kind === "rooms" && (
            <Field label="教室类型">
              <select
                className="h-8 rounded-2xl bg-input/50 px-3 text-sm outline-none"
                value={secondary}
                onChange={(event) => setSecondary(event.target.value)}
              >
                {roomTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {kind === "teachers" && (
            <Field label="任教课程">
              <div className="grid max-h-36 grid-cols-2 gap-2 overflow-auto rounded-2xl border p-3">
                {courses.map((course) => (
                  <label key={course.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={courseIds.includes(course.id)}
                      onCheckedChange={(checked) =>
                        setCourseIds((current) =>
                          checked
                            ? [...current, course.id]
                            : current.filter((id) => id !== course.id),
                        )
                      }
                    />
                    {course.name}
                  </label>
                ))}
              </div>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={active} onCheckedChange={(checked) => setActive(Boolean(checked))} />
            启用
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmDialog({
  open,
  title,
  description,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            确认删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
