import { ArrowRight, CircleMinus } from "lucide-react"
import type { ReactNode } from "react"
import type { AdjustmentDetail, DetailValue } from "@/lib/adjustment-detail"
import { recordStatusColor, recordTypeTone } from "./record-appearance"
import { cn } from "@/lib/utils"
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export function RecordDetailHeader({
  detail,
  status,
  scope,
  notice,
  heading,
  showScope = false,
}: {
  detail: AdjustmentDetail
  status: string
  scope: string
  notice?: string
  heading?: string
  showScope?: boolean
}) {
  return (
    <DialogHeader className="space-y-2 pr-8 text-left">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DialogTitle className={cn("text-lg leading-snug", recordTypeTone(detail.type).text)}>
          {heading || `${detail.type}详情`}
        </DialogTitle>
        <span className={cn("flex items-center gap-1.5 text-xs", recordStatusColor(status))}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          {status}
        </span>
      </div>
      <DialogDescription className={showScope ? "text-xs" : "sr-only"}>{scope}</DialogDescription>
      {notice && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{notice}</p>
      )}
    </DialogHeader>
  )
}
function Value({ value }: { value: DetailValue }) {
  return (
    <>
      {value.secondaryFirst && value.secondary && (
        <p className="text-sm text-muted-foreground">{value.secondary}</p>
      )}
      <p className="break-words text-base font-semibold leading-snug">
        {value.primary === "本节停课" && <CircleMinus className="mr-2 inline size-5" />}
        {value.primary}
      </p>
      {!value.secondaryFirst && value.secondary && (
        <p className="text-sm text-muted-foreground">{value.secondary}</p>
      )}
      {value.meta && <p className="break-words text-xs text-muted-foreground">{value.meta}</p>}
    </>
  )
}
export function RecordChangeBody({
  detail,
  historical = false,
}: {
  detail: AdjustmentDetail
  historical?: boolean
}) {
  const single = detail.rows.length === 1
  const afterLabel = historical ? "曾调整为" : detail.afterLabel
  const tone = recordTypeTone(detail.type)
  return (
    <div className="space-y-3" aria-label="本次调整内容">
      <div className="overflow-hidden rounded-lg border">
        {!single && (
          <div className="hidden grid-cols-[1.15fr_1fr_24px_1fr] gap-4 border-b bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground md:grid">
            <span>{detail.rows.some((row) => row.period) ? "课程 / 生效范围" : "课程"}</span>
            <span>{detail.beforeLabel}</span>
            <span />
            <span className={cn("pl-3", !historical && tone.text)}>{afterLabel}</span>
          </div>
        )}
        {detail.rows.map((row) => (
          <article
            key={row.id}
            aria-label={row.title}
            className={cn(
              "grid min-w-0 gap-3 border-b p-4 last:border-b-0",
              !single && "md:grid-cols-[1.15fr_1fr_24px_1fr] md:items-center md:gap-4",
            )}
          >
            <div className="min-w-0 space-y-1">
              <h3 className="break-words text-sm font-semibold">{row.title}</h3>
              {row.context && (
                <p className="text-xs leading-relaxed text-muted-foreground">{row.context}</p>
              )}
              {row.period && <p className="text-xs text-muted-foreground">{row.period}</p>}
            </div>
            <div
              className={cn(
                "grid min-w-0 grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] items-stretch gap-2",
                !single && "md:contents",
              )}
            >
              <div className="min-w-0 space-y-1.5 py-2">
                <p className={cn("text-xs text-muted-foreground", !single && "md:hidden")}>
                  {detail.beforeLabel}
                </p>
                <Value value={row.before} />
              </div>
              <ArrowRight className="size-4 self-center text-muted-foreground" aria-hidden="true" />
              <div
                className={cn(
                  "min-w-0 space-y-1.5 rounded-r-md border-l-2 py-2 pl-3 pr-2",
                  historical ? "border-border bg-muted/40" : cn(tone.surface, tone.text),
                )}
              >
                <p
                  className={cn(
                    "text-xs",
                    historical && "text-muted-foreground",
                    !single && "md:hidden",
                  )}
                >
                  {afterLabel}
                </p>
                <Value value={row.after} />
              </div>
            </div>
          </article>
        ))}
      </div>
      {detail.caution && detail.note && (
        <p
          className={cn(
            "text-xs leading-relaxed",
            historical ? "text-muted-foreground" : "text-[var(--timetable-notice-foreground)]",
          )}
        >
          {historical ? `当时安排：${detail.note}` : detail.note}
        </p>
      )}
    </div>
  )
}
export function RecordDetailMeta({ reason }: { reason: string }) {
  return (
    <div className="flex gap-4 border-t pt-4 text-sm">
      <span className="shrink-0 text-muted-foreground">调整原因</span>
      <p className="min-w-0 whitespace-pre-wrap break-words">{reason}</p>
    </div>
  )
}
export function RecordDetailFooter({ children }: { children: ReactNode }) {
  return (
    <div className="sticky -bottom-6 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t bg-background px-6 py-4">
      {children}
    </div>
  )
}
