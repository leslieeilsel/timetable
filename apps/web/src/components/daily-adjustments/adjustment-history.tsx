import { ChangeContacts } from "@/components/adjustments/change-contacts"
import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, apiMessage } from "@/lib/api"
import { temporaryDetail } from "@/lib/adjustment-detail"
import {
  RecordDetailHeader,
  RecordChangeBody,
  RecordDetailMeta,
  RecordDetailFooter,
} from "@/components/adjustments/record-detail"
import { adjustmentLabels, adjustmentTypes, describeAdjustment } from "@/lib/daily-adjustments"
import type { CalendarException, PaginationMeta } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { SimpleSelect } from "@/components/simple-select"
import { ErrorState, LoadingState } from "@/components/page"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AdjustmentHistoryToolbar,
  AdjustmentRecordList,
  AdjustmentRecordRow,
} from "@/components/adjustments/workbench"

export function AdjustmentHistory({
  semesterId,
  canEdit,
  onChanged,
  initialDate,
  onNew,
}: {
  semesterId: number
  canEdit: boolean
  onChanged: () => Promise<void>
  initialDate?: string
  onNew?: () => void
}) {
  const detailRef = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("all")
  const [type, setType] = useState("all")
  const [from, setFrom] = useState(initialDate ?? "")
  const [to, setTo] = useState(initialDate ?? "")
  const [detailId, setDetailId] = useState<number | null>(null)
  const [selected, setSelected] = useState<CalendarException | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const history = useQuery({
    queryKey: ["calendar-exceptions", semesterId, page, status, from, to, type, q],
    queryFn: () =>
      api<CalendarException[]>(
        `/api/v1/semesters/${semesterId}/calendar-exceptions?${new URLSearchParams({ page: String(page), per_page: "20", ...(q ? { q } : {}), ...(status === "all" ? {} : { status }), ...(type === "all" ? {} : { type }), ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}) })}`,
      ),
  })
  const meta = history.data?.meta?.pagination as PaginationMeta | undefined
  const detail = history.data?.data.find((record) => record.id === detailId)
  const detailView = detail ? temporaryDetail(detail) : null
  const activeFilters = type !== "all" || from || to || q
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [search])
  const clearFilters = () => {
    setSearch("")
    setQ("")
    setStatus("all")
    setFrom("")
    setTo("")
    setType("all")
    setPage(1)
  }
  useEffect(() => {
    if (meta && page > meta.last_page) setPage(Math.max(1, meta.last_page))
  }, [meta, page])
  const cancel = async () => {
    if (!selected || busy || !history.data?.etag) return
    setBusy(true)
    setError("")
    try {
      await api(`/api/v1/semesters/${semesterId}/calendar-exceptions/${selected.id}/cancel`, {
        method: "POST",
        etag: history.data.etag,
      })
      setSelected(null)
      setDetailId(null)
      toast.success("整组调整已撤回，实际课表已恢复")
      await onChanged()
      await history.refetch()
    } catch (caught) {
      setError(apiMessage(caught))
      void history.refetch()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-3" aria-label="调整事项">
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
            ["active", "已发布"],
            ["cancelled", "已撤回"],
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
          refreshing={history.isFetching}
          onRefresh={() => void history.refetch()}
          extraActive={type !== "all"}
          onNew={onNew}
        >
          <SimpleSelect
            label="调整记录类型"
            surface="filter"
            value={type}
            onValueChange={(value) => {
              setType(value)
              setPage(1)
            }}
          >
            <option value="all">全部调整类型</option>
            {adjustmentTypes.map((value) => (
              <option key={value} value={value}>
                {adjustmentLabels[value]}
              </option>
            ))}
          </SimpleSelect>
        </AdjustmentHistoryToolbar>
        {history.isError ? (
          <ErrorState retry={() => void history.refetch()} />
        ) : history.isLoading ? (
          <LoadingState label="正在加载调课事项…" />
        ) : (
          <AdjustmentRecordList>
            {history.data?.data.map((record) => {
              const summary = describeAdjustment(record)
              return (
                <AdjustmentRecordRow
                  key={record.id}
                  type={record.type === "move" ? "改时间" : adjustmentLabels[record.type]}
                  title={summary.title}
                  detail={summary.teacher}
                  before={summary.before}
                  after={summary.after}
                  date={
                    <>
                      {record.effective_date}
                      {record.replacement_date &&
                        record.replacement_date !== record.effective_date && (
                          <p>另含 {record.replacement_date}</p>
                        )}
                    </>
                  }
                  status={record.status === "active" ? "已发布" : "已撤回"}
                  onClick={() => setDetailId(record.id)}
                />
              )
            })}
            {!history.data?.data.length && (
              <div className="px-5 py-16 text-center">
                <p className="text-sm font-medium">
                  {activeFilters || status !== "all" ? "当前条件下没有调课事项" : "还没有调课记录"}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {activeFilters || status !== "all"
                    ? "可以清空筛选或查看全部事项。"
                    : "需要调整课程时，点击筛选栏右侧“发起调课”。"}
                </p>
              </div>
            )}
          </AdjustmentRecordList>
        )}
        {meta && meta.total > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
            <span>
              共 {meta.total} 项{meta.last_page > 1 ? ` · ${page} / ${meta.last_page} 页` : ""}
            </span>
            {meta.last_page > 1 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || history.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= meta.last_page || history.isFetching}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent
          ref={detailRef}
          initialFocus={detailRef}
          className="max-h-[90svh] overflow-y-auto sm:max-w-3xl"
        >
          {detail && detailView && (
            <>
              <RecordDetailHeader
                detail={detailView}
                status={detail.status === "active" ? "已发布" : "已撤回"}
                scope={
                  detail.type === "swap"
                    ? "临时调课 · 仅影响以下两次课程"
                    : "临时调课 · 仅影响这一次课程"
                }
                notice={
                  detail.status === "cancelled"
                    ? "本次调整已撤回。下方保留当时的变化，当前课表以实际安排为准。"
                    : undefined
                }
              />
              <RecordChangeBody detail={detailView} historical={detail.status === "cancelled"} />
              <RecordDetailMeta reason={detail.reason} />
              <ChangeContacts
                kind="calendar_exception"
                recordId={detail.id}
                detail={detailView}
                reason={detail.reason}
                status={
                  detail.status === "active" ? "已发布，仅本次日期生效" : "已撤回，以下是历史调整"
                }
                canEdit={canEdit}
              />
              <RecordDetailFooter>
                <div>
                  {detail.status === "active" && canEdit && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelected(detail)
                        setError("")
                      }}
                    >
                      撤回本次调整
                    </Button>
                  )}
                </div>
                <Button onClick={() => setDetailId(null)}>关闭详情</Button>
              </RecordDetailFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && !busy && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>撤回这次调整？</DialogTitle>
            <DialogDescription>
              将恢复 {selected?.effective_date}
              {selected?.replacement_date && selected.replacement_date !== selected.effective_date
                ? ` 和 ${selected.replacement_date}`
                : ""}{" "}
              的原安排。{selected?.type === "swap" ? "交换的两节课一起恢复；" : ""}
              有后续安排占用时会阻止撤回。
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">{selected?.reason}</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>
              保留调整
            </Button>
            <Button disabled={busy} onClick={() => void cancel()}>
              {busy ? "正在检查…" : "确认撤回整组"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
