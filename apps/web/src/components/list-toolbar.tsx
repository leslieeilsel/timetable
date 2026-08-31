import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react"
import { CornerDownLeftIcon, SearchIcon } from "lucide-react"
import { SimpleSelect } from "@/components/simple-select"
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
  const composingRef = useRef(false)
  const [draftSearch, setDraftSearch] = useState(search ?? "")
  const hasFilters = Boolean(onSearchChange || children)
  const hasControls = Boolean(hasFilters || actions)
  useEffect(() => {
    setDraftSearch(search ?? "")
  }, [search])
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

  const submitSearch = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || composingRef.current || event.nativeEvent.isComposing) return
    event.preventDefault()
    onSearchChange?.(draftSearch)
  }

  const updateDraftSearch = (value: string) => {
    setDraftSearch(value)
    if (value === "" && search) onSearchChange?.("")
  }

  if (!hasControls) return null

  return (
    <div
      className={cn(
        "data-toolbar flex flex-col gap-2.5 border-b px-4 py-3 lg:flex-row lg:flex-wrap lg:items-center",
        !hasFilters && "py-3",
        className,
      )}
    >
      {onSearchChange && (
        <label className="relative block w-full lg:max-w-80">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            surface="filter"
            type="search"
            enterKeyHint="search"
            value={draftSearch}
            onChange={(event) => updateDraftSearch(event.target.value)}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false
              setDraftSearch(event.currentTarget.value)
            }}
            onKeyDown={submitSearch}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            aria-keyshortcuts="Enter Meta+K Control+K"
            title="按 Enter 搜索"
            className="pl-9 pr-11"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <CornerDownLeftIcon className="size-3.5" aria-hidden="true" />
          </kbd>
        </label>
      )}
      {children}
      {summary && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm text-muted-foreground lg:ml-auto">
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
    <SimpleSelect
      value={value}
      onValueChange={onChange}
      label={label}
      surface="filter"
      className={cn("min-w-36", className)}
    >
      {children}
    </SimpleSelect>
  )
}
