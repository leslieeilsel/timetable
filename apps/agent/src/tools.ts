import type { AgentTool } from "@earendil-works/pi-agent-core"
import { Type, type Static, type TSchema } from "@earendil-works/pi-ai"
import {
  previewSchema,
  ruleDraftSchema,
  type AgentEvent,
  type RunInput,
} from "@timetable/agent-contracts"
import { z } from "zod"
import type { components } from "@timetable/api-client"
import type { BusinessApi } from "./business-api.ts"
import { AgentError } from "./errors.ts"
import { findCatalogResources } from "./resource-lookup.ts"
import { diagnosticEvidence } from "./diagnostic-data.ts"

export interface ResultCollector {
  result: Extract<AgentEvent, { type: "proposal" | "explanation" | "clarification" }> | null
  evidence: Map<string, string>
  headline: string
}

const empty = Type.Object({}, { additionalProperties: false })
const text = (max = 500) => Type.String({ minLength: 1, maxLength: max })
const id = Type.Integer({ minimum: 1 })

export function createTools(
  input: RunInput,
  api: BusinessApi,
  collector: ResultCollector,
  resolved = new Set<string>(),
  options: { allowNonFailedRun?: boolean } = {},
): AgentTool[] {
  const root = `/api/v1/semesters/${input.semester_id}`
  let capabilitiesLoaded = false
  let templateLoaded = false

  function tool<T extends TSchema>(
    name: string,
    label: string,
    parameters: T,
    execute: (args: Static<T>) => Promise<unknown>,
    description = label,
  ): AgentTool<T> {
    return {
      name,
      label,
      description,
      parameters,
      executionMode: "sequential",
      async execute(_callId, args) {
        if (collector.result)
          return {
            content: [{ type: "text", text: JSON.stringify({ ready: true }) }],
            details: {},
            terminate: true,
          }
        await api.authenticate()
        const value = await execute(args)
        return {
          content: [{ type: "text", text: JSON.stringify(value) }],
          details: {},
          terminate: collector.result !== null,
        }
      },
    }
  }

  const clarify = tool(
    "ask_clarification",
    "请求补充信息",
    Type.Object({ question: text(1500) }, { additionalProperties: false }),
    async ({ question }) => {
      collector.result = { type: "clarification", question }
      return { requires_user_input: true }
    },
  )

  if (input.feature === "schedule_run_explanation") {
    return [
      tool(
        "get_schedule_run",
        "读取本次排课诊断",
        Type.Object(
          {
            page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
          },
          { additionalProperties: false },
        ),
        async ({ page = 1 }) => {
          const response = await api.request(`${root}/schedule-runs/${input.schedule_run_id}`)
          const run = z
            .object({
              id: idSchema(),
              status: z.string(),
              error_code: z.string().nullable(),
              error_message: z.string().nullable(),
              diagnostics: z.unknown(),
            })
            .passthrough()
            .parse(response.data)
          if (
            run.id !== input.schedule_run_id ||
            (!options.allowNonFailedRun && run.status !== "failed")
          )
            throw new AgentError("RUN_NOT_FAILED", "请选择失败的排课任务进行解释。", 422)
          collector.headline = run.error_message ?? "排课诊断"
          const errorFact = JSON.stringify({
            status: run.status,
            error_code: run.error_code,
            error_message: run.error_message,
          })
          collector.evidence.set("run.error", errorFact)
          const { diagnostics, constraint_snapshot, ...details } = run
          const evidence = [
            ...diagnosticEvidence(diagnostics),
            ...diagnosticEvidence(constraint_snapshot, "constraint_snapshot"),
          ]
          const perPage = 8
          const selected = evidence.slice((page - 1) * perPage, page * perPage)
          for (const entry of selected) collector.evidence.set(entry.evidence_id, entry.fact)
          return {
            schedule_run: details,
            evidence: [{ evidence_id: "run.error", fact: errorFact }, ...selected],
            coverage: { complete: page === 1 && evidence.length <= perPage },
            missing_fields: run.diagnostics == null ? ["diagnostics"] : [],
            meta: {
              ...z.record(z.string(), z.unknown()).parse(response.meta ?? {}),
              pagination: {
                page,
                per_page: perPage,
                total: evidence.length,
                last_page: Math.max(1, Math.ceil(evidence.length / perPage)),
              },
            },
            field_meanings:
              "诊断和本次任务使用的规则快照按数据边界拆分并分页，长文本带片段位置；所有内容均可通过翻页读取。meta.is_stale 为 true 表示任务运行后的业务资料已变化，历史诊断不能视为当前状态。NO_FEASIBLE_SOLUTION 表示本次搜索未找到完整解，不等于证明无解。",
          }
        },
        "指定失败排课任务的状态、失败信息与诊断证据。诊断按页返回，每条有可供说明卡片引用的 evidence_id；覆盖范围随结果返回。",
      ),
      tool(
        "present_explanation",
        "整理诊断说明",
        Type.Object(
          {
            headline: Type.Optional(text(1000)),
            findings: Type.Array(
              Type.Object(
                { evidence_id: text(2000), explanation: text(1500) },
                { additionalProperties: false },
              ),
              { minItems: 1, maxItems: 12 },
            ),
            suggestions: Type.Array(text(500), { maxItems: 6 }),
          },
          { additionalProperties: false },
        ),
        async ({ headline, findings, suggestions }) => {
          if (
            collector.evidence.size === 0 ||
            findings.some((row) => !collector.evidence.has(row.evidence_id))
          ) {
            throw new AgentError(
              "EVIDENCE_REQUIRED",
              "必须先读取真实诊断，引用已返回的 evidence_id。",
              422,
            )
          }
          // Numeric claims must occur in the referenced evidence; free-form prose remains
          // an interpretation, with the authoritative original displayed beside it.
          for (const row of findings) {
            const fact = collector.evidence.get(row.evidence_id)!
            if ([...row.explanation.matchAll(/\d+(?:\.\d+)?/g)].some(([n]) => !fact.includes(n))) {
              throw new AgentError(
                "EVIDENCE_MISMATCH",
                "说明包含依据中没有的数字，请移除未经验证的数值。",
                422,
              )
            }
          }
          collector.result = {
            type: "explanation",
            explanation: {
              headline: headline ?? collector.headline,
              findings: findings.map((row) => ({
                ...row,
                fact: collector.evidence.get(row.evidence_id)!,
              })),
              suggestions,
            },
          }
          return { ready: true }
        },
      ),
    ]
  }

  return [
    clarify,
    tool(
      "find_resources",
      "查找教师或课程",
      Type.Object(
        {
          resource: Type.Union([Type.Literal("teacher"), Type.Literal("course")]),
          query: text(100),
        },
        { additionalProperties: false },
      ),
      async ({ resource, query }) => {
        const result = await findCatalogResources(api, resource, query)
        if (result.unique) resolved.add(`${resource}:${result.matches[0]!.id}`)
        return result
      },
      "按名称或编号查询教师及课程基础资料，教师包含登记的任教课程。",
    ),
    tool(
      "get_schedule_template",
      "读取当前作息",
      empty,
      async () => {
        const response = await api.request(`${root}/schedule-template`)
        if (response.data === null) return { configured: false, days: [], items: [] }
        const template = z
          .object({
            days: z.array(z.object({ weekday: z.number(), is_enabled: z.boolean() }).passthrough()),
            items: z.array(
              z
                .object({
                  id: idSchema(),
                  name: z.string(),
                  start_time: z.string(),
                  end_time: z.string(),
                  is_active: z.boolean(),
                  allows_course: z.boolean(),
                  counts_as_course: z.boolean(),
                })
                .passthrough(),
            ),
          })
          .passthrough()
          .parse(response.data)
        templateLoaded = true
        return {
          ...template,
          configured: true,
          field_meanings:
            "完整作息包含启用及停用的日期、授课和非授课时段。规则可用时段为启用日中 is_active、allows_course、counts_as_course 均为 true 的课节。",
        }
      },
      "完整作息表：日期开关、时段名称、用途类型、起止时间、排序、启用与授课属性，包含休息等非授课时段。",
    ),
    tool(
      "get_constraint_capabilities",
      "读取支持的规则",
      empty,
      async () => {
        const response = await api.request(`${root}/scheduling-constraints/capabilities`)
        capabilitiesLoaded = true
        return response.data
      },
      "服务端支持的规则种类、目标对象、作用范围和字段约束。",
    ),
    tool(
      "prepare_rule_drafts",
      "校验并预览规则",
      Type.Object(
        {
          constraints: Type.Array(
            Type.Object(
              {
                name: text(120),
                kind: Type.Union([Type.Literal("hard"), Type.Literal("soft")]),
                category: Type.Union([
                  Type.Literal("forbidden_slot"),
                  Type.Literal("preferred_slot"),
                  Type.Literal("daily_load"),
                ]),
                target_type: Type.Union([Type.Literal("teacher"), Type.Literal("course")]),
                target_id: id,
                scope: Type.Object(
                  {
                    weekdays: Type.Optional(Type.Array(Type.Integer({ minimum: 1, maximum: 7 }))),
                    item_ids: Type.Optional(Type.Array(id)),
                  },
                  { additionalProperties: false },
                ),
                requirement: Type.Object(
                  {
                    available: Type.Optional(Type.Literal(false)),
                    preference: Type.Optional(
                      Type.Union([Type.Literal("prefer"), Type.Literal("avoid")]),
                    ),
                    max_items_per_day: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
                  },
                  { additionalProperties: false },
                ),
                weight: Type.Union([Type.Integer({ minimum: 1, maximum: 100 }), Type.Null()]),
              },
              { additionalProperties: false },
            ),
            { minItems: 1, maxItems: 10 },
          ),
          unhandled_requirements: Type.Array(text(500), { maxItems: 10 }),
        },
        { additionalProperties: false },
      ),
      async ({ constraints, unhandled_requirements }) => {
        if (unhandled_requirements.length) {
          return { prepared: false, unsupported_requirements: unhandled_requirements }
        }
        if (!capabilitiesLoaded || !templateLoaded)
          throw new AgentError("RULE_CONTEXT_REQUIRED", "请先读取规则能力和当前作息。", 422)
        const rows = constraints.map((row) => ruleDraftSchema.parse(row))
        if (rows.some((row) => !resolved.has(`${row.target_type}:${row.target_id}`)))
          throw new AgentError(
            "RESOURCE_NOT_RESOLVED",
            "规则对象尚未唯一确认，请先查询或询问用户。",
            422,
          )
        const response = await api.request(`${root}/scheduling-constraints/preview`, {
          constraints: rows,
        } satisfies components["schemas"]["ConstraintDraftBatch"])
        const preview = previewSchema.parse(response.data)
        if (preview.etag !== response.etag)
          throw new AgentError("PREVIEW_VERSION_INVALID", "规则预览版本不一致，请重试。")
        collector.result = { type: "proposal", preview }
        return { ready: true, summaries: preview.summaries }
      },
      "校验并预览普通周规则：教师禁排、课程偏好时段、教师每日课时上限。前置条件为对象唯一确认、已读取作息与规则能力。hard 的 weight 为 null，soft 的默认权重为 50；daily_load 的 scope 为空。未支持的需求单独返回。预览不会保存，确认操作由用户和服务端完成。",
    ),
  ]
}

function idSchema() {
  return z.number().int().positive()
}
