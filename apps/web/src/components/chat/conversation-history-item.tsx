import { useId, useLayoutEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query"
import { EllipsisIcon, LoaderCircleIcon, PencilIcon, SparklesIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { conversationTitleSchema, type Conversation } from "@timetable/agent-contracts"
import {
  deleteConversation,
  generateConversationTitle,
  renameConversation,
  updateConversationTitle,
} from "@/lib/chat"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ShimmerText } from "./shimmer-text"

export function ConversationHistoryItem({
  conversation,
  active,
  onOpen,
  onDeleted,
}: {
  conversation: Conversation
  active: boolean
  onOpen: () => void
  onDeleted: () => void
}) {
  const client = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState("")
  const [validationError, setValidationError] = useState("")
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const menu = useRef<HTMLButtonElement>(null)
  const titleRow = useRef<HTMLDivElement>(null)
  const titleViewport = useRef<HTMLSpanElement>(null)
  const titleContent = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const viewport = titleViewport.current
    const content = titleContent.current
    const row = titleRow.current
    if (!viewport || !content || !row) return
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let hovered = row.matches(":hover") && window.matchMedia("(hover: hover)").matches
    let distance = 0
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let movement: Animation | undefined
    let fade: Animation | undefined
    let replayTimer: ReturnType<typeof setTimeout> | undefined
    const position = () => {
      const transform = getComputedStyle(content).transform
      return transform === "none" ? 0 : Math.max(0, -new DOMMatrixReadOnly(transform).m41)
    }
    const stopAnimations = () => {
      clearTimeout(replayTimer)
      if (movement) movement.onfinish = null
      movement?.cancel()
      fade?.cancel()
      movement = undefined
      fade = undefined
    }
    const settle = (value: number) => {
      content.style.transform = `translate3d(${-value}px, 0, 0)`
      viewport.style.setProperty("--history-offset", `${value}px`)
      stopAnimations()
      content.style.willChange = ""
    }
    const move = (target: number, pause: number) => {
      const from = position()
      settle(from)
      if (reducedMotion.matches) {
        settle(0)
        return
      }
      const travel = Math.abs(target - from)
      if (travel < 0.1 && (!hovered || distance <= 1)) {
        settle(0)
        return
      }
      content.style.willChange = "transform"
      const options: KeyframeAnimationOptions = {
        duration: hovered ? Math.max(1200, (travel / 32) * 1000) : 220,
        delay: pause,
        easing: "cubic-bezier(0.42, 0, 0.58, 1)",
        fill: "both",
      }
      movement = content.animate(
        [
          { transform: `translate3d(${-from}px, 0, 0)` },
          { transform: `translate3d(${-target}px, 0, 0)` },
        ],
        options,
      )
      // Registered CSS lengths keep the mask continuous and on the same timeline.
      // No JavaScript frame loop or boolean edge switches during travel.
      fade = viewport.animate(
        [{ "--history-offset": `${from}px` }, { "--history-offset": `${target}px` }],
        options,
      )
      const startTime = document.timeline.currentTime
      movement.startTime = startTime
      fade.startTime = startTime
      movement.onfinish = () => {
        settle(target)
        if (!hovered || distance <= 1) return
        // Hold the ending, then replay from the beginning without reverse travel.
        replayTimer = setTimeout(() => {
          if (!hovered || reducedMotion.matches || distance <= 1) return
          settle(0)
          move(distance, 500)
        }, 700)
      }
    }
    const schedule = () => {
      clearTimeout(replayTimer)
      clearTimeout(resizeTimer)
      // Let the menu's width transition settle. Resizing must not reset the text.
      resizeTimer = setTimeout(() => {
        if (hovered) move(distance, position() < 0.1 ? 500 : 0)
      }, 100)
    }
    const measure = () => {
      const next = Math.max(
        0,
        content.getBoundingClientRect().width - viewport.getBoundingClientRect().width,
      )
      if (Math.abs(next - distance) <= 0.1) return
      distance = next
      viewport.style.setProperty("--history-distance", `${distance}px`)
      if (hovered) schedule()
    }
    const enter = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      hovered = true
      measure()
      schedule()
    }
    const leave = () => {
      hovered = false
      clearTimeout(resizeTimer)
      move(0, 0)
    }
    const motionChanged = () => {
      clearTimeout(resizeTimer)
      if (reducedMotion.matches) settle(0)
      else if (hovered) schedule()
    }
    measure()
    if (hovered) schedule()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(content)
    row.addEventListener("pointerenter", enter)
    row.addEventListener("pointerleave", leave)
    row.addEventListener("pointercancel", leave)
    reducedMotion.addEventListener("change", motionChanged)
    return () => {
      clearTimeout(resizeTimer)
      stopAnimations()
      content.style.transform = ""
      content.style.willChange = ""
      viewport.style.removeProperty("--history-offset")
      viewport.style.removeProperty("--history-distance")
      observer.disconnect()
      row.removeEventListener("pointerenter", enter)
      row.removeEventListener("pointerleave", leave)
      row.removeEventListener("pointercancel", leave)
      reducedMotion.removeEventListener("change", motionChanged)
    }
  }, [conversation.title])
  const refreshHistory = () => client.invalidateQueries({ queryKey: ["ai", "history"] })
  const saveTitle = async (updated: Conversation) => {
    await client.cancelQueries({ queryKey: ["ai", "history"] })
    updateConversationTitle(client, updated)
  }
  const rename = useMutation({
    mutationFn: (value: string) => renameConversation(conversation.id, value),
    onSuccess: async (updated) => {
      await saveTitle(updated)
      setEditing(false)
    },
    onSettled: refreshHistory,
  })
  const generate = useMutation({
    mutationFn: () => generateConversationTitle(conversation.id),
    onSuccess: (suggestion) => {
      setTitle(suggestion.title)
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteConversation(conversation.id),
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: ["ai", "history"] })
      client.setQueryData<InfiniteData<Conversation[]>>(
        ["ai", "history"],
        (history) =>
          history && {
            ...history,
            pages: history.pages.map((page) => page.filter((item) => item.id !== conversation.id)),
          },
      )
      onDeleted()
      await client.cancelQueries({ queryKey: ["ai", "conversation", conversation.id] })
      client.removeQueries({ queryKey: ["ai", "conversation", conversation.id] })
      toast.success("对话已从列表移除")
    },
    onError: (error) => toast.error(error.message),
    onSettled: refreshHistory,
  })
  const busy = rename.isPending || generate.isPending
  const generating = generate.isPending || conversation.title_generating
  const error = validationError || rename.error?.message || generate.error?.message
  return (
    <>
      <div
        ref={titleRow}
        data-menu-open={menuOpen}
        className={cn(
          "chat-history-item group/history-item relative rounded-xl transition-colors hover:bg-muted",
          active && "bg-sidebar-accent hover:bg-sidebar-accent",
          !active && menuOpen && "bg-muted",
        )}
      >
        <Link
          to={`/ai/${conversation.id}`}
          onClick={onOpen}
          aria-current={active ? "page" : undefined}
          className="chat-history-link flex h-9 min-w-0 items-center rounded-xl pl-2.5 text-sm leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 max-md:min-h-12"
        >
          <span ref={titleViewport} className="chat-history-title min-w-0 flex-1">
            <span ref={titleContent} className="block w-max">
              <ShimmerText text={conversation.title} active={conversation.title_generating} />
            </span>
          </span>
        </Link>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <Button
                ref={menu}
                variant="ghost"
                size="icon-sm"
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded-lg text-muted-foreground opacity-0 transition-opacity group-hover/history-item:opacity-100 group-focus-within/history-item:opacity-100 data-popup-open:opacity-100 hover:bg-transparent aria-expanded:bg-transparent motion-reduce:transition-none dark:hover:bg-transparent [@media(hover:none)]:opacity-100"
              />
            }
            aria-label={`更多操作：${conversation.title}`}
            disabled={remove.isPending}
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuItem
              onClick={() => {
                setTitle(conversation.title)
                setValidationError("")
                rename.reset()
                generate.reset()
                setEditing(true)
              }}
            >
              <PencilIcon />
              重命名
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => remove.mutate()}>
              <Trash2Icon />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (!busy) setEditing(open)
        }}
      >
        <DialogContent
          initialFocus={input}
          finalFocus={menu}
          showCloseButton={!busy}
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault()
              if (busy) return
              const parsed = conversationTitleSchema.safeParse(title)
              if (!parsed.success) {
                setValidationError("请输入 1—80 个字符的名称，不能包含换行。")
                return
              }
              setValidationError("")
              rename.mutate(parsed.data)
            }}
          >
            <div className="space-y-2">
              <label htmlFor={inputId} className="sr-only">
                对话名称
              </label>
              <div className="relative">
                <Input
                  ref={input}
                  id={inputId}
                  value={title}
                  maxLength={80}
                  className="pr-10 max-md:pr-14"
                  disabled={busy}
                  aria-invalid={!!error}
                  aria-describedby={error ? `${inputId}-error` : undefined}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    setTitle(event.target.value)
                    setValidationError("")
                    rename.reset()
                    generate.reset()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.nativeEvent.isComposing)
                      event.preventDefault()
                  }}
                />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute top-1/2 right-0.5 -translate-y-1/2 rounded-xl text-muted-foreground"
                      />
                    }
                    aria-label={generating ? "正在自动重命名" : "自动重命名"}
                    disabled={busy || generating}
                    onClick={() => {
                      if (busy || generating) return
                      setValidationError("")
                      rename.reset()
                      generate.mutate()
                    }}
                  >
                    {generating ? (
                      <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                    ) : (
                      <SparklesIcon />
                    )}
                  </TooltipTrigger>
                  <TooltipContent>{generating ? "正在自动重命名…" : "自动重命名"}</TooltipContent>
                </Tooltip>
              </div>
              {error && (
                <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={!title.trim() || busy}>
                {rename.isPending ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
