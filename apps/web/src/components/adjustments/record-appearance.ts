// Type colors identify the operation; status colors describe its lifecycle.
const typeTones: Record<string, string> = {
  换课: "blue",
  改时间: "blue",
  换老师: "violet",
  换教室: "cyan",
  停课: "amber",
  安排活动: "amber",
}
const tones: Record<string, { text: string; surface: string }> = {
  blue: {
    text: "text-[var(--timetable-blue-accent)]",
    surface: "border-[var(--timetable-blue-border)] bg-[var(--timetable-blue-background)]",
  },
  violet: {
    text: "text-[var(--timetable-violet-accent)]",
    surface: "border-[var(--timetable-violet-border)] bg-[var(--timetable-violet-background)]",
  },
  cyan: {
    text: "text-[var(--timetable-cyan-accent)]",
    surface: "border-[var(--timetable-cyan-border)] bg-[var(--timetable-cyan-background)]",
  },
  amber: {
    text: "text-[var(--timetable-notice-foreground)]",
    surface: "border-[var(--timetable-amber-border)] bg-[var(--timetable-amber-background)]",
  },
  green: {
    text: "text-[var(--timetable-success-accent)]",
    surface: "border-[var(--timetable-green-border)] bg-[var(--timetable-green-background)]",
  },
}
export const recordTypeTone = (type: string) => tones[typeTones[type] ?? "blue"]

export function recordStatusColor(status: string) {
  if (["已发布", "正在生效"].includes(status)) return "text-[var(--timetable-success-accent)]"
  if (["尚未生效", "尚未确认", "已安排恢复"].includes(status))
    return "text-[var(--timetable-notice-foreground)]"
  return "text-muted-foreground"
}
