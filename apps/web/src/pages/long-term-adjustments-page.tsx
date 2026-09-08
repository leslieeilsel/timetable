import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router"
import {
  ArrowRightIcon,
  CalendarRangeIcon,
  CheckCircle2Icon,
  FilePenLineIcon,
  PlusIcon,
} from "lucide-react"
import { toast } from "sonner"
import { EmptyList, ErrorState, Field, LoadingState, PageHeader } from "@/components/page"
import { SimpleSelect } from "@/components/simple-select"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api, apiAllPages, apiMessage } from "@/lib/api"
import { semesterPath, useResolvedSemesterId } from "@/lib/semester"
import type { Semester, TimetableEffectivePeriod, TimetableVersion } from "@/lib/types"

interface LongTermPreview {
  allowed: boolean
  version: TimetableVersion
  effective_from: string
  effective_to: string
  replaced_periods: Array<{
    id: number
    version_id: number
    effective_from: string
    effective_to: string
  }>
  calendar_exceptions_to_rebase: number
  cross_period_exceptions_to_validate: number
  substitutions_to_rebase: number
  summary: string
}

export function LongTermAdjustmentsPage() {
  const { semesterId, context } = useResolvedSemesterId()
  const client = useQueryClient()
  const [baseVersionId, setBaseVersionId] = useState("")
  const [draftName, setDraftName] = useState("")
  const [draftVersionId, setDraftVersionId] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [effectiveTo, setEffectiveTo] = useState("")
  const [reason, setReason] = useState("")
  const [preview, setPreview] = useState<LongTermPreview | null>(null)
  const [creating, setCreating] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const semester = useQuery({
    queryKey: ["semester", semesterId],
    queryFn: () => api<Semester>(`/api/v1/semesters/${semesterId}`),
    enabled: semesterId !== null,
  })
  const versions = useQuery({
    queryKey: ["timetable-versions", semesterId],
    queryFn: () =>
      apiAllPages<TimetableVersion>(`/api/v1/semesters/${semesterId}/timetable-versions`),
    enabled: semesterId !== null,
  })
  const periods = useQuery({
    queryKey: ["long-term-adjustments", semesterId],
    queryFn: () =>
      api<TimetableEffectivePeriod[]>(`/api/v1/semesters/${semesterId}/long-term-adjustments`),
    enabled: semesterId !== null,
  })

  const allVersions = useMemo(() => versions.data?.data ?? [], [versions.data?.data])
  const sourceVersions = useMemo(
    () => allVersions.filter((version) => version.status !== "draft"),
    [allVersions],
  )
  const draftVersions = useMemo(
    () => allVersions.filter((version) => version.status === "draft"),
    [allVersions],
  )
  const selectedDraft = draftVersions.find((version) => String(version.id) === draftVersionId)

  useEffect(() => {
    const currentId = semester.data?.data.current_timetable_version_id
    if (!baseVersionId && currentId) setBaseVersionId(String(currentId))
  }, [baseVersionId, semester.data?.data.current_timetable_version_id])
  useEffect(() => {
    if (!draftVersionId && draftVersions[0]) setDraftVersionId(String(draftVersions[0].id))
  }, [draftVersionId, draftVersions])
  useEffect(() => {
    const current = semester.data?.data
    if (!current) return
    if (!effectiveFrom) setEffectiveFrom(dateWithinSemester(current))
    if (!effectiveTo) setEffectiveTo(current.end_date)
  }, [effectiveFrom, effectiveTo, semester.data?.data])
  useEffect(() => setPreview(null), [draftVersionId, effectiveFrom, effectiveTo, reason])

  if (semesterId === null) {
    if (context.isLoading) return <LoadingState label="正在载入学期…" />
    return (
      <>
        <PageHeader title="长期调课" />
        <EmptyList title="尚未设置当前学期" description="请先设置当前开放学期。" />
      </>
    )
  }
  if (semester.isLoading || versions.isLoading || periods.isLoading) return <LoadingState />
  if (semester.isError || versions.isError || periods.isError || !semester.data) {
    return (
      <ErrorState
        retry={() => {
          void semester.refetch()
          void versions.refetch()
          void periods.refetch()
        }}
      />
    )
  }

  const current = semester.data.data
  const canChange = current.status === "open"
  const mutationEtag = periods.data?.etag ?? versions.data?.etag ?? semester.data.etag

  const createDraft = async () => {
    if (!mutationEtag || !baseVersionId) return
    setCreating(true)
    try {
      const result = await api<TimetableVersion>(
        `/api/v1/semesters/${semesterId}/timetable-versions`,
        {
          method: "POST",
          etag: mutationEtag,
          body: JSON.stringify({
            base_version_id: Number(baseVersionId),
            name: draftName.trim() || `长期调课草稿 · ${effectiveFrom || current.start_date}`,
          }),
        },
      )
      setDraftVersionId(String(result.data.id))
      setDraftName("")
      toast.success("长期调课草稿已创建，可进入课表工作台编辑")
      await Promise.all([
        client.invalidateQueries({ queryKey: ["semester", semesterId] }),
        client.invalidateQueries({ queryKey: ["timetable-versions", semesterId] }),
        client.invalidateQueries({ queryKey: ["long-term-adjustments", semesterId] }),
      ])
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setCreating(false)
    }
  }

  const previewPublish = async () => {
    if (!draftVersionId || !effectiveFrom || !effectiveTo || !reason.trim()) return
    setPreviewing(true)
    try {
      const result = await api<LongTermPreview>(
        `/api/v1/semesters/${semesterId}/long-term-adjustments/preview`,
        {
          method: "POST",
          body: JSON.stringify({
            version_id: Number(draftVersionId),
            effective_from: effectiveFrom,
            effective_to: effectiveTo,
            reason: reason.trim(),
          }),
        },
      )
      setPreview(result.data)
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setPreviewing(false)
    }
  }

  const publish = async () => {
    if (!preview || !mutationEtag) return
    setPublishing(true)
    try {
      await api<TimetableEffectivePeriod>(`/api/v1/semesters/${semesterId}/long-term-adjustments`, {
        method: "POST",
        etag: mutationEtag,
        body: JSON.stringify({
          version_id: Number(draftVersionId),
          effective_from: effectiveFrom,
          effective_to: effectiveTo,
          reason: reason.trim(),
        }),
      })
      toast.success("长期调课已发布，指定日期区间将使用新课表")
      setPreview(null)
      setReason("")
      setDraftVersionId("")
      await Promise.all([
        client.invalidateQueries({ queryKey: ["semester", semesterId] }),
        client.invalidateQueries({ queryKey: ["timetable-versions", semesterId] }),
        client.invalidateQueries({ queryKey: ["long-term-adjustments", semesterId] }),
        client.invalidateQueries({ queryKey: ["daily-timetable"] }),
      ])
    } catch (error) {
      toast.error(apiMessage(error))
    } finally {
      setPublishing(false)
    }
  }

  return (
    <>
      <PageHeader
        title={`${current.name} · 长期调课`}
        description="按日期区间发布新的基础课表，区间外继续使用原课表。"
      />
      <div className="space-y-5 p-4 md:p-7">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarRangeIcon className="size-4 text-primary" />
                生效时间线
              </CardTitle>
              <CardDescription>教师课表和每日课表会按日期自动选用这里的基础版本。</CardDescription>
            </CardHeader>
            <CardContent>
              {periods.data?.data.length ? (
                <div className="space-y-2">
                  {periods.data.data.map((period) => (
                    <div
                      key={period.id}
                      className="grid gap-3 rounded-2xl border bg-background/70 p-4 sm:grid-cols-[150px_1fr_auto] sm:items-center"
                    >
                      <div className="font-medium tabular-nums">
                        {formatDate(period.effective_from)}
                        <ArrowRightIcon className="mx-1 inline size-3.5 text-muted-foreground" />
                        {formatDate(period.effective_to)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          v{period.timetable_version.version_no} · {period.timetable_version.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {period.reason} · {period.creator.name}
                        </p>
                      </div>
                      <StatusBadge value={period.timetable_version.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyList
                  title="还没有生效区间"
                  description="首次发布正式课表或长期调课后，会在这里形成时间线。"
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlusIcon className="size-4 text-primary" />
                1. 创建调整草稿
              </CardTitle>
              <CardDescription>复制一份既有课表作为起点；草稿与原课表相互独立。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="基于课表版本">
                <SimpleSelect
                  className="w-full"
                  value={baseVersionId}
                  onValueChange={setBaseVersionId}
                  disabled={!sourceVersions.length}
                >
                  {sourceVersions.map((version) => (
                    <option key={version.id} value={String(version.id)}>
                      v{version.version_no} · {version.name}
                      {version.id === current.current_timetable_version_id ? "（当前）" : ""}
                    </option>
                  ))}
                </SimpleSelect>
              </Field>
              <Field label="草稿名称">
                <Input
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="例如：国庆后执行的新课表"
                />
              </Field>
              <Button
                className="w-full"
                disabled={!canChange || !baseVersionId || creating}
                onClick={() => void createDraft()}
              >
                <PlusIcon />
                {creating ? "正在创建…" : "创建独立草稿"}
              </Button>
              {!sourceVersions.length && (
                <p className="text-xs text-amber-700">请先生成并发布一份正式课表。</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FilePenLineIcon className="size-4 text-primary" />
              2. 编辑并发布
            </CardTitle>
            <CardDescription>
              临时调课仍按单日或短期处理；这里用于替换连续日期区间的基础课表。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
            <div className="space-y-4">
              <Field label="调整草稿">
                <SimpleSelect
                  className="w-full"
                  value={draftVersionId}
                  onValueChange={setDraftVersionId}
                  disabled={!draftVersions.length}
                >
                  {draftVersions.map((version) => (
                    <option key={version.id} value={String(version.id)}>
                      v{version.version_no} · {version.name}（{version.entries_count ?? 0} 项）
                    </option>
                  ))}
                </SimpleSelect>
              </Field>
              {selectedDraft && (
                <Button
                  variant="outline"
                  render={
                    <Link
                      to={`${semesterPath(semesterId, "timetable")}?version=${selectedDraft.id}`}
                    />
                  }
                >
                  <FilePenLineIcon />
                  在课表工作台编辑此草稿
                </Button>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="开始生效日期">
                  <Input
                    type="date"
                    min={current.start_date}
                    max={current.end_date}
                    value={effectiveFrom}
                    onChange={(event) => setEffectiveFrom(event.target.value)}
                  />
                </Field>
                <Field label="结束生效日期">
                  <Input
                    type="date"
                    min={effectiveFrom || current.start_date}
                    max={current.end_date}
                    value={effectiveTo}
                    onChange={(event) => setEffectiveTo(event.target.value)}
                  />
                </Field>
              </div>
              <Field label="调整原因">
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="说明为什么调整，以及适用范围"
                  maxLength={500}
                />
              </Field>
              <Button
                disabled={
                  !canChange ||
                  !draftVersionId ||
                  !effectiveFrom ||
                  !effectiveTo ||
                  reason.trim().length < 2 ||
                  previewing
                }
                onClick={() => void previewPublish()}
              >
                {previewing ? "正在检查…" : "预览发布影响"}
              </Button>
            </div>

            <div className="rounded-2xl border bg-muted/35 p-5">
              {preview ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                    <div>
                      <p className="font-medium">检查通过，可以发布</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {preview.summary}
                      </p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <PreviewMetric label="覆盖既有区间" value={preview.replaced_periods.length} />
                    <PreviewMetric
                      label="迁移临时调课"
                      value={preview.calendar_exceptions_to_rebase}
                    />
                    <PreviewMetric
                      label="校验跨区间调课"
                      value={preview.cross_period_exceptions_to_validate}
                    />
                    <PreviewMetric label="迁移代课记录" value={preview.substitutions_to_rebase} />
                    <PreviewMetric
                      label="生效天数"
                      value={inclusiveDays(preview.effective_from, preview.effective_to)}
                    />
                  </dl>
                  <Button className="w-full" disabled={publishing} onClick={() => void publish()}>
                    {publishing ? "正在发布…" : "确认发布长期调课"}
                  </Button>
                </div>
              ) : (
                <div className="flex min-h-48 flex-col items-center justify-center text-center">
                  <CalendarRangeIcon className="size-8 text-muted-foreground/55" />
                  <p className="mt-3 font-medium">等待发布前检查</p>
                  <p className="mt-1 max-w-xs text-sm leading-6 text-muted-foreground">
                    系统会检查草稿完整性、区间冲突，以及已有临时调课和代课能否安全迁移。
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function PreviewMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-background p-3 ring-1 ring-foreground/5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function dateWithinSemester(semester: Semester) {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  const today = `${now.getFullYear()}-${month}-${day}`
  if (today < semester.start_date) return semester.start_date
  if (today > semester.end_date) return semester.end_date
  return today
}

function formatDate(value: string) {
  return value.slice(5).replace("-", "/")
}

function inclusiveDays(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.floor((end - start) / 86_400_000) + 1
}
