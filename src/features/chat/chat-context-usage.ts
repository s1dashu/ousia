export type ContextUsage = {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

export function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value))
}

export function getContextUsagePercent(usage: ContextUsage | undefined) {
  if (
    usage &&
    typeof usage.percent === "number" &&
    Number.isFinite(usage.percent) &&
    usage.percent >= 0
  ) {
    return clampPercentage(usage.percent)
  }

  if (
    usage &&
    typeof usage.tokens === "number" &&
    Number.isFinite(usage.tokens) &&
    usage.tokens > 0 &&
    Number.isFinite(usage.contextWindow) &&
    usage.contextWindow > 0
  ) {
    return clampPercentage((usage.tokens / usage.contextWindow) * 100)
  }

  return undefined
}

export function formatContextUsagePercent(percent: number) {
  return percent < 10 ? percent.toFixed(1) : Math.round(percent).toString()
}
