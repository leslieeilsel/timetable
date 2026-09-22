import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { TextPlayback } from "./text-playback"

const RevealContext = createContext(true)

export function TextReveal({ ready, children }: { ready: boolean; children: ReactNode }) {
  return <RevealContext.Provider value={ready}>{children}</RevealContext.Provider>
}

export function StreamingMarkdown({
  text,
  streaming,
  live,
  initialText = "",
}: {
  text: string
  streaming: boolean
  live: boolean
  initialText?: string
}) {
  const ready = useContext(RevealContext)
  const [shown, setShown] = useState(() =>
    !live ? text : text.startsWith(initialText) ? initialText : "",
  )
  const player = useRef<TextPlayback | null>(null)
  if (!player.current) player.current = new TextPlayback(shown)
  const frame = useRef<number | null>(null)
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  )
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReducedMotion(query.matches)
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  useLayoutEffect(() => {
    const playback = player.current!
    const cancel = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
    if (!live || reducedMotion || document.hidden) {
      cancel()
      playback.reset(text)
      setShown(text)
      return
    }
    if (!ready) {
      cancel()
      playback.pause()
      return
    }
    playback.receive(text, performance.now())
    setShown(playback.visible)
    if (frame.current !== null || !playback.pending) return
    const tick = (now: number) => {
      frame.current = null
      playback.advance(now)
      setShown(playback.visible)
      if (playback.pending) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    // A new network chunk updates the queue without cancelling the scheduled paint.
  }, [text, live, ready, reducedMotion])
  useLayoutEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    },
    [],
  )
  const visible = !live || reducedMotion ? text : shown
  return (
    <div
      data-chat-text
      data-streaming={streaming}
      data-revealing={visible !== text}
      className="text-sm leading-6 break-words [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:my-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:font-semibold [&_h3]:my-3 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-4 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:border [&_td]:px-3 [&_th]:border [&_th]:px-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              {children}
            </a>
          ),
          img: ({ alt }) => <span>{alt ?? "图片"}</span>,
        }}
      >
        {visible}
      </Markdown>
    </div>
  )
}
