import { Agent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core"
import { createModels, Type, type ToolCall } from "@earendil-works/pi-ai"
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek"
import type { UIMessageChunk } from "ai"
import type { ChatData, ChatMessage, ChatMetadata, ChatTextPhase } from "@timetable/agent-contracts"
import { modelOutputLimit, type AgentConfig } from "./config.ts"
import type { BusinessApi } from "./business-api.ts"
import { AgentError, safeError } from "./errors.ts"
import { ChatRecorder, type ChatRunRecord } from "./chat-record.ts"
import { createChatTools, type ChatCollector } from "./chat-tools.ts"
import { chatSystemPrompt } from "./chat-prompt.ts"
import { ModelData } from "./model-data.ts"
import { ChatTextStream, finalAnswerToolName, rawAssistantText, isFinalText } from "./chat-text.ts"

export type ChatChunk = UIMessageChunk<ChatMetadata, ChatData>
export type ChatRunner = (
  config: AgentConfig,
  input: { prompt: string; semesterId: number | null; history: AgentMessage[] },
  api: BusinessApi,
  emit: (chunk: ChatChunk) => void,
  signal: AbortSignal,
  record?: (record: ChatRunRecord) => void,
) => Promise<{ parts: ChatMessage["parts"]; transcript: AgentMessage[] }>

type TextSlot = { id: string; index: number; text: string; ended: boolean }

export const runChat: ChatRunner = async (config, input, api, emit, signal, record) => {
  const recorder = new ChatRecorder(config, record)
  const models = createModels()
  models.setProvider(deepseekProvider())
  const model = models.getModel("deepseek", config.model)
  if (!model) throw new AgentError("MODEL_UNAVAILABLE", "AI 模型配置暂不可用，请联系管理员。", 503)
  const collector: ChatCollector = { terminal: false, parts: [] }
  const modelData = new ModelData(input.history, input.semesterId)
  let textNumber = 0
  let received = ""
  let decoder = new ChatTextStream()
  let commentary: TextSlot | undefined
  let finalSlot: TextSlot | undefined
  let finalCallId: string | undefined
  let finalCommitted = false
  let repairingDelivery = false
  let activity: ChatData["activity"]["status"] | undefined

  const setActivity = (status: ChatData["activity"]["status"]) => {
    if (activity === status) return
    activity = status
    emit({ type: "data-activity", id: "activity", data: { status } })
  }
  const markText = (slot: TextSlot, phase: ChatTextPhase) =>
    emit({ type: "data-text-phase", id: slot.id, data: { text_index: slot.index, phase } })
  const startText = (phase: ChatTextPhase): TextSlot => {
    const index = textNumber++
    const slot = { id: "text-" + (index + 1), index, text: "", ended: false }
    // Announce final placement before any answer text, even while arguments are empty.
    markText(slot, phase)
    emit({ type: "text-start", id: slot.id })
    return slot
  }
  const append = (slot: TextSlot, delta: string) => {
    if (!delta || slot.ended) return
    setActivity("responding")
    slot.text += delta
    emit({ type: "text-delta", id: slot.id, delta })
  }
  const endText = (slot: TextSlot | undefined) => {
    if (!slot || slot.ended) return
    slot.ended = true
    emit({ type: "text-end", id: slot.id })
  }
  const appendCommentary = (delta: string) => {
    if (!delta) return
    commentary ??= startText("commentary")
    append(commentary, delta)
  }
  const receiveText = (delta: string) => {
    received += delta
    // Strip old prefixes copied from history; they no longer select display phases.
    const decoded = decoder.push(delta)
    if (decoded) appendCommentary(decoded.delta)
  }
  const receiveFinal = (call: ToolCall) => {
    if (finalCallId && finalCallId !== call.id) return
    finalCallId = call.id
    endText(commentary)
    finalSlot ??= startText("final_answer")
    const answer = call.arguments.answer
    if (typeof answer !== "string" || !answer.startsWith(finalSlot.text)) return
    // pi decodes streaming JSON; never expose partial JSON or dangling surrogate pairs.
    const stable = /[\uD800-\uDBFF]$/.test(answer) ? answer.slice(0, -1) : answer
    append(finalSlot, stable.slice(finalSlot.text.length))
  }
  const invalidateFinal = () => {
    if (finalSlot) {
      markText(finalSlot, "unknown")
      endText(finalSlot)
    }
    finalSlot = undefined
    finalCallId = undefined
  }
  const finalTool: AgentTool = {
    name: finalAnswerToolName,
    label: "提交答复",
    description:
      "向用户提交本轮最终答复并结束任务。answer 是你自主组织的完整 Markdown 答复，界面会流式显示它。确认不再需要查询后单独调用，不与其他工具一起调用；无需查询的问题也使用此工具。不在普通正文重复最终答复。",
    parameters: Type.Object(
      { answer: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
    async execute(callId, args) {
      const answer = (args as { answer: string }).answer
      if (!answer.trim() || (finalCallId && callId !== finalCallId))
        throw new AgentError("AI_OUTPUT_INCOMPLETE", "本次未能生成完整回答，请重试。")
      receiveFinal({
        type: "toolCall",
        id: callId,
        name: finalAnswerToolName,
        arguments: { answer },
      })
      if (finalSlot?.text !== answer)
        throw new AgentError("AI_OUTPUT_INCOMPLETE", "答复传输不完整，请重试。")
      endText(finalSlot)
      finalCommitted = true
      collector.terminal = true
      return { content: [{ type: "text", text: "答复已提交。" }], details: {}, terminate: true }
    },
  }
  const tools = [
    ...modelData.tools(
      createChatTools(
        api,
        collector,
        (source) => emit({ type: "data-source", id: source.id, data: source }),
        input.semesterId,
      ),
    ),
    finalTool,
  ]
  const agent = new Agent({
    convertToLlm: modelData.toMessages,
    initialState: {
      model,
      tools,
      messages: input.history.filter((message) => message.role !== "system"),
      thinkingLevel: model.reasoning ? config.thinkingLevel : "off",
      systemPrompt: chatSystemPrompt(model, input.semesterId),
    },
    streamFn: (selected, context, options) => {
      const maxTokens = modelOutputLimit(selected, config.maxTokens)
      recorder.modelStart(selected.id, maxTokens, repairingDelivery)
      return models.streamSimple(selected, context, {
        ...options,
        apiKey: config.apiKey,
        // Reasoning and answer share this ceiling; pi also fits it to remaining context.
        maxTokens,
        maxRetries: 0,
        ...(repairingDelivery ? { reasoning: undefined } : {}),
        onPayload: (payload: unknown) => {
          const request = repairingDelivery
            ? {
                ...(payload as Record<string, unknown>),
                // Named tool choice requires thinking off, only for delivery repair.
                thinking: { type: "disabled" },
                reasoning_effort: undefined,
                tool_choice: { type: "function", function: { name: finalAnswerToolName } },
              }
            : payload
          recorder.payload(request)
          return request
        },
        onResponse: (response) => recorder.response(response.status),
      })
    },
    toolExecution: "sequential",
    beforeToolCall: async ({ assistantMessage }) => {
      signal.throwIfAborted()
      await api.authenticate()
      if (collector.terminal)
        return { block: true, reason: "本轮已结束，等待用户。", terminate: true }
      const calls = assistantMessage.content.filter((part) => part.type === "toolCall")
      if (calls.some((call) => call.name === finalAnswerToolName) && calls.length !== 1) {
        invalidateFinal()
        return { block: true, reason: "最终答复须在查询结束后单独提交；请先完成所需查询。" }
      }
      return undefined
    },
    afterToolCall: async ({ toolCall, result, isError }) => {
      if (toolCall.name === finalAnswerToolName && isError) invalidateFinal()
      return result.details?.status === "error" ? { isError: true } : undefined
    },
    shouldStopAfterTurn: ({ message }) => {
      if (collector.terminal) return true
      if (isFinalText(message)) {
        if (repairingDelivery)
          throw new AgentError("AI_OUTPUT_INCOMPLETE", "本次未能提交完整回答，请重试。")
        repairingDelivery = true
        agent.steer({
          role: "system",
          timestamp: Date.now(),
          content:
            "将刚才已经完成的答复通过 " +
            finalAnswerToolName +
            " 的 answer 提交。仅修复交付格式，保留已核实的事实和信息缺口，不新增查询或编造内容。",
        })
      }
      return false
    },
  })
  const cancel = () => agent.abort()
  signal.addEventListener("abort", cancel, { once: true })
  agent.subscribe((event) => {
    if (event.type === "message_end") recorder.messageEnd(event.message)
    if (event.type === "message_update") recorder.firstEvent()
    if (event.type === "tool_execution_start") recorder.toolStart(event.toolCallId, event.toolName)
    if (event.type === "turn_start") setActivity("waiting")
    if (event.type === "message_start" && event.message.role === "assistant") {
      endText(commentary)
      received = ""
      decoder = new ChatTextStream()
      commentary = undefined
      setActivity("waiting")
    }
    if (event.type === "message_update" && event.message.role === "assistant") {
      const update = event.assistantMessageEvent
      if (update.type === "text_delta") receiveText(update.delta)
      if (update.type === "thinking_start" || update.type === "thinking_delta")
        setActivity("thinking")
      if (update.type === "thinking_end" || update.type === "text_end") setActivity("waiting")
      if (
        update.type === "toolcall_start" ||
        update.type === "toolcall_delta" ||
        update.type === "toolcall_end"
      ) {
        const call = event.message.content[update.contentIndex]
        if (call?.type === "toolCall" && call.name === finalAnswerToolName) receiveFinal(call)
        else setActivity("tool")
      }
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const message = event.message
      const text = rawAssistantText(message)
      if (text.startsWith(received)) receiveText(text.slice(received.length))
      const decoded = decoder.finish()
      if (decoded) appendCommentary(decoded.delta)
      endText(commentary)
      for (const call of message.content)
        if (call.type === "toolCall" && call.name === finalAnswerToolName) receiveFinal(call)
      if (
        message.stopReason === "length" ||
        message.stopReason === "error" ||
        message.stopReason === "aborted"
      )
        invalidateFinal()
      setActivity("waiting")
    }
    if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
      if (event.toolName === finalAnswerToolName) {
        if (event.type === "tool_execution_end" && event.isError) invalidateFinal()
        return
      }
      if (event.type === "tool_execution_start") setActivity("tool")
      emit({
        type: "data-progress",
        id: event.toolCallId,
        data: {
          label: tools.find((tool) => tool.name === event.toolName)?.label ?? "处理请求",
          status:
            event.type === "tool_execution_start"
              ? "running"
              : event.isError
                ? "error"
                : "complete",
        },
      })
      if (event.type === "tool_execution_end") setActivity("waiting")
    }
  })
  try {
    signal.throwIfAborted()
    await agent.prompt(input.prompt)
    signal.throwIfAborted()
    await api.authenticate()
    signal.throwIfAborted()
    const lastResponse = recorder.record.transcript.findLast(
      (message) => message.role === "assistant",
    )
    if (lastResponse?.role === "assistant" && lastResponse.stopReason === "length")
      throw new AgentError(
        "MODEL_OUTPUT_LIMIT",
        "本次请求达到输出或上下文 token 上限，回答未完成。可以继续提问或重试。",
      )
    if (agent.state.errorMessage)
      throw new AgentError("MODEL_REQUEST_FAILED", "AI 服务暂时不可用，请稍后重试或联系管理员。")
    if (!collector.terminal || (finalCallId && !finalCommitted))
      throw new AgentError("AI_OUTPUT_INCOMPLETE", "本次未能生成完整回答，请重试。")
    recorder.finish()
    return {
      parts: collector.parts,
      transcript: recorder.record.transcript,
    }
  } catch (error) {
    recorder.finish(signal.aborted ? "RUN_INTERRUPTED" : safeError(error).code)
    invalidateFinal()
    throw error
  } finally {
    endText(commentary)
    signal.removeEventListener("abort", cancel)
    agent.abort()
  }
}
