import { useQuery } from "@tanstack/react-query"
import { CheckIcon, ChevronRightIcon, CircleAlertIcon } from "lucide-react"
import { Link, useLocation } from "react-router"
import { api } from "@/lib/api"
import {
  semesterDestinationForPath,
  semesterPathOrCurrent,
  useResolvedSemesterId,
  type SemesterDestination,
} from "@/lib/semester"
import type { PreparationCheck } from "@/lib/types"
import { workflowStepState } from "@/lib/scheduling-workflow"
import { cn } from "@/lib/utils"

const steps = [
  { number: 1, label: "准备检查", destination: "preparation" },
  { number: 2, label: "课程与任课矩阵", destination: "assignments" },
  { number: 3, label: "规则与约束", destination: "constraints" },
  { number: 4, label: "方案生成", destination: "generate" },
  { number: 5, label: "课表调整与诊断", destination: "timetable" },
] satisfies Array<{ number: number; label: string; destination: SemesterDestination }>

export function SchedulingWorkflow() {
  const { pathname } = useLocation()
  const { semesterId } = useResolvedSemesterId()
  const activeDestination = semesterDestinationForPath(pathname)
  const activeStepNumber = steps.find((step) => step.destination === activeDestination)?.number ?? 0
  const preparation = useQuery({
    queryKey: ["preparation-check", semesterId],
    queryFn: () => api<PreparationCheck>(`/api/v1/semesters/${semesterId}/preparation-check`),
    enabled: semesterId !== null,
  })

  return (
    <nav
      aria-label="排课流程"
      aria-busy={preparation.isLoading || undefined}
      className="overflow-x-auto border-b bg-muted/20 px-4 md:px-7"
    >
      <ol className="flex min-w-max items-center py-2.5">
        {steps.map((step, index) => {
          const active = step.destination === activeDestination
          const to = semesterPathOrCurrent(semesterId, step.destination)
          const actualState = workflowStepState(step.number, preparation.data?.data.checks)
          const state = step.number < activeStepNumber ? actualState : "pending"
          const completed = state === "complete" && !active
          const blocking = state === "blocking" && !active
          const warning = state === "warning" && !active
          const stateLabel = completed
            ? "已完成"
            : blocking
              ? "存在阻塞问题"
              : warning
                ? "有待处理提醒"
                : "未完成"
          return (
            <li key={step.destination} className="flex items-center">
              {index > 0 && (
                <ChevronRightIcon
                  className="mx-2 size-3.5 text-muted-foreground/60"
                  aria-hidden="true"
                />
              )}
              <Link
                to={to}
                aria-current={active ? "step" : undefined}
                aria-label={`${step.label}，${active ? "当前步骤" : stateLabel}`}
                data-state={active ? "active" : state}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm outline-none transition-[background-color,color] duration-150 focus-visible:ring-3 focus-visible:ring-ring/20",
                  active
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  blocking && "text-destructive hover:bg-destructive/10 hover:text-destructive",
                  warning && "text-amber-700 hover:bg-amber-50 hover:text-amber-800",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums",
                    active && "border-primary bg-primary text-primary-foreground",
                    completed && "border-emerald-500 bg-emerald-500 text-white",
                    blocking && "border-destructive/40 bg-destructive/10 text-destructive",
                    warning && "border-amber-400 bg-amber-100 text-amber-800",
                  )}
                >
                  {completed ? (
                    <CheckIcon className="size-3" />
                  ) : blocking || warning ? (
                    <CircleAlertIcon className="size-3" />
                  ) : (
                    step.number
                  )}
                </span>
                {step.label}
              </Link>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
