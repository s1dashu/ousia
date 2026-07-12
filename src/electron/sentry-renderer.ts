import * as Sentry from "@sentry/electron/renderer"

import { sanitizeSentryEvent } from "./sentry-privacy.js"
import type { DesktopSentryConfig } from "./sentry-config.js"

export function initializeDesktopSentryRenderer(
  config: DesktopSentryConfig,
  processType: "preload" | "renderer"
) {
  if (!config.enabled) return false
  const defaultIntegrations = Sentry.getDefaultIntegrations({}).filter(
    (integration) =>
      !["Breadcrumbs", "BrowserContext", "HttpContext"].includes(
        integration.name
      )
  )
  Sentry.init({
    beforeSend: (event) => sanitizeSentryEvent(event, config.productId, processType),
    defaultIntegrations,
    enableLogs: false,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  })
  return true
}
