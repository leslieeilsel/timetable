import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { CalendarIcon, ClockIcon } from "lucide-react"
import type { Matcher } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

function parseDateValue(value?: string) {
  if (!value) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.slice(0, 10))
  if (!match) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return undefined
  }
  return date
}

function dateValue(date: Date) {
  return format(date, "yyyy-MM-dd")
}

function disabledDates(min?: string, max?: string) {
  const matchers: Matcher[] = []
  const minimum = parseDateValue(min)
  const maximum = parseDateValue(max)
  if (minimum) matchers.push({ before: minimum })
  if (maximum) matchers.push({ after: maximum })
  return matchers
}

function clampDateTime(value: string, min?: string, max?: string) {
  if (min && value < min) return min
  if (max && value > max) return max
  return value
}

type DatePickerProps = {
  value: string
  onValueChange: (value: string) => void
  label?: string
  placeholder?: string
  className?: string
  min?: string
  max?: string
  disabled?: boolean
  required?: boolean
  ariaDescribedBy?: string
  invalid?: boolean
  surface?: "form" | "filter"
}

export function DatePicker({
  value,
  onValueChange,
  label,
  placeholder = "选择日期",
  className,
  min,
  max,
  disabled,
  required,
  ariaDescribedBy,
  invalid,
  surface = "form",
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = parseDateValue(value)
  const matchers = useMemo(() => disabledDates(min, max), [max, min])
  const displayValue = selected ? format(selected, "PPP", { locale: zhCN }) : placeholder

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="outline"
            data-empty={!selected}
            aria-label={
              label ? `${label}${required ? "（必填）" : ""}：${displayValue}` : undefined
            }
            aria-describedby={ariaDescribedBy}
            aria-invalid={invalid || undefined}
            className={cn(
              "justify-start border-input bg-background text-left font-normal data-[empty=true]:text-muted-foreground dark:bg-background",
              surface === "filter" && "border-transparent bg-input/50 dark:bg-input/50",
              className,
            )}
          />
        }
      >
        <CalendarIcon />
        {displayValue}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          locale={zhCN}
          selected={selected}
          defaultMonth={selected ?? parseDateValue(min)}
          disabled={matchers}
          onSelect={(date) => {
            if (!date) return
            onValueChange(dateValue(date))
            setOpen(false)
          }}
        />
        {selected && !required && (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onValueChange("")
                setOpen(false)
              }}
            >
              清除日期
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function DateTimePicker({
  value,
  onValueChange,
  label,
  placeholder = "选择日期和时间",
  className,
  min,
  max,
  disabled,
  required,
  ariaDescribedBy,
  invalid,
  surface = "form",
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = parseDateValue(value)
  const time = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value.slice(11, 16) : "00:00"
  const matchers = useMemo(() => disabledDates(min, max), [max, min])
  const displayValue = selected
    ? `${format(selected, "PPP", { locale: zhCN })} ${time}`
    : placeholder
  const selectedDay = selected ? dateValue(selected) : ""
  const minimumTime = min?.startsWith(`${selectedDay}T`) ? min.slice(11, 16) : undefined
  const maximumTime = max?.startsWith(`${selectedDay}T`) ? max.slice(11, 16) : undefined

  const updateDateTime = (day: string, nextTime: string) => {
    onValueChange(clampDateTime(`${day}T${nextTime}`, min, max))
  }

  useEffect(() => {
    if (!value) return
    const clamped = clampDateTime(value, min, max)
    if (clamped !== value) onValueChange(clamped)
  }, [max, min, onValueChange, value])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="outline"
            data-empty={!selected}
            aria-label={
              label ? `${label}${required ? "（必填）" : ""}：${displayValue}` : undefined
            }
            aria-describedby={ariaDescribedBy}
            aria-invalid={invalid || undefined}
            className={cn(
              "justify-start border-input bg-background text-left font-normal data-[empty=true]:text-muted-foreground dark:bg-background",
              surface === "filter" && "border-transparent bg-input/50 dark:bg-input/50",
              className,
            )}
          />
        }
      >
        <CalendarIcon />
        {displayValue}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          locale={zhCN}
          selected={selected}
          defaultMonth={selected ?? parseDateValue(min)}
          disabled={matchers}
          onSelect={(date) => date && updateDateTime(dateValue(date), time)}
        />
        <label className="flex items-center gap-2 border-t p-3 text-sm">
          <ClockIcon className="size-4 text-muted-foreground" />
          <span className="font-medium">时间</span>
          <Input
            type="time"
            className="ml-auto w-28"
            value={time}
            min={minimumTime}
            max={maximumTime}
            disabled={!selected}
            onChange={(event) =>
              selected && updateDateTime(dateValue(selected), event.target.value)
            }
          />
        </label>
        {selected && !required && (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onValueChange("")
                setOpen(false)
              }}
            >
              清除日期和时间
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
