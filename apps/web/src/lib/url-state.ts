export function positiveIntegerParam(
  params: URLSearchParams,
  key: string,
  fallback: number,
  allowed?: readonly number[],
) {
  const value = Number(params.get(key))
  if (!Number.isInteger(value) || value < 1 || (allowed && !allowed.includes(value)))
    return fallback
  return value
}

export function enumParam<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
) {
  const value = params.get(key)
  return value !== null && allowed.includes(value as T) ? (value as T) : fallback
}

export function mergeSearchParams(
  current: URLSearchParams,
  values: Record<string, string | number | null>,
) {
  const next = new URLSearchParams(current)
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === "") next.delete(key)
    else next.set(key, String(value))
  }
  return next
}
