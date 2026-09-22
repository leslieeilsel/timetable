import { Agent } from "@earendil-works/pi-agent-core"
import { createModels } from "@earendil-works/pi-ai"
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek"
import { agentEventSchema, type AgentEvent, type RunInput } from "@timetable/agent-contracts"
import type { BusinessApi } from "./business-api.ts"
import { modelOutputLimit, type AgentConfig } from "./config.ts"
import { AgentError } from "./errors.ts"
import { createTools, type ResultCollector } from "./tools.ts"
import { ModelData } from "./model-data.ts"
import { chatSystemPrompt } from "./chat-prompt.ts"

export type RunScenario = (
  config: AgentConfig,
  input: RunInput,
  api: BusinessApi,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
) => Promise<void>

export const runScenario: RunScenario = async (config, input, api, emit, signal) => {
  const models = createModels()
  models.setProvider(deepseekProvider())
  const model = models.getModel("deepseek", config.model)
  if (!model) throw new AgentError("MODEL_UNAVAILABLE", "AI 模型配置暂不可用，请联系管理员。", 503)
  const collector: ResultCollector = { result: null, evidence: new Map(), headline: "" }
  const modelData = new ModelData([], input.semester_id)
  const tools = modelData.tools(createTools(input, api, collector))
  const agent = new Agent({
    convertToLlm: modelData.toMessages,
    initialState: {
      model,
      tools,
      thinkingLevel: model.reasoning ? config.thinkingLevel : "off",
      systemPrompt: [
        chatSystemPrompt(model, input.semester_id),
        "当前入口使用结构化结果卡片。按工具说明准备规则预览或整理诊断说明；缺少关键信息或存在未支持的需求时，通过询问工具交由用户决定。",
      ].join("\n"),
    },
    streamFn: (selected, context, options) =>
      models.streamSimple(selected, context, {
        ...options,
        apiKey: config.apiKey,
        maxTokens: modelOutputLimit(selected, config.maxTokens),
        maxRetries: 0,
      }),
    toolExecution: "sequential",
    beforeToolCall: async () => {
      signal.throwIfAborted()
      await api.authenticate()
      return collector.result ? { block: true, reason: "结果已完成。", terminate: true } : undefined
    },
    afterToolCall: async ({ result }) =>
      result.details?.status === "error" ? { isError: true } : undefined,
    shouldStopAfterTurn: () => collector.result !== null,
  })
  const cancel = () => agent.abort()
  signal.addEventListener("abort", cancel, { once: true })
  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      const label = tools.find((tool) => tool.name === event.toolName)?.label
      if (label) emit({ type: "progress", message: label })
    }
  })
  try {
    signal.throwIfAborted()
    await agent.prompt(
      input.feature === "constraint_draft"
        ? input.input
        : "请解释本次指定排课任务的失败原因，并给出待验证的建议。",
    )
    signal.throwIfAborted()
    await api.authenticate()
    if (agent.state.errorMessage)
      throw new AgentError("MODEL_REQUEST_FAILED", "AI 服务暂时不可用，请稍后重试或联系管理员。")
    if (!collector.result)
      throw new AgentError("AI_OUTPUT_INVALID", "AI 未能生成有效结果，请补充具体要求后重试。")
    emit(agentEventSchema.parse(collector.result))
  } finally {
    signal.removeEventListener("abort", cancel)
    agent.abort()
  }
}
