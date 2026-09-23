import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, apiMessage } from "@/lib/api"
import type { Semester, TimetablePublicationPreview, TimetableVersion } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

export function PublishTimetableDialog({
  open,
  onClose,
  semester,
  version,
  onPublished,
}: {
  open: boolean
  onClose: () => void
  semester: Semester
  version: TimetableVersion
  onPublished: () => Promise<void>
}) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const preview = useQuery({
    queryKey: [
      "timetable-publication-preview",
      semester.id,
      version.id,
      semester.timetable_revision,
    ],
    enabled: open,
    staleTime: 0,
    retry: false,
    queryFn: () =>
      api<TimetablePublicationPreview>(
        `/api/v1/semesters/${semester.id}/timetable-versions/${version.id}/publication-preview`,
        { method: "POST" },
      ),
  })
  const publish = async () => {
    if (busy || !preview.data?.etag || !preview.data.data.allowed || reason.trim().length < 2)
      return
    setBusy(true)
    setError("")
    try {
      await api(`/api/v1/semesters/${semester.id}/timetable-versions/${version.id}/activate`, {
        method: "POST",
        etag: preview.data.etag,
        body: JSON.stringify({ reason: reason.trim() }),
      })
      await onPublished()
      toast.success("课表已发布，可在“查看课表”中查看")
      onClose()
    } catch (caught) {
      setError(apiMessage(caught))
      void preview.refetch()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>检查并发布课表</DialogTitle>
          <DialogDescription>{version.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="font-medium">替换本学期的标准课表</p>
            <p className="mt-1 text-muted-foreground">
              {semester.start_date} 至 {semester.end_date}
            </p>
          </div>
          {preview.isFetching ? (
            <p role="status">正在检查课程冲突与现有调课…</p>
          ) : preview.isError ? (
            <div role="alert">
              <p className="text-destructive">{apiMessage(preview.error)}</p>
              <Button className="mt-2" variant="outline" onClick={() => void preview.refetch()}>
                重新检查
              </Button>
            </div>
          ) : (
            preview.data && (
              <div>
                <p
                  className={
                    preview.data.data.allowed
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-destructive"
                  }
                >
                  {preview.data.data.summary}
                </p>
                {preview.data.data.impact.items
                  .filter((item) => item.status === "needs_review" || item.status === "orphaned")
                  .map((item) => (
                    <p key={`${item.kind}-${item.id}`} className="mt-2 text-muted-foreground">
                      {item.effective_date} · {item.summary}：{item.reason}
                    </p>
                  ))}
              </div>
            )
          )}
          <label className="grid gap-2">
            发布说明
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：新学期课表复核完成"
              maxLength={500}
              disabled={busy}
            />
          </label>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            返回编排
          </Button>
          <Button
            disabled={
              busy ||
              preview.isFetching ||
              preview.isError ||
              !preview.data?.data.allowed ||
              reason.trim().length < 2
            }
            onClick={() => void publish()}
          >
            {busy ? "正在发布…" : "确认发布"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
