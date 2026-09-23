import { useEffect, useState } from "react"
import type { Semester } from "@/lib/types"

export function schoolDate(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)!.value
  return `${part("year")}-${part("month")}-${part("day")}`
}

export function useSchoolToday(timezone = "Asia/Shanghai") {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const update = () => setNow(new Date())
    const timer = window.setInterval(update, 60_000)
    window.addEventListener("focus", update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", update)
    }
  }, [])
  return schoolDate(timezone, now)
}

export function semesterPhase(semester: Pick<Semester, "start_date" | "end_date">, today: string) {
  if (today < semester.start_date) return { value: "upcoming", label: "筹备中" } as const
  if (today > semester.end_date) return { value: "ended", label: "已结束" } as const
  return { value: "teaching", label: "教学中" } as const
}

export function calendarDaysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}
