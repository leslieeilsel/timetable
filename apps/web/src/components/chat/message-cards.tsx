import { useState } from "react"
import { CheckIcon, LoaderCircleIcon } from "lucide-react"
import type { ChatQuestion, ChatInput, ChatProposal, Explanation } from "@timetable/agent-contracts"
import { confirmProposal } from "@/lib/chat"
import { Button } from "@/components/ui/button"
import {
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireTitle,
  QuestionnaireChoices,
  QuestionnaireChoice,
  QuestionnaireInput,
  QuestionnaireError,
  QuestionnaireActions,
  QuestionnairePrevious,
  QuestionnaireNext,
  QuestionnaireSubmit,
} from "@/components/ui/questionnaire"

export function QuestionCard({
  question,
  disabled,
  onAnswer,
}: {
  question: ChatQuestion
  disabled: boolean
  onAnswer: (text: string, answer: NonNullable<ChatInput["answer"]>) => void
}) {
  if (question.status !== "pending")
    return (
      <div className="rounded-xl border p-4 text-sm text-muted-foreground">
        {question.status === "answered" ? "已回答补充问题" : "已跳过补充问题"}
      </div>
    )
  return (
    <div className="rounded-2xl border bg-muted/20 p-5">
      <p className="mb-4 text-xs font-medium text-muted-foreground">补充信息</p>
      <Questionnaire
        items={question.items.map((item) => ({
          name: item.id,
          disabled,
          required: true,
          choices: item.choices,
        }))}
        onSubmit={(event) => {
          event.preventDefault()
          if (disabled) return
          const form = new FormData(event.currentTarget)
          const values = Object.fromEntries(
            question.items.map((item) => [
              item.id,
              form
                .getAll(item.id)
                .map(String)
                .map((v) => v.trim())
                .filter(Boolean),
            ]),
          )
          const text = question.items
            .map(
              (item) =>
                `${item.prompt}：${values[item.id]!.map((value) => item.choices.find((choice) => choice.value === value)?.label ?? value).join("、")}`,
            )
            .join("\n")
          onAnswer(text, { question_id: question.id, values })
        }}
      >
        {question.items.length > 1 && (
          <p className="text-xs text-muted-foreground">共 {question.items.length} 个问题</p>
        )}
        {question.items.map((item) => (
          <QuestionnaireItem
            key={item.id}
            name={item.id}
            multiple={item.multiple}
            required
            disabled={disabled}
          >
            <QuestionnaireTitle>{item.prompt}</QuestionnaireTitle>
            {item.choices.length > 0 && (
              <QuestionnaireChoices>
                {item.choices.map((choice) => (
                  <QuestionnaireChoice key={choice.value} value={choice.value}>
                    {choice.label}
                  </QuestionnaireChoice>
                ))}
              </QuestionnaireChoices>
            )}
            {item.allow_text && (
              <QuestionnaireInput
                aria-label={`${item.prompt}，自由填写`}
                placeholder="也可以直接填写…"
                maxLength={1000}
              />
            )}
            <QuestionnaireError>请选择或填写答案。</QuestionnaireError>
          </QuestionnaireItem>
        ))}
        <QuestionnaireActions>
          <QuestionnairePrevious>上一项</QuestionnairePrevious>
          <QuestionnaireNext>下一项</QuestionnaireNext>
          <QuestionnaireSubmit disabled={disabled}>提交并继续</QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
      <p className="mt-3 text-xs text-muted-foreground">
        也可以直接在下方输入新要求，跳过这组问题。
      </p>
    </div>
  )
}

export function ProposalCard({
  proposal,
  conversationId,
  disabled,
  onSaved,
  onBusy,
}: {
  proposal: ChatProposal
  conversationId: string
  disabled: boolean
  onSaved: () => Promise<void>
  onBusy: (busy: boolean) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState<ChatProposal | null>(null)
  const action = saved ?? proposal
  return (
    <div className="rounded-2xl border bg-muted/20 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {action.status === "saved" ? "规则草稿已保存" : "规则草稿 · 待确认"}
        </h3>
        <span className="text-xs text-muted-foreground">
          {action.preview.constraints.length} 条
        </span>
      </div>
      <ol className="space-y-3 text-sm">
        {action.preview.summaries.map((summary, index) => (
          <li key={index} className="flex gap-2">
            <span className="text-muted-foreground">{index + 1}.</span>
            <span>{summary}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 border-t pt-4">
        {action.status === "saved" ? (
          <p className="flex items-center gap-2 text-sm">
            <CheckIcon className="size-4 text-emerald-600" />
            已保存 {action.saved_count} 条草稿，尚未启用。
          </p>
        ) : action.status === "expired" ? (
          <p className="text-sm text-muted-foreground">
            已有新要求或业务数据变化，这份草稿已失效。
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              {action.status === "confirming"
                ? "上次保存结果尚待确认，重试会核对同一笔操作。"
                : "确认后保存为规则草稿。想修改内容，可以在下方继续描述。"}
            </p>
            <Button
              disabled={disabled || saving}
              onClick={async () => {
                setSaving(true)
                onBusy(true)
                setError("")
                try {
                  setSaved(await confirmProposal(conversationId, action.id))
                  await onSaved()
                } catch (error) {
                  setError(error instanceof Error ? error.message : "保存失败，请重试。")
                  await onSaved()
                } finally {
                  setSaving(false)
                  onBusy(false)
                }
              }}
            >
              {saving && <LoaderCircleIcon className="animate-spin" />}
              {action.status === "confirming" ? "重试确认保存结果" : "确认保存草稿"}
            </Button>
          </>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

export function ExplanationCard({ explanation }: { explanation: Explanation }) {
  return (
    <div className="space-y-4 rounded-2xl border p-5 text-sm">
      <p className="font-medium">{explanation.headline}</p>
      {explanation.findings.map((finding, index) => (
        <div key={index}>
          <p>{finding.explanation}</p>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">查看原始依据 · {finding.evidence_id}</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3">
              {finding.fact}
            </pre>
          </details>
        </div>
      ))}
      {explanation.suggestions.length > 0 && (
        <div className="border-t pt-3">
          <p className="mb-2 text-xs text-muted-foreground">待验证的建议</p>
          <ul className="list-disc space-y-1 pl-4">
            {explanation.suggestions.map((suggestion) => (
              <li key={suggestion}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
