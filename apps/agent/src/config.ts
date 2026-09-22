import { z } from "zod"

// DeepSeek documents 384K as 384 * 1024. pi 0.86.1 lists 384000 instead.
export const deepseekMaxOutputTokens = 393216

export function modelOutputLimit(model: { id: string; maxTokens: number }, requested: number) {
  const limit = ["deepseek-flash", "deepseek-v4-pro"].includes(model.id)
    ? deepseekMaxOutputTokens
    : model.maxTokens
  return Math.min(requested, limit)
}

const positive = (fallback: number, max: number) =>
  z.coerce.number().int().positive().max(max).default(fallback)
const environment = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: positive(8010, 65535),
  PUBLIC_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  LARAVEL_BASE_URL: z.url().default("http://127.0.0.1:8000"),
  DEEPSEEK_API_KEY: z.string().trim().default(""),
  DEEPSEEK_MODEL: z.string().default("deepseek-flash"),
  DEEPSEEK_THINKING_LEVEL: z.enum(["off", "low", "high", "max"]).default("max"),
  DEEPSEEK_MAX_TOKENS: positive(deepseekMaxOutputTokens, deepseekMaxOutputTokens),
  AGENT_DATABASE_PATH: z.string().min(1).default("storage/chat.sqlite"),
})

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = environment.safeParse(env)
  if (!parsed.success) throw new Error("Agent 配置无效，请检查 .env.example 中的配置项。")
  const values = parsed.data
  const origins = values.PUBLIC_ORIGINS.split(",").map((value) => value.trim())
  const base = new URL(values.LARAVEL_BASE_URL)
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new Error("LARAVEL_BASE_URL 必须是固定的 HTTP(S) 地址。")
  }
  for (const origin of origins) {
    if (new URL(origin).origin !== origin)
      throw new Error("PUBLIC_ORIGINS 必须包含完整的站点 origin。")
  }
  return {
    host: values.HOST,
    port: values.PORT,
    origins,
    laravelBaseUrl: base.origin,
    apiKey: values.DEEPSEEK_API_KEY,
    model: values.DEEPSEEK_MODEL,
    thinkingLevel: values.DEEPSEEK_THINKING_LEVEL,
    maxTokens: values.DEEPSEEK_MAX_TOKENS,
    databasePath: values.AGENT_DATABASE_PATH,
  }
}

export type AgentConfig = ReturnType<typeof readConfig>
