import { Skeleton } from "@/components/ui/skeleton"

export function WorkspaceLoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-svh bg-background md:grid-cols-[255px_minmax(0,1fr)]"
    >
      <span className="sr-only">正在恢复会话…</span>
      <aside aria-hidden="true" className="hidden border-r bg-sidebar p-4 md:block">
        <div className="flex items-center gap-3 pb-8">
          <Skeleton className="size-8 shrink-0" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="grid gap-7">
          {[72, 88, 64].map((width, groupIndex) => (
            <div key={width} className="grid gap-3">
              <Skeleton className="h-3" style={{ width }} />
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex h-8 items-center gap-3 px-2">
                  <Skeleton className="size-4" />
                  <Skeleton
                    className="h-3"
                    style={{ width: `${96 + groupIndex * 18 - item * 7}px` }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <div className="min-w-0">
        <header aria-hidden="true" className="flex h-14 items-center gap-3 border-b px-4 md:px-7">
          <Skeleton className="size-7 md:hidden" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="ml-auto h-7 w-24" />
        </header>
        <main aria-hidden="true" className="space-y-7 p-5 md:p-7">
          <div className="grid gap-3">
            <Skeleton className="h-8 w-full max-w-lg" />
            <Skeleton className="h-4 w-full max-w-sm" />
          </div>
          <Skeleton className="h-28 w-full" />
          <div className="grid gap-6 xl:grid-cols-[1.5fr_0.75fr]">
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        </main>
      </div>
    </div>
  )
}
