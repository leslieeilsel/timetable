import { z } from "zod"
import { AgentError } from "./errors.ts"

export interface BusinessIdentity {
  cookie: string
  csrf: string
  origin: string
}

const identitySchema = z.object({
  id: z.number().int().positive(),
  role: z.enum(["admin", "scheduler", "viewer", "teacher"]),
  is_active: z.boolean(),
  must_change_password: z.boolean(),
})

export class BusinessApi {
  private readonly base: string
  private readonly identity: BusinessIdentity
  private readonly signal: AbortSignal
  private readonly transport: typeof fetch
  private actorId: number | undefined

  constructor(
    base: string,
    identity: BusinessIdentity,
    signal: AbortSignal,
    transport: typeof fetch = fetch,
  ) {
    this.base = base
    this.identity = identity
    this.signal = signal
    this.transport = transport
  }

  async request(
    path: string,
    body?: unknown,
    mutation?: { etag: string; idempotencyKey: string },
  ): Promise<{ data: unknown; meta: unknown; etag: string | null; cookies: string[] }> {
    if (!path.startsWith("/api/v1/") || path.includes("\\") || path.includes("..")) {
      throw new AgentError("INVALID_TOOL_PATH", "业务操作不受支持。", 400)
    }
    let response: Response
    try {
      response = await this.transport(new URL(path, this.base), {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: this.identity.cookie,
          "X-XSRF-TOKEN": this.identity.csrf,
          Origin: this.identity.origin,
          Referer: `${this.identity.origin}/`,
          ...(mutation
            ? { "If-Match": mutation.etag, "Idempotency-Key": mutation.idempotencyKey }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.any([this.signal, AbortSignal.timeout(15000)]),
      })
    } catch {
      throw new AgentError("BUSINESS_API_UNAVAILABLE", "业务服务暂时不可用，请稍后重试。", 503)
    }
    if ([401, 403, 419].includes(response.status)) {
      throw new AgentError(
        response.status === 419 ? "CSRF_EXPIRED" : "SESSION_INVALID",
        "登录状态已失效或无权访问，请刷新页面。",
        response.status,
      )
    }
    if (response.status === 404) {
      throw new AgentError(
        "BUSINESS_RECORD_NOT_FOUND",
        "请求的业务记录不存在，请通过列表查询核实对象后重试。",
        404,
      )
    }
    let payload: { data?: unknown; meta?: unknown; message?: unknown }
    try {
      payload = await response.json()
    } catch {
      throw new AgentError("BUSINESS_RESPONSE_INVALID", "业务服务返回了无效响应。")
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload))
      throw new AgentError("BUSINESS_RESPONSE_INVALID", "业务服务返回了无效响应。")
    if (!response.ok) {
      // Never forward upstream exception bodies or request/config objects to the model/browser.
      const message =
        response.status < 500 && typeof payload.message === "string"
          ? payload.message.slice(0, 300)
          : "业务服务暂时无法完成操作。"
      throw new AgentError("BUSINESS_VALIDATION_FAILED", message, response.status)
    }
    if (!Object.hasOwn(payload, "data"))
      throw new AgentError("BUSINESS_RESPONSE_INVALID", "业务服务响应缺少数据字段。")
    return {
      data: payload.data,
      meta: payload.meta,
      etag: response.headers.get("ETag"),
      cookies: response.headers.getSetCookie(),
    }
  }

  get ownerId(): number {
    if (this.actorId === undefined) throw new AgentError("SESSION_REQUIRED", "请先登录。", 401)
    return this.actorId
  }

  async authenticate(): Promise<string[]> {
    const response = await this.request("/api/v1/auth/session-check", {})
    const parsed = identitySchema.safeParse(response.data)
    if (!parsed.success) throw new AgentError("SESSION_INVALID", "无法验证当前登录状态。", 401)
    const user = parsed.data
    if (
      !user.is_active ||
      user.must_change_password ||
      !["admin", "scheduler"].includes(user.role)
    ) {
      throw new AgentError("FORBIDDEN", "当前账号无权使用教务助手。", 403)
    }
    if (this.actorId !== undefined && this.actorId !== user.id) {
      throw new AgentError("SESSION_CHANGED", "登录用户已变化，请重新发起请求。", 401)
    }
    this.actorId = user.id
    return response.cookies
  }
}
