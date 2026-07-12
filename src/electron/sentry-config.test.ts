import { describe, expect, it } from "vitest"

import { requireDesktopSentryConfig } from "./sentry-config.js"

describe("requireDesktopSentryConfig", () => {
  it("accepts a complete disabled product configuration", () => {
    expect(
      requireDesktopSentryConfig({
        dsn: "",
        enabled: false,
        enabledInDevelopment: false,
        environment: "development",
        nativeCrashReportsEnabled: false,
        productId: "ousia",
        release: "ousia-desktop@0.1.25",
      })
    ).toMatchObject({ enabled: false, productId: "ousia" })
  })

  it("fails when an enabled build has no DSN", () => {
    expect(() =>
      requireDesktopSentryConfig({
        dsn: "",
        enabled: true,
        enabledInDevelopment: false,
        environment: "production",
        nativeCrashReportsEnabled: false,
        productId: "ousia",
        release: "ousia-desktop@0.1.25",
      })
    ).toThrow("Enabled Desktop Sentry configuration requires a DSN")
  })
})
