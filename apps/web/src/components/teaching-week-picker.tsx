import { useRef, useState, type KeyboardEvent } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"

export function TeachingWeekPicker({
  value,
  weekCount,
  overloadedWeeks,
  onValueChange,
}: {
  value: number
  weekCount: number
  overloadedWeeks: number[]
  onValueChange: (week: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [focusedWeek, setFocusedWeek] = useState(value)
  const weekButtons = useRef<HTMLDivElement>(null)
  const overloaded = new Set(overloadedWeeks)

  const selectWeek = (week: number) => {
    if (week < 1 || week > weekCount) return
    onValueChange(week)
    setOpen(false)
  }

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, week: number) => {
    const nextWeek = {
      ArrowLeft: week - 1,
      ArrowRight: week + 1,
      ArrowUp: week - 5,
      ArrowDown: week + 5,
      Home: event.ctrlKey ? 1 : Math.floor((week - 1) / 5) * 5 + 1,
      End: event.ctrlKey ? weekCount : Math.min(Math.ceil(week / 5) * 5, weekCount),
    }[event.key]
    if (nextWeek === undefined) return
    event.preventDefault()
    if (nextWeek < 1 || nextWeek > weekCount) return
    weekButtons.current?.querySelector<HTMLButtonElement>(`[data-week="${nextWeek}"]`)?.focus()
  }

  return (
    <div role="group" aria-label="查看教学周" className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="rounded-md"
        aria-label="上一教学周"
        disabled={value <= 1}
        onClick={() => selectWeek(value - 1)}
      >
        <ChevronLeftIcon aria-hidden="true" />
      </Button>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setFocusedWeek(value)
          setOpen(nextOpen)
        }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="min-w-22 rounded-md text-xs tabular-nums"
            />
          }
          aria-label={`第 ${value} 教学周，选择教学周`}
        >
          第 {value} 周
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="max-h-[var(--available-height)] w-72 max-w-[calc(100vw-2rem)] gap-3 rounded-xl"
          initialFocus={() =>
            weekButtons.current?.querySelector<HTMLButtonElement>(`[data-week="${value}"]`) ?? true
          }
        >
          <div className="flex shrink-0 items-center justify-between gap-3">
            <PopoverTitle className="text-sm font-medium">选择教学周</PopoverTitle>
            <span className="text-xs text-muted-foreground">共 {weekCount} 周</span>
          </div>
          <div
            ref={weekButtons}
            role="group"
            aria-label="教学周列表"
            className="grid min-h-0 max-h-64 grid-cols-5 gap-1.5 overflow-y-auto overscroll-contain p-0.5"
          >
            {Array.from({ length: weekCount }, (_, index) => index + 1).map((week) => (
              <button
                key={week}
                type="button"
                data-week={week}
                tabIndex={focusedWeek === week ? 0 : -1}
                aria-pressed={value === week}
                aria-label={`第 ${week} 教学周${overloaded.has(week) ? "，超限" : ""}`}
                onFocus={() => setFocusedWeek(week)}
                onKeyDown={(event) => moveFocus(event, week)}
                onClick={() => selectWeek(week)}
                className={cn(
                  "flex h-11 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border text-sm font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-ring",
                  value === week
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted",
                )}
              >
                <span>{week}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full",
                    overloaded.has(week) ? "bg-destructive" : "bg-transparent",
                  )}
                />
              </button>
            ))}
          </div>
          {overloadedWeeks.length > 0 && (
            <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
              超限
            </div>
          )}
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="rounded-md"
        aria-label="下一教学周"
        disabled={value >= weekCount}
        onClick={() => selectWeek(value + 1)}
      >
        <ChevronRightIcon aria-hidden="true" />
      </Button>
    </div>
  )
}
