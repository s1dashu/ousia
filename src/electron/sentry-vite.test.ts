import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  desktopSentryVite,
  loadDesktopSentryEnvironment,
} from "./sentry-vite-build"

const ENVIRONMENT_NAMES = [
  "OUSIA_SENTRY_DSN",
  "OUSIA_SENTRY_ENABLE_IN_DEVELOPMENT",
  "OUSIA_SENTRY_ENABLE_NATIVE_CRASH_REPORTS",
  "OUSIA_SENTRY_ENVIRONMENT",
  "OUSIA_SENTRY_PROJECT",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
] as const

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const name of ENVIRONMENT_NAMES) delete process.env[name]
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
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
  it("loads ignored local environment files before applying process overrides", () => {
    const root = mkdtempSync(join(tmpdir(), "ousia-sentry-env-"))
    temporaryDirectories.push(root)
    writeFileSync(
      join(root, ".env.local"),
      "OUSIA_SENTRY_DSN=https://file@example.ingest.sentry.io/123\n"
    )
    process.env.OUSIA_SENTRY_DSN =
      "https://process@example.ingest.sentry.io/456"

    expect(
      loadDesktopSentryEnvironment({ mode: "development", root })
    ).toMatchObject({
      OUSIA_SENTRY_DSN: "https://process@example.ingest.sentry.io/456",
    })
  })

  it("builds an explicit disabled configuration without credentials", () => {
    const config = JSON.parse(
      String(build("serve").define.__DESKTOP_SENTRY_CONFIG__)
    )
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
