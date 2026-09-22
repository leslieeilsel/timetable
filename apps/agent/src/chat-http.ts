import type { IncomingMessage, ServerResponse } from "node:http"
import { z } from "zod"
import {
  chatInputSchema,
  createConversationSchema,
  renameConversationSchema,
  type ChatMessage,
} from "@timetable/agent-contracts"
import type { AgentConfig } from "./config.ts"
import { BusinessApi } from "./business-api.ts"
import { AgentError, safeError } from "./errors.ts"
import { ChatStore } from "./chat-store.ts"
import { runChat, type ChatChunk, type ChatRunner } from "./chat-run.ts"
import type { ChatTitles } from "./chat-title.ts"
import type { ChatRunRecord } from "./chat-record.ts"

const uuid = "[0-9a-f-]{36}"
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  })
  response.end(JSON.stringify(body))
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
    throw new AgentError("INVALID_CONTENT_TYPE", "请求必须使用 JSON。", 415)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const data = Buffer.from(chunk as Uint8Array)
    size += data.length
    if (size > 32768) throw new AgentError("INPUT_TOO_LARGE", "消息过长，请缩短后再发。", 413)
    chunks.push(data)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  } catch {
    throw new AgentError("INVALID_INPUT", "请求格式无效。", 400)
  }
}
function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AgentError("INVALID_INPUT", "请求参数无效。", 422)
  return result.data
}

export async function handleChat(
  request: IncomingMessage,
  response: ServerResponse,
  config: AgentConfig,
  store: ChatStore,
  active: Set<AbortController>,
  titles: ChatTitles,
  chatRuns: Map<string, AbortController>,
  transport: typeof fetch = fetch,
  runner: ChatRunner = runChat,
) {
  const controller = new AbortController()
  active.add(controller)
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let turn: ReturnType<ChatStore["begin"]> | undefined
  let conversationId: string | undefined
  let persisted = false
  let runRecord: ChatRunRecord | undefined
  let lastCheckpoint = 0
  const textParts = new Map<string, number>()
  response.on("close", () => {
    if (!response.writableEnded) controller.abort()
  })
  const send = (chunk: ChatChunk) => {
    if (!response.destroyed && !response.writableEnded)
      response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  }
  const emit = (chunk: ChatChunk) => {
    if (!turn) return
    const parts = turn.assistant.parts
    if (chunk.type === "text-start") {
      textParts.set(chunk.id, parts.length)
      parts.push({ type: "text", text: "" })
    }
    if (chunk.type === "text-delta") {
      const index = textParts.get(chunk.id)
      const part = index === undefined ? undefined : parts[index]
      if (part?.type === "text") part.text += chunk.delta
    }
    if (
      chunk.type === "data-progress" ||
      chunk.type === "data-source" ||
      chunk.type === "data-activity" ||
      chunk.type === "data-text-phase"
    ) {
      const index = parts.findIndex(
        (part) => part.type === chunk.type && "id" in part && part.id === chunk.id,
      )
      const part: ChatMessage["parts"][number] = chunk
      if (index >= 0) parts[index] = part
      else parts.push(part)
    }
    // Status changes can be followed by a long, silent model request. Persist
    // them immediately so a refreshed page does not show the previous activity.
    if (
      chunk.type === "data-activity" ||
      chunk.type === "data-progress" ||
      chunk.type === "data-text-phase" ||
      Date.now() - lastCheckpoint > 300
    ) {
      store.checkpoint(turn.seq, turn.assistant)
      lastCheckpoint = Date.now()
    }
    send(chunk)
  }
  try {
    const origin =
      request.headers.origin ??
      (request.headers.referer ? new URL(request.headers.referer).origin : undefined)
    const cookie = request.headers.cookie
    const csrf = request.headers["x-xsrf-token"]
    if (
      !origin ||
      !config.origins.includes(origin) ||
      request.headers["sec-fetch-site"] === "cross-site"
    )
      throw new AgentError("ORIGIN_FORBIDDEN", "请求来源不受支持。", 403)
    if (!cookie || typeof csrf !== "string" || !csrf)
      throw new AgentError("SESSION_REQUIRED", "请登录并刷新页面后重试。", 401)
    const api = new BusinessApi(
      config.laravelBaseUrl,
      { cookie, csrf, origin },
      controller.signal,
      transport,
    )
    const cookies = await api.authenticate()
    if (cookies.length) response.setHeader("Set-Cookie", cookies)
    const owner = api.ownerId
    const url = new URL(request.url!, "http://agent.local")
    const path = url.pathname
    const listPath = "/agent/v1/conversations"
    if (path === listPath && request.method === "GET") {
      const offset = validated(
        z.coerce.number().int().min(0).max(1000000),
        url.searchParams.get("offset") ?? 0,
      )
      json(response, 200, { data: store.list(owner, offset) })
      return
    }
    if (path === listPath && request.method === "POST") {
      const input = validated(createConversationSchema, await body(request))
      if (input.semester_id) await api.request(`/api/v1/semesters/${input.semester_id}`)
      json(response, 201, { data: store.create(owner, input.semester_id) })
      return
    }
    const match = new RegExp(
      `^${listPath}/(${uuid})(?:/(messages|title|actions/(${uuid})/confirm))?$`,
    ).exec(path)
    if (!match) throw new AgentError("NOT_FOUND", "接口不存在。", 404)
    conversationId = match[1]!
    if (!match[2] && request.method === "GET") {
      const before = url.searchParams.has("before")
        ? validated(z.coerce.number().int().positive(), url.searchParams.get("before"))
        : undefined
      json(response, 200, { data: store.detail(owner, conversationId, before) })
      return
    }
    if (!match[2] && request.method === "PATCH") {
      const input = validated(renameConversationSchema, await body(request))
      const conversation = store.rename(owner, conversationId, input.title)
      titles.cancel(conversationId)
      json(response, 200, { data: conversation })
      return
    }
    if (!match[2] && request.method === "DELETE") {
      store.softDelete(owner, conversationId)
      titles.cancel(conversationId)
      chatRuns.get(conversationId)?.abort()
      json(response, 200, { data: { id: conversationId } })
      return
    }
    if (match[2] === "title" && request.method === "POST") {
      const input = validated(
        z.strictObject({ preview: z.literal(true).optional() }),
        await body(request),
      )
      const result = input.preview
        ? await titles.suggest(owner, conversationId, controller.signal)
        : await titles.rename(owner, conversationId, controller.signal)
      json(response, 200, { data: result })
      return
    }
    if (match[3] && request.method === "POST") {
      validated(z.strictObject({}), await body(request))
      const actionId = match[3]
      const action = store.lockAction(owner, conversationId, actionId)
      if (action.status === "saved") {
        json(response, 200, { data: action })
        return
      }
      try {
        // This route is deliberately absent from the model's tool set. The immutable
        // preview and idempotency key are loaded from the authenticated user's store.
        const result = await api.request(
          `/api/v1/semesters/${action.semester_id}/scheduling-constraints/bulk`,
          { constraints: action.preview.constraints },
          { etag: action.preview.etag, idempotencyKey: action.id },
        )
        const rows = z.array(z.object({ id: z.number().int().positive() })).parse(result.data)
        store.finishAction(conversationId, actionId, "saved", rows.length)
        json(response, 200, { data: store.action(owner, conversationId, actionId) })
      } catch (error) {
        const failure = safeError(error)
        // Unknown outcome is retryable with the SAME key, never re-preview or write a
        // new operation. A definite stale/rejected draft must be regenerated.
        const definitive = [404, 409, 412, 422].includes(failure.status)
        store.finishAction(conversationId, actionId, definitive ? "expired" : "confirming")
        throw error
      }
      return
    }
    if (match[2] !== "messages" || request.method !== "POST")
      throw new AgentError("NOT_FOUND", "接口不存在。", 404)
    const input = validated(chatInputSchema, await body(request))
    store.detail(owner, conversationId)
    if (!config.apiKey)
      throw new AgentError("AI_UNCONFIGURED", "AI 服务尚未启用，请联系管理员。", 503)
    turn = store.begin(owner, conversationId, input)
    chatRuns.set(conversationId, controller)
    const history = store.history(owner, conversationId)
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      "X-Accel-Buffering": "no",
      "x-vercel-ai-ui-message-stream": "v1",
    })
    response.flushHeaders()
    send({ type: "start", messageId: turn.assistant.id, messageMetadata: turn.assistant.metadata })
    if (turn.firstTurn) {
      // Naming is independent of answer delivery and also survives a stopped answer.
      void titles
        .rename(owner, conversationId)
        .then((conversation) =>
          send({ type: "data-conversation", data: conversation, transient: true }),
        )
        .catch(() => {}) // Keep the first-message fallback if this optional request fails.
    }
    send({ type: "data-conversation", data: store.get(owner, conversationId), transient: true })
    heartbeat = setInterval(() => {
      if (!response.destroyed) response.write(": heartbeat\n\n")
    }, 10000)
    const result = await runner(
      config,
      { prompt: turn.prompt, semesterId: turn.semesterId, history },
      api,
      emit,
      controller.signal,
      (record) => {
        runRecord = record
        store.checkpointRecord(turn!.seq, record)
      },
    )
    controller.signal.throwIfAborted()
    turn.assistant.parts.push(...result.parts)
    store.finish(
      conversationId,
      turn.seq,
      turn.assistant,
      result.transcript,
      true,
      runRecord?.diagnostics,
    )
    persisted = true
    for (const part of result.parts) {
      if (
        part.type === "data-proposal" ||
        part.type === "data-question" ||
        part.type === "data-explanation"
      )
        send(part)
    }
    send({ type: "finish", finishReason: "stop", messageMetadata: turn.assistant.metadata })
    response.end("data: [DONE]\n\n")
  } catch (error) {
    const failure = controller.signal.aborted
      ? new AgentError("RUN_INTERRUPTED", "回答已停止，可以继续提问或重试。", 408)
      : safeError(error)
    if (turn && conversationId && !persisted) {
      turn.assistant.parts = turn.assistant.parts.filter(
        (part) => part.type !== "data-question" && part.type !== "data-proposal",
      )
      turn.assistant.metadata = {
        ...turn.assistant.metadata,
        status: "interrupted",
        error_code: failure.code,
        error: failure.message,
      }
      store.finish(
        conversationId,
        turn.seq,
        turn.assistant,
        runRecord?.transcript ?? [],
        false,
        runRecord?.diagnostics,
      )
    }
    if (!response.destroyed) {
      if (!response.headersSent)
        json(response, failure.status, { code: failure.code, message: failure.message })
      else {
        send({
          type: "message-metadata",
          messageMetadata: {
            ...turn?.assistant.metadata,
            status: "interrupted",
            error_code: failure.code,
            error: failure.message,
          },
        })
        send({ type: "error", errorText: failure.message })
        response.end("data: [DONE]\n\n")
      }
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    controller.abort()
    active.delete(controller)
    if (conversationId && chatRuns.get(conversationId) === controller)
      chatRuns.delete(conversationId)
  }
}
