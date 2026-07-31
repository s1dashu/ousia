export type PiRetryFailureSource =
  | "provider"
  | "client_auth"
  | "client_request"
  | "network"
  | "unknown"

export type PiFailureStatus = {
  detail?: string
  errorCode?: string
  errorType?: string
  httpStatus?: number
  source: PiRetryFailureSource
  text: string
  transportCode?: string
}

type PiFailureStatusOptions = {
  errorMessage?: string
  provider?: string
}

type PiRetryStatusOptions = PiFailureStatusOptions & {
  attempt?: number
  delayMs?: number
  maxAttempts?: number
}

const MAX_DETAIL_LENGTH = 180
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  google: "Google",
  groq: "Groq",
  mistral: "Mistral",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  xai: "xAI",
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function redactSensitiveText(value: string) {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:api[_ -]?key|authorization|token)\s*[:=]\s*["']?[^"',;\s}]+/gi,
      (match) => `${match.split(/[:=]/, 1)[0]}=[REDACTED]`
    )
    .replace(/\b(?:sk|ds|AIza)[-_A-Za-z0-9]{12,}\b/g, "[REDACTED]")
}

function safeDetail(value: unknown) {
  if (typeof value !== "string") {
    return undefined
  }
  const text = compactText(redactSensitiveText(value))
  if (!text) {
    return undefined
  }
  return text.length > MAX_DETAIL_LENGTH
    ? `${text.slice(0, MAX_DETAIL_LENGTH - 1)}…`
    : text
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function parseJsonErrorPayload(errorMessage: string) {
  const jsonStart = errorMessage.indexOf("{")
  const jsonEnd = errorMessage.lastIndexOf("}")
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    return undefined
  }
  try {
    const payload = recordValue(
      JSON.parse(errorMessage.slice(jsonStart, jsonEnd + 1))
    )
    return recordValue(payload?.error) ?? payload
  } catch {
    return undefined
  }
}

function parseHttpStatus(errorMessage: string) {
  const match = errorMessage.match(
    /(?:^|\b)(?:HTTP\s*)?([1-5]\d{2})(?=\s*[:;-]|\b)/i
  )
  if (!match) {
    return undefined
  }
  const status = Number(match[1])
  return Number.isInteger(status) ? status : undefined
}

function parseTransportCode(errorMessage: string) {
  return errorMessage.match(
    /\b(ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)\b/i
  )?.[1]
}

function fallbackDetail(errorMessage: string) {
  return safeDetail(
    errorMessage
      .replace(/^\s*(?:HTTP\s*)?[1-5]\d{2}\s*[:;-]?\s*/i, "")
      .replace(/^\s*Error:\s*/i, "")
  )
}

function providerLabel(provider: string | undefined) {
  const normalized = provider?.trim()
  if (!normalized) {
    return "模型"
  }
  return PROVIDER_LABELS[normalized.toLowerCase()] ?? normalized
}

function classifyFailure({
  detail,
  errorCode,
  errorMessage,
  errorType,
  httpStatus,
  transportCode,
}: {
  detail?: string
  errorCode?: string
  errorMessage: string
  errorType?: string
  httpStatus?: number
  transportCode?: string
}): PiRetryFailureSource {
  if (httpStatus === 401 || httpStatus === 403) {
    return "client_auth"
  }
  if (
    httpStatus === 400 ||
    httpStatus === 404 ||
    httpStatus === 405 ||
    httpStatus === 409 ||
    httpStatus === 415 ||
    httpStatus === 422
  ) {
    return "client_request"
  }
  if (httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500)) {
    return "provider"
  }

  const searchable = [
    errorMessage,
    detail,
    errorCode,
    errorType,
    transportCode,
  ]
    .filter(Boolean)
    .join(" ")

  if (
    /\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|ETIMEDOUT)\b|network|connection|fetch failed|socket|dns|timed?\s*out|timeout/i.test(
      searchable
    )
  ) {
    return "network"
  }
  return "unknown"
}

function failureSummary(
  source: PiRetryFailureSource,
  provider: string | undefined,
  httpStatus: number | undefined,
  searchable: string
) {
  const label = providerLabel(provider)
  if (source === "client_auth") {
    return `客户端配置 · ${label} 认证或权限失败`
  }
  if (source === "client_request") {
    return `客户端请求 · ${label} 请求参数或模型配置错误`
  }
  if (source === "network") {
    return "网络连接 · 客户端与模型服务之间的连接异常"
  }
  if (source === "provider") {
    if (httpStatus === 429) {
      return `模型服务端 · ${label} 请求限流`
    }
    if (
      httpStatus === 503 &&
      /\bbusy\b|overload|service[_ -]?unavailable/i.test(searchable)
    ) {
      return `模型服务端 · ${label} 服务繁忙`
    }
    return `模型服务端 · ${label} 暂时不可用`
  }
  return "未知来源 · 请求暂时失败"
}

function retrySuffix({
  attempt,
  delayMs,
  maxAttempts,
}: Pick<PiRetryStatusOptions, "attempt" | "delayMs" | "maxAttempts">) {
  const retryCount =
    attempt !== undefined && maxAttempts !== undefined
      ? `（${attempt}/${maxAttempts}）`
      : attempt !== undefined
        ? `（第 ${attempt} 次）`
        : ""
  if (delayMs === undefined || !Number.isFinite(delayMs) || delayMs < 0) {
    return `正在自动重试${retryCount}…`
  }
  const delay =
    delayMs < 1000
      ? `${Math.round(delayMs)} 毫秒`
      : `${Number((delayMs / 1000).toFixed(1))} 秒`
  return `${delay}后自动重试${retryCount}…`
}

export function describePiFailure({
  errorMessage = "",
  provider,
}: PiFailureStatusOptions): PiFailureStatus {
  const payload = parseJsonErrorPayload(errorMessage)
  const detail =
    safeDetail(payload?.message) ??
    safeDetail(payload?.detail) ??
    (payload ? undefined : fallbackDetail(errorMessage))
  const errorType = safeDetail(payload?.type)
  const errorCode = safeDetail(payload?.code)
  const httpStatus = parseHttpStatus(errorMessage)
  const transportCode = parseTransportCode(errorMessage)
  const source = classifyFailure({
    detail,
    errorCode,
    errorMessage,
    errorType,
    httpStatus,
    transportCode,
  })
  const searchable = [detail, errorCode, errorType, errorMessage]
    .filter(Boolean)
    .join(" ")
  const summary = failureSummary(source, provider, httpStatus, searchable)
  const metadata = [
    httpStatus ? `HTTP ${httpStatus}` : undefined,
    errorCode,
    errorType !== errorCode ? errorType : undefined,
    transportCode,
  ].filter(Boolean)
  const metadataText = metadata.length ? `（${metadata.join(" · ")}）` : ""
  const detailText = detail ? `：${detail}` : ""

  return {
    detail,
    errorCode,
    errorType,
    httpStatus,
    source,
    text: `${summary}${metadataText}${detailText}`,
    transportCode,
  }
}

export function describePiRetry({
  attempt,
  delayMs,
  errorMessage = "",
  maxAttempts,
  provider,
}: PiRetryStatusOptions): PiFailureStatus {
  const failure = describePiFailure({ errorMessage, provider })
  return {
    ...failure,
    text: `${failure.text}；${retrySuffix({
      attempt,
      delayMs,
      maxAttempts,
    })}`,
  }
}
