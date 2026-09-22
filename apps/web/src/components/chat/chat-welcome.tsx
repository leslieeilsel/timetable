import { CalendarDaysIcon, ClipboardCheckIcon, FilePenLineIcon } from "lucide-react"

const suggestions = [
  {
    icon: CalendarDaysIcon,
    title: "日常查询",
    description: "查老师任教课程、班级教室和课表",
    prompt: "七年级1班今天有哪些课，在哪里上？",
  },
  {
    icon: ClipboardCheckIcon,
    title: "排课检查",
    description: "看看本学期还有哪些准备项未完成",
    prompt: "请检查当前学期的排课准备情况，告诉我还有哪些准备项未完成，以及优先处理什么。",
  },
  {
    icon: FilePenLineIcon,
    title: "通知起草",
    description: "帮我写一份调课通知",
    prompt: "帮我起草一份发给教师的调课通知，先问我需要补充哪些信息。",
  },
]

export function ChatWelcomeSuggestions({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <ul aria-label="可以尝试的工作" className="mt-5 space-y-1">
      {suggestions.map(({ icon: Icon, title, description, prompt }) => (
        <li key={title}>
          <button
            type="button"
            className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-xl px-3 py-3 text-left text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 sm:grid-cols-[1rem_4.5rem_minmax(0,1fr)] sm:items-center"
            onClick={() => onSelect(prompt)}
          >
            <Icon aria-hidden className="mt-0.5 size-4 text-muted-foreground sm:mt-0" />
            <span className="font-medium">{title}</span>
            <span className="col-start-2 text-muted-foreground sm:col-start-auto">
              {description}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
