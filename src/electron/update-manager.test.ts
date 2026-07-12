import { beforeEach, describe, expect, it, vi } from "vitest"

const { autoUpdater, writeRuntimeLog } = vi.hoisted(() => ({
  autoUpdater: {
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  writeRuntimeLog: vi.fn(),
}))

vi.mock("electron", () => ({ autoUpdater }))
vi.mock("./runtime-logger.js", () => ({ writeRuntimeLog }))

import { compareVersions, createUpdateManager } from "./update-manager.js"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("compareVersions", () => {
  it("orders semantic release versions", () => {
    expect(compareVersions("0.1.22", "0.1.21")).toBe(1)
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0)
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1)
  })
})

describe("createUpdateManager", () => {
  function createManager(fetchRelease: typeof fetch) {
    return createUpdateManager({
      currentVersion: "0.1.23",
      fetchRelease,
      getWindow: () => undefined,
      isPackaged: true,
      serviceBaseUrl: "https://updates.example.test",
    })
  }

  it("publishes an available update from the injected release transport", async () => {
    const fetchRelease = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            version: "0.1.24",
            releaseName: "Ousia 0.1.24",
          }),
          { status: 200 }
        )
      )
    )
    const manager = createManager(fetchRelease)

    await expect(manager.check("manual")).resolves.toEqual({
      phase: "available",
      currentVersion: "0.1.23",
      version: "0.1.24",
      releaseName: "Ousia 0.1.24",
    })
    expect(fetchRelease).toHaveBeenCalledWith(
      "https://updates.example.test/api/releases/latest?platform=darwin&arch=arm64",
      expect.objectContaining({
        headers: { "user-agent": "Ousia/0.1.23" },
      })
    )
  })

  it("reports that the current version is up to date", async () => {
    const fetchRelease = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            version: "0.1.23",
            releaseName: "Ousia 0.1.23",
          }),
          { status: 200 }
        )
      )
    )
    const manager = createManager(fetchRelease)

    await expect(manager.check("manual")).resolves.toEqual({
      phase: "idle",
      currentVersion: "0.1.23",
    })
  })

  it("makes failed startup checks visible and traceable", async () => {
    const fetchRelease = vi.fn<typeof fetch>(async () => {
      throw new Error("fetch failed")
    })
    const manager = createManager(fetchRelease)

    await expect(manager.check("startup")).resolves.toEqual({
      phase: "error",
      currentVersion: "0.1.23",
      message: "fetch failed",
    })
    expect(writeRuntimeLog).toHaveBeenCalledWith(
      "update.state",
      "error",
      expect.objectContaining({ message: "fetch failed" })
    )
  })
})
