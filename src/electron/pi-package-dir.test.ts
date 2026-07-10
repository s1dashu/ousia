import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  writeRuntimeLog: vi.fn(),
}))

vi.mock("electron", () => ({
  app: { getAppPath: () => "/tmp/app" },
}))

vi.mock("./runtime-logger.js", () => ({
  writeRuntimeLog: mocks.writeRuntimeLog,
}))

describe("Pi package directory bootstrap", () => {
  const originalPiPackageDir = process.env.PI_PACKAGE_DIR

  beforeEach(() => {
    vi.resetModules()
    mocks.writeRuntimeLog.mockClear()
    delete process.env.PI_PACKAGE_DIR
  })

  afterEach(() => {
    if (originalPiPackageDir === undefined) {
      delete process.env.PI_PACKAGE_DIR
    } else {
      process.env.PI_PACKAGE_DIR = originalPiPackageDir
    }
  })

  it("has no import-time path or logger side effects", async () => {
    await import("./pi-package-dir.js")

    expect(process.env.PI_PACKAGE_DIR).toBeUndefined()
    expect(mocks.writeRuntimeLog).not.toHaveBeenCalled()
  })
})
