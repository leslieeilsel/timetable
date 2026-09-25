import { useRef, useState } from "react"
import { api, apiDownload, apiMessage, saveDownload, type ApiResult } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/page"
import { SimpleSelect } from "@/components/simple-select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

type Preview = {
  token: string
  headers: string[]
  fields: Record<string, string>
  mapping: Record<string, number | null>
  rows: {
    row: number
    label: string
    action: "create" | "update" | "skip"
    before: string
    after: string
    errors: string[]
  }[]
  summary: { create: number; update: number; skip: number; errors: number }
}
const actions = { create: "新增", update: "修改", skip: "跳过（相同）" }

export function DataImportDialog({
  kind,
  semesterId,
  open,
  onClose,
  onSaved,
}: {
  kind: "teachers" | "assignments"
  semesterId?: number
  open: boolean
  onClose: () => void
  onSaved: () => Promise<unknown>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ApiResult<Preview> | null>(null)
  const [mapping, setMapping] = useState<Record<string, number | null>>({})
  const [mappingChanged, setMappingChanged] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    created: number
    updated: number
    skipped: number
  } | null>(null)
  const inFlight = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const base = `/api/v1/data-imports/${kind}`
  const inspect = async (useMapping: boolean) => {
    if (!file || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError("")
    setPreview(null)
    try {
      const body = new FormData()
      body.append("file", file)
      if (semesterId) body.append("semester_id", String(semesterId))
      if (useMapping) body.append("mapping", JSON.stringify(mapping))
      const response = await api<Preview>(`${base}/preview`, {
        method: "POST",
        body,
        formData: true,
      })
      setPreview(response)
      setMapping(response.data.mapping)
      setMappingChanged(false)
    } catch (cause) {
      setError(apiMessage(cause))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const commit = async () => {
    if (!preview || mappingChanged || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError("")
    try {
      const response = await api<{ created: number; updated: number; skipped: number }>(
        `${base}/commit`,
        { method: "POST", etag: preview.etag, body: JSON.stringify({ token: preview.data.token }) },
      )
      setResult(response.data)
      await onSaved()
    } catch (cause) {
      setError(apiMessage(cause))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const errorsDownload = () => {
    if (!preview) return
    // Quote as text even when school-controlled names start with spreadsheet formula prefixes.
    const cell = (value: string) =>
      `"${(/[=+@\-\t\r]/.test(value[0] ?? "") ? "'" : "") + value.replaceAll('"', '""')}"`
    const rows = [
      ["Excel 行号", "对象", "问题"],
      ...preview.data.rows
        .filter((row) => row.errors.length)
        .map((row) => [String(row.row), row.label, row.errors.join("；")]),
    ]
    saveDownload(
      {
        blob: new Blob(["\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n")], {
          type: "text/csv;charset=utf-8",
        }),
        filename: "导入错误明细.csv",
      },
      "导入错误明细.csv",
    )
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <DialogContent className="grid max-h-[90svh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-4xl">
        <DialogHeader className="pr-10">
          <DialogTitle>导入{kind === "teachers" ? "教师" : "任课明细"}</DialogTitle>
          <DialogDescription>
            上传 Excel → 核对列与差异 → 整批导入。预检不会修改资料。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 overflow-y-auto py-1">
          {result ? (
            <div role="status" className="space-y-3">
              <h3 className="font-semibold">导入完成</h3>
              <p>
                新增 {result.created} 条，修改 {result.updated} 条，相同跳过 {result.skipped} 条。
              </p>
              <p className="text-sm text-muted-foreground">
                {kind === "assignments"
                  ? "任课以草稿保存，请核对并确认后再排课。已发布的课表保持原安排。"
                  : "教师资料已保存。教师账号仍需在账号管理中单独创建。"}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  支持单工作表 .xlsx，第一行为表头，最多 500
                  行。工号列请设为文本；不支持合并单元格、公式或任意课表版式。
                </p>
                <p>
                  {kind === "teachers"
                    ? "教师工号和姓名必填。任教课程用顿号分隔，须先维护课程。同名不同工号按不同教师处理；已有工号仅补充任教课程。"
                    : "班级须已在本学期启用，课程、教师与教室须已建立。教师按工号匹配；周型填每周、单周或双周，教室留空使用班级固定教室。教学组、协同授课及指定周请在任课详情中维护。"}
                </p>
                <p>
                  {kind === "assignments"
                    ? "只新增或更新未排课的草稿。已确认任课若有差异，会阻止整批导入并提示处理入口。上学期资料可使用列表的“复制上学期本年级”。"
                    : "工号已存在但姓名不同会阻止导入，请先核实身份。"}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid min-w-0 gap-2 text-sm sm:max-w-xs">
                  <span className="font-medium">Excel 文件</span>
                  <input
                    ref={fileInput}
                    type="file"
                    hidden
                    aria-label="选择 Excel 文件"
                    accept=".xlsx"
                    disabled={busy}
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null)
                      setPreview(null)
                      setMapping({})
                      setError("")
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    {file ? "更换 Excel 文件" : "选择 Excel 文件"}
                  </Button>
                  <span className="break-all text-muted-foreground">
                    {file ? `当前文件：${file.name}` : "尚未选择文件"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      saveDownload(await apiDownload(`${base}/template`), "导入模板.xlsx")
                    } catch (cause) {
                      setError(apiMessage(cause))
                    }
                  }}
                >
                  下载中文模板
                </Button>
                <Button
                  variant="outline"
                  disabled={!file || busy}
                  onClick={() => void inspect(false)}
                >
                  读取文件
                </Button>
              </div>
              {preview && (
                <>
                  <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <legend className="mb-3 font-medium">字段映射</legend>
                    {Object.entries(preview.data.fields).map(([key, label]) => (
                      <Field key={key} label={label}>
                        <SimpleSelect
                          label={`${label}对应列`}
                          value={mapping[key] == null ? "none" : String(mapping[key])}
                          onValueChange={(value) => {
                            setMapping((current) => ({
                              ...current,
                              [key]: value === "none" ? null : Number(value),
                            }))
                            setMappingChanged(true)
                          }}
                        >
                          <option value="none">不映射（留空）</option>
                          {preview.data.headers.map((header, index) => (
                            <option key={index} value={index}>
                              {index + 1}. {header || "空表头"}
                            </option>
                          ))}
                        </SimpleSelect>
                      </Field>
                    ))}
                  </fieldset>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="outline" disabled={busy} onClick={() => void inspect(true)}>
                      按当前映射重新预检
                    </Button>
                    {preview.data.summary.errors > 0 && (
                      <Button variant="outline" onClick={errorsDownload}>
                        下载行级错误
                      </Button>
                    )}
                  </div>
                  {mappingChanged ? (
                    <p role="status">列映射已修改，请重新预检后核对差异。</p>
                  ) : (
                    <>
                      <p role="status" className="text-sm">
                        新增 {preview.data.summary.create} 条 · 修改 {preview.data.summary.update}{" "}
                        条 · 相同跳过 {preview.data.summary.skip} 条 · 错误{" "}
                        {preview.data.summary.errors} 行。
                        {preview.data.summary.errors > 0 &&
                          "有错误时整批不写入，请修正文件后重新读取。"}
                      </p>
                      <div className="max-h-72 overflow-auto rounded-md border">
                        <table className="w-full text-left text-sm">
                          <thead className="sticky top-0 bg-background">
                            <tr>
                              {["行 / 对象", "处理", "当前 → 导入后 / 问题"].map((label) => (
                                <th key={label} className="p-3 font-medium">
                                  {label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {preview.data.rows.map((row) => (
                              <tr key={row.row} className="border-t">
                                <td className="p-3">
                                  第 {row.row} 行<br />
                                  {row.label}
                                </td>
                                <td className="p-3">
                                  {row.errors.length ? "需修正" : actions[row.action]}
                                </td>
                                <td className="p-3">
                                  <div>
                                    {row.before} → {row.after}
                                  </div>
                                  {row.errors.map((message) => (
                                    <p key={message} className="mt-1 text-destructive">
                                      {message}
                                    </p>
                                  ))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="flex-wrap">
          {result && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setResult(null)
                setFile(null)
                setPreview(null)
                setMapping({})
                setMappingChanged(false)
                setError("")
              }}
            >
              导入另一份文件
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {result ? "完成" : "关闭（本页保留文件）"}
          </Button>
          {!result && (
            <Button
              disabled={busy || !preview || mappingChanged || preview.data.summary.errors > 0}
              onClick={() => void commit()}
            >
              {busy ? "处理中…" : "确认差异并导入整批"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
