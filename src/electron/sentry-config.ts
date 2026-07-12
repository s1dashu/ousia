export type DesktopSentryConfig = {
  buildVerificationMarker: string
  dsn: string
  enabled: boolean
  enabledInDevelopment: boolean
  environment: string
  nativeCrashReportsEnabled: boolean
  productId: string
  release: string
}

export function requireDesktopSentryConfig(
  value: unknown
): DesktopSentryConfig {
  if (!value || typeof value !== "object") {
    throw new Error("Desktop Sentry build configuration is missing")
  }
  const config = value as Record<string, unknown>
  const stringFields = [
    "buildVerificationMarker",
    "dsn",
    "environment",
    "productId",
    "release",
  ] as const
  const booleanFields = [
    "enabled",
    "enabledInDevelopment",
    "nativeCrashReportsEnabled",
  ] as const
  for (const field of stringFields) {
    if (typeof config[field] !== "string") {
      throw new Error(
        `Desktop Sentry configuration field ${field} must be a string`
      )
    }
  }
  for (const field of booleanFields) {
    if (typeof config[field] !== "boolean") {
      throw new Error(
        `Desktop Sentry configuration field ${field} must be a boolean`
      )
    }
  }
  if (!config.productId || !config.release || !config.environment) {
    throw new Error(
      "Desktop Sentry productId, release, and environment must be non-empty"
    )
  }
  if (config.enabled && !config.dsn) {
    throw new Error("Enabled Desktop Sentry configuration requires a DSN")
  }
  const expectedBuildVerificationMarker = `desktop-sentry-build:${config.enabled ? "enabled" : "disabled"}:${config.release}`
  if (config.buildVerificationMarker !== expectedBuildVerificationMarker) {
    throw new Error("Desktop Sentry build verification marker is invalid")
  }
  return config as DesktopSentryConfig
}
