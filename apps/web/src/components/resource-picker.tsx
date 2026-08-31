import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleOffIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Course, Room, SchoolClass, Teacher, TeachingAssignment } from "@/lib/types"
import { cn } from "@/lib/utils"

export type ResourcePickerStatusTone = "success" | "warning" | "muted" | "danger"

export interface ResourcePickerItem {
  value: string
  label: string
  description?: string
  searchText: string
  pinyinSource?: string
  disabled?: boolean
  disabledReason?: string
  status: string
  statusTone?: ResourcePickerStatusTone
}

export interface ResourcePickerColumn {
  key: string
  label: string
  className?: string
  render: (item: ResourcePickerItem) => ReactNode
}

export interface ResourcePickerFacetOption {
  value: string
  label: string
  matches: (item: ResourcePickerItem) => boolean
}

export interface ResourcePickerFacet {
  key: string
  label: string
  defaultValue?: string
  maxVisibleOptions?: number
  options: ResourcePickerFacetOption[]
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN")
}

export function matchesResourceQuery(
  item: ResourcePickerItem,
  query: string,
  pinyinSearchText = "",
) {
  const needle = normalized(query)
  return (
    !needle ||
    normalized(
      `${item.label} ${item.description ?? ""} ${item.searchText} ${pinyinSearchText}`,
    ).includes(needle)
  )
}

function statusAppearance(tone: ResourcePickerStatusTone = "muted") {
  if (tone === "success") {
    return {
      icon: CheckCircle2Icon,
      className: "text-emerald-700 dark:text-emerald-400",
    }
  }
  if (tone === "warning") {
    return { icon: AlertCircleIcon, className: "text-amber-700 dark:text-amber-400" }
  }
  if (tone === "danger") {
    return { icon: CircleOffIcon, className: "text-destructive" }
  }
  return { icon: CircleOffIcon, className: "text-muted-foreground" }
}

function ResourceStatus({ item }: { item: ResourcePickerItem }) {
  const appearance = statusAppearance(item.statusTone)
  const Icon = appearance.icon
  return (
    <div className={cn("min-w-36", appearance.className)}>
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Icon className="size-4" />
        {item.status}
      </span>
      {item.disabledReason && (
        <span className="mt-0.5 block whitespace-normal text-xs text-muted-foreground">
          {item.disabledReason}
        </span>
      )}
    </div>
  )
}

interface ResourcePickerProps {
  value: string
  onValueChange: (value: string) => void
  items: ResourcePickerItem[]
  columns: ResourcePickerColumn[]
  title: string
  description: string
  ariaLabel: string
  placeholder: string
  searchPlaceholder: string
  facets?: ResourcePickerFacet[]
  countLabel?: (count: number) => string
  emptyDescription?: string
  clearable?: boolean
  clearLabel?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  onlySelectableLabel?: string
  defaultOnlySelectable?: boolean
}

export function ResourcePicker({
  value,
  onValueChange,
  items,
  columns,
  title,
  description,
  ariaLabel,
  placeholder,
  searchPlaceholder,
  facets = [],
  countLabel = (count) => `${count} 项`,
  emptyDescription = "请调整搜索词或筛选条件",
  clearable = false,
  clearLabel = "清除选择",
  disabled = false,
  invalid = false,
  className,
  onlySelectableLabel = "仅看可选",
  defaultOnlySelectable = true,
}: ResourcePickerProps) {
  const radioName = useId()
  const [open, setOpen] = useState(false)
  const [draftQuery, setDraftQuery] = useState("")
  const [query, setQuery] = useState("")
  const [pendingValue, setPendingValue] = useState(value)
  const [highlightedValue, setHighlightedValue] = useState(value)
  const [onlySelectable, setOnlySelectable] = useState(defaultOnlySelectable)
  const [facetValues, setFacetValues] = useState<Record<string, string>>({})
  const [pinyinIndex, setPinyinIndex] = useState<{
    signature: string
    values: Record<string, string>
  } | null>(null)
  const [pinyinLoading, setPinyinLoading] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())

  const selected = items.find((item) => item.value === value)
  const hasDisabledItems = items.some((item) => item.disabled)
  const pinyinSignature = items.map((item) => `${item.value}:${item.pinyinSource ?? ""}`).join("|")
  const activePinyinIndex =
    pinyinIndex?.signature === pinyinSignature ? pinyinIndex.values : undefined

  const resetDialog = () => {
    setDraftQuery("")
    setQuery("")
    setPendingValue(value)
    setHighlightedValue(value)
    setOnlySelectable(selected?.disabled ? false : defaultOnlySelectable)
    setFacetValues(
      Object.fromEntries(facets.map((facet) => [facet.key, facet.defaultValue ?? "all"])),
    )
  }

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (onlySelectable && item.disabled) return false
        if (!matchesResourceQuery(item, query, activePinyinIndex?.[item.value])) return false
        return facets.every((facet) => {
          const selectedFacet = facetValues[facet.key] ?? facet.defaultValue ?? "all"
          if (selectedFacet === "all") return true
          return (
            facet.options.find((option) => option.value === selectedFacet)?.matches(item) ?? true
          )
        })
      }),
    [activePinyinIndex, facetValues, facets, items, onlySelectable, query],
  )

  const applySearch = async () => {
    const nextQuery = draftQuery
    if (!/[a-z]/i.test(nextQuery)) {
      setQuery(nextQuery)
      return
    }
    if (activePinyinIndex) {
      setQuery(nextQuery)
      return
    }
    setPinyinLoading(true)
    try {
      const { resourcePinyin } = await import("@/lib/resource-pinyin")
      const values = Object.fromEntries(
        items.map((item) => [item.value, resourcePinyin(item.pinyinSource ?? item.label)]),
      )
      setPinyinIndex({ signature: pinyinSignature, values })
      setQuery(nextQuery)
    } finally {
      setPinyinLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    if (visibleItems.some((item) => item.value === highlightedValue && !item.disabled)) return
    setHighlightedValue(visibleItems.find((item) => !item.disabled)?.value ?? "")
  }, [highlightedValue, open, visibleItems])

  useEffect(() => {
    if (!open || !pendingValue) return
    const frame = requestAnimationFrame(() =>
      rowRefs.current.get(pendingValue)?.scrollIntoView({ block: "nearest" }),
    )
    return () => cancelAnimationFrame(frame)
  }, [open, pendingValue])

  const focusRow = (nextValue: string) => {
    setHighlightedValue(nextValue)
    requestAnimationFrame(() => rowRefs.current.get(nextValue)?.focus())
  }

  const moveHighlight = (direction: 1 | -1) => {
    const selectable = visibleItems.filter((item) => !item.disabled)
    if (!selectable.length) return
    const currentIndex = selectable.findIndex((item) => item.value === highlightedValue)
    const nextIndex =
      currentIndex < 0 ? 0 : (currentIndex + direction + selectable.length) % selectable.length
    focusRow(selectable[nextIndex].value)
  }

  const commit = (nextValue: string) => {
    onValueChange(nextValue)
    setOpen(false)
  }

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    item: ResourcePickerItem,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      moveHighlight(event.key === "ArrowDown" ? 1 : -1)
    } else if (event.key === "Enter") {
      event.preventDefault()
      commit(item.value)
    } else if (event.key === " ") {
      event.preventDefault()
      setPendingValue(item.value)
    }
  }

  return (
    <>
      <div className={cn("flex min-w-0 gap-2", className)}>
        <Button
          type="button"
          variant="outline"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className="min-w-0 flex-1 justify-between bg-background px-3 font-normal"
          onClick={() => {
            resetDialog()
            setOpen(true)
          }}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <span className="ml-2 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {selected ? "更换" : "选择"}
            <ChevronDownIcon className="size-3.5" />
          </span>
          <span className="sr-only">，{ariaLabel}</span>
        </Button>
        {clearable && selected && !disabled && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={() => onValueChange("")}
          >
            <XIcon />
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid max-h-[calc(100svh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:h-[min(42rem,calc(100svh-2rem))] sm:max-w-5xl">
          <DialogHeader className="border-b px-5 py-4 pr-14 sm:px-6">
            <DialogTitle className="text-lg">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 overflow-hidden px-4 py-4 sm:px-6">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={draftQuery}
                aria-label={searchPlaceholder}
                aria-busy={pinyinLoading || undefined}
                placeholder={searchPlaceholder}
                className="h-12 bg-background pr-10 pl-9 text-base sm:h-11 sm:pr-24"
                onChange={(event) => setDraftQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void applySearch()
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault()
                    const first = visibleItems.find((item) => !item.disabled)
                    if (first) focusRow(first.value)
                  }
                }}
              />
              <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
                {draftQuery && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="清除搜索"
                    onClick={() => {
                      setDraftQuery("")
                      setQuery("")
                    }}
                  >
                    <XIcon />
                  </Button>
                )}
                <span className="hidden rounded-md border bg-muted px-2 py-1 text-xs text-muted-foreground sm:inline-flex">
                  {pinyinLoading ? "正在准备拼音搜索…" : "Enter 搜索"}
                </span>
              </div>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
              {facets.map((facet) => (
                <div key={facet.key} className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    {facet.label}
                  </span>
                  <div className="flex min-w-0 max-w-full gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {facet.options
                      .slice(0, facet.maxVisibleOptions ?? facet.options.length)
                      .map((option) => {
                        const active =
                          (facetValues[facet.key] ?? facet.defaultValue ?? "all") === option.value
                        return (
                          <Button
                            key={option.value}
                            type="button"
                            size="sm"
                            variant={active ? "default" : "secondary"}
                            aria-pressed={active}
                            onClick={() =>
                              setFacetValues((current) => ({
                                ...current,
                                [facet.key]: option.value,
                              }))
                            }
                          >
                            {option.label}
                          </Button>
                        )
                      })}
                    {facet.maxVisibleOptions &&
                      facet.options.length > facet.maxVisibleOptions &&
                      (() => {
                        const overflowOptions = facet.options.slice(facet.maxVisibleOptions)
                        const selectedOverflow = overflowOptions.find(
                          (option) =>
                            option.value ===
                            (facetValues[facet.key] ?? facet.defaultValue ?? "all"),
                        )
                        return (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={selectedOverflow ? "default" : "secondary"}
                                  aria-label={`更多${facet.label}筛选`}
                                />
                              }
                            >
                              {selectedOverflow?.label ?? "更多"}
                              <ChevronDownIcon className="size-3" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="max-h-64 w-40" align="start">
                              {overflowOptions.map((option) => (
                                <DropdownMenuItem
                                  key={option.value}
                                  onClick={() =>
                                    setFacetValues((current) => ({
                                      ...current,
                                      [facet.key]: option.value,
                                    }))
                                  }
                                >
                                  {option.label}
                                  {selectedOverflow?.value === option.value && (
                                    <CheckCircle2Icon className="ml-auto size-3.5" />
                                  )}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )
                      })()}
                  </div>
                </div>
              ))}
              <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                {hasDisabledItems && (
                  <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap">
                    <span>{onlySelectableLabel}</span>
                    <Switch
                      className="data-checked:bg-emerald-600 dark:data-checked:bg-emerald-500"
                      checked={onlySelectable}
                      onCheckedChange={setOnlySelectable}
                    />
                  </label>
                )}
                <span aria-live="polite">{countLabel(visibleItems.length)}</span>
              </div>
            </div>

            <div className="min-h-0 overflow-auto rounded-lg border">
              <Table className="min-w-[680px] text-[15px]">
                <TableHeader className="sticky top-0 z-10 bg-popover">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-14">选择</TableHead>
                    {columns.map((column) => (
                      <TableHead key={column.key} className={column.className}>
                        {column.label}
                      </TableHead>
                    ))}
                    <TableHead className="w-48">状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleItems.map((item) => {
                    const checked = pendingValue === item.value
                    const highlighted = highlightedValue === item.value
                    return (
                      <TableRow
                        key={item.value}
                        ref={(node) => {
                          if (node) rowRefs.current.set(item.value, node)
                          else rowRefs.current.delete(item.value)
                        }}
                        role="option"
                        aria-selected={checked}
                        aria-disabled={item.disabled || undefined}
                        tabIndex={highlighted && !item.disabled ? 0 : -1}
                        data-state={checked ? "selected" : undefined}
                        className={cn(
                          "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          highlighted && "bg-muted/50",
                          checked && "bg-primary/[0.06] shadow-[inset_3px_0_0_0_var(--primary)]",
                          item.disabled && "cursor-not-allowed text-muted-foreground",
                        )}
                        onClick={() => !item.disabled && setPendingValue(item.value)}
                        onDoubleClick={() => !item.disabled && commit(item.value)}
                        onFocus={() => setHighlightedValue(item.value)}
                        onKeyDown={(event) => !item.disabled && handleRowKeyDown(event, item)}
                      >
                        <TableCell className="py-2.5">
                          <input
                            type="radio"
                            name={radioName}
                            value={item.value}
                            checked={checked}
                            disabled={item.disabled}
                            aria-label={`选择${item.label}`}
                            className="size-4 accent-primary"
                            onChange={() => setPendingValue(item.value)}
                          />
                        </TableCell>
                        {columns.map((column) => (
                          <TableCell key={column.key} className={cn("py-2.5", column.className)}>
                            {column.render(item)}
                          </TableCell>
                        ))}
                        <TableCell className="py-2.5">
                          <ResourceStatus item={item} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {visibleItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={columns.length + 2} className="h-40 text-center">
                        <p className="font-medium">没有匹配结果</p>
                        <p className="mt-1 text-xs text-muted-foreground">{emptyDescription}</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter className="grid grid-cols-2 items-center border-t bg-background px-4 py-4 sm:flex sm:flex-row sm:px-6">
            <div className="col-span-2 min-w-0 sm:mr-auto">
              <p className="truncate text-base font-medium">
                {pendingValue
                  ? `已选择：${items.find((item) => item.value === pendingValue)?.label ?? ""}`
                  : "尚未选择"}
              </p>
              <p className="hidden text-xs text-muted-foreground sm:block">
                ↑↓ 移动 · Enter 选择 · Esc 关闭
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={
                !pendingValue || items.find((item) => item.value === pendingValue)?.disabled
              }
              onClick={() => commit(pendingValue)}
            >
              确认选择
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function textCell(primary: string, secondary?: string | null) {
  return (
    <div className="min-w-0">
      <p className="font-medium">{primary}</p>
      {secondary && <p className="mt-0.5 text-xs text-muted-foreground">{secondary}</p>}
    </div>
  )
}

function allFacetOption(): ResourcePickerFacetOption {
  return { value: "all", label: "全部", matches: () => true }
}

type CommonPickerProps = {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  invalid?: boolean
  clearable?: boolean
  className?: string
}

export function teachersWithAssignmentCourses(assignments: TeachingAssignment[]) {
  const teachers = new Map<number, Teacher>()
  const coursesByTeacher = new Map<number, Map<number, Course>>()

  assignments.forEach((assignment) => {
    const relatedTeachers = [assignment.teacher, ...assignment.collaborators]
    relatedTeachers.forEach((teacher) => {
      teachers.set(teacher.id, teacher)
      const courses = coursesByTeacher.get(teacher.id) ?? new Map<number, Course>()
      teacher.courses?.forEach((course) => courses.set(course.id, course))
      courses.set(assignment.course.id, assignment.course)
      coursesByTeacher.set(teacher.id, courses)
    })
  })

  return [...teachers.values()].map((teacher) => ({
    ...teacher,
    courses: [...(coursesByTeacher.get(teacher.id)?.values() ?? [])],
  }))
}

export function TeacherPicker({
  teachers,
  courseId,
  requireQualification = false,
  ...props
}: CommonPickerProps & {
  teachers: Teacher[]
  courseId?: number | null
  requireQualification?: boolean
}) {
  const byId = new Map(teachers.map((teacher) => [String(teacher.id), teacher]))
  const items = teachers.map<ResourcePickerItem>((teacher) => {
    const qualificationKnown = Array.isArray(teacher.courses)
    const qualified =
      !courseId || !qualificationKnown || teacher.courses?.some((course) => course.id === courseId)
    const disabled = !teacher.is_active || (requireQualification && !qualified)
    return {
      value: String(teacher.id),
      label: teacher.name,
      description: teacher.employee_no ?? undefined,
      searchText: `${teacher.employee_no ?? ""} ${(teacher.courses ?? []).map((course) => `${course.name} ${course.short_name ?? ""}`).join(" ")}`,
      pinyinSource: `${teacher.name} ${(teacher.courses ?? []).map((course) => course.name).join(" ")}`,
      disabled,
      disabledReason: !teacher.is_active
        ? "教师已停用"
        : requireQualification && !qualified
          ? "未标记当前课程任教资格"
          : undefined,
      status: !teacher.is_active ? "已停用" : qualified ? "可选" : "未标记任教资格",
      statusTone: !teacher.is_active ? "muted" : qualified ? "success" : "warning",
    }
  })
  const courseMap = new Map<number, Course>()
  teachers.forEach((teacher) =>
    teacher.courses?.forEach((course) => courseMap.set(course.id, course)),
  )
  const coursePriority = ["语文", "数学", "英语", "物理"]
  const courseOptions = [...courseMap.values()]
    .sort((left, right) => {
      if (left.id === courseId) return -1
      if (right.id === courseId) return 1
      const leftPriority = coursePriority.indexOf(left.name)
      const rightPriority = coursePriority.indexOf(right.name)
      if (leftPriority !== rightPriority) {
        if (leftPriority < 0) return 1
        if (rightPriority < 0) return -1
        return leftPriority - rightPriority
      }
      return left.name.localeCompare(right.name, "zh-CN")
    })
    .map<ResourcePickerFacetOption>((course) => ({
      value: String(course.id),
      label: course.name,
      matches: (item) =>
        Boolean(byId.get(item.value)?.courses?.some((candidate) => candidate.id === course.id)),
    }))

  return (
    <ResourcePicker
      {...props}
      items={items}
      title="选择教师"
      description={
        courseId ? "按学科、姓名或工号快速定位合适教师" : "按姓名、工号或任教学科快速查找"
      }
      ariaLabel="选择教师"
      placeholder="请选择教师"
      searchPlaceholder="搜索教师姓名、工号或任教学科"
      facets={
        courseOptions.length
          ? [
              {
                key: "course",
                label: "学科",
                defaultValue: courseId ? String(courseId) : "all",
                maxVisibleOptions: 5,
                options: [allFacetOption(), ...courseOptions],
              },
            ]
          : []
      }
      countLabel={(count) => `${count} 位教师`}
      columns={[
        {
          key: "teacher",
          label: "教师",
          className: "min-w-36",
          render: (item) => textCell(item.label),
        },
        {
          key: "employee",
          label: "工号",
          className: "min-w-28",
          render: (item) => byId.get(item.value)?.employee_no ?? "—",
        },
        {
          key: "courses",
          label: "任教学科",
          className: "min-w-44 whitespace-normal",
          render: (item) =>
            byId
              .get(item.value)
              ?.courses?.map((course) => course.name)
              .join("、") || "未标记",
        },
      ]}
    />
  )
}

export function ClassPicker({
  classes,
  statusById,
  ...props
}: CommonPickerProps & {
  classes: SchoolClass[]
  statusById?: Record<number, { disabled?: boolean; label: string; reason?: string }>
}) {
  const byId = new Map(classes.map((item) => [String(item.id), item]))
  const items = classes.map<ResourcePickerItem>((schoolClass) => {
    const customStatus = statusById?.[schoolClass.id]
    const disabled = schoolClass.status !== "active" || customStatus?.disabled
    return {
      value: String(schoolClass.id),
      label: schoolClass.name,
      description: schoolClass.code ?? undefined,
      searchText: `${schoolClass.code ?? ""} ${schoolClass.grade.name}`,
      pinyinSource: `${schoolClass.name} ${schoolClass.grade.name}`,
      disabled,
      disabledReason:
        customStatus?.reason ?? (schoolClass.status !== "active" ? "班级已停用" : undefined),
      status: customStatus?.label ?? (schoolClass.status === "active" ? "可选" : "已停用"),
      statusTone: disabled ? "muted" : "success",
    }
  })
  const grades = [...new Map(classes.map((item) => [item.grade.id, item.grade])).values()]

  return (
    <ResourcePicker
      {...props}
      items={items}
      title="选择班级"
      description="按年级、班级名称或编号快速查找"
      ariaLabel="选择班级"
      placeholder="请选择班级"
      searchPlaceholder="搜索班级名称、编号或年级"
      facets={[
        {
          key: "grade",
          label: "年级",
          options: [
            allFacetOption(),
            ...grades.map<ResourcePickerFacetOption>((grade) => ({
              value: String(grade.id),
              label: grade.name,
              matches: (item) => byId.get(item.value)?.grade_id === grade.id,
            })),
          ],
        },
      ]}
      countLabel={(count) => `${count} 个班级`}
      columns={[
        {
          key: "class",
          label: "班级",
          className: "min-w-40",
          render: (item) => textCell(item.label),
        },
        {
          key: "grade",
          label: "年级",
          className: "min-w-28",
          render: (item) => byId.get(item.value)?.grade.name ?? "—",
        },
        {
          key: "code",
          label: "编号",
          className: "min-w-28",
          render: (item) => byId.get(item.value)?.code ?? "—",
        },
      ]}
    />
  )
}

export function RoomPicker({
  rooms,
  disabledReasons,
  contextDescription = "按名称或场地类型快速查找",
  ...props
}: CommonPickerProps & {
  rooms: Room[]
  disabledReasons?: Record<number, string>
  contextDescription?: string
}) {
  const typeLabels: Record<string, string> = {
    classroom: "普通教室",
    standard: "普通教室",
    playground: "操场",
    sports: "体育场地",
    music_room: "音乐教室",
    music: "音乐教室",
    art_room: "美术教室",
    art: "美术教室",
    laboratory: "实验室",
    computer_room: "计算机教室",
    computer: "计算机教室",
    other: "其他",
  }
  const typeLabel = (type: string) => typeLabels[type] ?? type
  const byId = new Map(rooms.map((item) => [String(item.id), item]))
  const items = rooms.map<ResourcePickerItem>((room) => {
    const reason = disabledReasons?.[room.id]
    const disabled = !room.is_active || Boolean(reason)
    return {
      value: String(room.id),
      label: room.name,
      description: typeLabel(room.type),
      searchText: `${room.type} ${typeLabel(room.type)}`,
      pinyinSource: `${room.name} ${typeLabel(room.type)}`,
      disabled,
      disabledReason: reason ?? (!room.is_active ? "场地已停用" : undefined),
      status: !room.is_active ? "已停用" : reason ? "当前不可用" : "可选",
      statusTone: disabled ? (reason ? "danger" : "muted") : "success",
    }
  })
  const types = [...new Set(rooms.map((room) => room.type).filter(Boolean))]

  return (
    <ResourcePicker
      {...props}
      items={items}
      title="选择教室/场地"
      description={contextDescription}
      ariaLabel="选择教室或场地"
      placeholder="请选择教室/场地"
      searchPlaceholder="搜索名称或场地类型"
      facets={[
        {
          key: "type",
          label: "类型",
          maxVisibleOptions: 5,
          options: [
            allFacetOption(),
            ...types.map<ResourcePickerFacetOption>((type) => ({
              value: type,
              label: typeLabel(type),
              matches: (item) => byId.get(item.value)?.type === type,
            })),
          ],
        },
      ]}
      countLabel={(count) => `${count} 个场地`}
      columns={[
        {
          key: "room",
          label: "场地",
          className: "min-w-52",
          render: (item) => textCell(item.label),
        },
        {
          key: "type",
          label: "类型",
          className: "min-w-36",
          render: (item) => typeLabel(byId.get(item.value)?.type ?? ""),
        },
      ]}
    />
  )
}

export function CoursePicker({ courses, ...props }: CommonPickerProps & { courses: Course[] }) {
  const byId = new Map(courses.map((item) => [String(item.id), item]))
  const items = courses.map<ResourcePickerItem>((course) => ({
    value: String(course.id),
    label: course.name,
    description: course.short_name ?? undefined,
    searchText: course.short_name ?? "",
    pinyinSource: course.name,
    disabled: !course.is_active,
    disabledReason: !course.is_active ? "课程已停用" : undefined,
    status: course.is_active ? "已启用" : "已停用",
    statusTone: course.is_active ? "success" : "muted",
  }))

  return (
    <ResourcePicker
      {...props}
      items={items}
      title="选择课程"
      description="可按课程名称或简称快速查找"
      ariaLabel="选择课程"
      placeholder="请选择课程"
      searchPlaceholder="搜索课程名称或简称"
      facets={[
        {
          key: "status",
          label: "状态",
          defaultValue: "active",
          options: [
            allFacetOption(),
            {
              value: "active",
              label: "已启用",
              matches: (item) => Boolean(byId.get(item.value)?.is_active),
            },
            {
              value: "inactive",
              label: "已停用",
              matches: (item) => !byId.get(item.value)?.is_active,
            },
          ],
        },
      ]}
      defaultOnlySelectable={false}
      countLabel={(count) => `${count} 门课程`}
      columns={[
        {
          key: "course",
          label: "课程",
          className: "min-w-52",
          render: (item) => textCell(item.label),
        },
        {
          key: "short",
          label: "简称",
          className: "min-w-36",
          render: (item) => byId.get(item.value)?.short_name ?? "—",
        },
      ]}
    />
  )
}

function assignmentTarget(assignment: TeachingAssignment) {
  return assignment.school_class?.name ?? assignment.teaching_group?.name ?? "未设置授课对象"
}

export function AssignmentPicker({
  assignments,
  requireConfirmed = false,
  ...props
}: CommonPickerProps & {
  assignments: TeachingAssignment[]
  requireConfirmed?: boolean
}) {
  const byId = new Map(assignments.map((item) => [String(item.id), item]))
  const items = assignments.map<ResourcePickerItem>((assignment) => {
    const disabled =
      assignment.status === "inactive" || (requireConfirmed && assignment.status !== "confirmed")
    return {
      value: String(assignment.id),
      label: `${assignmentTarget(assignment)} · ${assignment.course.name} · ${assignment.teacher.name}`,
      description: assignment.teacher.employee_no ?? undefined,
      searchText: `${assignmentTarget(assignment)} ${assignment.course.name} ${assignment.course.short_name ?? ""} ${assignment.teacher.name} ${assignment.teacher.employee_no ?? ""}`,
      pinyinSource: `${assignmentTarget(assignment)} ${assignment.course.name} ${assignment.teacher.name}`,
      disabled,
      disabledReason:
        assignment.status === "inactive"
          ? "任课关系已停用"
          : requireConfirmed && assignment.status !== "confirmed"
            ? "任课关系尚未确认"
            : undefined,
      status:
        assignment.status === "confirmed"
          ? "已确认"
          : assignment.status === "draft"
            ? "待确认"
            : "已停用",
      statusTone:
        assignment.status === "confirmed"
          ? "success"
          : assignment.status === "draft"
            ? "warning"
            : "muted",
    }
  })
  const grades = [
    ...new Map(
      assignments.flatMap((assignment) =>
        assignment.school_class
          ? [[assignment.school_class.grade.id, assignment.school_class.grade] as const]
          : [],
      ),
    ).values(),
  ]
  const courses = [
    ...new Map(assignments.map((assignment) => [assignment.course.id, assignment.course])).values(),
  ]

  return (
    <ResourcePicker
      {...props}
      items={items}
      title="选择任课关系"
      description="按班级、课程或教师快速定位任课关系"
      ariaLabel="选择任课关系"
      placeholder="请选择班级、课程与教师"
      searchPlaceholder="搜索班级、课程、教师姓名或工号"
      facets={[
        {
          key: "grade",
          label: "年级",
          options: [
            allFacetOption(),
            ...grades.map<ResourcePickerFacetOption>((grade) => ({
              value: String(grade.id),
              label: grade.name,
              matches: (item) => byId.get(item.value)?.school_class?.grade.id === grade.id,
            })),
          ],
        },
        {
          key: "course",
          label: "课程",
          maxVisibleOptions: 5,
          options: [
            allFacetOption(),
            ...courses.map<ResourcePickerFacetOption>((course) => ({
              value: String(course.id),
              label: course.name,
              matches: (item) => byId.get(item.value)?.course_id === course.id,
            })),
          ],
        },
      ]}
      countLabel={(count) => `${count} 条任课关系`}
      columns={[
        {
          key: "target",
          label: "授课对象",
          className: "min-w-36",
          render: (item) => textCell(assignmentTarget(byId.get(item.value)!)),
        },
        {
          key: "course",
          label: "课程",
          className: "min-w-28",
          render: (item) => byId.get(item.value)?.course.name ?? "—",
        },
        {
          key: "teacher",
          label: "任课教师",
          className: "min-w-40",
          render: (item) => {
            const teacher = byId.get(item.value)?.teacher
            return teacher ? textCell(teacher.name, teacher.employee_no) : "—"
          },
        },
        {
          key: "weekly",
          label: "周课时",
          className: "min-w-20",
          render: (item) => byId.get(item.value)?.weekly_items ?? "—",
        },
      ]}
    />
  )
}
