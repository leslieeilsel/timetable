import { Link } from "react-router"
import { SparklesIcon } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { buttonVariants } from "@/components/ui/button"

/** Context entry points only prefill the chat composer; navigation never calls the model. */
export function AiAssistantButton({
  semesterId,
  scheduleRunId,
}: {
  semesterId: number | null
  scheduleRunId?: number
}) {
  const { user } = useAuth()
  if (!semesterId || !user || !["admin", "scheduler"].includes(user.role)) return null
  const query = new URLSearchParams({
    semester_id: String(semesterId),
    prompt: scheduleRunId
      ? `请解释学期 ${semesterId} 中排课任务 #${scheduleRunId} 的失败原因，并给出建议。`
      : "我想添加一条排课规则：",
  })
  return (
    <Link className={buttonVariants({ variant: "outline" })} to={`/ai?${query}`}>
      <SparklesIcon />
      {scheduleRunId ? "AI 解释原因" : "AI 添加规则"}
    </Link>
  )
}
