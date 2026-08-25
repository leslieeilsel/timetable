import { useEffect, useRef, type ReactNode } from "react"
import { SearchIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export function ListToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "搜索",
  children,
  summary,
  actions,
  className,
}: {
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  children?: ReactNode
  summary?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  const hasFilters = Boolean(onSearchChange || children)
  const hasControls = Boolean(hasFilters || actions)
  useEffect(() => {
    if (!onSearchChange) return
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener("keydown", focusSearch)
    return () => window.removeEventListener("keydown", focusSearch)
  }, [onSearchChange])
  if (!hasControls) return null

  return (
    <div
      className={cn(
        "data-toolbar flex flex-col gap-3 border-b px-4 py-4 lg:flex-row lg:flex-wrap lg:items-center",
        !hasFilters && "py-3",
        className,
      )}
    >
      {onSearchChange && (
        <label className="relative block w-full lg:max-w-80">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="pl-10 pr-12"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border bg-muted/60 px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">
            ⌘K
          </kbd>
        </label>
      )}
      {children}
      {summary && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground lg:ml-auto">
          {summary}
        </div>
      )}
      {actions && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-end gap-2 self-end",
            !summary && "lg:ml-auto",
          )}
        >
          {actions}
        </div>
      )}
    </div>
  )
}

export function ToolbarSelect({
  value,
  onChange,
  label,
  children,
  className,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className={cn(
        "h-11 min-w-40 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors hover:bg-muted/40 focus:border-ring focus:ring-3 focus:ring-ring/20",
        className,
      )}
    >
      {children}
    </select>
  )
}
