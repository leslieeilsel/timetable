import type { ReactNode } from "react"
import { AlertCircleIcon, LoaderCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="sr-only">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  )
}

export function LoadingState({ label = "正在加载…" }: { label?: string }) {
  return (
    <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
      <LoaderCircleIcon className="size-4 animate-spin" />
      {label}
    </div>
  )
}

export function ErrorState({ retry }: { retry?: () => void }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
      <AlertCircleIcon className="size-7 text-destructive" />
      <div>
        <p className="font-medium">暂时无法加载数据</p>
        <p className="text-sm text-muted-foreground">请检查服务状态后重试。</p>
      </div>
      {retry && (
        <Button variant="outline" onClick={retry}>
          重新加载
        </Button>
      )}
    </div>
  )
}

export function EmptyList({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center border-y border-dashed px-4 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}

export function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  )
}
