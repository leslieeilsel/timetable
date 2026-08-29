import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { api, apiMessage, jsonBody } from "@/lib/api"
import type { ClassSetting, PaginationMeta, TeachingGroup, TeachingGroupMode } from "@/lib/types"
import { EmptyList, ErrorState, Field, LoadingState } from "@/components/page"
import { ListToolbar, ToolbarSelect } from "@/components/list-toolbar"
import { SimpleSelect } from "@/components/simple-select"
import { StatusBadge } from "@/components/status-badge"
import { TableActionButton } from "@/components/table-action-button"
import { TablePagination } from "@/components/table-pagination"
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

export function TeachingGroupManager({
  open,
  semesterId,
  etag,
  settings,
  onClose,
  onSaved,
}: {
  open: boolean
  semesterId: number
  etag: string | null
  settings: ClassSetting[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [editing, setEditing] = useState<TeachingGroup | null | undefined>(undefined)
  const [pendingDelete, setPendingDelete] = useState<TeachingGroup | null>(null)
  const deferredSearch = useDeferredValue(search.trim())
  const groups = useQuery({
    queryKey: ["teaching-groups", semesterId, "manager", page, pageSize, deferredSearch, status],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page), per_page: String(pageSize) })
      if (deferredSearch) query.set("search", deferredSearch)
      if (status !== "all") query.set("status", status)
      return api<TeachingGroup[]>(`/api/v1/semesters/${semesterId}/teaching-groups?${query}`)
    },
    enabled: open,
  })
  const items = groups.data?.data ?? []
  const pagination = groups.data?.meta?.pagination as PaginationMeta | undefined
  const currentEtag = groups.data?.etag ?? etag
  const hasFilters = Boolean(deferredSearch || status !== "all")

  useEffect(() => {
    if (pagination && page > Math.max(1, pagination.last_page)) {
      setPage(Math.max(1, pagination.last_page))
    }
  }, [page, pagination])

  const remove = async () => {
    if (!pendingDelete || !currentEtag) return
    try {
      await api(`/api/v1/semesters/${semesterId}/teaching-groups/${pendingDelete.id}`, {
        method: "DELETE",
        etag: currentEtag,
      })
      toast.success("教学组已删除")
      setPendingDelete(null)
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>教学组</DialogTitle>
          <DialogDescription>
            合班、拆班和走班先定义所含班级，再作为一个授课对象加入任课矩阵。
          </DialogDescription>
        </DialogHeader>
        {editing !== undefined ? (
          <TeachingGroupForm
            group={editing}
            semesterId={semesterId}
            etag={currentEtag}
            settings={settings}
            onCancel={() => setEditing(undefined)}
            onSaved={async () => {
              setEditing(undefined)
              await onSaved()
            }}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <ListToolbar
              search={search}
              onSearchChange={(value) => {
                setSearch(value)
                setPage(1)
              }}
              searchPlaceholder="搜索教学组或班级"
              summary={<span>共 {pagination?.total ?? items.length} 个教学组</span>}
              actions={
                <Button size="sm" onClick={() => setEditing(null)}>
                  <PlusIcon />
                  新建教学组
                </Button>
              }
            >
              <ToolbarSelect
                value={status}
                onChange={(value) => {
                  setStatus(value)
                  setPage(1)
                }}
                label="状态筛选"
              >
                <option value="all">全部状态</option>
                <option value="active">已启用</option>
                <option value="inactive">已停用</option>
              </ToolbarSelect>
            </ListToolbar>
            {pendingDelete && (
              <div className="flex flex-wrap items-center gap-3 border-b bg-destructive/5 px-4 py-3 text-sm">
                <span className="mr-auto">
                  确认删除“{pendingDelete.name}”？仅未创建任课关系的教学组可以删除。
                </span>
                <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>
                  取消
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void remove()}>
                  确认删除
                </Button>
              </div>
            )}
            {groups.isLoading ? (
              <LoadingState />
            ) : groups.isError ? (
              <ErrorState retry={() => void groups.refetch()} />
            ) : !items.length && !hasFilters ? (
              <EmptyList
                title="还没有教学组"
                description="普通行政班课程无需教学组；出现合班、拆班或走班时再建立。"
                actions={
                  <Button size="sm" onClick={() => setEditing(null)}>
                    <PlusIcon />
                    新建教学组
                  </Button>
                }
              />
            ) : items.length ? (
              <Table responsive>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>包含班级</TableHead>
                    <TableHead>任课关系</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((group) => (
                    <TableRow key={group.id}>
                      <TableCell data-label="名称" className="font-medium">
                        {group.name}
                      </TableCell>
                      <TableCell data-label="类型">{groupModeLabel(group.mode)}</TableCell>
                      <TableCell data-label="包含班级" className="max-w-80">
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {group.school_classes.map((item) => item.name).join("、")}
                        </span>
                      </TableCell>
                      <TableCell data-label="任课关系">{group.assignments_count ?? 0} 条</TableCell>
                      <TableCell data-label="状态">
                        <StatusBadge value={group.status} />
                      </TableCell>
                      <TableCell data-label="操作" className="text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <TableActionButton intent="edit" onClick={() => setEditing(group)}>
                            编辑
                          </TableActionButton>
                          <TableActionButton
                            intent="delete"
                            disabled={(group.assignments_count ?? 0) > 0}
                            title={
                              (group.assignments_count ?? 0) > 0
                                ? "已有任课关系，不能删除"
                                : "删除教学组"
                            }
                            onClick={() => setPendingDelete(group)}
                          >
                            删除
                          </TableActionButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyList title="没有匹配的教学组" description="请调整搜索词或状态筛选。" />
            )}
            {pagination && pagination.total > 0 && (
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
        )}
        {editing === undefined && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              完成
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TeachingGroupForm({
  group,
  semesterId,
  etag,
  settings,
  onCancel,
  onSaved,
}: {
  group: TeachingGroup | null
  semesterId: number
  etag: string | null
  settings: ClassSetting[]
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: "",
    mode: "combined" as TeachingGroupMode,
    status: "active" as "active" | "inactive",
    schoolClassIds: [] as number[],
  })
  useEffect(() => {
    setForm({
      name: group?.name ?? "",
      mode: group?.mode ?? "combined",
      status: group?.status ?? "active",
      schoolClassIds: group?.school_classes.map((item) => item.id) ?? [],
    })
  }, [group])
  const gradeGroups = useMemo(
    () =>
      Object.entries(
        settings
          .filter((item) => item.status === "active")
          .reduce<Record<string, ClassSetting[]>>((result, setting) => {
            const name = setting.school_class.grade.name
            result[name] = [...(result[name] ?? []), setting]
            return result
          }, {}),
      ),
    [settings],
  )

  const save = async () => {
    if (!etag || !form.name.trim() || !form.schoolClassIds.length) return
    setSaving(true)
    try {
      await api(
        group
          ? `/api/v1/semesters/${semesterId}/teaching-groups/${group.id}`
          : `/api/v1/semesters/${semesterId}/teaching-groups`,
        {
          method: group ? "PATCH" : "POST",
          etag,
          body: jsonBody({
            name: form.name.trim(),
            mode: form.mode,
            status: form.status,
            school_class_ids: form.schoolClassIds,
          }),
        },
      )
      toast.success(group ? "教学组已更新" : "教学组已创建")
      await onSaved()
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="教学组名称">
          <Input
            value={form.name}
            placeholder="例如：七年级体育合班"
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field label="组织方式">
          <SimpleSelect
            className="w-full"
            value={form.mode}
            onValueChange={(value) =>
              setForm((current) => ({
                ...current,
                mode: value as TeachingGroupMode,
              }))
            }
          >
            <option value="combined">合班</option>
            <option value="split">拆班</option>
            <option value="roaming">走班</option>
          </SimpleSelect>
        </Field>
        <Field label="状态">
          <SimpleSelect
            className="w-full"
            value={form.status}
            onValueChange={(value) =>
              setForm((current) => ({
                ...current,
                status: value as "active" | "inactive",
              }))
            }
          >
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </SimpleSelect>
        </Field>
      </div>
      <Field label={`包含班级（已选 ${form.schoolClassIds.length} 个）`}>
        <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl border p-3">
          {gradeGroups.map(([grade, gradeSettings]) => (
            <section key={grade}>
              <div className="mb-2 flex items-center gap-3">
                <p className="text-sm font-semibold">{grade}</p>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    const ids = gradeSettings.map((item) => item.school_class_id)
                    const allSelected = ids.every((id) => form.schoolClassIds.includes(id))
                    setForm((current) => ({
                      ...current,
                      schoolClassIds: allSelected
                        ? current.schoolClassIds.filter((id) => !ids.includes(id))
                        : [...new Set([...current.schoolClassIds, ...ids])],
                    }))
                  }}
                >
                  全选 / 取消
                </Button>
              </div>
              <div className="grid gap-1 sm:grid-cols-3">
                {gradeSettings.map((setting) => (
                  <label
                    key={setting.school_class_id}
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted"
                  >
                    <Checkbox
                      checked={form.schoolClassIds.includes(setting.school_class_id)}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          schoolClassIds: checked
                            ? [...current.schoolClassIds, setting.school_class_id]
                            : current.schoolClassIds.filter((id) => id !== setting.school_class_id),
                        }))
                      }
                    />
                    {setting.school_class.name}
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          返回列表
        </Button>
        <Button
          disabled={saving || !form.name.trim() || !form.schoolClassIds.length}
          onClick={() => void save()}
        >
          {saving ? "正在保存…" : group ? "保存修改" : "创建教学组"}
        </Button>
      </DialogFooter>
    </div>
  )
}

function groupModeLabel(mode: TeachingGroupMode) {
  return { combined: "合班", split: "拆班", roaming: "走班" }[mode]
}
