import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { skipToken, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type ChatTransport } from "ai"
import {
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  HistoryIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RotateCcwIcon,
  SquareIcon,
  SquarePenIcon,
} from "lucide-react"
import type { ChatInput, ChatMessage, ConversationDetail } from "@timetable/agent-contracts"
import {
  chatFetch,
  createConversation,
  getConversation,
  listConversations,
  updateConversationTitle,
} from "@/lib/chat"
import { splitChatMessage, type ChatDisplayPart } from "@/lib/chat-message"
import { useSchoolContext } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ChatScroller,
  ChatScrollerContent,
  ChatScrollerItem as MessageScrollerItem,
} from "@/components/chat/chat-scroller"
import { StreamingMarkdown } from "@/components/chat/streaming-markdown"
import { ExplanationCard, ProposalCard, QuestionCard } from "@/components/chat/message-cards"
import { ToolProgress } from "@/components/chat/tool-progress"
import { AssistantTurn } from "@/components/chat/assistant-turn"
import { ChatWelcomeSuggestions } from "@/components/chat/chat-welcome"
import { ConversationHistoryItem } from "@/components/chat/conversation-history-item"
import { ChatHistorySkeleton, ChatMessagesSkeleton } from "@/components/chat/ai-chat-loading-state"

export function AiChatPage() {
  const { conversationId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const currentConversation = useRef(conversationId)
  useLayoutEffect(() => {
    currentConversation.current = conversationId
  }, [conversationId])
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [startedDraft, setStartedDraft] = useState<{ id: string; key: string }>()
  // Promoting a local draft must keep its component and active stream mounted.
  const sessionKey = conversationId
    ? startedDraft?.id === conversationId
      ? startedDraft.key
      : conversationId
    : `draft:${location.key}`
  return (
    <ConversationPage
      key={sessionKey}
      id={conversationId}
      historyCollapsed={historyCollapsed}
      onHistoryCollapsedChange={setHistoryCollapsed}
      onDeleted={(id) => {
        if (currentConversation.current === id) void navigate("/ai", { replace: true })
      }}
      onCreated={(id) => {
        setStartedDraft({ id, key: sessionKey })
        void navigate(`/ai/${id}`, { replace: true })
      }}
    />
  )
}
type HistoryLayoutProps = {
  historyCollapsed: boolean
  onHistoryCollapsedChange: (collapsed: boolean) => void
}
type ConversationPageProps = HistoryLayoutProps & {
  id?: string
  onCreated: (id: string) => void
  onDeleted: (id: string) => void
}

function ConversationPage({ id, ...sessionProps }: ConversationPageProps) {
  const detail = useQuery({
    queryKey: ["ai", "conversation", id],
    queryFn: id ? ({ signal }) => getConversation(id, undefined, signal) : skipToken,
    refetchOnWindowFocus: false,
  })
  return (
    <ChatSession
      id={id}
      initial={detail.data}
      loadError={detail.isError && !detail.data ? detail.error.message : undefined}
      onRetryLoad={() => void detail.refetch()}
      {...sessionProps}
    />
  )
}

function ChatSession({
  id,
  initial,
  loadError,
  onRetryLoad,
  historyCollapsed,
  onHistoryCollapsedChange,
  onCreated,
  onDeleted,
}: ConversationPageProps & {
  initial?: ConversationDetail
  loadError?: string
  onRetryLoad: () => void
}) {
  const location = useLocation()
  const [search] = useSearchParams()
  const context = useSchoolContext()
  const client = useQueryClient()
  const [draft, setDraft] = useState(
    () =>
      search.get("prompt")?.slice(0, 4000) ??
      (location.state as { draft?: string } | null)?.draft ??
      "",
  )
  const composer = useRef<HTMLTextAreaElement>(null)
  const composerForm = useRef<HTMLFormElement>(null)
  const composerOrigin = useRef<DOMRect | null>(null)
  const [chatId] = useState(() => initial?.id ?? crypto.randomUUID())
  const conversation = useRef(initial)
  const active = useRef(true)
  const submitting = useRef(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [snapshot, setSnapshot] = useState(initial)
  // Keep the opening snapshot separate from later completion/sync updates.
  const [restoredTexts, setRestoredTexts] = useState(
    () =>
      new Map(
        (initial?.messages ?? []).map((message) => [
          message.id,
          message.parts.filter((part) => part.type === "text").map((part) => part.text),
        ]),
      ),
  )
  const [earlier, setEarlier] = useState<ChatMessage[]>([])
  const [before, setBefore] = useState(initial?.before ?? null)
  const [hasEarlier, setHasEarlier] = useState(initial?.has_earlier ?? false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState("")
  const revision = useRef(initial?.revision ?? 0)
  const lastSubmitted = useRef("")
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const ensureConversationRef = useRef<(signal?: AbortSignal) => Promise<void>>(async () => {})
  const history = useInfiniteQuery({
    queryKey: ["ai", "history"],
    queryFn: ({ pageParam, signal }) => listConversations(pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === 50 ? pages.length * 50 : undefined),
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.some((item) => item.title_generating))
        ? 1500
        : false,
  })
  const transport = useMemo<ChatTransport<ChatMessage>>(() => {
    const http = new DefaultChatTransport<ChatMessage>({
      fetch: chatFetch,
      credentials: "include",
      prepareSendMessagesRequest: ({ messages, body }) => {
        const latest = messages.at(-1)
        if (!latest || latest.role !== "user") throw new Error("请发送新的用户消息。")
        if (!conversation.current) throw new Error("对话尚未创建，请重试。")
        return {
          api: `/agent/v1/conversations/${conversation.current.id}/messages`,
          body: {
            message_id: latest.id,
            text: latest.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
            revision: revision.current,
            ...(body?.answer ? { answer: body.answer } : {}),
          },
        }
      },
    })
    return {
      sendMessages: async (options) => {
        await ensureConversationRef.current(options.abortSignal)
        options.abortSignal?.throwIfAborted()
        return http.sendMessages(options)
      },
      // Persisted replies are restored through getConversation, not a resume endpoint.
      reconnectToStream: async () => null,
    }
  }, [])
  const { messages, setMessages, sendMessage, status, error, clearError, stop } =
    useChat<ChatMessage>({
      id: chatId,
      messages: initial?.messages ?? [],
      transport,
      onData: (part) => {
        if (part.type !== "data-conversation" || !active.current) return
        updateConversationTitle(client, part.data)
        void client.invalidateQueries({ queryKey: ["ai", "history"] })
      },
      onFinish: () => {
        if (!active.current) return
        if (!conversation.current) {
          setMessages([])
          setDraft((current) => current || lastSubmitted.current)
          return
        }
        void refreshRef.current()
      },
    })
  useLayoutEffect(() => {
    if (!initial || conversation.current) return
    // Restore once, before paint, without remounting the history or composer.
    // A draft promoted during its first send already owns its active messages.
    conversation.current = initial
    revision.current = initial.revision
    setSnapshot(initial)
    setMessages(initial.messages)
    setRestoredTexts(
      new Map(
        initial.messages.map((message) => [
          message.id,
          message.parts.filter((part) => part.type === "text").map((part) => part.text),
        ]),
      ),
    )
    setBefore(initial.before)
    setHasEarlier(initial.has_earlier)
  }, [initial, setMessages])
  const restoring = Boolean(id) && !snapshot
  const streaming = status === "submitted" || status === "streaming"
  const busy = restoring || streaming || Boolean(snapshot?.busy) || syncing || actionBusy
  async function ensureConversation(signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (conversation.current) return
    const requested = Number(search.get("semester_id"))
    let semesterId: number | null
    if (Number.isSafeInteger(requested) && requested > 0) {
      semesterId = requested
    } else {
      const school = context.data ?? (await context.refetch()).data
      if (!school) throw new Error("无法读取当前学期，请稍后重试。")
      semesterId = school.current_semester?.id ?? null
    }
    signal?.throwIfAborted()
    const created = await createConversation(semesterId, signal)
    signal?.throwIfAborted()
    if (!active.current) throw new DOMException("对话已关闭", "AbortError")
    conversation.current = created
    revision.current = created.revision
    setSnapshot(created)
    client.setQueryData(["ai", "conversation", created.id], created)
    onCreated(created.id)
  }
  async function refresh() {
    const id = conversation.current?.id
    if (!id || !active.current) return
    setSyncing(true)
    try {
      const current = await getConversation(id)
      if (!active.current) return
      conversation.current = current
      revision.current = current.revision
      setSnapshot(current)
      setMessages(current.messages)
      setSyncError("")
      client.setQueryData(["ai", "conversation", id], current)
      await client.invalidateQueries({ queryKey: ["ai", "history"] })
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "同步失败，请刷新后继续。")
    } finally {
      setSyncing(false)
    }
  }
  useEffect(() => {
    refreshRef.current = refresh
    ensureConversationRef.current = ensureConversation
  })
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      void stop()
    }
  }, [stop])
  useEffect(() => {
    if (!snapshot?.busy || streaming) return
    const timer = window.setInterval(() => {
      void refreshRef.current()
    }, 1500)
    return () => window.clearInterval(timer)
  }, [snapshot?.busy, streaming])
  async function submit(text: string, answer?: ChatInput["answer"]) {
    const value = text.trim()
    if (!value || busy || syncError || submitting.current) return
    submitting.current = true
    if (showWelcome) composerOrigin.current = composerForm.current?.getBoundingClientRect() ?? null
    setDraft("")
    clearError()
    lastSubmitted.current = value
    try {
      await sendMessage(
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: value }],
          metadata: { status: "complete", sent_at: new Date().toISOString() },
        },
        { body: answer ? { answer } : undefined },
      )
    } finally {
      submitting.current = false
    }
  }
  function retryLastMessage() {
    const text = messages
      .findLast((message) => message.role === "user")
      ?.parts.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
    if (text) void submit(text)
  }
  const allMessages = [
    ...earlier.filter((old) => !messages.some((message) => message.id === old.id)),
    ...messages,
  ]
  const latest = messages.at(-1)
  const replyError =
    latest?.role === "assistant" && latest.metadata?.status === "interrupted"
      ? latest.metadata.error
      : undefined
  // Errors already attached to a reply belong in that reply, not the composer.
  const composerError = syncError || (error?.message !== replyError ? error?.message : undefined)
  const showWelcome = !restoring && !allMessages.length && !hasEarlier
  useLayoutEffect(() => {
    const origin = composerOrigin.current
    composerOrigin.current = null
    const form = composerForm.current
    if (
      showWelcome ||
      !origin ||
      !form ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return
    // Keep the same input mounted; only animate its move after the first send.
    const destination = form.getBoundingClientRect()
    const offsetX = origin.left - destination.left
    const offsetY = origin.top - destination.top
    if (Math.abs(offsetX) < 1 && Math.abs(offsetY) < 1) return
    const animation = form.animate(
      [{ transform: `translate(${offsetX}px, ${offsetY}px)` }, { transform: "translate(0, 0)" }],
      { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    )
    return () => animation.cancel()
  }, [showWelcome])
  return (
    <div className="relative flex h-full min-h-0 min-w-0 overflow-hidden">
      {historyOpen && (
        <button
          className="absolute inset-0 z-20 bg-background/75 lg:hidden"
          aria-label="关闭对话历史"
          onClick={() => setHistoryOpen(false)}
        />
      )}
      <aside
        aria-label="对话历史"
        className={cn(
          "relative flex w-64 shrink-0 flex-col border-r bg-muted/20 transition-[width] duration-200 ease-linear max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-30 max-lg:bg-background motion-reduce:transition-none",
          historyCollapsed && "lg:w-0 lg:border-r-0",
          !historyOpen && "max-lg:hidden",
        )}
      >
        <div
          className={cn(
            "absolute top-0 left-0 z-10 flex w-64 items-center gap-1 p-3 transition-[width] duration-200 ease-linear motion-reduce:transition-none",
            historyCollapsed && "lg:w-22",
          )}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  to="/ai"
                  onClick={(event) => {
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return
                    setHistoryOpen(false)
                    if (!allMessages.length && !hasEarlier && !busy) {
                      event.preventDefault()
                      requestAnimationFrame(() => composer.current?.focus())
                    } else {
                      void stop()
                    }
                  }}
                />
              }
              disabled={!historyCollapsed}
              className={cn(
                "inline-flex h-7 shrink-0 items-center rounded-lg text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 max-md:min-h-12",
                historyCollapsed && "lg:text-muted-foreground lg:hover:text-foreground",
              )}
              aria-label="新对话"
            >
              <span className="flex size-7 shrink-0 items-center justify-center">
                <SquarePenIcon className="size-4" />
              </span>
              <span
                className={cn(
                  "max-w-20 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-linear motion-reduce:transition-none",
                  historyCollapsed && "lg:max-w-0 lg:opacity-0",
                )}
              >
                <span className="block pr-2">新对话</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8} className="max-lg:hidden">
              新对话
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto hidden rounded-lg text-muted-foreground aria-expanded:bg-transparent lg:inline-flex"
                />
              }
              aria-label={historyCollapsed ? "展开对话列表" : "收起对话列表"}
              aria-expanded={!historyCollapsed}
              aria-controls="chat-history-list"
              onClick={() => onHistoryCollapsedChange(!historyCollapsed)}
            >
              {historyCollapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              {historyCollapsed ? "展开对话列表" : "收起对话列表"}
            </TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto rounded-lg text-muted-foreground aria-expanded:bg-transparent lg:hidden"
            aria-label="收起对话列表"
            title="收起对话列表"
            aria-expanded={historyOpen}
            aria-controls="chat-history-list"
            onClick={() => setHistoryOpen(false)}
          >
            <PanelLeftCloseIcon />
          </Button>
        </div>
        <div
          id="chat-history-list"
          inert={historyCollapsed && !historyOpen}
          className={cn(
            "flex min-h-0 flex-1 overflow-hidden pt-18 transition-[opacity,visibility] duration-200 ease-linear md:pt-14 motion-reduce:transition-none",
            historyCollapsed && "lg:invisible lg:pointer-events-none lg:opacity-0",
          )}
        >
          <div className="flex min-h-0 w-64 shrink-0 flex-col">
            <p className="px-4 pb-2 text-xs text-muted-foreground">最近对话</p>
            <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-4">
              {history.isLoading && <ChatHistorySkeleton />}
              {history.data?.pages.flat().map((conversation) => (
                <ConversationHistoryItem
                  key={conversation.id}
                  conversation={conversation}
                  active={(id ?? snapshot?.id) === conversation.id}
                  onOpen={() => setHistoryOpen(false)}
                  onDeleted={() => onDeleted(conversation.id)}
                />
              ))}
              {history.isError && (
                <button
                  className="px-3 py-2 text-sm text-destructive"
                  onClick={() => void history.refetch()}
                >
                  历史加载失败，点击重试
                </button>
              )}
              {history.hasNextPage && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  更多对话
                </Button>
              )}
              {!history.isLoading && !history.data?.pages.flat().length && (
                <p className="px-3 py-4 text-xs leading-6 text-muted-foreground">
                  发送第一条消息后，对话会保存在这里。
                </p>
              )}
            </nav>
          </div>
        </div>
      </aside>
      <section
        aria-label="AI 对话"
        aria-busy={restoring && !loadError}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {!showWelcome && (
          <ChatScroller
            resetKey={allMessages.findLast((message) => message.role === "user")?.id}
            prependKey={allMessages[0]?.id}
          >
            <ChatScrollerContent>
              {restoring && (
                <MessageScrollerItem messageId="loading">
                  <ConversationLoading error={loadError} onRetry={onRetryLoad} />
                </MessageScrollerItem>
              )}
              {hasEarlier && (
                <MessageScrollerItem messageId="earlier">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={loadingEarlier}
                    onClick={async () => {
                      if (!before || !snapshot) return
                      setLoadingEarlier(true)
                      try {
                        const page = await getConversation(snapshot.id, before)
                        setEarlier((old) => [...page.messages, ...old])
                        setBefore(page.before)
                        setHasEarlier(page.has_earlier)
                      } catch (error) {
                        setSyncError(error instanceof Error ? error.message : "无法加载历史。")
                      } finally {
                        setLoadingEarlier(false)
                      }
                    }}
                  >
                    加载更早的消息
                  </Button>
                </MessageScrollerItem>
              )}
              {allMessages.map((message) => (
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <MessageView
                    message={message}
                    initialTexts={
                      restoredTexts.get(message.id) ??
                      earlier
                        .find((old) => old.id === message.id)
                        ?.parts.filter((part) => part.type === "text")
                        .map((part) => part.text)
                    }
                    isLatest={message.id === latest?.id}
                    conversationId={snapshot?.id}
                    disabled={
                      busy ||
                      !!syncError ||
                      message.id !== latest?.id ||
                      message.metadata?.status !== "complete"
                    }
                    onAnswer={(text, answer) => void submit(text, answer)}
                    onSaved={async () => {
                      await client.invalidateQueries({
                        predicate: (query) => query.queryKey[0] !== "ai",
                      })
                      await refresh()
                    }}
                    onBusy={setActionBusy}
                    onRetry={
                      message.role === "assistant" &&
                      message.id === latest?.id &&
                      message.metadata?.status === "interrupted"
                        ? retryLastMessage
                        : undefined
                    }
                    retryDisabled={busy || !!syncError}
                  />
                </MessageScrollerItem>
              ))}
              {status === "submitted" && latest?.role === "user" && (
                <MessageScrollerItem messageId="waiting">
                  <AssistantTurn
                    metadata={{ status: "running", started_at: latest.metadata?.sent_at }}
                    activityLabel="正在思考"
                  />
                </MessageScrollerItem>
              )}
            </ChatScrollerContent>
          </ChatScroller>
        )}
        <div
          className={cn(
            "mx-auto flex w-full max-w-3xl shrink-0 flex-col px-4 pb-4 sm:px-8 sm:pb-5",
            showWelcome &&
              "min-h-0 flex-1 overflow-y-auto pt-16 pb-8 sm:pt-20 sm:pb-12 [@media(max-height:600px)]:pt-6",
          )}
        >
          <div className={cn("w-full shrink-0", showWelcome && "my-auto")}>
            {showWelcome && (
              <h1 className="mb-6 text-center text-2xl font-medium tracking-tight">
                今天想处理什么？
              </h1>
            )}
            {composerError && (
              <div
                role="alert"
                className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                <p className="flex-1">{composerError}</p>
                {snapshot && (
                  <Button size="sm" variant="ghost" onClick={() => void refresh()}>
                    同步对话
                  </Button>
                )}
                {!syncError && lastSubmitted.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void submit(lastSubmitted.current)}
                  >
                    重试回答
                  </Button>
                )}
              </div>
            )}
            {snapshot?.busy && !streaming && (
              <p role="status" className="mb-2 text-xs text-muted-foreground">
                正在同步另一页面中的处理进度…
              </p>
            )}
            <form
              ref={composerForm}
              className="rounded-[24px] border border-foreground/15 bg-background p-2 shadow-sm shadow-black/[0.03] transition-[border-color,box-shadow] focus-within:border-foreground/25 focus-within:ring-2 focus-within:ring-foreground/5"
              onSubmit={(event) => {
                event.preventDefault()
                void submit(draft)
              }}
            >
              <Textarea
                ref={composer}
                aria-label="发送给 AI 的消息"
                placeholder={showWelcome ? "输入问题，或描述你想完成的事…" : "输入消息…"}
                disabled={restoring}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={4000}
                rows={2}
                className="block max-h-40 min-h-14 resize-none border-0 bg-transparent! px-2 py-1 text-sm leading-6 shadow-none focus-visible:ring-0"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void submit(draft)
                  }
                }}
              />
              <div className="mt-1 flex min-h-8 items-center gap-2">
                <SidebarTrigger
                  className="rounded-full md:hidden"
                  aria-label="打开导航菜单"
                  title="打开导航菜单"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="rounded-full lg:hidden"
                  aria-label="查看对话历史"
                  aria-expanded={historyOpen}
                  aria-controls="chat-history-list"
                  onClick={() => setHistoryOpen(true)}
                >
                  <HistoryIcon />
                </Button>
                {streaming ? (
                  <Button
                    type="button"
                    size="icon"
                    className="ml-auto rounded-full bg-foreground text-background hover:bg-foreground/85"
                    aria-label="停止生成"
                    onClick={() => {
                      void stop().then(() => refreshRef.current())
                    }}
                  >
                    <SquareIcon className="size-3 fill-current" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    className="ml-auto rounded-full bg-foreground text-background hover:bg-foreground/85 disabled:bg-muted disabled:text-muted-foreground/50 disabled:opacity-100"
                    aria-label="发送消息"
                    title="发送消息（Enter）"
                    disabled={busy || !draft.trim() || !!syncError}
                  >
                    <ArrowUpIcon />
                  </Button>
                )}
              </div>
            </form>
            {showWelcome && (
              <ChatWelcomeSuggestions
                onSelect={(prompt) => {
                  setDraft(prompt)
                  composer.current?.focus({ preventScroll: true })
                }}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function ConversationLoading({ error, onRetry }: { error?: string; onRetry: () => void }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 160)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <div
      role={error ? "alert" : "status"}
      className={cn(
        "text-sm text-muted-foreground",
        error && "flex min-h-40 flex-col items-center justify-center gap-3",
      )}
    >
      {error ? (
        <>
          <p>{error}</p>
          <Button variant="outline" onClick={onRetry}>
            重试
          </Button>
        </>
      ) : (
        <>
          <span className="sr-only">正在读取对话…</span>
          {visible && <ChatMessagesSkeleton />}
        </>
      )}
    </div>
  )
}

function MessageView({
  message,
  initialTexts,
  isLatest,
  conversationId,
  disabled,
  onAnswer,
  onSaved,
  onBusy,
  onRetry,
  retryDisabled,
}: {
  message: ChatMessage
  initialTexts?: string[]
  isLatest: boolean
  conversationId?: string
  disabled: boolean
  onAnswer: (text: string, answer: NonNullable<ChatInput["answer"]>) => void
  onSaved: () => Promise<void>
  onBusy: (busy: boolean) => void
  onRetry?: () => void
  retryDisabled: boolean
}) {
  // A live reply remains live for display purposes after the model has finished.
  const [live] = useState(() => !initialTexts || message.metadata?.status === "running")
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])
  const textParts = message.parts.filter((part) => part.type === "text")
  const text = textParts.map((part) => part.text).join("\n")
  const content = splitChatMessage(message)
  const copyText = message.role === "assistant" ? content.answerText || text : text
  const sentAt = message.metadata?.sent_at ? new Date(message.metadata.sent_at) : null
  const timestamp =
    sentAt && !Number.isNaN(sentAt.getTime()) ? (
      <time
        dateTime={sentAt.toISOString()}
        title={sentAt.toLocaleString("zh-CN", { hour12: false })}
        className="text-[11px] tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100"
      >
        {sentAt.toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })}
      </time>
    ) : null
  const copyButton =
    text && message.metadata?.status !== "running" ? (
      <Button
        variant="ghost"
        size="icon-xs"
        className={cn(
          "transition-opacity",
          !(message.role === "assistant" && isLatest) &&
            "opacity-0 group-hover/message:opacity-100 focus-visible:opacity-100",
        )}
        aria-label={copied ? "已复制" : message.role === "user" ? "复制消息" : "复制回答"}
        onClick={() => {
          void navigator.clipboard
            .writeText(copyText)
            .then(() => setCopied(true))
            .catch(() => setCopied(false))
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    ) : null
  if (message.role === "user")
    return (
      <article aria-label="我的消息" className="group/message ml-auto w-fit max-w-[90%]">
        <div className="ml-auto w-fit max-w-full whitespace-pre-wrap break-words rounded-[22px] bg-[#e8f3fe] px-4 py-2.5 text-sm leading-6 text-[#0c274a] dark:bg-[#173e76] dark:text-[#f6fafe]">
          {text}
        </div>
        <div className="mt-1 flex min-h-6 items-center justify-end gap-2 text-muted-foreground">
          {timestamp}
          {copyButton}
        </div>
      </article>
    )
  const renderParts = (contentParts: ChatDisplayPart[]) =>
    contentParts.map((part, index) => {
      if (part.type === "data-progress") {
        if (contentParts[index - 1]?.type === "data-progress") return null
        let end = index + 1
        while (contentParts[end]?.type === "data-progress") end++
        return (
          <ToolProgress
            key={part.id ?? `progress-${index}`}
            steps={contentParts.slice(index, end).filter((item) => item.type === "data-progress")}
            running={message.metadata?.status === "running"}
          />
        )
      }
      if (part.type === "text" && part.text)
        return (
          <StreamingMarkdown
            key={`text-${textParts.indexOf(part)}`}
            text={part.text}
            streaming={message.metadata?.status === "running" && part.state === "streaming"}
            live={live && message.metadata?.status !== "interrupted"}
            initialText={initialTexts?.[textParts.indexOf(part)]}
          />
        )
      if (part.type === "data-question")
        return (
          <QuestionCard
            key={part.data.id}
            question={part.data}
            disabled={disabled}
            onAnswer={onAnswer}
          />
        )
      if (part.type === "data-proposal" && conversationId)
        return (
          <ProposalCard
            key={part.data.id}
            proposal={part.data}
            conversationId={conversationId}
            disabled={disabled}
            onSaved={onSaved}
            onBusy={onBusy}
          />
        )
      if (part.type === "data-explanation")
        return <ExplanationCard key={index} explanation={part.data} />
      return null
    })
  return (
    <article aria-label="AI 回复" className="group/message space-y-2">
      <AssistantTurn
        metadata={message.metadata}
        live={live}
        hasProcess={content.process.length > 0}
        process={renderParts(content.process)}
        answer={content.answer.length > 0 ? renderParts(content.answer) : null}
        collapseProcess={content.hasFinalAnswer && !content.waitingFor}
        activityLabel={content.activityLabel}
        waitingFor={content.waitingFor}
      />
      {(copyButton || timestamp || onRetry) && (
        <div className="flex min-h-6 items-center gap-2 text-muted-foreground">
          {copyButton}
          {onRetry && (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-xs" disabled={retryDisabled} />}
                aria-label="重试回答"
                onClick={onRetry}
              >
                <RotateCcwIcon />
              </TooltipTrigger>
              <TooltipContent side="bottom">重试回答</TooltipContent>
            </Tooltip>
          )}
          {timestamp}
        </div>
      )}
    </article>
  )
}
