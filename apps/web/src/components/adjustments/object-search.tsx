import { useMemo } from "react"
import { Combobox } from "@base-ui/react/combobox"
import { Check, Search, X } from "lucide-react"
import { resourcePinyin } from "@/lib/resource-pinyin"
import type { Room, SchoolClass, Teacher } from "@/lib/types"

export function AdjustmentObjectSearch({
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
  const options = useMemo(
    () =>
      [
        ...teachers.map((item) => ({
          id: item.id,
          kind: "teacher",
          type: "老师",
          name: item.name,
          detail: item.employee_no ?? "",
        })),
        ...classes.map((item) => ({
          id: item.id,
          kind: "class",
          type: "班级",
          name: item.name,
          detail: "",
        })),
        ...rooms.map((item) => ({
          id: item.id,
          kind: "room",
          type: "教室",
          name: item.name,
          detail: "",
        })),
      ].map((item) => ({
        ...item,
        key: `${item.kind}:${item.id}`,
        search:
          `${item.name} ${item.type} ${item.detail} ${resourcePinyin(item.name)}`.toLowerCase(),
      })),
    [teachers, classes, rooms],
  )
  return (
    <Combobox.Root
      items={options}
      value={options.find((item) => item.kind === kind && String(item.id) === resource) ?? null}
      onValueChange={(item) => onChange(item?.kind ?? kind, item ? String(item.id) : "")}
      itemToStringLabel={(item) => item.name}
      isItemEqualToValue={(a, b) => a.key === b.key}
      filter={(item, query) =>
        query
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .every((word) => item.search.includes(word))
      }
      autoHighlight
      openOnInputClick
    >
      <Combobox.InputGroup className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-background px-3 focus-within:border-foreground/60 focus-within:ring-1 focus-within:ring-foreground/30">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Combobox.Input
          aria-label="搜索老师、班级或教室"
          placeholder="输入老师、班级或教室，支持拼音"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <Combobox.Clear aria-label="清除查课对象" className="rounded p-0.5 hover:bg-muted">
          <X className="size-4" />
        </Combobox.Clear>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner
          sideOffset={6}
          className="z-[85] w-[var(--anchor-width)] max-w-[var(--available-width)]"
        >
          <Combobox.Popup className="overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
            <Combobox.Empty className="px-4 py-6 text-center text-sm text-muted-foreground empty:hidden">
              没有找到，试试姓名、班级名称或拼音
            </Combobox.Empty>
            <Combobox.List className="max-h-72 overflow-y-auto overscroll-contain p-1">
              {(item: (typeof options)[number]) => (
                <Combobox.Item
                  key={item.key}
                  value={item}
                  className="flex cursor-default items-center gap-2 rounded px-3 py-2.5 text-sm outline-none data-highlighted:bg-muted"
                >
                  <span className="w-8 shrink-0 text-xs text-muted-foreground">{item.type}</span>
                  <span className="min-w-0 flex-1">
                    {item.name}
                    {item.detail && (
                      <span className="ml-2 text-xs text-muted-foreground">{item.detail}</span>
                    )}
                  </span>
                  <Combobox.ItemIndicator>
                    <Check className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
