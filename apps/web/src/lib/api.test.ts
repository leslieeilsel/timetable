import { afterEach, describe, expect, it, vi } from "vitest"
import { api, ApiError, apiMessage, jsonBody } from "@/lib/api"

afterEach(() => vi.unstubAllGlobals())

describe("API utilities", () => {
  it("turns an ETag conflict into an actionable refresh message", () => {
    expect(apiMessage(new ApiError("conflict", 412, "SEMESTER_ETAG_CONFLICT", {}))).toBe(
      "数据已被其他人更新，请刷新后重试。",
    )
  })

  it("preserves structured API errors and serializes JSON bodies", () => {
    expect(apiMessage(new ApiError("教室冲突", 409, "TIMETABLE_RESOURCE_CONFLICT", {}))).toBe(
      "教室冲突",
    )
    expect(jsonBody({ weekday: 1 })).toBe('{"weekday":1}')
  })

  it("refreshes an expired CSRF cookie once before retrying a write", async () => {
    vi.stubGlobal("document", { cookie: "" })
    vi.stubGlobal("window", new EventTarget())
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "expired", code: "CSRF_EXPIRED" }), {
          status: 419,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { saved: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      api<{ saved: boolean }>("/api/v1/test", {
        method: "POST",
        body: jsonBody({ value: 1 }),
      }),
    ).resolves.toMatchObject({ data: { saved: true } })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
