import { afterEach, describe, expect, it } from "vitest"

import { desktopSentryVite } from "./sentry-vite-build"

const ENVIRONMENT_NAMES = [
  "OUSIA_SENTRY_DSN",
  "OUSIA_SENTRY_ENABLE_IN_DEVELOPMENT",
  "OUSIA_SENTRY_ENABLE_NATIVE_CRASH_REPORTS",
  "OUSIA_SENTRY_ENVIRONMENT",
  "OUSIA_SENTRY_PROJECT",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
] as const

afterEach(() => {
  for (const name of ENVIRONMENT_NAMES) delete process.env[name]
})

function build(command: "build" | "serve") {
  return desktopSentryVite({
    command,
    envPrefix: "OUSIA",
    productId: "ousia",
    releaseName: "ousia-desktop",
  })
}

describe("desktopSentryVite", () => {
  it("builds an explicit disabled configuration without credentials", () => {
    const config = JSON.parse(String(build("serve").define.__DESKTOP_SENTRY_CONFIG__))
    expect(config).toMatchObject({
      dsn: "",
      enabled: false,
      environment: "development",
      productId: "ousia",
    })
  })

  it("requires source-map credentials for an enabled production build", () => {
    process.env.OUSIA_SENTRY_DSN = "https://public@example.ingest.sentry.io/123"
    expect(() => build("build")).toThrow(
      "A Sentry-enabled production build requires source-map upload credentials"
    )
  })

  it("rejects partial source-map credentials", () => {
    process.env.SENTRY_ORG = "example"
    expect(() => build("serve")).toThrow(
      "Source-map upload requires SENTRY_AUTH_TOKEN, SENTRY_ORG, and OUSIA_SENTRY_PROJECT together"
    )
  })
})
