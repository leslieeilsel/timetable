import type { Conversation, ConversationDetail, ChatProposal } from "@timetable/agent-contracts"
import { csrfHeaders, ApiError } from "@/lib/api"
import type { InfiniteData, QueryClient } from "@tanstack/react-query"

/** Every Agent request is authenticated again by Laravel, including history reads. */
export const chatFetch: typeof fetch = async (input, init) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers(init?.headers)
    for (const [key, value] of Object.entries(await csrfHeaders(attempt > 0)))
      headers.set(key, value)
    const response = await fetch(input, { ...init, headers, credentials: "include" })
    if (response.status === 419 && attempt === 0) {
      await response.body?.cancel()
      continue
    }
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new Event("auth:invalid"))
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string
        code?: string
      }
      throw new ApiError(
        payload.message ?? "对话服务暂时不可用，请稍后重试。",
        response.status,
        payload.code ?? "CHAT_UNAVAILABLE",
        {},
      )
    }
    return response
  }
  throw new Error("登录验证失败，请刷新页面后重试。")
}
const root = "/agent/v1/conversations"
async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await chatFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return ((await response.json()) as { data: T }).data
}
export const listConversations = (offset = 0, signal?: AbortSignal) =>
  request<Conversation[]>(`${root}?offset=${offset}`, undefined, signal)
export const createConversation = (semesterId: number | null, signal?: AbortSignal) =>
  request<ConversationDetail>(root, { semester_id: semesterId }, signal)
export const getConversation = (id: string, before?: number, signal?: AbortSignal) =>
  request<ConversationDetail>(
    `${root}/${id}${before ? `?before=${before}` : ""}`,
    undefined,
    signal,
  )
export const confirmProposal = (conversationId: string, actionId: string) =>
  request<ChatProposal>(`${root}/${conversationId}/actions/${actionId}/confirm`, {})
export const renameConversation = (id: string, title: string) =>
  request<Conversation>(`${root}/${id}`, { title }, undefined, "PATCH")
export const generateConversationTitle = (id: string) =>
  request<{ title: string }>(`${root}/${id}/title`, { preview: true })
export const deleteConversation = (id: string) =>
  request<{ id: string }>(`${root}/${id}`, undefined, undefined, "DELETE")

/** A title change must not replace a live reply or rewind its message revision. */
export function updateConversationTitle(client: QueryClient, conversation: Conversation) {
  const title = { title: conversation.title, title_generating: conversation.title_generating }
  client.setQueryData<InfiniteData<Conversation[]>>(
    ["ai", "history"],
    (history) =>
      history && {
        ...history,
        pages: history.pages.map((page) =>
          page.map((item) => (item.id === conversation.id ? { ...item, ...title } : item)),
        ),
      },
  )
  client.setQueryData<ConversationDetail>(
    ["ai", "conversation", conversation.id],
    (detail) => detail && { ...detail, ...title },
  )
}
