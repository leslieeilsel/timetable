export interface DiagnosticEvidence {
  evidence_id: string
  fact: string
}

/** Split at data boundaries, retaining every field. Large text values are exposed
 * as labelled segments instead of silently discarding them. */
export function diagnosticEvidence(value: unknown, path = "diagnostics"): DiagnosticEvidence[] {
  const fact = JSON.stringify(value)
  if (fact === undefined) return []
  if (fact.length <= 3000) return [{ evidence_id: path, fact }]
  if (typeof value === "string") {
    const parts: DiagnosticEvidence[] = []
    for (let offset = 0; offset < value.length; offset += 2000)
      parts.push({
        evidence_id: `${path}/segment-${offset}`,
        fact: JSON.stringify({
          field: path,
          offset,
          total_characters: value.length,
          text: value.slice(offset, offset + 2000),
        }),
      })
    return parts
  }
  if (Array.isArray(value))
    return value.flatMap((entry, index) => diagnosticEvidence(entry, `${path}/${index}`))
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, entry]) => {
      const child = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`
      const serialized = JSON.stringify({ [key]: entry })
      return serialized.length <= 3000
        ? [{ evidence_id: child, fact: serialized }]
        : diagnosticEvidence(entry, child)
    })
  return [{ evidence_id: path, fact }]
}
