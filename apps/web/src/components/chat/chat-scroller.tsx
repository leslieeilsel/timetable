import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react"
import { ArrowDownIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const ScrollContext = createContext<{ content: (node: HTMLDivElement | null) => void } | null>(null)

/** The resize observer corrects the viewport before paint, including during collapses. */
export function ChatScroller({
  children,
  resetKey,
  prependKey,
}: {
  children: ReactNode
  resetKey?: string
  prependKey?: string
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement | null>(null)
  const following = useRef(true)
  const jumping = useRef(false)
  const jumpTimer = useRef<number | null>(null)
  const lastAutoTop = useRef(0)
  const previousTop = useRef(0)
  const previousHeight = useRef(0)
  const [away, setAway] = useState(false)

  const clearJump = () => {
    jumping.current = false
    if (jumpTimer.current !== null) window.clearTimeout(jumpTimer.current)
    jumpTimer.current = null
  }
  const follow = () => {
    const el = viewport.current
    if (!el) return
    clearJump()
    following.current = true
    el.style.overflowAnchor = "none"
    // Natural content height decides whether scrolling is needed; short turns stay put.
    const bottom = Math.max(0, el.scrollHeight - el.clientHeight)
    if (Math.abs(el.scrollTop - bottom) > 0.5) el.scrollTop = bottom
    lastAutoTop.current = el.scrollTop
    previousTop.current = el.scrollTop
    setAway(false)
  }
  const settleJump = () => {
    if (jumpTimer.current !== null) window.clearTimeout(jumpTimer.current)
    // Fallback for browsers without scrollend; reset while native scrolling is moving.
    jumpTimer.current = window.setTimeout(() => {
      if (jumping.current) follow()
    }, 200)
  }
  const scrollToLatest = () => {
    const el = viewport.current
    if (!el) return
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      el.scrollHeight - el.clientHeight - el.scrollTop <= 1
    ) {
      follow()
      return
    }
    // A resize during streaming must not cut the button's smooth scroll short.
    jumping.current = true
    following.current = false
    el.style.overflowAnchor = "none"
    setAway(false)
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    settleJump()
  }
  const pause = () => {
    const el = viewport.current
    if (jumping.current && el) el.scrollTo({ top: el.scrollTop, behavior: "instant" })
    clearJump()
    following.current = false
    if (el) {
      el.style.overflowAnchor = "auto"
      setAway(el.scrollHeight - el.clientHeight - el.scrollTop > 32)
    }
  }
  useLayoutEffect(() => {
    const el = viewport.current
    const body = content.current
    if (!el || !body) return
    previousHeight.current = el.scrollHeight
    const resize = new ResizeObserver(() => {
      if (following.current) follow()
      previousHeight.current = el.scrollHeight
      setAway(!jumping.current && el.scrollHeight - el.clientHeight - el.scrollTop > 32)
    })
    resize.observe(body)
    resize.observe(el)
    follow()
    return () => {
      resize.disconnect()
      clearJump()
    }
  }, [resetKey])
  useLayoutEffect(() => {
    const el = viewport.current
    if (!el || following.current) return
    // Loading earlier messages must preserve the reading position before paint.
    el.scrollTop = previousTop.current + el.scrollHeight - previousHeight.current
    previousTop.current = el.scrollTop
    previousHeight.current = el.scrollHeight
  }, [prependKey])

  return (
    <ScrollContext.Provider
      value={{
        content: (node) => {
          content.current = node
        },
      }}
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          ref={viewport}
          data-slot="chat-viewport"
          role="region"
          aria-label="对话消息"
          tabIndex={0}
          className="size-full min-h-0 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-gutter-stable"
          onWheel={(event) => {
            if (jumping.current || event.deltaY < 0) pause()
          }}
          onTouchMove={pause}
          onKeyDown={(event) => {
            const keys = jumping.current
              ? ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]
              : ["ArrowUp", "PageUp", "Home"]
            if (keys.includes(event.key)) pause()
          }}
          onPointerDown={() => {
            if (jumping.current) pause()
          }}
          onPointerUp={() => {
            if (window.getSelection()?.toString()) pause()
          }}
          onClickCapture={(event) => {
            // Expanding past work is a reading action, not a request to follow its bottom.
            if ((event.target as Element).closest("button[aria-controls]")) pause()
          }}
          onScroll={() => {
            const el = viewport.current
            if (!el) return
            const distance = el.scrollHeight - el.clientHeight - el.scrollTop
            const resized = previousHeight.current !== el.scrollHeight
            const automatic = Math.abs(el.scrollTop - lastAutoTop.current) < 2
            if (jumping.current) {
              settleJump()
            } else if (distance <= 10) {
              following.current = true
              el.style.overflowAnchor = "none"
            } else if (!resized && !automatic && el.scrollTop < previousTop.current) pause()
            previousTop.current = el.scrollTop
            previousHeight.current = el.scrollHeight
            setAway(!jumping.current && distance > 32)
          }}
          onScrollEnd={() => {
            if (jumping.current) follow()
          }}
        >
          {children}
        </div>
        <Button
          aria-label="滚动到最新消息"
          size="icon-sm"
          variant="secondary"
          data-active={away}
          inert={!away}
          tabIndex={away ? 0 : -1}
          className="absolute bottom-4 inset-s-1/2 -translate-x-1/2 rounded-full border border-border/60 bg-background/30 text-foreground shadow-sm backdrop-blur-sm backdrop-saturate-150 transition-[translate,scale,opacity] duration-200 hover:bg-background/45 hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:translate-y-full data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none rtl:translate-x-1/2"
          onClick={(event) => {
            event.currentTarget.blur()
            scrollToLatest()
          }}
        >
          <ArrowDownIcon />
        </Button>
      </div>
    </ScrollContext.Provider>
  )
}

export function ChatScrollerContent({ children }: { children: ReactNode }) {
  const scroll = useContext(ScrollContext)
  return (
    <div
      ref={scroll?.content}
      role="log"
      data-slot="chat-content"
      className="mx-auto flex min-h-full max-w-3xl flex-col gap-7 px-4 py-8 sm:px-8"
    >
      {children}
    </div>
  )
}

export function ChatScrollerItem({
  messageId,
  className,
  ...props
}: ComponentProps<"div"> & { messageId: string }) {
  return (
    <div data-message-id={messageId} className={cn("min-w-0 shrink-0", className)} {...props} />
  )
}
