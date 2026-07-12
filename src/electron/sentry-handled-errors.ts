import { writeRuntimeLog } from "./runtime-logger.js"

const SAFE_DIAGNOSTIC_TOKEN = /^[a-z][a-z0-9_.-]{0,63}$/

export type DesktopHandledErrorContext = {
  errorCode: string
  operation: string
  retryable: boolean
  subsystem: string
}

type CaptureException = (
  error: unknown,
  context: { tags: Record<string, string> }
) => string

let captureException: CaptureException | undefined

function requireSafeDiagnosticToken(name: string, value: string) {
  if (!SAFE_DIAGNOSTIC_TOKEN.test(value)) {
    throw new Error(
      `${name} must be a lowercase diagnostic token with at most 64 characters`
    )
  }
  return value
}

export function configureDesktopHandledErrorCapture(
  capture: CaptureException | undefined
) {
  captureException = capture
}

export function captureDesktopHandledError(
  error: unknown,
  context: DesktopHandledErrorContext
) {
  const safeContext = {
    error_code: requireSafeDiagnosticToken("errorCode", context.errorCode),
    handled: "true",
    operation: requireSafeDiagnosticToken("operation", context.operation),
    retryable: String(context.retryable),
    subsystem: requireSafeDiagnosticToken("subsystem", context.subsystem),
  }
  if (!captureException) return undefined
  const eventId = captureException(error, { tags: safeContext })
  writeRuntimeLog("sentry.capture", "info", {
    ...safeContext,
    eventId,
  })
  return eventId
}
