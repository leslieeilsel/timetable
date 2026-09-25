import { ChangeContacts } from "@/components/adjustments/change-contacts"
import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRightIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DatePicker } from "@/components/date-picker"
import { api, apiMessage, type ApiResult } from "@/lib/api"
import type { LongTermPreview, LongTermRecord } from "@/lib/long-term-changes"
import { arrangement, localDate, recordStatus } from "@/lib/long-term-changes"
import type { PaginationMeta, TimetableEffectivePeriod } from "@/lib/types"
import { weeklyDetail } from "@/lib/adjustment-detail"
import {
  RecordDetailHeader,
  RecordChangeBody,
  RecordDetailMeta,
  RecordDetailFooter,
} from "@/components/adjustments/record-detail"
import {
  AdjustmentHistoryToolbar,
  AdjustmentRecordList,
  AdjustmentRecordRow,
} from "@/components/adjustments/workbench"

export function LongTermHistory({
  semesterId,
  canEdit,
  onNew,
}: {
  semesterId: number
  canEdit: boolean
  onNew?: () => void
}) {
  const client = useQueryClient()
  const detailRef = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<LongTermRecord | null>(null)
  const [restoreDate, setRestoreDate] = useState("")
  const [restoring, setRestoring] = useState(false)
  const [restoreMode, setRestoreMode] = useState(false)
  const [preview, setPreview] = useState<ApiResult<LongTermPreview> | null>(null)
  const [error, setError] = useState("")
  const [legacyOpen, setLegacyOpen] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [search])
  const records = useQuery({
    queryKey: ["long-term-changes", semesterId, q, status, from, to, page],
    queryFn: () => {
      const query = new URLSearchParams({ q, status, page: String(page) })
      if (from) query.set("date_from", from)
      if (to) query.set("date_to", to)
      return api<LongTermRecord[]>(`/api/v1/semesters/${semesterId}/long-term-changes?${query}`)
    },
  })
  const legacy = useQuery({
    queryKey: ["long-term-adjustments", semesterId],
    queryFn: () =>
      api<TimetableEffectivePeriod[]>(`/api/v1/semesters/${semesterId}/long-term-adjustments`),
    enabled: legacyOpen,
  })
  const pagination = records.data?.meta?.pagination as PaginationMeta | undefined
  const serverToday = records.data?.meta?.today
  const today = typeof serverToday === "string" ? serverToday : localDate()
  const clearFilters = () => {
    setSearch("")
    setQ("")
    setStatus("all")
    setFrom("")
    setTo("")
    setPage(1)
  }
  const isCancelled = selected && selected.effective_from > today
  const openRecord = (record: LongTermRecord) => {
    setSelected(record)
    setRestoreMode(false)
    setError("")
    setPreview(null)
    setRestoreDate(record.effective_from > today ? record.effective_from : today)
  }
  const restore = async (publish: boolean) => {
    if (!selected) return
    setRestoring(true)
    setError("")
    try {
      const result = await api<LongTermPreview>(
        `/api/v1/semesters/${semesterId}/long-term-changes/${selected.id}/restore${publish ? "" : "/preview"}`,
        {
          method: "POST",
          etag: publish ? preview?.etag : records.data?.etag,
          body: JSON.stringify({ effective_from: restoreDate }),
        },
      )
      if (publish) {
        setSelected(null)
        setPreview(null)
        toast.success(isCancelled ? "已取消这次长期调课" : `已安排从 ${restoreDate} 起恢复`)
        await client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "me" })
      } else setPreview(result)
    } catch (caught) {
      setError(apiMessage(caught))
    } finally {
      setRestoring(false)
    }
  }
  return (
    <>
      <div className="surface-panel overflow-hidden">
        <AdjustmentHistoryToolbar
          search={search}
          onSearch={setSearch}
          onSubmit={() => {
            setQ(search.trim())
            setPage(1)
          }}
          status={status}
          statuses={[
            ["all", "全部状态"],
            ["upcoming", "尚未生效"],
            ["active", "正在生效"],
            ["ended", "已结束"],
            ["restored", "取消 / 恢复安排"],
          ]}
          onStatus={(value) => {
            setStatus(value)
            setPage(1)
          }}
          from={from}
          to={to}
          onFrom={(value) => {
            setFrom(value)
            setPage(1)
          }}
          onTo={(value) => {
            setTo(value)
            setPage(1)
          }}
          onClear={clearFilters}
          refreshing={records.isFetching}
          onRefresh={() => void records.refetch()}
          onNew={onNew}
          newLabel="发起持续调课"
        />
        {records.isError ? (
          <div role="alert" className="py-10 text-center">
            <p>{apiMessage(records.error)}</p>
            <Button variant="outline" className="mt-3" onClick={() => void records.refetch()}>
              重新加载
            </Button>
          </div>
        ) : records.isLoading ? (
          <p className="py-12 text-center text-muted-foreground">正在加载调整记录…</p>
        ) : (
          <AdjustmentRecordList>
            {records.data?.data.map((record) => {
              const first = record.changes[0]
              const count = new Set(record.changes.map((change) => change.before.entry_key)).size
              return (
                <AdjustmentRecordRow
                  key={record.id}
                  type={weeklyDetail(record.changes).type}
                  title={[
                    ...new Set(
                      record.changes.map(
                        ({ before }) => `${before.target_name} · ${before.course_name}`,
                      ),
                    ),
                  ].join("；")}
                  before={first ? arrangement(first.before) : "—"}
                  after={
                    <>
                      {first ? arrangement(first.after) : "—"}
                      {count > 1 && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          另 {count - 1} 节
                        </span>
                      )}
                    </>
                  }
                  date={
                    <>
                      {record.effective_from}
                      <p>至 {record.effective_to}</p>
                    </>
                  }
                  status={recordStatus(record, today)}
                  statusDetail={record.restored_from ? `${record.restored_from} 起恢复` : undefined}
                  onClick={() => openRecord(record)}
                />
              )
            })}
            {!records.data?.data.length && (
              <div className="px-5 py-16 text-center">
                <p className="text-sm font-medium">
                  {q || status !== "all" || from || to
                    ? "当前条件下没有调课事项"
                    : "还没有调课记录"}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {q || status !== "all" || from || to
                    ? "可以清空筛选或查看全部事项。"
                    : "需要调整每周课程时，点击筛选栏右侧“发起持续调课”。"}
                </p>
              </div>
            )}
          </AdjustmentRecordList>
        )}
        {pagination && pagination.total > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
            <span>
              共 {pagination.total} 项
              {pagination.last_page > 1 ? ` · ${page} / ${pagination.last_page} 页` : ""}
            </span>
            {pagination.last_page > 1 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || records.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= pagination.last_page || records.isFetching}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <Button
        variant="link"
        size="sm"
        className="mt-5 px-0 text-muted-foreground"
        onClick={() => setLegacyOpen(true)}
      >
        查看课表生效时间线
        <ArrowRightIcon />
      </Button>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !restoring) setSelected(null)
        }}
      >
        <DialogContent
          ref={detailRef}
          initialFocus={detailRef}
          className="max-h-[88svh] overflow-y-auto sm:max-w-3xl"
        >
          {selected && (
            <>
              <RecordDetailHeader
                detail={weeklyDetail(preview?.data.changes ?? selected.changes)}
                heading={
                  preview ? (isCancelled ? "核对取消后的安排" : "核对恢复后的安排") : undefined
                }
                showScope
                status={preview ? "尚未确认" : recordStatus(selected, today)}
                scope={`固定调课 · ${selected.effective_from} 至 ${selected.effective_to}，按周执行`}
                notice={
                  preview
                    ? "以下为恢复后的安排，确认后才会生效。"
                    : selected.restored_from
                      ? `${selected.restored_from} 起${selected.restored_from > today ? "将恢复" : "已恢复"}本次修改前的安排。下方保留当时的调整记录。`
                      : undefined
                }
              />
              <RecordChangeBody
                detail={weeklyDetail(preview?.data.changes ?? selected.changes)}
                historical={!preview && Boolean(selected.restored_from)}
              />
              {!restoreMode && <RecordDetailMeta reason={selected.reason} />}
              {!restoreMode && (
                <ChangeContacts
                  kind="long_term_change"
                  recordId={selected.id}
                  detail={weeklyDetail(selected.changes)}
                  reason={selected.reason}
                  status={`${recordStatus(selected, today)} · ${selected.effective_from} 至 ${selected.effective_to}${selected.restored_from ? `；${selected.restored_from} 起恢复原安排，以下为历史调整` : ""}`}
                  canEdit={canEdit}
                />
              )}
              {restoreMode &&
                canEdit &&
                !selected.restored_from &&
                selected.effective_to >= today && (
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-sm font-medium">
                      {isCancelled ? "取消这次尚未生效的调整" : "从指定日期恢复本次修改前的安排"}
                    </p>
                    {!isCancelled && (
                      <DatePicker
                        label="恢复日期"
                        value={restoreDate}
                        min={today > selected.effective_from ? today : selected.effective_from}
                        max={selected.effective_to}
                        required
                        onValueChange={(value) => {
                          setRestoreDate(value)
                          setPreview(null)
                          setError("")
                        }}
                      />
                    )}
                    <p className="text-xs text-muted-foreground">
                      只恢复本次改动，保留其他安排。恢复前会重新检查冲突，历史课表保持原样。
                    </p>
                    {error && (
                      <p role="alert" className="text-sm text-destructive">
                        {error}
                      </p>
                    )}
                    <DialogFooter>
                      <Button
                        variant="outline"
                        disabled={restoring}
                        onClick={() => {
                          setRestoreMode(false)
                          setPreview(null)
                          setError("")
                        }}
                      >
                        返回详情
                      </Button>
                      <Button
                        disabled={restoring || !restoreDate}
                        onClick={() => void restore(Boolean(preview))}
                      >
                        {restoring
                          ? "正在检查…"
                          : preview
                            ? isCancelled
                              ? "确认取消"
                              : "确认恢复"
                            : "检查恢复后的安排"}
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              {!restoreMode && (
                <RecordDetailFooter>
                  <div>
                    {canEdit && !selected.restored_from && selected.effective_to >= today && (
                      <Button variant="outline" onClick={() => setRestoreMode(true)}>
                        {isCancelled ? "取消本次调整" : "恢复原安排"}
                      </Button>
                    )}
                  </div>
                  <Button onClick={() => setSelected(null)}>关闭详情</Button>
                </RecordDetailFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={legacyOpen} onOpenChange={setLegacyOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>课表生效时间线</DialogTitle>
            <DialogDescription>包含既有正式课表和历次长期调整，按日期衔接。</DialogDescription>
          </DialogHeader>
          {legacy.isLoading ? (
            <p>正在加载…</p>
          ) : legacy.isError ? (
            <p role="alert">{apiMessage(legacy.error)}</p>
          ) : (
            <div className="divide-y">
              {legacy.data?.data.map((period) => (
                <div key={period.id} className="py-3 text-sm">
                  <p className="font-medium">
                    {period.effective_from} 至 {period.effective_to}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {period.reason} · {period.creator.name}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
