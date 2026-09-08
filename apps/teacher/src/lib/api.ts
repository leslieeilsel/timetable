export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(message: string, status: number, code: string, details: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? ""
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"])
let csrfReady = false

function endpoint(path: string) {
  return `${apiBase}${path}`
}

function cookie(name: string) {
  const value = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
  return value ? decodeURIComponent(value) : null
}

async function ensureCsrf() {
  if (csrfReady && cookie("XSRF-TOKEN")) return
  const response = await fetch(endpoint("/sanctum/csrf-cookie"), {
    credentials: "include",
    headers: { Accept: "application/json" },
  })
  if (!response.ok)
    throw new ApiError("无法初始化安全会话", response.status, "CSRF_INIT_FAILED", {})
  csrfReady = true
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request<T>(path, options, true)
}

async function request<T>(
  path: string,
  options: RequestInit,
  retryExpiredCsrf: boolean,
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase()
  if (unsafeMethods.has(method)) await ensureCsrf()
  const headers = new Headers(options.headers)
  headers.set("Accept", "application/json")
  if (unsafeMethods.has(method)) {
    const xsrf = cookie("XSRF-TOKEN")
    if (xsrf) headers.set("X-XSRF-TOKEN", xsrf)
  }
  if (options.body) headers.set("Content-Type", "application/json")

  const response = await fetch(endpoint(path), {
    ...options,
    method,
    headers,
    credentials: "include",
  })
  const isJson = response.headers.get("content-type")?.includes("application/json")
  const payload = isJson ? await response.json() : null
  if (!response.ok) {
    if (response.status === 419 && retryExpiredCsrf && unsafeMethods.has(method)) {
      csrfReady = false
      return request(path, options, false)
    }
    if (response.status === 401) window.dispatchEvent(new Event("auth:invalid"))
    throw new ApiError(
      payload?.message ?? `请求失败（${response.status}）`,
      response.status,
      payload?.code ?? "REQUEST_FAILED",
      payload ?? {},
    )
  }

  return payload?.data as T
}

export function apiMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  return "操作失败，请稍后重试"
}

export function jsonBody(value: unknown) {
  return JSON.stringify(value)
}
