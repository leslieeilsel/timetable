import { lazy, Suspense, useEffect, useState } from "react"

const Toaster = lazy(() =>
  import("@/components/ui/sonner").then((module) => ({ default: module.Toaster })),
)

export function DeferredToaster() {
  const [requested, setRequested] = useState(false)

  useEffect(() => {
    if (requested) return

    const request = () => setRequested(true)
    window.addEventListener("pointerdown", request, { capture: true, once: true })
    window.addEventListener("keydown", request, { capture: true, once: true })

    return () => {
      window.removeEventListener("pointerdown", request, { capture: true })
      window.removeEventListener("keydown", request, { capture: true })
    }
  }, [requested])

  if (!requested) return null

  return (
    <Suspense fallback={null}>
      <Toaster richColors closeButton />
    </Suspense>
  )
}
