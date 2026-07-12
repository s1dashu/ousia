import { createRequire } from "node:module"
import { describe, expect, it, vi } from "vitest"

const require = createRequire(__filename)
const { loadSentryBuildToken } = require(
  "../../scripts/sentry-build-credentials.cjs"
) as {
  loadSentryBuildToken: (options: {
    environment: Record<string, string | undefined>
    platform: string
    readPassword?: () => {
      error?: Error
      status: number
      stdout: string
    }
  }) => string
}

describe("loadSentryBuildToken", () => {
  it("preserves an explicitly supplied build token", () => {
    const environment = { SENTRY_AUTH_TOKEN: "from-environment" }
    const readPassword = vi.fn()

    expect(
      loadSentryBuildToken({ environment, platform: "darwin", readPassword })
    ).toBe("environment")
    expect(readPassword).not.toHaveBeenCalled()
  })

  it("loads a missing token from macOS Keychain without logging it", () => {
    const environment: Record<string, string | undefined> = {}

    expect(
      loadSentryBuildToken({
        environment,
        platform: "darwin",
        readPassword: () => ({ status: 0, stdout: "keychain-token\n" }),
      })
    ).toBe("keychain")
    expect(environment.SENTRY_AUTH_TOKEN).toBe("keychain-token")
  })

  it("leaves the token unset when the keychain entry does not exist", () => {
    const environment: Record<string, string | undefined> = {}

    expect(
      loadSentryBuildToken({
        environment,
        platform: "darwin",
        readPassword: () => ({ status: 44, stdout: "" }),
      })
    ).toBe("unavailable")
    expect(environment.SENTRY_AUTH_TOKEN).toBeUndefined()
  })
})
