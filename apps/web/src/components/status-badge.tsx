import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const labels: Record<string, string> = {
  draft: "草稿",
  open: "开放",
  closed: "已关闭",
  active: "启用",
  inactive: "停用",
  confirmed: "已确认",
  cancelled: "已取消",
  admin: "管理员",
  scheduler: "排课员",
  viewer: "查看者",
}

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  if (["admin", "scheduler", "viewer"].includes(value)) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "h-6 rounded-md bg-background px-2 font-medium",
          value === "admin" && "border-primary/35 text-primary",
        )}
      >
        {label ?? labels[value]}
      </Badge>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap",
        ["open", "active", "confirmed"].includes(value) && "text-emerald-700",
        value === "draft" && "text-amber-700",
        ["closed", "inactive", "cancelled"].includes(value) && "text-slate-500",
      )}
    >
      <span
        className={cn(
          "status-dot",
          ["open", "active", "confirmed"].includes(value) && "bg-emerald-500",
          value === "draft" && "bg-amber-500",
          ["closed", "inactive", "cancelled"].includes(value) && "bg-slate-400",
        )}
      />
      {label ?? labels[value] ?? value}
    </span>
  )
}
