import { afterEach, describe, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { ChatStore } from "../src/chat-store.ts"
import { ChatTitles, type TitleGenerator } from "../src/chat-title.ts"
import { readConfig } from "../src/config.ts"

const stores: ChatStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})
function setup(generate: TitleGenerator) {
  const store = new ChatStore(":memory:")
  stores.push(store)
  const chat = store.create(1, 1)
  const turn = store.begin(1, chat.id, {
    message_id: randomUUID(),
    revision: 0,
    text: "帮我查询七年级1班的教室",
  })
  store.finish(chat.id, turn.seq, turn.assistant, [], true)
  const active = new Set<AbortController>()
  const titles = new ChatTitles(
    readConfig({ DEEPSEEK_API_KEY: "test-only" }),
    store,
    active,
    generate,
  )
  return { store, chat, titles, active }
}

describe("independent conversation titles", () => {
  it("uses user requests without internal context and does not block another chat turn", async () => {
    let finish!: (title: string) => void
    const generate = vi.fn<TitleGenerator>(
      async () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { store, chat, titles, active } = setup(generate)
    const pending = titles.rename(1, chat.id)
    expect(store.get(1, chat.id).title_generating).toBe(true)
    await expect(titles.rename(1, chat.id)).rejects.toMatchObject({ code: "TITLE_BUSY" })
    const next = store.begin(1, chat.id, {
      message_id: randomUUID(),
      revision: 1,
      text: "再查一下课程",
    })
    expect(generate.mock.calls[0]?.[1]).toEqual(["帮我查询七年级1班的教室"])
    finish("七年级1班教室查询")
    expect(await pending).toMatchObject({
      title: "七年级1班教室查询",
      revision: 2,
      busy: true,
      title_generating: false,
    })
    store.finish(chat.id, next.seq, next.assistant, [], true)
    expect(active.size).toBe(0)
  })
  it("retains the existing title when the provider fails without exposing its error", async () => {
    const { store, chat, titles } = setup(async () => {
      throw new Error("private-provider-key")
    })
    await expect(titles.rename(1, chat.id)).rejects.toMatchObject({
      code: "TITLE_FAILED",
      message: expect.stringContaining("保留原名称"),
    })
    expect(store.get(1, chat.id)).toMatchObject({
      title: "帮我查询七年级1班的教室",
      title_generating: false,
    })
  })
})
