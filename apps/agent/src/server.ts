import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import { runInputSchema, type AgentEvent } from "@timetable/agent-contracts"
import { readConfig, type AgentConfig } from "./config.ts"
import { BusinessApi } from "./business-api.ts"
import { AgentError, safeError } from "./errors.ts"
import { runScenario, type RunScenario } from "./run.ts"
import { ChatStore } from "./chat-store.ts"
import { handleChat } from "./chat-http.ts"
import type { ChatRunner } from "./chat-run.ts"
import { ChatTitles, type TitleGenerator } from "./chat-title.ts"

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  })
  response.end(JSON.stringify(body))
}

async function readBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let failed = false
    const abort = () => {
      failed = true
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    request.once("close", () => signal.removeEventListener("abort", abort))
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 32768) {
        failed = true
        reject(new AgentError("INPUT_TOO_LARGE", "请求内容过长，请缩短后重试。", 413))
      } else if (!failed) chunks.push(chunk)
    })
    request.on("end", () => {
      if (failed) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        reject(new AgentError("INVALID_INPUT", "请求格式无效。", 400))
      }
    })
    request.on("error", reject)
  })
}

export function createAgentServer(
  config: AgentConfig,
  runner: RunScenario = runScenario,
  transport: typeof fetch = fetch,
  chatRunner?: ChatRunner,
  titleGenerator?: TitleGenerator,
) {
  const active = new Set<AbortController>()
  const chatRuns = new Map<string, AbortController>()
  let chatStore: ChatStore | undefined
  let chatTitles: ChatTitles | undefined
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/agent/health") {
      json(response, 200, { data: { status: config.apiKey ? "ready" : "unconfigured" } })
      return
    }
    if (request.url?.startsWith("/agent/v1/conversations")) {
      try {
        chatStore ??= new ChatStore(config.databasePath)
        chatTitles ??= new ChatTitles(config, chatStore, active, titleGenerator)
      } catch {
        json(response, 503, {
          code: "CHAT_STORAGE_UNAVAILABLE",
          message: "对话存储暂时不可用，请联系管理员。",
        })
        return
      }
      await handleChat(
        request,
        response,
        config,
        chatStore,
        active,
        chatTitles,
        chatRuns,
        transport,
        chatRunner,
      )
      return
    }
    if (request.method !== "POST" || request.url !== "/agent/v1/runs") {
      json(response, 404, { code: "NOT_FOUND", message: "接口不存在。" })
      return
    }
    const controller = new AbortController()
    active.add(controller)
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let sequence = 0
    const emit = (event: AgentEvent) => {
      if (!response.destroyed && !response.writableEnded) {
        response.write(`id: ${++sequence}\ndata: ${JSON.stringify(event)}\n\n`)
      }
    }
    response.on("close", () => {
      if (!response.writableEnded) controller.abort()
    })
    try {
      const origin = request.headers.origin
      const cookie = request.headers.cookie
      const csrf = request.headers["x-xsrf-token"]
      if (
        !origin ||
        !config.origins.includes(origin) ||
        request.headers["sec-fetch-site"] === "cross-site"
      ) {
        throw new AgentError("ORIGIN_FORBIDDEN", "请求来源不受支持。", 403)
      }
      if (!cookie || typeof csrf !== "string" || !csrf)
        throw new AgentError("SESSION_REQUIRED", "请登录并刷新页面后重试。", 401)
      if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
        throw new AgentError("INVALID_CONTENT_TYPE", "请求必须使用 JSON 格式。", 415)
      }
      const input = runInputSchema.safeParse(await readBody(request, controller.signal))
      if (!input.success) throw new AgentError("INVALID_INPUT", "请检查学期、需求和任务参数。", 422)
      const api = new BusinessApi(
        config.laravelBaseUrl,
        { cookie, csrf, origin },
        controller.signal,
        transport,
      )
      const cookies = await api.authenticate()
      if (!config.apiKey)
        throw new AgentError("AI_UNCONFIGURED", "AI 服务尚未启用，请联系管理员。", 503)
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store",
        "X-Accel-Buffering": "no",
        ...(cookies.length ? { "Set-Cookie": cookies } : {}),
      })
      response.flushHeaders()
      emit({ type: "run.started", run_id: randomUUID() })
      heartbeat = setInterval(() => {
        if (!response.destroyed) response.write(": heartbeat\n\n")
      }, 10000)
      await runner(config, input.data, api, emit, controller.signal)
      controller.signal.throwIfAborted()
      emit({ type: "run.completed" })
      response.end()
    } catch (error) {
      const failure = controller.signal.aborted
        ? new AgentError("RUN_INTERRUPTED", "请求已中止，请重试。", 408)
        : safeError(error)
      if (!response.destroyed) {
        if (response.headersSent) {
          emit({ type: "run.error", code: failure.code, message: failure.message })
          response.end()
        } else json(response, failure.status, { code: failure.code, message: failure.message })
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat)
      controller.abort()
      active.delete(controller)
    }
  })
  server.on("close", () => {
    for (const controller of active) controller.abort()
    // Active handlers finish their SQLite checkpoints before closing the store.
    if (active.size === 0) chatStore?.close()
  })
  return {
    server,
    abortAll: () => {
      for (const controller of active) controller.abort()
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = readConfig()
    const { server, abortAll } = createAgentServer(config)
    server.listen(config.port, config.host, () =>
      process.stdout.write(`Timetable Agent listening on ${config.host}:${config.port}\n`),
    )
    server.on("error", () => {
      process.stderr.write("Agent 启动失败，请检查监听地址和端口。\n")
      process.exitCode = 1
    })
    const stop = () => {
      abortAll()
      server.close()
      server.closeIdleConnections()
    }
    process.once("SIGTERM", stop)
    process.once("SIGINT", stop)
  } catch {
    process.stderr.write("Agent 配置无效，请检查服务端配置。\n")
    process.exitCode = 1
  }
}
