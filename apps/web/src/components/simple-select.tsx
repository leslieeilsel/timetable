import { Children, isValidElement, type ComponentProps, type ReactNode } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function encodeValue(value: string) {
  return value === "" ? null : value
}

function decodeValue(value: string | null) {
  return value ?? ""
}

function renderItems(children: ReactNode) {
  return Children.toArray(children).map((child) => {
    if (!isValidElement<ComponentProps<"option">>(child) || child.type !== "option") return child
    const rawValue = child.props.value
    const value =
      typeof rawValue === "string" || typeof rawValue === "number" ? String(rawValue) : ""
    return (
      <SelectItem
        key={child.key ?? value}
        value={encodeValue(value)}
        disabled={child.props.disabled}
      >
        {child.props.children}
      </SelectItem>
    )
  })
}

function collectItems(
  children: ReactNode,
  items: Array<{ value: string | null; label: ReactNode }> = [],
) {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number }>(child)) return
    if (child.type === "option" || child.type === SimpleSelectItem) {
      const rawValue = child.props.value
      const value =
        typeof rawValue === "string" || typeof rawValue === "number" ? String(rawValue) : ""
      items.push({ value: encodeValue(value), label: child.props.children })
      return
    }
    if (child.props.children) collectItems(child.props.children, items)
  })
  return items
}

export function SimpleSelect({
  value,
  onValueChange,
  children,
  className,
  disabled,
  required,
  name,
  label,
  autoFocus,
  invalid,
  surface = "form",
}: {
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
  className?: string
  disabled?: boolean
  required?: boolean
  name?: string
  label?: string
  autoFocus?: boolean
  invalid?: boolean
  surface?: "form" | "filter"
}) {
  const items = collectItems(children)
  return (
    <Select
      items={items}
      value={encodeValue(value)}
      onValueChange={(nextValue) => onValueChange(decodeValue(nextValue))}
      disabled={disabled}
      required={required}
      name={name}
    >
      <SelectTrigger
        className={className}
        aria-label={label}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        surface={surface}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{renderItems(children)}</SelectContent>
    </Select>
  )
}

export function SimpleSelectItem({
  value,
  children,
  disabled,
}: {
  value: string
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <SelectItem value={encodeValue(value)} disabled={disabled}>
      {children}
    </SelectItem>
  )
}
