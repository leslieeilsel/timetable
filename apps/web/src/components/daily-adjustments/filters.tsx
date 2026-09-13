import { useEffect, useState } from "react"
import { Search, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  emptyDailyFilters,
  filterCount,
  matchesDailyFilters,
  type DailyFilters,
} from "@/lib/daily-adjustments"
import type { DailyTimetableRow } from "@/lib/types"

export function AdjustmentFilters({
  value,
  rows,
  onChange,
  shortcutsEnabled = true,
}: {
  shortcutsEnabled?: boolean
  value: DailyFilters
  rows: DailyTimetableRow[]
  onChange: (filters: DailyFilters, replace?: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [search, setSearch] = useState("")
  const courses = [
    ...new Map(rows.map((row) => [String(row.course_id), row.course_name])).entries(),
  ]
  const available = courses
    .filter(([, name]) => name.includes(search.trim()))
    .sort(([a], [b]) => Number(draft.courses.includes(b)) - Number(draft.courses.includes(a)))
  const previewCount = rows.filter((row) => matchesDailyFilters(row, draft)).length
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        !shortcutsEnabled ||
        event.key !== "/" ||
        event.isComposing ||
        (event.target as HTMLElement).closest(
          'input,textarea,[contenteditable="true"],[role="dialog"]',
        )
      )
        return
      event.preventDefault()
      setDraft(value)
      setSearch("")
      setOpen(true)
    }
    window.addEventListener("keydown", keyboard)
    return () => window.removeEventListener("keydown", keyboard)
  }, [shortcutsEnabled, value])
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        title="搜索与筛选（/）"
        onClick={() => {
          setDraft(value)
          setSearch("")
          setOpen(true)
        }}
      >
        <SlidersHorizontal className="size-4" />
        筛选
        {filterCount(value) > 0 && (
          <span className="rounded bg-muted px-1.5 text-xs">{filterCount(value)}</span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85svh] flex-col gap-0 p-0 sm:max-w-lg max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:rounded-b-none">
          <DialogHeader className="border-b p-4">
            <DialogTitle>筛选课程</DialogTitle>
            <DialogDescription>缩小当前查找结果，日期和查看对象保持不变。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                data-lesson-search
                autoFocus
                aria-label="查找当前对象的课程"
                placeholder="课程、教师、教室关键词"
                className="pl-9"
                value={draft.q}
                onChange={(event) => setDraft({ ...draft, q: event.target.value })}
              />
            </div>
            <fieldset>
              <legend className="mb-2 font-medium">
                课程{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  已选 {draft.courses.length} 门 · 不选表示全部
                </span>
              </legend>
              {courses.length > 10 && (
                <>
                  <Input
                    aria-label="搜索筛选课程"
                    placeholder="搜索课程名称"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>搜索结果 {available.length} 门</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!available.length}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          courses: [...new Set([...draft.courses, ...available.map(([id]) => id)])],
                        })
                      }
                    >
                      选中搜索结果
                    </Button>
                  </div>
                </>
              )}
              <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto py-1">
                {available.map(([id, name]) => (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={draft.courses.includes(id)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          courses: event.target.checked
                            ? [...draft.courses, id]
                            : draft.courses.filter((course) => course !== id),
                        })
                      }
                    />
                    <span className="flex-1">{name}</span>
                    <span className="text-xs text-muted-foreground">
                      {rows.filter((row) => String(row.course_id) === id).length}
                    </span>
                  </label>
                ))}
                {!available.length && (
                  <p className="col-span-2 py-3 text-muted-foreground">没有匹配的课程名称。</p>
                )}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 font-medium">时段</legend>
              <div className="flex gap-2">
                {(
                  [
                    ["all", "全天"],
                    ["am", "上午"],
                    ["pm", "下午"],
                  ] as const
                ).map(([period, label]) => (
                  <Button
                    key={period}
                    variant={draft.period === period ? "secondary" : "outline"}
                    aria-pressed={draft.period === period}
                    onClick={() => setDraft({ ...draft, period })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 font-medium">状态</legend>
              <div className="flex gap-2">
                {(
                  [
                    ["all", "全部课程"],
                    ["changed", "有变动"],
                  ] as const
                ).map(([status, label]) => (
                  <Button
                    key={status}
                    variant={draft.status === status ? "secondary" : "outline"}
                    aria-pressed={draft.status === status}
                    onClick={() => setDraft({ ...draft, status })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </fieldset>
          </div>
          <DialogFooter className="border-t p-4">
            <Button variant="ghost" onClick={() => setDraft(emptyDailyFilters)}>
              清空条件
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                onChange(draft)
                setOpen(false)
              }}
            >
              查看 {previewCount} 节课
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
export function AppliedAdjustmentFilters({
  value,
  rows,
  onChange,
}: {
  value: DailyFilters
  rows: DailyTimetableRow[]
  onChange: (filters: DailyFilters) => void
}) {
  if (!filterCount(value)) return null
  const selectedNames = new Map(rows.map((row) => [String(row.course_id), row.course_name]))
  const update = (changes: Partial<DailyFilters>) => onChange({ ...value, ...changes })
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs"
      aria-label="已应用的筛选条件"
    >
      {value.courses.map((id) => (
        <FilterChip
          key={id}
          label={selectedNames.get(id) ?? `课程 #${id}`}
          onRemove={() => update({ courses: value.courses.filter((course) => course !== id) })}
        />
      ))}
      {value.period !== "all" && (
        <FilterChip
          label={value.period === "am" ? "上午" : "下午"}
          onRemove={() => update({ period: "all" })}
        />
      )}
      {value.status !== "all" && (
        <FilterChip label="有变动" onRemove={() => update({ status: "all" })} />
      )}
      {value.q.trim() && (
        <FilterChip label={`搜索：${value.q}`} onRemove={() => update({ q: "" })} />
      )}
      <Button size="sm" variant="ghost" onClick={() => onChange(emptyDailyFilters)}>
        清空条件
      </Button>
    </div>
  )
}
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onRemove}
      aria-label={`移除条件：${label}`}
    >
      {label}
      <X className="size-3" />
    </button>
  )
}
