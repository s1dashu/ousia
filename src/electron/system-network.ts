export type SystemNetworkErrorDetails = {
  address?: string
  code?: string
  errno?: string | number
  message?: string
  name?: string
  port?: number
  syscall?: string
}

export type SystemNetworkFailure = {
  cause?: SystemNetworkErrorDetails
  durationMs: number
  error: SystemNetworkErrorDetails
  host: string
  method: string
}

type ChromiumFetch = (
  input: string | Request,
  init?: RequestInit
) => Promise<Response>

type SystemProxyFetchOptions = {
  fetchWithSystemProxy: ChromiumFetch
  now?: () => number
  onFailure: (failure: SystemNetworkFailure) => void
}

function redactUrlDetails(message: string) {
  return message
    .replace(
      /\b(https?:\/\/[^/?#\s]+)(?:[^\s]*)/gi,
      (_match, origin: string) => `${origin}/[redacted]`
    )
    .slice(0, 500)
}

function errorDetails(value: unknown): SystemNetworkErrorDetails {
  if (!value || typeof value !== "object") {
    return { message: redactUrlDetails(String(value)) }
  }
  const error = value as Record<string, unknown>
  const details: SystemNetworkErrorDetails = {}
  if (typeof error.name === "string" && error.name) {
    details.name = error.name
  }
  if (typeof error.message === "string" && error.message) {
    details.message = redactUrlDetails(error.message)
  }
  if (typeof error.code === "string" && error.code) {
    details.code = error.code
  }
  if (typeof error.errno === "string" || typeof error.errno === "number") {
    details.errno = error.errno
  }
  if (typeof error.syscall === "string" && error.syscall) {
    details.syscall = error.syscall
  }
  if (typeof error.address === "string" && error.address) {
    details.address = error.address
  }
  if (typeof error.port === "number" && Number.isFinite(error.port)) {
    details.port = error.port
  }
  return details
}

function requestHost(input: string | URL | Request) {
  try {
    if (input instanceof URL) {
      return input.hostname
    }
    if (input instanceof Request) {
      return new URL(input.url).hostname
    }
    return new URL(input).hostname
  } catch {
    return "invalid-url"
  }
}

function requestMethod(input: string | URL | Request, init?: RequestInit) {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
}

export function createSystemProxyFetch({
  fetchWithSystemProxy,
  now = performance.now.bind(performance),
  onFailure,
}: SystemProxyFetchOptions): typeof fetch {
  return (async (input, init) => {
    const startedAt = now()
    try {
      return await fetchWithSystemProxy(
        input instanceof URL ? input.toString() : input,
        init
      )
    } catch (error) {
      const cause =
        error && typeof error === "object" && "cause" in error
          ? (error as { cause?: unknown }).cause
          : undefined
      onFailure({
        cause: cause === undefined ? undefined : errorDetails(cause),
        durationMs: Math.max(0, Math.round(now() - startedAt)),
        error: errorDetails(error),
        host: requestHost(input),
        method: requestMethod(input, init),
      })
      throw error
    }
  }) as typeof fetch
}
