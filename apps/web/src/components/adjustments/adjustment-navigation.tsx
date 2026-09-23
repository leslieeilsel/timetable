import type { ReactNode } from "react"
import { Link, useLocation } from "react-router"
import { semesterPath, useResolvedSemesterId } from "@/lib/semester"
import { cn } from "@/lib/utils"

export function AdjustmentNavigation({ actions }: { actions?: ReactNode }) {
  const { semesterId } = useResolvedSemesterId()
  const { pathname } = useLocation()
  if (!semesterId) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 border-b">
      <nav aria-label="调课记录分类" className="flex gap-5 overflow-x-auto text-sm">
        {(
          [
            ["adjustments", "单次调课"],
            ["long-term", "持续调课"],
            ["leaves", "请假与代课"],
          ] as const
        ).map(([destination, label]) => {
          const to = semesterPath(semesterId, destination)
          const active = pathname === to
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 border-b-2 px-1 py-3",
                active
                  ? "border-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          )
        })}
      </nav>
      {actions && <div className="flex items-center gap-2 pb-2">{actions}</div>}
    </div>
  )
}
