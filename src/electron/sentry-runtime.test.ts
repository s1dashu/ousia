import { beforeEach, describe, expect, it, vi } from "vitest"

const { captureException, getDefaultIntegrations, init, writeRuntimeLog } =
  vi.hoisted(() => ({
    captureException: vi.fn(() => "event-id"),
    getDefaultIntegrations: vi.fn(() => [
      { name: "SentryMinidump" },
      { name: "ElectronBreadcrumbs" },
      { name: "GlobalHandlers" },
    ]),
    init: vi.fn(),
    writeRuntimeLog: vi.fn(),
  }))

vi.mock("@sentry/electron/main", () => ({
  captureException,
  getDefaultIntegrations,
  init,
}))
vi.mock("./runtime-logger.js", () => ({ writeRuntimeLog }))

import { initializeDesktopSentry } from "./sentry-runtime.js"
import { captureDesktopHandledError } from "./sentry-handled-errors.js"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("initializeDesktopSentry", () => {
  it("records an explicit disabled state when no DSN is built in", () => {
    expect(
      initializeDesktopSentry({
        buildVerificationMarker:
          "desktop-sentry-build:disabled:ousia-desktop@0.1.25",
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
    expect(
      initializeDesktopSentry({
        buildVerificationMarker:
          "desktop-sentry-build:enabled:ousia-desktop@0.1.25",
        dsn: "https://public@example.ingest.sentry.io/123",
        enabled: true,
        enabledInDevelopment: true,
        environment: "development",
        nativeCrashReportsEnabled: false,
        productId: "ousia",
        release: "ousia-desktop@0.1.25",
      })
    ).toBe(true)
    const options = init.mock.calls[0][0]
    expect(options.defaultIntegrations).toEqual([{ name: "GlobalHandlers" }])
    expect(options).toMatchObject({
      attachScreenshot: false,
      enableLogs: false,
      sendDefaultPii: false,
      tracesSampleRate: 0,
    })
  })

  it("captures handled errors with validated diagnostic tags", () => {
    initializeDesktopSentry({
      buildVerificationMarker:
        "desktop-sentry-build:enabled:ousia-desktop@0.1.25",
      dsn: "https://public@example.ingest.sentry.io/123",
      enabled: true,
      enabledInDevelopment: true,
      environment: "development",
      nativeCrashReportsEnabled: false,
      productId: "ousia",
      release: "ousia-desktop@0.1.25",
    })
    const error = new Error("private provider response")

    expect(
      captureDesktopHandledError(error, {
        errorCode: "update.check_failed",
        operation: "check",
        retryable: true,
        subsystem: "update",
      })
    ).toBe("event-id")
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: {
        error_code: "update.check_failed",
        handled: "true",
        operation: "check",
        retryable: "true",
        subsystem: "update",
      },
    })
  })

  it("rejects unsafe diagnostic values instead of uploading arbitrary data", () => {
    expect(() =>
      captureDesktopHandledError(new Error("private"), {
        errorCode: "/Users/private/project",
        operation: "check",
        retryable: false,
        subsystem: "update",
      })
    ).toThrow("errorCode must be a lowercase diagnostic token")
  })
})
