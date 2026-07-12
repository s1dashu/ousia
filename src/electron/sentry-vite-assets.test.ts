import { beforeEach, describe, expect, it, vi } from "vitest"

const { sentryVitePlugin } = vi.hoisted(() => ({
  sentryVitePlugin: vi.fn((options: unknown) => {
    void options
    return { name: "sentry-test" }
  }),
}))

vi.mock("@sentry/vite-plugin", () => ({ sentryVitePlugin }))

import { desktopSentryVite } from "./sentry-vite-build.js"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("desktopSentryVite source-map ownership", () => {
  it("passes the target-owned asset patterns and a fail-fast handler", () => {
    desktopSentryVite({
      command: "build",
      environment: {
        OUSIA_SENTRY_DSN: "https://public@example.ingest.sentry.io/123",
        OUSIA_SENTRY_PROJECT: "ousia-desktop",
        SENTRY_AUTH_TOKEN: "token",
        SENTRY_ORG: "sida-software",
      },
      envPrefix: "OUSIA",
      productId: "ousia",
      releaseName: "ousia-desktop",
      sourcemapAssets: [
        ".vite/build/**/*.js",
        "!.vite/build/preload.js",
      ],
    })

    const options = sentryVitePlugin.mock.calls[0]?.[0] as {
      errorHandler: (error: Error) => void
      sourcemaps: { assets: string[] }
    }
    expect(options.sourcemaps.assets).toEqual([
      ".vite/build/**/*.js",
      "!.vite/build/preload.js",
    ])
    expect(() => options.errorHandler(new Error("parse failed"))).toThrow(
      "parse failed"
    )
  })

  it("rejects an empty source-map ownership contract", () => {
    expect(() =>
      desktopSentryVite({
        command: "serve",
        environment: {},
        envPrefix: "OUSIA",
        productId: "ousia",
        releaseName: "ousia-desktop",
        sourcemapAssets: [],
      })
    ).toThrow("Desktop Sentry source-map assets must not be empty")
  })
})
