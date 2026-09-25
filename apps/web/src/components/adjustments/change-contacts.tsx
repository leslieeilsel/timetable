import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api, apiMessage } from "@/lib/api"
import type { AdjustmentDetail, DetailValue } from "@/lib/adjustment-detail"
import type { ChangeMessageReceipt } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ErrorState, LoadingState } from "@/components/page"

type Receipt = ChangeMessageReceipt & {
  contacted_at: string | null
  contacted_by_name: string | null
  contact_note: string | null
}
const valueText = (value: DetailValue) =>
  [
    value.secondaryFirst && value.secondary,
    value.primary,
    !value.secondaryFirst && value.secondary,
    value.meta,
  ]
    .filter(Boolean)
    .join(" · ")
const time = (value: string) =>
  value
    .replace("T", " ")
    .replace(/\.\d+Z?$/, "")
    .slice(0, 19)

export function ChangeContacts({
  kind,
  recordId,
  detail,
  reason,
  status,
  canEdit,
}: {
  kind: "calendar_exception" | "long_term_change"
  recordId: number
  detail: AdjustmentDetail
  reason: string
  status: string
  canEdit: boolean
}) {
  const receipts = useQuery({
    queryKey: ["change-contacts", kind, recordId],
    queryFn: () => api<Receipt[]>(`/api/v1/change-messages?${kind}_id=${recordId}`),
  })
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [copyFallback, setCopyFallback] = useState(false)
  const rows = receipts.data?.data ?? []
  const latest = rows.filter(
    (row) => !rows.some((other) => other.teacher_id === row.teacher_id && other.id > row.id),
  )
  const pending = latest.filter((row) => !row.read_at && !row.contacted_at)
  const summary = [
    `课表调整 · ${status}`,
    ...detail.rows.map(
      (row) =>
        `${[row.title, row.context, row.period].filter(Boolean).join(" · ")}\n调整前：${valueText(row.before)}\n调整后：${valueText(row.after)}`,
    ),
    `原因：${reason}`,
    "请以系统中对应日期的实际课表为准。",
  ].join("\n")
  const contact = async (id: number) => {
    if (busy !== null) return
    setBusy(id)
    setError("")
    try {
      await api(`/api/v1/change-messages/${id}/contact`, {
        method: "POST",
        body: JSON.stringify({ note: notes[id]?.trim() }),
      })
      await receipts.refetch()
    } catch (cause) {
      setError(apiMessage(cause))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="space-y-3 border-t pt-4" aria-label="变更消息与人工联系">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">消息与人工联系</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(summary)
                setCopied(true)
              } catch {
                setCopyFallback(true)
              }
            }}
          >
            {copied ? "已复制变更摘要" : "复制变更摘要"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={receipts.isFetching}
            onClick={() => void receipts.refetch()}
          >
            刷新查看状态
          </Button>
        </div>
      </div>
      {copyFallback && (
        <label className="block text-sm">
          请选中并复制摘要
          <textarea
            readOnly
            className="mt-2 min-h-36 w-full rounded-md border bg-background p-3"
            value={summary}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
      {receipts.isLoading ? (
        <LoadingState />
      ) : receipts.isError ? (
        <ErrorState retry={() => void receipts.refetch()} />
      ) : (
        <>
          <p className="text-sm">
            {rows.length
              ? pending.length
                ? `仍需联系：${pending.map((row) => row.name).join("、")}（最新消息未查看且未记录人工联系）`
                : "最新消息均已有查看或人工联系记录。"
              : "本次没有站内消息记录，请按变更摘要联系受影响教师。"}
          </p>
          <p className="text-xs text-muted-foreground">
            查看只表示打开过消息；人工联系由教务记录，二者均不代表理解或同意。撤回后需要确认新的恢复消息。
          </p>
          <ul className="divide-y">
            {rows.map((row) => {
              const isLatest = latest.some((item) => item.id === row.id)
              return (
                <li key={row.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <span className="font-medium">
                      {row.name} · {row.event === "published" ? "调整消息" : "撤回 / 恢复消息"}
                      {!isLatest && "（历史记录）"}
                    </span>
                    <span>{row.read_at ? `站内已查看 · ${time(row.read_at)}` : "站内未查看"}</span>
                  </div>
                  {row.contacted_at ? (
                    <p className="text-sm text-muted-foreground">
                      人工联系 · {time(row.contacted_at)} · {row.contacted_by_name ?? "教务"}：
                      {row.contact_note}
                    </p>
                  ) : canEdit && isLatest ? (
                    <div className="flex flex-wrap gap-2">
                      <Input
                        className="min-w-40 flex-1"
                        aria-label={`联系 ${row.name} 的方式及结果`}
                        placeholder="填写联系渠道及结果，例如电话已告知新安排"
                        maxLength={500}
                        disabled={busy !== null}
                        value={notes[row.id] ?? ""}
                        onChange={(event) =>
                          setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                        }
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null || (notes[row.id]?.trim().length ?? 0) < 2}
                        onClick={() => void contact(row.id)}
                      >
                        {busy === row.id ? "保存中…" : "记录已人工联系"}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">未记录人工联系</p>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
