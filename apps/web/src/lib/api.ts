import type { ApiEnvelope } from "@/lib/types"

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

export interface ApiResult<T> extends ApiEnvelope<T> {
  etag: string | null
}

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"])
let csrfReady = false

function cookie(name: string) {
  const value = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
  return value ? decodeURIComponent(value) : null
}

async function ensureCsrf() {
  if (csrfReady && cookie("XSRF-TOKEN")) return
  const response = await fetch("/sanctum/csrf-cookie", {
    credentials: "include",
    headers: { Accept: "application/json" },
  })
  if (!response.ok)
    throw new ApiError("无法初始化安全会话", response.status, "CSRF_INIT_FAILED", {})
  csrfReady = true
}

export async function api<T>(
  path: string,
  options: RequestInit & { etag?: string | null; formData?: boolean } = {},
): Promise<ApiResult<T>> {
  return request<T>(path, options, true)
}

export async function apiAllPages<T>(path: string): Promise<ApiResult<T[]>> {
  const url = new URL(path, window.location.origin)
  url.searchParams.set("per_page", "100")
  let page = 1
  let lastPage = 1
  let etag: string | null = null
  let meta: Record<string, unknown> | undefined
  const items: T[] = []
  do {
    url.searchParams.set("page", String(page))
    const result = await api<T[]>(`${url.pathname}${url.search}`)
    items.push(...result.data)
    etag = result.etag
    meta = result.meta
    const pagination = result.meta?.pagination
    lastPage =
      pagination && typeof pagination === "object" && "last_page" in pagination
        ? Number(pagination.last_page) || 1
        : 1
    page += 1
  } while (page <= lastPage)

  return { data: items, etag, meta }
}

async function request<T>(
  path: string,
  options: RequestInit & { etag?: string | null; formData?: boolean },
  retryExpiredCsrf: boolean,
): Promise<ApiResult<T>> {
  const method = (options.method ?? "GET").toUpperCase()
  if (unsafeMethods.has(method)) await ensureCsrf()

  const headers = new Headers(options.headers)
  headers.set("Accept", "application/json")
  if (unsafeMethods.has(method)) {
    const xsrf = cookie("XSRF-TOKEN")
    if (xsrf) headers.set("X-XSRF-TOKEN", xsrf)
  }
  if (options.etag) headers.set("If-Match", options.etag)
  if (options.body && !options.formData) headers.set("Content-Type", "application/json")

  const response = await fetch(path, { ...options, method, headers, credentials: "include" })
  const isJson = response.headers.get("content-type")?.includes("application/json")
  const payload = isJson ? await response.json() : null
  if (!response.ok) {
    if (response.status === 419) {
      csrfReady = false
      if (retryExpiredCsrf && unsafeMethods.has(method)) return request(path, options, false)
    }
    if (response.status === 401) window.dispatchEvent(new Event("auth:invalid"))
    if (response.status === 412) window.dispatchEvent(new Event("data:stale"))
    throw new ApiError(
      payload?.message ?? `请求失败（${response.status}）`,
      response.status,
      payload?.code ?? "REQUEST_FAILED",
      payload ?? {},
    )
  }

  return {
    data: payload?.data as T,
    meta: payload?.meta,
    etag: response.headers.get("ETag"),
  }
}

export function jsonBody(value: unknown) {
  return JSON.stringify(value)
}

export function apiMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 412) return "数据已被其他人更新，请刷新后重试。"
    return error.message
  }
  return "操作失败，请稍后重试。"
}
