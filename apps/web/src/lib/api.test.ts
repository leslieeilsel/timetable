import { afterEach, describe, expect, it, vi } from "vitest"
import { api, apiAllPages, apiDownload, ApiError, apiMessage, jsonBody } from "@/lib/api"

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

  it("turns validation envelopes into a specific field-level message", () => {
    expect(
      apiMessage(
        new ApiError("请求数据校验失败", 422, "VALIDATION_FAILED", {
          errors: { teacher_id: ["The teacher id field is required."] },
        }),
      ),
    ).toBe("请检查“教师”，该字段缺失或格式不正确。")
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

  it("downloads binary responses and reads an RFC 5987 filename", async () => {
    vi.stubGlobal("document", { cookie: "" })
    vi.stubGlobal("window", new EventTarget())
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response("PK-test-archive", {
          status: 200,
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": "attachment; filename*=UTF-8''%E8%AF%BE%E8%A1%A8.zip",
          },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    const result = await apiDownload("/api/v1/export.zip", {
      method: "POST",
      body: jsonBody({ class_ids: [1] }),
    })

    expect(result.filename).toBe("课表.zip")
    await expect(result.blob.text()).resolves.toBe("PK-test-archive")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("rejects paginated results assembled from different ETag revisions", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost" } })
    const page = (data: number[], currentPage: number, etag: string) =>
      new Response(
        JSON.stringify({
          data,
          meta: { pagination: { page: currentPage, last_page: 2 } },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ETag: etag },
        },
      )
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(page([1], 1, '"revision-1"'))
        .mockResolvedValueOnce(page([2], 2, '"revision-2"')),
    )

    await expect(apiAllPages<number>("/api/v1/items")).rejects.toMatchObject({
      status: 409,
      code: "PAGINATED_SNAPSHOT_CHANGED",
      details: { page: 2, expected_etag: '"revision-1"', actual_etag: '"revision-2"' },
    })
  })
})
