import { useEffect, useMemo, useRef, useState } from "react"
import {
  DownloadIcon,
  GraduationCapIcon,
  LoaderCircleIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react"
import { toast } from "sonner"
import { apiDownload, apiMessage, jsonBody, saveDownload } from "@/lib/api"
import { cn } from "@/lib/utils"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export interface BulkClassExportOption {
  id: number
  name: string
  gradeName: string
}

export interface BulkTeacherExportOption {
  id: number
  name: string
  hasSchedule: boolean
}

interface BulkTimetableExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  semesterId: number
  versionId: string
  versionLabel: string
  mode: "official" | "full"
  classes: BulkClassExportOption[]
  teachers: BulkTeacherExportOption[]
  teachersLoading: boolean
  teachersError: boolean
}

type ExportKind = "class" | "teacher"

export function BulkTimetableExportDialog({
  open,
  onOpenChange,
  semesterId,
  versionId,
  versionLabel,
  mode,
  classes,
  teachers,
  teachersLoading,
  teachersError,
}: BulkTimetableExportDialogProps) {
  const initialized = useRef(false)
  const teachersInitialized = useRef(false)
  const [kind, setKind] = useState<ExportKind>("class")
  const [search, setSearch] = useState("")
  const [selectedClassIds, setSelectedClassIds] = useState<Set<number>>(new Set())
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      initialized.current = false
      teachersInitialized.current = false
      return
    }
    if (!initialized.current) {
      setKind("class")
      setSearch("")
      setSelectedClassIds(new Set(classes.map((item) => item.id)))
      setSelectedTeacherIds(new Set())
      initialized.current = true
    }
    if (!teachersLoading && !teachersInitialized.current) {
      setSelectedTeacherIds(
        new Set(teachers.filter((item) => item.hasSchedule).map((item) => item.id)),
      )
      teachersInitialized.current = true
    }
  }, [classes, open, teachers, teachersLoading])

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const visibleClasses = useMemo(
    () =>
      classes.filter(
        (item) =>
          normalizedSearch === "" ||
          item.name.toLocaleLowerCase().includes(normalizedSearch) ||
          item.gradeName.toLocaleLowerCase().includes(normalizedSearch),
      ),
    [classes, normalizedSearch],
  )
  const visibleTeachers = useMemo(
    () =>
      teachers.filter(
        (item) =>
          normalizedSearch === "" || item.name.toLocaleLowerCase().includes(normalizedSearch),
      ),
    [normalizedSearch, teachers],
  )
  const groupedClasses = useMemo(() => {
    const groups = new Map<string, BulkClassExportOption[]>()
    for (const item of visibleClasses) {
      const group = groups.get(item.gradeName) ?? []
      group.push(item)
      groups.set(item.gradeName, group)
    }
    return Array.from(groups.entries())
  }, [visibleClasses])

  const selectedCount = selectedClassIds.size + selectedTeacherIds.size
  const activeOptions = kind === "class" ? visibleClasses : visibleTeachers
  const activeSelection = kind === "class" ? selectedClassIds : selectedTeacherIds
  const allVisibleSelected =
    activeOptions.length > 0 && activeOptions.every((item) => activeSelection.has(item.id))

  const toggle = (targetKind: ExportKind, id: number, checked: boolean) => {
    const update = (current: Set<number>) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    }
    if (targetKind === "class") setSelectedClassIds(update)
    else setSelectedTeacherIds(update)
  }

  const toggleVisible = () => {
    const ids = activeOptions.map((item) => item.id)
    const update = (current: Set<number>) => {
      const next = new Set(current)
      for (const id of ids) {
        if (allVisibleSelected) next.delete(id)
        else next.add(id)
      }
      return next
    }
    if (kind === "class") setSelectedClassIds(update)
    else setSelectedTeacherIds(update)
  }

  const exportTimetables = async () => {
    if (selectedCount === 0 || selectedCount > 200 || busy) return
    setBusy(true)
    try {
      const download = await apiDownload(
        "/api/v1/semesters/" + semesterId + "/timetable/export.zip",
        {
          method: "POST",
          body: jsonBody({
            class_ids: classes
              .filter((item) => selectedClassIds.has(item.id))
              .map((item) => item.id),
            teacher_ids: teachers
              .filter((item) => selectedTeacherIds.has(item.id))
              .map((item) => item.id),
            mode,
            version_id: versionId ? Number(versionId) : undefined,
          }),
        },
      )
      saveDownload(download, "课表批量导出.zip")
      onOpenChange(false)
      toast.success("已导出 " + selectedCount + " 份课表")
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 pt-6 pb-5">
          <DialogTitle className="text-lg">批量导出课表</DialogTitle>
          <DialogDescription>
            {versionLabel} · {mode === "full" ? "完整作息" : "正式课程"} · Excel A4 竖向版
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          <Tabs
            value={kind}
            onValueChange={(value) => {
              setKind(value as ExportKind)
              setSearch("")
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="class">
                <GraduationCapIcon />
                班级
                <span className="text-xs tabular-nums text-muted-foreground">
                  {selectedClassIds.size}/{classes.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="teacher">
                <UsersIcon />
                教师
                <span className="text-xs tabular-nums text-muted-foreground">
                  {selectedTeacherIds.size}/{teachers.length}
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                surface="filter"
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={kind === "class" ? "搜索班级或年级" : "搜索教师"}
                aria-label={kind === "class" ? "搜索班级或年级" : "搜索教师"}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={activeOptions.length === 0}
              onClick={toggleVisible}
            >
              {allVisibleSelected ? "取消全选" : "全选结果"}
            </Button>
          </div>

          <div className="h-[min(42vh,22rem)] overflow-y-auto rounded-2xl border bg-background p-2">
            {kind === "teacher" && teachersLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" />
                正在载入导出对象…
              </div>
            ) : kind === "class" ? (
              groupedClasses.length > 0 ? (
                <div className="space-y-3">
                  {groupedClasses.map(([gradeName, items]) => (
                    <section key={gradeName}>
                      <div className="sticky top-0 z-10 bg-background/95 px-2 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                        {gradeName}
                      </div>
                      <div className="space-y-0.5">
                        {items.map((item) => (
                          <ExportOptionRow
                            key={item.id}
                            checked={selectedClassIds.has(item.id)}
                            label={item.name}
                            onCheckedChange={(checked) => toggle("class", item.id, checked)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <EmptyOptions search={normalizedSearch !== ""} label="班级" />
              )
            ) : visibleTeachers.length > 0 ? (
              <div className="space-y-0.5">
                {visibleTeachers.map((item) => (
                  <ExportOptionRow
                    key={item.id}
                    checked={selectedTeacherIds.has(item.id)}
                    label={item.name}
                    detail={item.hasSchedule ? "已有课表" : "暂无课程"}
                    muted={!item.hasSchedule}
                    onCheckedChange={(checked) => toggle("teacher", item.id, checked)}
                  />
                ))}
              </div>
            ) : (
              <EmptyOptions
                search={normalizedSearch !== ""}
                label={teachersError ? "教师名单（加载失败）" : "教师"}
              />
            )}
          </div>
        </div>

        <DialogFooter className="items-center border-t bg-muted/20 px-6 py-4">
          <p
            className={cn(
              "mr-auto text-xs text-muted-foreground",
              selectedCount > 200 && "text-destructive",
            )}
          >
            {selectedCount > 200
              ? "已选 " + selectedCount + " 份，单次最多 200 份"
              : selectedCount === 0
                ? "请选择需要导出的班级或教师"
                : "将生成包含 " + selectedCount + " 份 Excel 的 ZIP"}
          </p>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={busy || selectedCount === 0 || selectedCount > 200}
            onClick={() => void exportTimetables()}
          >
            {busy ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
            {busy ? "正在生成…" : "生成并下载"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ExportOptionRow({
  checked,
  label,
  detail,
  muted = false,
  onCheckedChange,
}: {
  checked: boolean
  label: string
  detail?: string
  muted?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/60">
      <Checkbox
        checked={checked}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
      />
      <span className={cn("min-w-0 flex-1 truncate font-medium", muted && "text-muted-foreground")}>
        {label}
      </span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
    </label>
  )
}

function EmptyOptions({ search, label }: { search: boolean; label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {search ? "没有匹配的" + label : "暂无可导出的" + label}
    </div>
  )
}
