import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useLocation } from "react-router"

const WorkingSemesterContext = createContext<number | null>(null)

export function WorkingSemesterProvider({
  userId,
  children,
}: {
  userId: number
  children: ReactNode
}) {
  const { pathname } = useLocation()
  const storageKey = `timetable:working-semester:${userId}`
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    try {
      const value = Number(sessionStorage.getItem(storageKey))
      return Number.isSafeInteger(value) && value > 0 ? value : null
    } catch {
      return null
    }
  })
  const routeValue = /^\/semesters\/([1-9]\d*)(?:\/|$)/.exec(pathname)?.[1]
  const routeId = routeValue && Number.isSafeInteger(Number(routeValue)) ? Number(routeValue) : null

  useEffect(() => {
    if (routeId === null) return
    setSelectedId(routeId)
    try {
      sessionStorage.setItem(storageKey, String(routeId))
    } catch {
      // Navigation still works when browser storage is unavailable.
    }
  }, [routeId, storageKey])

  return <WorkingSemesterContext value={routeId ?? selectedId}>{children}</WorkingSemesterContext>
}

export function useWorkingSemesterId() {
  return useContext(WorkingSemesterContext)
}
