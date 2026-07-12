import * as Sentry from "@sentry/electron/main"

import { sanitizeSentryEvent } from "./sentry-privacy.js"
import type { DesktopSentryConfig } from "./sentry-config.js"
import { configureDesktopHandledErrorCapture } from "./sentry-handled-errors.js"
import { writeRuntimeLog } from "./runtime-logger.js"

const PRIVATE_DEFAULT_INTEGRATIONS = new Set([
  "AdditionalContext",
  "ContextLines",
  "ElectronBreadcrumbs",
  "ElectronNet",
  "GPUContext",
  "LocalVariables",
  "NodeContext",
  "Screenshots",
])

export function initializeDesktopSentry(config: DesktopSentryConfig) {
  if (!config.enabled) {
    configureDesktopHandledErrorCapture(undefined)
    writeRuntimeLog("sentry.init", "info", {
      enabled: false,
      productId: config.productId,
      reason: config.dsn ? "development_disabled" : "dsn_not_configured",
    })
    return false
  }

  const defaultIntegrations = Sentry.getDefaultIntegrations({
    dsn: config.dsn,
  }).filter((integration) => {
    if (PRIVATE_DEFAULT_INTEGRATIONS.has(integration.name)) return false
    if (integration.name === "SentryMinidump") {
      return config.nativeCrashReportsEnabled
    }
    return true
  })
  Sentry.init({
    attachScreenshot: false,
    beforeSend: (event) => sanitizeSentryEvent(event, config.productId, "main"),
    defaultIntegrations,
    dsn: config.dsn,
    enableLogs: false,
    environment: config.environment,
    initialScope: {
      tags: { process_type: "main", product_id: config.productId },
    },
    release: config.release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  })
  configureDesktopHandledErrorCapture((error, context) =>
    Sentry.captureException(error, context)
  )
  writeRuntimeLog("sentry.init", "info", {
    enabled: true,
    environment: config.environment,
    nativeCrashReportsEnabled: config.nativeCrashReportsEnabled,
    productId: config.productId,
    release: config.release,
  })
  return true
}
