import { beforeEach, describe, expect, it, vi } from "vitest"

const { getDefaultIntegrations, init, writeRuntimeLog } = vi.hoisted(() => ({
  getDefaultIntegrations: vi.fn(() => [
    { name: "SentryMinidump" },
    { name: "ElectronBreadcrumbs" },
    { name: "GlobalHandlers" },
  ]),
  init: vi.fn(),
  writeRuntimeLog: vi.fn(),
}))

vi.mock("@sentry/electron/main", () => ({ getDefaultIntegrations, init }))
vi.mock("./runtime-logger.js", () => ({ writeRuntimeLog }))

import { initializeDesktopSentry } from "./sentry-runtime.js"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("initializeDesktopSentry", () => {
  it("records an explicit disabled state when no DSN is built in", () => {
    expect(
      initializeDesktopSentry({
        dsn: "",
        enabled: false,
        enabledInDevelopment: false,
        environment: "development",
        nativeCrashReportsEnabled: false,
        productId: "ousia",
        release: "ousia-desktop@0.1.25",
      })
    ).toBe(false)
    expect(init).not.toHaveBeenCalled()
    expect(writeRuntimeLog).toHaveBeenCalledWith(
      "sentry.init",
      "info",
      expect.objectContaining({ enabled: false, reason: "dsn_not_configured" })
    )
  })

  it("removes sensitive integrations and native dumps by default", () => {
    expect(initializeDesktopSentry({
      dsn: "https://public@example.ingest.sentry.io/123",
      enabled: true,
      enabledInDevelopment: true,
      environment: "development",
      nativeCrashReportsEnabled: false,
      productId: "ousia",
      release: "ousia-desktop@0.1.25",
    })).toBe(true)
    const options = init.mock.calls[0][0]
    expect(options.defaultIntegrations).toEqual([{ name: "GlobalHandlers" }])
    expect(options).toMatchObject({
      attachScreenshot: false,
      enableLogs: false,
      sendDefaultPii: false,
      tracesSampleRate: 0,
    })
  })
})
