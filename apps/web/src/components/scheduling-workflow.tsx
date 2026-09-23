import { ChevronRightIcon } from "lucide-react"
import { Link, useLocation } from "react-router"
import {
  semesterDestinationForPath,
  semesterPathOrCurrent,
  useResolvedSemesterId,
  type SemesterDestination,
} from "@/lib/semester"
import { cn } from "@/lib/utils"

const steps: { label: string; destination: SemesterDestination; active: SemesterDestination[] }[] =
  [
    {
      label: "教学安排",
      destination: "preparation",
      active: ["preparation", "assignments", "setup"],
    },
    { label: "排课规则", destination: "constraints", active: ["constraints"] },
    { label: "编排课表", destination: "generate", active: ["generate"] },
    { label: "检查并发布", destination: "planning", active: ["planning"] },
  ]

export function SchedulingWorkflow() {
  const { pathname } = useLocation()
  const { semesterId } = useResolvedSemesterId()
  const destination = semesterDestinationForPath(pathname)
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3 md:px-7">
      <nav aria-label="排课流程" className="min-w-0 overflow-x-auto">
        <ol className="flex min-w-max items-center gap-2">
          {steps.map((step, index) => {
            const active = destination !== null && step.active.includes(destination)
            return (
              <li key={step.destination} className="flex items-center gap-2">
                {index > 0 && <ChevronRightIcon className="size-3.5 text-muted-foreground/50" />}
                <Link
                  to={semesterPathOrCurrent(semesterId, step.destination)}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-muted font-semibold"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full text-xs",
                      active ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {index + 1}
                  </span>
                  {step.label}
                </Link>
              </li>
            )
          })}
        </ol>
      </nav>
      <Link
        className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
        to={semesterPathOrCurrent(semesterId, "timetable")}
      >
        查看已发布课表 →
      </Link>
    </div>
  )
}
