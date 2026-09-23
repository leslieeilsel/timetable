import { useEffect, useRef, type ReactNode } from "react"
import {
  ArrowLeft,
  ArrowLeftRight,
  CircleMinus,
  Flag,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  List,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Check,
  Clock3,
  UserRound,
  DoorOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SimpleSelect } from "@/components/simple-select"
import { DatePicker } from "@/components/date-picker"
import { ListToolbar } from "@/components/list-toolbar"
import { ClassPicker, RoomPicker, TeacherPicker } from "@/components/resource-picker"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Room, SchoolClass, Teacher } from "@/lib/types"
import { cn } from "@/lib/utils"
import { recordStatusColor, recordTypeTone } from "./record-appearance"
import { AdjustmentNavigation } from "./adjustment-navigation"

export const adjustmentPageClass =
  "flex min-h-[calc(100svh-3.5rem)] w-full flex-col gap-5 p-4 md:p-7"
export const adjustmentContentClass = "w-full space-y-6"

export function AdjustmentLessonToolbar({
  label,
  count,
  countLabel,
  search,
  onSearch,
  searchLabel,
  grid,
  onToggleGrid,
  leading,
  children,
}: {
  label: string
  count: number
  countLabel?: string
  search: string
  onSearch: (value: string) => void
  searchLabel: string
  grid: boolean
  onToggleGrid: () => void
  leading?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div className="mr-auto flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold">{label}的课程</span>
        <span className="text-muted-foreground" aria-live="polite">
          {countLabel ?? `${count} 节课`}
        </span>
        {leading}
      </div>
      <div className="relative w-48 max-w-full">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          aria-label={searchLabel}
          placeholder="查找课程"
          className="pl-9"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>
      {children}
      <Button size="sm" variant="ghost" onClick={onToggleGrid}>
        {grid ? <List /> : <CalendarDays />}
        {grid ? "从列表选课" : "对照课表"}
      </Button>
    </div>
  )
}

export function AdjustmentPageHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <header>
      <div className="sr-only">
        <h1 tabIndex={-1}>{title}</h1>
        <p>{description}</p>
      </div>
      <AdjustmentNavigation />
    </header>
  )
}

export function AdjustmentStepHeader({
  step,
  description,
  onBack,
  busy = false,
  title,
}: {
  step: number
  description: string
  onBack?: () => void
  busy?: boolean
  title?: string
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [step])
  return (
    <header className="-mx-4 -mt-4 flex min-h-14 flex-wrap items-center justify-between gap-2 border-b bg-background px-4 py-2 md:-mx-7 md:-mt-7 md:px-7">
      <h1 ref={heading} tabIndex={-1} className="sr-only">
        {title ?? ["", "选择课程", "设置新安排", "核对发布", "调课已发布"][step]}
      </h1>
      <p className="sr-only">{description}</p>
      <ol aria-label="调课步骤" className="flex min-w-0 items-center gap-1 sm:gap-3">
        {["选择课程", "设置新安排", "核对发布"].map((label, index) => {
          const number = index + 1
          const current = step === number
          const complete = step > number
          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className="flex items-center gap-1 sm:gap-3"
            >
              {index > 0 && (
                <ChevronRight
                  aria-hidden="true"
                  className="size-3 shrink-0 text-muted-foreground/60"
                />
              )}
              <span
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1.5 text-xs sm:gap-2 sm:px-3 sm:text-sm",
                  current ? "bg-muted font-semibold" : "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-xs",
                    current
                      ? "bg-primary text-primary-foreground"
                      : complete
                        ? "bg-emerald-500 text-white"
                        : "border bg-background",
                  )}
                >
                  {complete ? <Check className="size-3" /> : number}
                </span>
                <span className="sr-only">
                  第 {number} 步，{complete ? "已完成，" : current ? "当前步骤，" : ""}
                </span>
                {label}
              </span>
            </li>
          )
        })}
      </ol>
      {onBack && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onBack}
          className="ml-auto text-muted-foreground"
        >
          返回调整记录
        </Button>
      )}
    </header>
  )
}

export function AdjustmentEditorLayout({
  source,
  children,
  footer,
  busy,
}: {
  source?: ReactNode
  children: ReactNode
  footer?: ReactNode
  busy?: boolean
}) {
  return (
    <div
      className={cn(
        "overflow-clip rounded-xl border bg-card",
        source && "lg:grid lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)]",
      )}
    >
      {source && (
        <aside className="border-b bg-muted/35 lg:border-r lg:border-b-0">
          <fieldset disabled={busy} className="h-full min-w-0 p-4 lg:p-6">
            {source}
          </fieldset>
        </aside>
      )}
      <div className="flex min-w-0 flex-col p-4 lg:p-7">
        <div className="min-w-0 flex-1">{children}</div>
        {footer}
      </div>
    </div>
  )
}

export function AdjustmentFooter({
  onBack,
  backLabel = "上一步",
  onDraft,
  onPrimary,
  primaryLabel,
  disabled,
  busy,
  hint,
}: {
  onBack?: () => void
  backLabel?: string
  onDraft?: () => void
  onPrimary: () => void
  primaryLabel: string
  disabled?: boolean
  busy?: boolean
  hint?: ReactNode
}) {
  return (
    <footer className="sticky bottom-0 z-20 mt-6 flex flex-wrap items-center gap-2 border-t bg-card/95 pt-4 pb-2 backdrop-blur-sm">
      {onBack && (
        <Button variant="ghost" size="sm" aria-label={backLabel} disabled={busy} onClick={onBack}>
          <ArrowLeft />
          上一步
        </Button>
      )}
      <span
        className="order-last w-full text-xs text-muted-foreground xl:order-none xl:w-auto xl:flex-1"
        aria-live="polite"
      >
        {hint}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {onDraft && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onDraft}>
            暂存
          </Button>
        )}
        <Button
          className="font-semibold sm:min-w-32"
          disabled={disabled || busy}
          onClick={onPrimary}
        >
          {busy && <LoaderCircle className="animate-spin" />}
          {primaryLabel}
          {!busy && <ArrowRight />}
        </Button>
      </div>
    </footer>
  )
}

export function AdjustmentDraftNotice({
  description,
  onContinue,
  onDelete,
  busy,
}: {
  description: ReactNode
  onContinue: () => void
  onDelete?: () => void
  busy?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-4 py-3">
      <div className="text-sm">
        <span className="mr-2 font-medium">未发布草稿</span>
        {description}
      </div>
      <div className="flex gap-2">
        {onDelete && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
            删除草稿
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={busy} onClick={onContinue}>
          {busy ? "正在载入…" : "继续调整"}
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}

export function AdjustmentObjectPicker({
  kind,
  resource,
  onChange,
  classes,
  teachers,
  rooms,
}: {
  kind: string
  resource: string
  onChange: (kind: string, id: string) => void
  classes: SchoolClass[]
  teachers: Teacher[]
  rooms: Room[]
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
      <SimpleSelect
        label="查找课程的对象类型"
        className="w-20 shrink-0"
        value={kind}
        onValueChange={(value) => onChange(value, "")}
      >
        <option value="teacher">老师</option>
        <option value="class">班级</option>
        <option value="room">教室</option>
      </SimpleSelect>
      <div className="min-w-0 flex-1 sm:max-w-80">
        {kind === "class" ? (
          <ClassPicker
            classes={classes}
            value={resource}
            onValueChange={(id) => onChange(kind, id)}
          />
        ) : kind === "teacher" ? (
          <TeacherPicker
            teachers={teachers}
            value={resource}
            onValueChange={(id) => onChange(kind, id)}
          />
        ) : (
          <RoomPicker rooms={rooms} value={resource} onValueChange={(id) => onChange(kind, id)} />
        )}
      </div>
    </div>
  )
}

export function AdjustmentLiveComparison({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="本次调整对照"
      className="rounded-lg border border-[var(--timetable-blue-border)] bg-[var(--timetable-blue-background)] px-4 py-3"
    >
      <p className="mb-2 text-xs font-medium text-muted-foreground">本次调整 · 核对后发布</p>
      <div className="space-y-2 text-sm">{children}</div>
    </section>
  )
}

export function AdjustmentSourceSummary({
  title,
  subtitle,
  date,
  time,
  teachers,
  room,
  detail,
  children,
  onReselect,
  label = "原课程",
}: {
  title: ReactNode
  subtitle?: ReactNode
  date?: ReactNode
  time: ReactNode
  teachers?: ReactNode
  room?: ReactNode
  detail?: ReactNode
  children?: ReactNode
  onReselect?: () => void
  label?: string
}) {
  return (
    <section aria-label={label} className="flex h-full flex-col gap-3 lg:min-h-[480px] lg:gap-5">
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xs text-muted-foreground">{label}</h2>
          {onReselect && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onReselect}>
              重选课程
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 lg:block">
          <p className="text-xl font-semibold tracking-tight lg:text-2xl">{title}</p>
          {subtitle && <p className="text-sm font-medium lg:mt-1.5">{subtitle}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs lg:mt-2 lg:grid-cols-1 lg:gap-5 lg:text-sm">
        {date && (
          <p className="flex items-start gap-2 lg:gap-3">
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{date}</span>
          </p>
        )}
        <p className="flex items-start gap-2 lg:gap-3">
          <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{time}</span>
        </p>
        {teachers && (
          <p className="flex items-start gap-2 lg:gap-3">
            <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{teachers}</span>
          </p>
        )}
        {room && (
          <p className="flex items-start gap-2 lg:gap-3">
            <DoorOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{room}</span>
          </p>
        )}
      </div>
      {detail && <div className="text-xs leading-relaxed text-muted-foreground">{detail}</div>}
      {children && (
        <div className="mt-auto flex flex-wrap items-center gap-1 border-t pt-1 lg:pt-4">
          {children}
        </div>
      )}
    </section>
  )
}

export function AdjustmentTargetSection({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function AdjustmentCourseChoices({
  choices,
  onSelect,
}: {
  choices: {
    key: string
    period: string
    time: string
    title: string
    teachers: string
    room: string
    problem?: string
    selected?: boolean
  }[]
  onSelect: (key: string) => void
}) {
  if (choices.length === 1) {
    const item = choices[0]!
    return (
      <button
        type="button"
        disabled={Boolean(item.problem)}
        aria-pressed={item.selected ?? false}
        aria-label={`选择交换课程 ${item.period} ${item.title} ${item.teachers}`}
        onClick={() => onSelect(item.key)}
        className={cn(
          "w-full rounded-lg border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          item.selected ? "border-foreground/25 bg-muted/15" : "hover:enabled:bg-muted/30",
        )}
      >
        <span className="block text-xs text-muted-foreground">目标课程</span>
        <span className="mt-2 flex items-center justify-between gap-3">
          <strong className="text-lg font-semibold">{item.title}</strong>
          {item.selected ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <Check className="size-4" />
              已选中
            </span>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground">
              {item.problem ? "不可选" : "选择这节课"}
            </span>
          )}
        </span>
        <span className="mt-2 block text-sm text-muted-foreground">
          {item.period} · {item.time}　{item.teachers} · {item.room}
        </span>
        {item.problem && (
          <span className="mt-2 block text-sm text-destructive">{item.problem}</span>
        )}
      </button>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[76px_minmax(0,1fr)_20px] gap-3 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)_20px]">
        <span>课节 / 时间</span>
        <span>课程 / 班级</span>
        <span className="hidden sm:block">老师 / 教室</span>
        <span />
      </div>
      <div className="max-h-[38svh] overflow-y-auto">
        {choices.map((item) => (
          <button
            type="button"
            key={item.key}
            disabled={Boolean(item.problem)}
            aria-pressed={item.selected ?? false}
            aria-label={`选择交换课程 ${item.period} ${item.title} ${item.teachers}`}
            onClick={() => onSelect(item.key)}
            className={cn(
              "grid w-full grid-cols-[76px_minmax(0,1fr)_20px] items-center gap-3 border-t px-3 py-3 text-left text-sm first:border-t-0 hover:enabled:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)_20px]",
              item.selected && "bg-muted/50",
              item.problem && "bg-muted/20 text-muted-foreground",
            )}
          >
            <span>
              <span className="block font-medium">{item.period}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{item.time}</span>
            </span>
            <span className="min-w-0">
              <strong className="font-medium">{item.title}</strong>
              <span className="mt-1 block text-xs text-muted-foreground sm:hidden">
                {item.teachers} · {item.room}
              </span>
              {item.problem && (
                <span className="mt-1 block text-xs text-destructive">不可选：{item.problem}</span>
              )}
            </span>
            <span className="hidden min-w-0 sm:block">
              {item.teachers}
              <span className="mt-1 block text-xs text-muted-foreground">{item.room}</span>
            </span>
            {item.selected ? (
              <Check className="size-4" />
            ) : (
              <span className="size-4 rounded-full border" />
            )}
          </button>
        ))}
        {!choices.length && (
          <p className="p-5 text-sm text-muted-foreground">
            没有匹配的课程，请修改时间、课节或搜索条件。
          </p>
        )}
      </div>
    </div>
  )
}

export function AdjustmentActionTabs({
  value,
  onChange,
  options,
  more = [],
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string; disabled?: boolean }[]
  more?: { value: string; label: string }[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 sm:gap-2" role="group" aria-label="调整方式">
      {options.map((option) => (
        <Button
          key={option.value}
          disabled={option.disabled}
          variant={value === option.value ? "default" : "ghost"}
          className="rounded-full px-2.5 text-xs sm:px-4 sm:text-sm"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className="rounded-full px-2.5 text-xs sm:px-4 sm:text-sm"
                variant={more.some((option) => option.value === value) ? "default" : "ghost"}
              />
            }
          >
            {more.find((option) => option.value === value)?.label ?? (
              <>
                <span className="sm:hidden">更多</span>
                <span className="hidden sm:inline">更多调整</span>
              </>
            )}
            <ChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {more.map((option) => (
              <DropdownMenuItem key={option.value} onClick={() => onChange(option.value)}>
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export function AdjustmentHistoryToolbar({
  search,
  onSearch,
  onSubmit,
  status,
  statuses,
  onStatus,
  from,
  to,
  onFrom,
  onTo,
  onClear,
  refreshing,
  onRefresh,
  children,
  extraActive = false,
  onNew,
  newLabel = "发起调课",
}: {
  search: string
  onSearch: (value: string) => void
  onSubmit: () => void
  status: string
  statuses: [string, string][]
  onStatus: (value: string) => void
  from: string
  to: string
  onFrom: (value: string) => void
  onTo: (value: string) => void
  onClear: () => void
  refreshing: boolean
  onRefresh: () => void
  children?: ReactNode
  extraActive?: boolean
  onNew?: () => void
  newLabel?: string
}) {
  const filtered = Boolean(search || status !== "all" || from || to || extraActive)
  return (
    <ListToolbar
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label="刷新调课记录"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw />
          </Button>
          {onNew && (
            <Button onClick={onNew}>
              <Plus />
              {newLabel}
            </Button>
          )}
        </>
      }
    >
      <form
        className="relative min-w-48 flex-1 sm:max-w-80"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          aria-label="搜索调课记录"
          type="search"
          surface="filter"
          className="pl-9"
          placeholder="搜索班级、老师、课程或原因"
          maxLength={100}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </form>
      <SimpleSelect label="调课记录状态" value={status} onValueChange={onStatus} surface="filter">
        {statuses.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SimpleSelect>
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <DatePicker
          label="筛选开始日期"
          placeholder="开始日期"
          value={from}
          max={to || undefined}
          onValueChange={onFrom}
          className="w-40"
          surface="filter"
        />
        <span className="text-sm text-muted-foreground">至</span>
        <DatePicker
          label="筛选结束日期"
          placeholder="结束日期"
          value={to}
          min={from || undefined}
          onValueChange={onTo}
          className="w-40"
          surface="filter"
        />
      </div>
      {filtered && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          清空筛选
        </Button>
      )}
    </ListToolbar>
  )
}

export function AdjustmentRecordList({ children }: { children: ReactNode }) {
  return (
    <div>
      <div className="hidden grid-cols-[88px_minmax(120px,1fr)_minmax(180px,1.5fr)_140px_88px_16px] gap-4 border-b bg-muted px-4 py-2.5 text-sm font-medium xl:grid">
        <span>类型</span>
        <span>课程</span>
        <span>原安排 → 新安排</span>
        <span>生效时间</span>
        <span>状态</span>
        <span />
      </div>
      {children}
    </div>
  )
}
export function AdjustmentRecordRow({
  type,
  title,
  detail,
  before,
  after,
  date,
  status,
  statusDetail,
  onClick,
}: {
  type: string
  title: ReactNode
  detail?: ReactNode
  before: ReactNode
  after: ReactNode
  date: ReactNode
  status: string
  statusDetail?: ReactNode
  onClick: () => void
}) {
  const TypeIcon =
    {
      换课: ArrowLeftRight,
      改时间: Clock3,
      换老师: UserRound,
      换教室: DoorOpen,
      停课: CircleMinus,
      安排活动: Flag,
    }[type] || SlidersHorizontal
  return (
    <button
      className="grid w-full grid-cols-[1fr_20px] items-center gap-x-4 gap-y-2 border-b px-4 py-4 text-left last:border-b-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring xl:grid-cols-[88px_minmax(120px,1fr)_minmax(180px,1.5fr)_140px_88px_16px]"
      onClick={onClick}
    >
      <div
        className={cn("flex items-center gap-2 text-sm font-semibold", recordTypeTone(type).text)}
      >
        <TypeIcon className="size-4 shrink-0" aria-hidden="true" />
        {type}
      </div>
      <div className="col-start-1 row-start-2 min-w-0 xl:col-start-auto xl:row-start-auto">
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      </div>
      <div className="col-start-1 row-start-3 min-w-0 text-sm xl:col-start-auto xl:row-start-auto">
        <p className="text-xs text-muted-foreground">{before}</p>
        <p className="mt-1 flex items-start gap-1.5">
          <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">{after}</span>
        </p>
      </div>
      <div className="col-start-1 row-start-4 text-xs text-muted-foreground xl:col-start-auto xl:row-start-auto">
        {date}
      </div>
      <div className="col-start-1 row-start-5 text-xs xl:col-start-auto xl:row-start-auto">
        <span className={cn("inline-flex items-center gap-1.5", recordStatusColor(status))}>
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
          {status}
        </span>
        {statusDetail && <p className="mt-1 text-muted-foreground">{statusDetail}</p>}
      </div>
      <ChevronRight className="col-start-2 row-start-1 size-4 text-muted-foreground xl:col-start-auto xl:row-start-auto" />
    </button>
  )
}
export function AdjustmentComparisonItem({
  title,
  date,
  before,
  after,
}: {
  title: ReactNode
  date?: ReactNode
  before: ReactNode
  after: ReactNode
}) {
  return (
    <article className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        {date && <span className="text-xs text-muted-foreground">{date}</span>}
      </div>
      <div className="grid items-stretch gap-2 text-sm md:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="mb-1 text-xs text-muted-foreground">原安排</p>
          {before}
        </div>
        <ArrowRight className="hidden size-4 self-center text-muted-foreground md:block" />
        <div className="rounded-lg bg-primary/5 p-3">
          <p className="mb-1 text-xs text-muted-foreground">新安排</p>
          {after}
        </div>
      </div>
    </article>
  )
}
