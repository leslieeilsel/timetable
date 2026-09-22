import { useId, useState } from "react"
import {
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleDotIcon,
  SquareIcon,
} from "lucide-react"
import type { ChatMessage } from "@timetable/agent-contracts"
import { cn } from "@/lib/utils"
import { ShimmerText } from "./shimmer-text"

type ProgressPart = Extract<ChatMessage["parts"][number], { type: "data-progress" }>

function ProgressIcon({
  status,
  running,
}: {
  status: ProgressPart["data"]["status"]
  running: boolean
}) {
  const Icon =
    status === "error"
      ? CircleAlertIcon
      : status === "complete"
        ? CheckIcon
        : running
          ? CircleDotIcon
          : SquareIcon
  return (
    <span className="grid size-3.5 shrink-0 place-items-center">
      <Icon aria-hidden className="size-3.5" />
    </span>
  )
}
function ProgressStep({ part, running }: { part: ProgressPart; running: boolean }) {
  const active = running && part.data.status === "running"
  const suffix =
    part.data.status === "error"
      ? "（未完成）"
      : part.data.status === "running" && !running
        ? "（已停止）"
        : ""
  return (
    <div className="flex items-center gap-2">
      <ProgressIcon status={part.data.status} running={active} />
      <ShimmerText text={part.data.label + suffix} active={active} />
    </div>
  )
}

export function ToolProgress({ steps, running }: { steps: ProgressPart[]; running: boolean }) {
  const detailsId = useId()
  const [open, setOpen] = useState(false)
  const first = steps[0]
  if (!first) return null
  const multiple = steps.length > 1
  const active = running ? steps.find((part) => part.data.status === "running") : undefined
  const completed = steps.filter((part) => part.data.status === "complete").length
  const failed = steps.some((part) => part.data.status === "error")
  const status = active
    ? "running"
    : failed
      ? "error"
      : completed === steps.length
        ? "complete"
        : "running"
  const label = !multiple
    ? first.data.label +
      (failed ? "（未完成）" : first.data.status === "running" && !running ? "（已停止）" : "")
    : active
      ? active.data.label + " · " + steps.length + " 个步骤"
      : completed === steps.length
        ? "已完成 " + steps.length + " 个步骤"
        : "已处理 " + steps.length + " 个步骤，" + (steps.length - completed) + " 项未完成"
  return (
    <div
      data-chat-tools
      data-running={!!active}
      className="text-xs leading-5 text-muted-foreground"
    >
      <button
        type="button"
        disabled={!multiple}
        aria-expanded={multiple ? open : undefined}
        aria-controls={multiple ? detailsId : undefined}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex min-h-5 max-w-full items-center gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-4",
          multiple && "cursor-pointer",
        )}
      >
        <ProgressIcon status={status} running={!!active} />
        <ShimmerText text={label} active={!!active} />
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 transition-transform motion-reduce:transition-none",
            !multiple && "invisible",
            open && "rotate-90",
          )}
        />
      </button>
      {multiple && (
        <div id={detailsId} className="chat-collapse" data-open={open} inert={!open}>
          <div className="min-h-0 overflow-hidden">
            <ul className="mt-2 space-y-1.5 border-l pl-3">
              {steps.map((part, index) => (
                <li key={part.id ?? index}>
                  <ProgressStep part={part} running={running} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
