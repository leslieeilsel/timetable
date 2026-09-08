import { differenceInMinutes, isSameDay, parseISO } from "date-fns"

import type { TimetableRow } from "@/lib/types"

export type LessonTiming = "completed" | "ongoing" | "upcoming"

export function lessonTiming(row: TimetableRow, now = new Date()): LessonTiming {
  const start = parseISO(`${row.date}T${row.start_time}`)
  const end = parseISO(`${row.date}T${row.end_time}`)

  if (now >= end) return "completed"
  if (now >= start) return "ongoing"
  return "upcoming"
}

export function lessonStartHint(row: TimetableRow, now = new Date()) {
  const timing = lessonTiming(row, now)
  if (timing === "ongoing") return "正在上课"
  if (timing === "completed") return "已结束"

  const start = parseISO(`${row.date}T${row.start_time}`)
  const minutes = differenceInMinutes(start, now)

  if (!isSameDay(start, now)) {
    return `${row.date.slice(5).replace("-", "月")}日 ${row.start_time.slice(0, 5)}`
  }
  if (minutes < 1) return "即将开始"
  if (minutes < 60) return `${minutes}分钟后`
  if (minutes < 120) {
    const remainder = minutes % 60
    return remainder ? `1小时${remainder}分钟后` : "1小时后"
  }
  const hour = Number(row.start_time.slice(0, 2))
  const period = hour < 12 ? "上午" : hour < 18 ? "下午" : "晚上"
  return `今天${period}`
}

export function rowStatus(row: TimetableRow) {
  if (row.duty_status === "removed") {
    return { label: row.is_cancelled ? "已取消" : "已调出", variant: "destructive" as const }
  }
  if (row.duty_status === "added") {
    return { label: "临时代课", variant: "secondary" as const }
  }
  const labels: Record<string, string> = {
    moved_in: "临时调入",
    moved_out: "已调出",
    substitution: "代课安排",
    teacher_change: "教师调整",
    room_change: "教室调整",
    cancel: "已停课",
    activity: "临时活动",
    makeup: "临时补课",
    swap: "临时换课",
  }
  return row.status === "base"
    ? null
    : {
        label: labels[row.status] ?? "临时调整",
        variant: row.is_cancelled ? ("destructive" as const) : ("secondary" as const),
      }
}
