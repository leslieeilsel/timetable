import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router"
import { useResolvedSemesterId } from "@/lib/semester"
import { WorkingSemesterProvider } from "@/lib/working-semester"

function Probe() {
  const { semesterId } = useResolvedSemesterId()
  return <output>{semesterId ?? "none"}</output>
}
function renderSelection(path: string, userId = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(["context"], { timezone: "Asia/Shanghai", current_semester: { id: 4 } })
  const output = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <WorkingSemesterProvider userId={userId}>
          <Routes>
            <Route element={<Probe />}>
              <Route path="*" element={null} />
            </Route>
          </Routes>
        </WorkingSemesterProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  client.clear()
  return output
}
afterEach(() => vi.unstubAllGlobals())

describe("personal working semester", () => {
  it("uses the school default when no personal selection exists", () => {
    expect(renderSelection("/")).toBe("<output>4</output>")
  })
  it("keeps a remembered selection on home and resource pages", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => "17" })
    expect(renderSelection("/")).toBe("<output>17</output>")
    expect(renderSelection("/resources/teachers")).toBe("<output>17</output>")
  })
  it("lets the explicit route override the remembered semester even in the parent layout", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => "17" })
    expect(renderSelection("/semesters/23/assignments")).toBe("<output>23</output>")
  })
  it("does not silently substitute the default for an invalid explicit route", () => {
    expect(renderSelection("/semesters/invalid/dashboard")).toBe("<output>none</output>")
  })
  it("isolates remembered selections by signed-in user", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => (key === "timetable:working-semester:1" ? "17" : null),
    })
    expect(renderSelection("/", 1)).toBe("<output>17</output>")
    expect(renderSelection("/", 2)).toBe("<output>4</output>")
  })
  it("ignores corrupt storage and continues when browser storage is blocked", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => "not-a-semester" })
    expect(renderSelection("/")).toBe("<output>4</output>")
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked")
      },
    })
    expect(renderSelection("/semesters/23/dashboard")).toBe("<output>23</output>")
  })
})
