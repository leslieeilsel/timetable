import { useLocation } from "react-router"
import { Skeleton } from "@/components/ui/skeleton"

export function ChatHistorySkeleton() {
  return (
    <div role="status" aria-label="正在读取对话列表">
      <div aria-hidden="true" className="space-y-0.5">
        {[78, 62, 86, 70, 54, 82, 66, 74].map((width) => (
          <div key={width} className="flex h-9 items-center px-2.5 max-md:min-h-12">
            <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ChatMessagesSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-7">
      <div className="pb-7">
        <Skeleton className="ml-auto h-11 w-40 max-w-[70%] rounded-[22px]" />
      </div>
      <div className="space-y-4">
        <div className="border-b border-border/50 pb-2">
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-3.5 w-[92%]" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-[64%]" />
        </div>
        <Skeleton className="size-4" />
      </div>
    </div>
  )
}

function ComposerSkeleton() {
  return (
    <div className="rounded-[24px] border border-foreground/15 bg-background p-2 shadow-sm shadow-black/[0.03]">
      <div className="min-h-14 px-2 py-2">
        <Skeleton className="h-3.5 w-40 max-w-[60%]" />
      </div>
      <div className="mt-1 flex min-h-8 items-center justify-end">
        <Skeleton className="size-8 rounded-full max-md:size-12" />
      </div>
    </div>
  )
}

/** Match the destination before the chat module or authentication has loaded. */
export function AiChatLoadingState() {
  const { pathname } = useLocation()
  const hasConversation = pathname.split("/").filter(Boolean).length > 1
  return (
    <div role="status" aria-busy="true" className="h-full min-h-0">
      <span className="sr-only">正在载入 AI 助手…</span>
      <div aria-hidden="true" className="flex h-full min-h-0 overflow-hidden">
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/20 lg:flex">
          <div className="flex h-14 shrink-0 items-center gap-2 px-4">
            <Skeleton className="size-4" />
            <Skeleton className="h-3.5 w-12" />
            <Skeleton className="ml-auto size-4" />
          </div>
          <div className="px-4 pb-2">
            <Skeleton className="h-3 w-12" />
          </div>
          <div className="min-h-0 overflow-hidden px-1.5 pb-4">
            <ChatHistorySkeleton />
          </div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {hasConversation ? (
            <>
              <div className="min-h-0 flex-1 overflow-hidden scrollbar-gutter-stable">
                <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
                  <ChatMessagesSkeleton />
                </div>
              </div>
              <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 sm:px-8 sm:pb-5">
                <ComposerSkeleton />
              </div>
            </>
          ) : (
            <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
              <div className="mx-auto my-auto w-full max-w-3xl shrink-0 px-4 pt-16 pb-8 sm:px-8 sm:pt-20 sm:pb-12 [@media(max-height:600px)]:pt-6">
                <Skeleton className="mx-auto mb-6 h-8 w-48" />
                <ComposerSkeleton />
                <div className="mt-5 space-y-1">
                  {[72, 84, 56].map((width) => (
                    <div key={width} className="flex items-center gap-3 px-3 py-3.5">
                      <Skeleton className="size-4 shrink-0" />
                      <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
