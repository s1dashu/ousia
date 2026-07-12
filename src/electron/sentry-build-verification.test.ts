import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

const require = createRequire(__filename)
const { requireEnabledPackagedSentry } =
  require("../../scripts/sentry-build-verification.cjs") as {
    requireEnabledPackagedSentry: (
      bundleSource: string,
      release: string
    ) => void
  }

describe("requireEnabledPackagedSentry", () => {
  it("accepts the exact enabled release marker", () => {
    expect(() =>
      requireEnabledPackagedSentry(
        "desktop-sentry-build:enabled:ousia-desktop@1.2.3",
        "ousia-desktop@1.2.3"
      )
    ).not.toThrow()
  })

  it("rejects a disabled distributable", () => {
    expect(() =>
      requireEnabledPackagedSentry(
        "desktop-sentry-build:disabled:ousia-desktop@1.2.3",
        "ousia-desktop@1.2.3"
      )
    ).toThrow("Refusing to create a distributable with Sentry disabled")
  })
})
