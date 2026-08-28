import { Combobox } from "@base-ui/react/combobox"
import { CheckIcon, ChevronsUpDownIcon, SearchIcon, XIcon } from "lucide-react"

import { ResourcePicker } from "@/components/resource-picker"
import { cn } from "@/lib/utils"

export interface SearchableOption {
  id: number
  label: string
  description?: string
  searchText?: string
  disabled?: boolean
}

interface SharedPickerProps {
  options: SearchableOption[]
  ariaLabel: string
  placeholder: string
  searchPlaceholder?: string
  emptyTitle?: string
  emptyDescription?: string
  invalid?: boolean
  disabled?: boolean
  className?: string
}

const popupClass =
  "z-[80] w-[var(--anchor-width)] max-w-[var(--available-width)] origin-[var(--transform-origin)] overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-lg outline-none transition-[scale,opacity] duration-100 data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0"

const itemClass =
  "relative grid cursor-default grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 px-3 py-2.5 text-sm outline-none select-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-45"

function optionFilter(option: SearchableOption, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN")
  if (!normalizedQuery) return true
  return `${option.label} ${option.description ?? ""} ${option.searchText ?? ""}`
    .toLocaleLowerCase("zh-CN")
    .includes(normalizedQuery)
}

function ResultList({
  options,
  emptyTitle,
  emptyDescription,
}: {
  options: SearchableOption[]
  emptyTitle: string
  emptyDescription?: string
}) {
  return (
    <>
      <Combobox.Empty className="px-4 py-6 text-center">
        <p className="text-sm font-medium">{options.length ? emptyTitle : "暂无可选数据"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {options.length
            ? (emptyDescription ?? "换个关键词试试")
            : (emptyDescription ?? "请先维护相关基础资料")}
        </p>
      </Combobox.Empty>
      <Combobox.List className="max-h-[min(20rem,var(--available-height))] overflow-y-auto overscroll-contain py-1 outline-none scroll-py-1">
        {(option: SearchableOption) => (
          <Combobox.Item
            key={option.id}
            value={option}
            disabled={option.disabled}
            className={itemClass}
          >
            <Combobox.ItemIndicator className="col-start-1 row-start-1 mt-0.5 text-primary">
              <CheckIcon className="size-4" />
            </Combobox.ItemIndicator>
            <span className="col-start-2 row-start-1 min-w-0">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{option.label}</span>
                {option.disabled && (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    已停用
                  </span>
                )}
              </span>
              {option.description && (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
          </Combobox.Item>
        )}
      </Combobox.List>
    </>
  )
}

export function SearchablePicker({
  options,
  ariaLabel,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder = "输入关键词搜索",
  emptyTitle = "没有匹配结果",
  emptyDescription,
  invalid,
  disabled,
  className,
}: SharedPickerProps & {
  value: number | null
  onValueChange: (value: number | null) => void
}) {
  return (
    <ResourcePicker
      value={value ? String(value) : ""}
      onValueChange={(next) => onValueChange(next ? Number(next) : null)}
      items={options.map((option) => ({
        value: String(option.id),
        label: option.label,
        description: option.description,
        searchText: option.searchText ?? "",
        disabled: option.disabled,
        disabledReason: option.disabled ? "当前对象不可选" : undefined,
        status: option.disabled ? "不可选" : "可选",
        statusTone: option.disabled ? "muted" : "success",
      }))}
      columns={[
        {
          key: "name",
          label: "名称",
          className: "min-w-52",
          render: (item) => <span className="font-medium">{item.label}</span>,
        },
        {
          key: "description",
          label: "说明",
          className: "min-w-52 whitespace-normal text-muted-foreground",
          render: (item) => item.description ?? "—",
        },
      ]}
      title={`选择${ariaLabel.replace(/^搜索/, "")}`}
      description="通过名称或说明快速定位作用对象"
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyDescription={emptyDescription ?? emptyTitle}
      invalid={invalid}
      disabled={disabled}
      className={className}
      clearable
    />
  )
}

export function SearchableMultiPicker({
  options,
  ariaLabel,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder = "继续搜索并添加",
  emptyTitle = "没有匹配结果",
  emptyDescription,
  invalid,
  disabled,
  className,
}: SharedPickerProps & {
  value: number[]
  onValueChange: (value: number[]) => void
}) {
  const selected = value.flatMap((id) => {
    const option = options.find((candidate) => candidate.id === id)
    return option ? [option] : []
  })

  return (
    <Combobox.Root<SearchableOption, true>
      items={options}
      value={selected}
      onValueChange={(next) => onValueChange(next.map((option) => option.id))}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(option, current) => option.id === current.id}
      filter={optionFilter}
      autoHighlight
      multiple
      disabled={disabled}
    >
      <Combobox.InputGroup
        className={cn(
          "relative flex min-h-8 w-full cursor-text items-center rounded-2xl border border-input bg-background px-2 py-1 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
          invalid && "border-destructive ring-3 ring-destructive/20",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
      >
        <SearchIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
        <Combobox.Chips className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <Combobox.Value>
            {(current: SearchableOption[]) => {
              const visible = current.slice(0, 3)
              const hiddenCount = current.length - visible.length
              return (
                <>
                  {visible.map((option) => (
                    <Combobox.Chip
                      key={option.id}
                      className="group flex h-6 max-w-40 items-center gap-1 rounded-full bg-background px-2 text-xs ring-1 ring-border outline-none focus-within:ring-ring"
                      aria-label={option.label}
                    >
                      <span className="truncate">{option.label}</span>
                      <Combobox.ChipRemove
                        aria-label={`移除${option.label}`}
                        className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <XIcon className="size-3" />
                      </Combobox.ChipRemove>
                    </Combobox.Chip>
                  ))}
                  {hiddenCount > 0 && (
                    <span className="rounded-full bg-background px-2 py-1 text-xs text-muted-foreground ring-1 ring-border">
                      +{hiddenCount}
                    </span>
                  )}
                  <Combobox.Input
                    aria-label={ariaLabel}
                    placeholder={current.length ? searchPlaceholder : placeholder}
                    aria-invalid={invalid || undefined}
                    className="h-6 min-w-28 flex-1 border-0 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
                  />
                </>
              )
            }}
          </Combobox.Value>
        </Combobox.Chips>
        <span className="ml-1 flex shrink-0 items-center">
          <Combobox.Clear
            aria-label="清空已选项"
            className="hidden size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground data-visible:flex"
          >
            <XIcon className="size-3.5" />
          </Combobox.Clear>
          <Combobox.Trigger
            aria-label="展开选项"
            className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronsUpDownIcon className="size-3.5" />
          </Combobox.Trigger>
        </span>
      </Combobox.InputGroup>
      {selected.length > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">已选 {selected.length} 项</p>
      )}
      <Combobox.Portal>
        <Combobox.Positioner className="z-[80] outline-none" sideOffset={6} align="start">
          <Combobox.Popup className={popupClass}>
            <ResultList
              options={options}
              emptyTitle={emptyTitle}
              emptyDescription={emptyDescription}
            />
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
