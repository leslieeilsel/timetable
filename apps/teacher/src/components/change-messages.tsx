import { useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Bell, ChevronLeft, ChevronRight, X } from "lucide-react"
import { api, apiMessage } from "@/lib/api"
import type { TimetableRow } from "@/lib/types"

type ChangeMessage = {
  id: number
  event: "published" | "cancelled"
  reason: string
  exception_status: string
  type?: string
  effective_from?: string | null
  effective_to?: string | null
  restored_from?: string | null
  read_at: string | null
  created_at: string
  changes: Array<{ before: ChangeRow | null; after: ChangeRow | null }>
}
type ChangeRow = TimetableRow & {
  recurrence_label?: string
  effective_from?: string
  effective_to?: string
}
type MessagePage = { messages: ChangeMessage[]; unread: number; page: number; last_page: number }
export function ChangeMessages({
  teacherId,
  onDate,
}: {
  teacherId: number
  onDate: (date: string) => void
}) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [reading, setReading] = useState(false)
  const messages = useQuery({
    queryKey: ["teacher-change-messages", page],
    queryFn: () => api<MessagePage>(`/api/v1/teacher/me/change-messages?page=${page}`),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const detail = messages.data?.messages.find((message) => message.id === selected)
  const markRead = async (message: ChangeMessage) => {
    setSelected(message.id)
    setError("")
    if (message.read_at) return
    setReading(true)
    try {
      await api(`/api/v1/teacher/me/change-messages/${message.id}/read`, { method: "POST" })
      await client.invalidateQueries({ queryKey: ["teacher-change-messages"] })
    } catch (caught) {
      setError(`详情已打开，但查看状态未保存：${apiMessage(caught)}`)
    } finally {
      setReading(false)
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (!value) {
          setSelected(null)
          setError("")
        }
      }}
    >
      <Dialog.Trigger
        className="change-message-trigger"
        aria-label={`课表变更消息${messages.data?.unread ? `，${messages.data.unread} 条未读` : ""}`}
      >
        <Bell aria-hidden="true" />
        {Boolean(messages.data?.unread) && (
          <span>{messages.data!.unread > 99 ? "99+" : messages.data!.unread}</span>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="change-message-backdrop" />
        <Dialog.Popup className="change-message-panel">
          <header>
            <div>
              <Dialog.Title>课表变更</Dialog.Title>
              <Dialog.Description>
                {messages.data?.unread ?? 0} 条未读 · 打开详情后记录为已查看
              </Dialog.Description>
            </div>
            <Dialog.Close className="change-message-close" aria-label="关闭变更消息">
              <X />
            </Dialog.Close>
          </header>
          <div className="change-message-content">
            {messages.isError ? (
              <div role="alert">
                <p>{apiMessage(messages.error)}</p>
                <button className="change-message-action" onClick={() => void messages.refetch()}>
                  重新加载
                </button>
              </div>
            ) : messages.isLoading ? (
              <p>正在加载…</p>
            ) : detail ? (
              <>
                <button className="change-message-action" onClick={() => setSelected(null)}>
                  <ChevronLeft />
                  返回消息列表
                </button>
                <h3>
                  {detail.type === "long_term"
                    ? detail.event === "cancelled"
                      ? `从 ${detail.restored_from} 起恢复安排`
                      : `长期调课：${detail.effective_from} 至 ${detail.effective_to}`
                    : detail.event === "cancelled"
                      ? "调整已撤回，恢复原安排"
                      : detail.exception_status === "cancelled"
                        ? "这次调整已撤回"
                        : "请按以下新安排上课"}
                </h3>
                <p className="change-message-muted">原因：{detail.reason}</p>
                {detail.type === "long_term" &&
                  detail.event === "published" &&
                  detail.restored_from && (
                    <p className="change-message-muted">
                      已安排从 {detail.restored_from} 起恢复，请以对应日期的实际课表为准。
                    </p>
                  )}
                {detail.type !== "long_term" &&
                  detail.event === "published" &&
                  detail.exception_status === "cancelled" && (
                    <p className="change-message-muted">以下是历史消息，请以最新实际课表为准。</p>
                  )}
                {detail.changes.map((change, index) => (
                  <article key={index} className="change-message-comparison">
                    <h4>
                      {change.before?.course_name ?? change.after?.course_name} ·{" "}
                      {change.before?.target_name ?? change.after?.target_name}
                    </h4>
                    <TeacherChangeSide row={change.before} label="调整前" teacherId={teacherId} />
                    <TeacherChangeSide row={change.after} label="调整后" teacherId={teacherId} />
                    {(change.after ?? change.before) && (
                      <button
                        className="change-message-action"
                        onClick={() => {
                          onDate((change.after ?? change.before)!.date)
                          setOpen(false)
                          setSelected(null)
                        }}
                      >
                        {detail.type === "long_term" ? "查看生效日期的课表" : "查看当天实际课表"}
                        <ChevronRight />
                      </button>
                    )}
                  </article>
                ))}
                <p className="change-message-muted">
                  {reading
                    ? "正在保存查看状态…"
                    : detail.read_at
                      ? "你已查看这条消息"
                      : "查看状态尚未保存"}
                </p>
                {error && (
                  <div role="alert">
                    <p>{error}</p>
                    <button
                      className="change-message-action"
                      disabled={reading}
                      onClick={() => void markRead(detail)}
                    >
                      重试保存查看状态
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                {!messages.data?.messages.length && (
                  <div className="change-message-empty">
                    <Bell />
                    <h3>暂无课表变更消息</h3>
                    <p>学校发布课表调整后，会在这里告诉你具体变化。</p>
                  </div>
                )}
                {messages.data?.messages.map((message) => (
                  <button
                    className="change-message-row"
                    key={message.id}
                    onClick={() => void markRead(message)}
                  >
                    <span>
                      <strong>
                        {message.type === "long_term"
                          ? message.event === "cancelled"
                            ? "长期调课恢复安排"
                            : "新的长期调课"
                          : message.event === "cancelled"
                            ? "临时调整已撤回"
                            : "你有新的课表调整"}
                      </strong>
                      {!message.read_at && <i aria-label="未读" />}
                      <small>
                        {message.changes
                          .map(
                            (change) =>
                              `${change.after?.recurrence_label ?? change.before?.recurrence_label ?? change.after?.date ?? change.before?.date} ${change.after?.item_name ?? change.before?.item_name} · ${change.after?.course_name ?? change.before?.course_name}`,
                          )
                          .join("；")}
                      </small>
                      <small>{message.reason}</small>
                      {message.event === "published" &&
                        message.type !== "long_term" &&
                        message.exception_status === "cancelled" && <small>此调整已撤回</small>}
                    </span>
                    <ChevronRight />
                  </button>
                ))}
                {messages.data && messages.data.last_page > 1 && (
                  <div className="change-message-pagination">
                    <button
                      className="change-message-action"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      上一页
                    </button>
                    <span>
                      {page}/{messages.data.last_page}
                    </span>
                    <button
                      className="change-message-action"
                      disabled={page >= messages.data.last_page}
                      onClick={() => setPage(page + 1)}
                    >
                      下一页
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
function TeacherChangeSide({
  row,
  label,
  teacherId,
}: {
  row: ChangeRow | null
  label: string
  teacherId: number
}) {
  return (
    <div className="change-message-side">
      <small>{label}</small>
      {row ? (
        <>
          <strong>
            {row.recurrence_label ?? row.date} · {row.item_name} · {row.start_time.slice(0, 5)}–
            {row.end_time.slice(0, 5)}
          </strong>
          {row.recurrence_label && (
            <p>
              {row.effective_from} 至 {row.effective_to}
            </p>
          )}
          <p>
            {row.title ?? row.course_name} · {row.target_name}
          </p>
          <p>
            {row.room_name} · {row.teacher_names.join("、")}
          </p>
          {(row.is_cancelled || !row.teacher_ids.includes(teacherId)) && (
            <p className="change-message-muted">
              {row.is_cancelled ? "原课程停上" : "你不再负责这节课"}
            </p>
          )}
        </>
      ) : (
        <p>{label === "调整前" ? "无授课安排" : "无需上这节课"}</p>
      )}
    </div>
  )
}
