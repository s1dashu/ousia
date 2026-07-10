import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>()
  return { ...original, homedir: () => "/Users/test" }
})

describe("runtime logger product paths", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("fails before the composition root configures the logger", async () => {
    const { getDesktopRuntimeLogPath } = await import("./runtime-logger.js")
    expect(() => getDesktopRuntimeLogPath()).toThrow(
      "Runtime logger has not been configured"
    )
  })

  it("uses a frozen non-Ousia product snapshot", async () => {
    const {
      configureRuntimeLogger,
      getDesktopRuntimeLogPath,
      getRuntimeLogDirectoryPath,
    } = await import("./runtime-logger.js")
    const identity = { id: "other", displayName: "Other" }
    const pathPolicy = {
      userDataDirectoryName: "other-desktop",
      runtimeLog: {
        homeDirectoryName: ".other",
        directoryName: "diagnostics",
        fileName: "other.log",
      },
    }

    configureRuntimeLogger(identity, pathPolicy)
    pathPolicy.runtimeLog.fileName = "mutated.log"

    expect(getRuntimeLogDirectoryPath()).toBe(
      "/Users/test/.other/diagnostics"
    )
    expect(getDesktopRuntimeLogPath()).toBe(
      "/Users/test/.other/diagnostics/other.log"
    )
  })
})
