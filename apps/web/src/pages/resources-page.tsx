import { useDeferredValue, useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router"
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
  MusicIcon,
  PaletteIcon,
  PlusIcon,
  ScaleIcon,
  SearchIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api, apiAllPages, ApiError, apiMessage, jsonBody } from "@/lib/api"
import type { Grade, Course, Teacher, Room, PaginationMeta } from "@/lib/types"
import { PageHeader, EmptyList, ErrorState, LoadingState, Field } from "@/components/page"
import { ListToolbar, ToolbarSelect } from "@/components/list-toolbar"
import { StatusBadge } from "@/components/status-badge"
import { TableActionButton } from "@/components/table-action-button"
import { TablePagination } from "@/components/table-pagination"
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
import { enumParam, mergeSearchParams, positiveIntegerParam } from "@/lib/url-state"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

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
  teachers: "维护教师、工号和任教课程；停用教师后不能继续用于新任课关系。",
  courses: "维护全校共用课程及课表简称；历史任课关系会保留原有课程信息。",
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

function resourceCategoryParam(params: URLSearchParams, kind: Kind) {
  const value = params.get("category")
  if (!value) return "all"
  if (kind === "teachers") return /^\d+$/.test(value) ? value : "all"
  if (kind === "rooms") return roomTypes.some(([type]) => type === value) ? value : "all"
  return "all"
}

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
  const [urlParams, setUrlParams] = useSearchParams()
  const [editing, setEditing] = useState<Resource | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Resource | null>(null)
  const [search, setSearch] = useState(() => urlParams.get("q") ?? "")
  const [status, setStatus] = useState(() =>
    enumParam(urlParams, "status", ["all", "active", "inactive"], "all"),
  )
  const [category, setCategory] = useState(() => resourceCategoryParam(urlParams, kind))
  const [page, setPage] = useState(() => positiveIntegerParam(urlParams, "page", 1))
  const [pageSize, setPageSize] = useState(() =>
    positiveIntegerParam(urlParams, "per_page", 20, [20, 50, 100]),
  )
  const deferredSearch = useDeferredValue(search.trim())
  const resources = useQuery({
    queryKey: [kind, "page", page, pageSize, deferredSearch, status, category],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page), per_page: String(pageSize) })
      if (deferredSearch) query.set("search", deferredSearch)
      if (status !== "all") query.set("status", status)
      if (category !== "all" && kind === "teachers") query.set("course_id", category)
      if (category !== "all" && kind === "rooms") query.set("type", category)
      return api<Resource[]>(`/api/v1/${kind}?${query}`)
    },
  })
  const courses = useQuery({
    queryKey: ["courses", "all", "resource-filter"],
    queryFn: () => apiAllPages<Course>("/api/v1/courses"),
    enabled: kind === "teachers",
  })
  const currentEtag = resources.data?.etag
  const resourceItems = resources.data?.data ?? []
  const pagination = resources.data?.meta?.pagination as PaginationMeta | undefined
  const total = pagination?.total ?? resourceItems.length
  const hasFilters = Boolean(deferredSearch || status !== "all" || category !== "all")
  const didMountFilters = useRef(false)
  useEffect(() => {
    if (!didMountFilters.current) {
      didMountFilters.current = true
      return
    }
    setPage(1)
  }, [deferredSearch, status, category, kind])
  useEffect(() => {
    setUrlParams(
      (current) =>
        mergeSearchParams(current, {
          q: search.trim() || null,
          status: status === "all" ? null : status,
          category: category === "all" ? null : category,
          page: page === 1 ? null : page,
          per_page: pageSize === 20 ? null : pageSize,
        }),
      { replace: true },
    )
  }, [category, page, pageSize, search, setUrlParams, status])
  useEffect(() => {
    if (pagination && page > Math.max(1, pagination.last_page)) {
      setPage(Math.max(1, pagination.last_page))
    }
  }, [page, pagination])
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: [kind] })
  }
  const remove = async () => {
    if (!deleting || !currentEtag) return
    try {
      await api(`/api/v1/${kind}/${deleting.id}`, { method: "DELETE", etag: currentEtag })
      toast.success(`${titles[kind]}已删除`)
      setDeleting(null)
      if (resourceItems.length === 1 && page > 1) setPage(page - 1)
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
          ) : !resourceItems.length && !hasFilters ? (
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
                    <span>
                      共 {total} 个{titles[kind]}
                    </span>
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
              {resourceItems.length ? (
                <ResourceTable
                  kind={kind}
                  items={resourceItems}
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
          <TableHead className="w-32 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-medium">
              <span className="inline-flex items-center gap-2.5">
                {kind === "teachers" && (
                  <span
                    className={`flex size-8 items-center justify-center rounded-full text-xs font-medium ${resourceAvatarTone(item.id)}`}
                  >
                    {resourceName(item).slice(0, 1)}
                  </span>
                )}
                {kind === "courses" && (
                  <span className="flex size-6 items-center justify-center text-muted-foreground">
                    <CourseGlyph name={resourceName(item)} />
                  </span>
                )}
                {kind === "rooms" && (
                  <span className="flex size-6 items-center justify-center text-muted-foreground">
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
              <div className="flex items-center justify-end gap-0.5">
                <TableActionButton intent="edit" onClick={() => onEdit(item)}>
                  编辑
                </TableActionButton>
                <TableActionButton intent="delete" onClick={() => onDelete(item)}>
                  删除
                </TableActionButton>
              </div>
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
  const [courseSearch, setCourseSearch] = useState("")
  const [courseFilter, setCourseFilter] = useState<"all" | "selected">("all")
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
    setCourseSearch("")
    setCourseFilter("all")
  }, [item, kind, open])

  const normalizedCourseSearch = courseSearch.trim().toLocaleLowerCase("zh-CN")
  const visibleCourses = courses.filter(
    (course) =>
      (courseFilter === "all" || courseIds.includes(course.id)) &&
      (!normalizedCourseSearch ||
        course.name.toLocaleLowerCase("zh-CN").includes(normalizedCourseSearch)),
  )

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
      <DialogContent
        className={
          kind === "teachers"
            ? "max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[940px]"
            : undefined
        }
      >
        {kind === "teachers" ? (
          <>
            <DialogHeader className="border-b px-6 py-5 pr-14">
              <DialogTitle>
                {item ? "编辑" : "新增"}
                {titles[kind]}
              </DialogTitle>
              <DialogDescription className="sr-only">维护教师资料。</DialogDescription>
            </DialogHeader>

            <div className="min-h-0 overflow-y-auto md:grid md:min-h-[32rem] md:grid-cols-[20rem_minmax(0,1fr)]">
              <section
                className="border-b p-6 md:border-r md:border-b-0"
                aria-labelledby="teacher-basic-heading"
              >
                <h3 id="teacher-basic-heading" className="mb-5 text-base font-medium">
                  基本信息
                </h3>
                <div className="grid gap-5">
                  <Field label="名称">
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoFocus
                    />
                  </Field>
                  <Field label="工号（可选）">
                    <Input
                      value={secondary}
                      onChange={(event) => setSecondary(event.target.value)}
                    />
                  </Field>
                  <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={active}
                      onCheckedChange={(checked) => setActive(Boolean(checked))}
                    />
                    启用
                  </label>
                </div>
              </section>

              <section className="min-w-0 p-6" aria-labelledby="teacher-courses-heading">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-baseline gap-3">
                    <h3 id="teacher-courses-heading" className="text-base font-medium">
                      任教课程
                    </h3>
                    <span className="text-sm text-muted-foreground">
                      已选 {courseIds.length} / {courses.length}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={courseIds.length === 0}
                    onClick={() => setCourseIds([])}
                  >
                    清空
                  </Button>
                </div>

                <div className="relative mt-4">
                  <SearchIcon
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    aria-label="搜索课程"
                    className="pl-9"
                    placeholder="搜索课程"
                    value={courseSearch}
                    onChange={(event) => setCourseSearch(event.target.value)}
                  />
                </div>

                <div className="mt-3 flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={courseFilter === "all" ? "secondary" : "ghost"}
                    onClick={() => setCourseFilter("all")}
                  >
                    全部
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={courseFilter === "selected" ? "secondary" : "ghost"}
                    onClick={() => setCourseFilter("selected")}
                  >
                    只看已选
                  </Button>
                </div>

                <div className="mt-3 grid max-h-[25rem] grid-cols-1 overflow-y-auto sm:grid-cols-2 sm:gap-x-6">
                  {visibleCourses.length > 0 ? (
                    visibleCourses.map((course) => (
                      <label
                        key={course.id}
                        className="flex min-h-10 cursor-pointer items-center gap-3 border-b py-2 text-base"
                      >
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
                        <span className="min-w-0 break-words">{course.name}</span>
                      </label>
                    ))
                  ) : (
                    <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
                      {courseFilter === "selected" ? "暂无已选课程" : "未找到匹配课程"}
                    </p>
                  )}
                </div>
              </section>
            </div>

            <DialogFooter className="border-t px-6 py-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={() => void save()} disabled={saving || !name.trim()}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {item ? "编辑" : "新增"}
                {titles[kind]}
              </DialogTitle>
              <DialogDescription className="sr-only">维护基础资料。</DialogDescription>
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
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={active}
                  onCheckedChange={(checked) => setActive(Boolean(checked))}
                />
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
          </>
        )}
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
