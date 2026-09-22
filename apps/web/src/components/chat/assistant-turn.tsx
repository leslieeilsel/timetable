import { useEffect, useId, useLayoutEffect, useState, type ReactNode } from "react"
import { ChevronRightIcon } from "lucide-react"
import type { ChatMetadata } from "@timetable/agent-contracts"
import { cn } from "@/lib/utils"
import { ShimmerText } from "./shimmer-text"
import { TextReveal } from "./streaming-markdown"

type WaitingFor = "answer" | "confirmation" | undefined

function isStopped(metadata?: ChatMetadata) {
  return (
    metadata?.status === "interrupted" &&
    (metadata.error_code === "RUN_INTERRUPTED" ||
      // Compatibility with saved replies and cached data from before error codes.
      (!metadata.error_code && metadata.error === "回答已停止，可以继续提问或重试。"))
  )
}

function formatDuration(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分钟 ${seconds % 60}秒`
}

function ProcessingLabel({
  metadata,
  waitingFor,
}: {
  metadata?: ChatMetadata
  waitingFor: WaitingFor
}) {
  const running = metadata?.status === "running"
  const startedAt = Date.parse(metadata?.started_at ?? "")
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running || !Number.isFinite(startedAt)) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, startedAt])
  const elapsed = running && Number.isFinite(startedAt) ? now - startedAt : metadata?.duration_ms
  const duration =
    typeof elapsed === "number" && Number.isFinite(elapsed) ? formatDuration(elapsed) : null
  if (running) return duration ? `已处理 ${duration}` : "正在思考"
  if (metadata?.status === "interrupted") {
    if (isStopped(metadata)) return duration ? `已在 ${duration} 后停止` : "回答已停止"
    return duration ? `已中断 · 用时 ${duration}` : "回答已中断"
  }
  const state =
    waitingFor === "answer" ? "等待回答" : waitingFor === "confirmation" ? "等待确认" : null
  if (state) return duration ? `${state} · 用时 ${duration}` : state
  return duration ? `用时 ${duration}` : "处理过程"
}

export function AssistantTurn({
  metadata,
  live = false,
  process,
  answer,
  hasProcess = false,
  collapseProcess = false,
  activityLabel,
  waitingFor,
}: {
  metadata?: ChatMetadata
  live?: boolean
  process?: ReactNode
  answer?: ReactNode
  hasProcess?: boolean
  collapseProcess?: boolean
  activityLabel?: string
  waitingFor?: WaitingFor
}) {
  const processId = useId()
  const collapsedByDefault = metadata?.status !== "interrupted" && collapseProcess
  const mode =
    metadata?.status === "interrupted" ? "interrupted" : collapsedByDefault ? "answer" : "process"
  const [choice, setChoice] = useState<{ mode: string; open: boolean } | null>(null)
  // Collapse when the final answer is announced, before its text arrives. Finishing
  // or refreshing that answer should not undo a later manual toggle.
  const open = choice?.mode === mode ? choice.open : !collapsedByDefault
  const [settledOpen, setSettledOpen] = useState(open)
  const collapsing = hasProcess && !open && settledOpen && choice?.mode !== mode
  useLayoutEffect(() => {
    if (open || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSettledOpen(open)
      return
    }
    const timer = window.setTimeout(() => setSettledOpen(false), 240)
    return () => window.clearTimeout(timer)
  }, [open])
  const [visibleActivity, setVisibleActivity] = useState<string>()
  useEffect(() => {
    setVisibleActivity(undefined)
    if (!activityLabel) return
    const timer = window.setTimeout(() => setVisibleActivity(activityLabel), 160)
    return () => window.clearTimeout(timer)
  }, [activityLabel])
  const showActivity = activityLabel && visibleActivity === activityLabel
  const hasActivitySlot = metadata?.status === "running" && !collapseProcess && !waitingFor
  const interruptionError =
    metadata?.status === "interrupted" && !isStopped(metadata) ? metadata.error : undefined
  return (
    <div data-chat-turn data-phase={mode} data-collapsing={collapsing}>
      <div className="mb-3 border-b border-border/50 pb-2 text-xs tabular-nums text-muted-foreground">
        {hasProcess ? (
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4"
            aria-expanded={open}
            aria-controls={processId}
            onClick={() => setChoice({ mode, open: !open })}
          >
            <ProcessingLabel metadata={metadata} waitingFor={waitingFor} />
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-3 transition-transform motion-reduce:transition-none",
                open && "rotate-90",
              )}
            />
            <span className="sr-only">{open ? "收起处理过程" : "展开处理过程"}</span>
          </button>
        ) : (
          <p>
            <ProcessingLabel metadata={metadata} waitingFor={waitingFor} />
          </p>
        )}
      </div>
      {interruptionError && (
        <p role="status" className="mb-3 text-xs leading-5 text-muted-foreground">
          {interruptionError}
        </p>
      )}
      {hasProcess && (
        <div
          id={processId}
          data-chat-process
          data-open={open}
          data-has-following={Boolean(hasActivitySlot || answer)}
          inert={!open}
          className="chat-collapse chat-process"
          onTransitionEnd={(event) => {
            if (
              !open &&
              event.target === event.currentTarget &&
              event.propertyName === "grid-template-rows"
            )
              setSettledOpen(false)
          }}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col gap-3">{process}</div>
          </div>
        </div>
      )}
      {hasActivitySlot && (
        <p
          role="status"
          data-chat-activity
          className="min-h-5 text-xs leading-5 text-muted-foreground"
        >
          {showActivity && <ShimmerText text={activityLabel} active />}
        </p>
      )}
      {answer && (
        <div
          data-chat-answer
          data-live={live}
          hidden={collapsing}
          className="chat-answer space-y-3"
        >
          <TextReveal ready={!collapsing}>{answer}</TextReveal>
        </div>
      )}
    </div>
  )
}
