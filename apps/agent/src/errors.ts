export class AgentError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 502) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function safeError(error: unknown): AgentError {
  if (error instanceof AgentError) return error
  return new AgentError("AGENT_FAILED", "AI 暂时无法完成请求，请重试或使用原有功能。")
}
