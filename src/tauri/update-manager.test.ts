import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  getVersion: vi.fn(),
  invoke: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }))
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }))

function createUpdate(version = "0.2.4") {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    currentVersion: "0.2.3",
    download: vi.fn().mockImplementation(async (onEvent) => {
      onEvent?.({ event: "Started", data: { contentLength: 12 } })
      onEvent?.({ event: "Progress", data: { chunkLength: 12 } })
      onEvent?.({ event: "Finished" })
    }),
    install: vi.fn().mockResolvedValue(undefined),
    rawJson: { name: `Pi v${version}` },
    rid: 7,
    version,
  }
}

describe("Tauri update manager", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    mocks.check.mockReset()
    mocks.getVersion.mockReset().mockResolvedValue("0.2.3")
    mocks.invoke.mockReset().mockResolvedValue(undefined)
    mocks.relaunch.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it("stays idle when the release feed has no newer version", async () => {
    mocks.check.mockResolvedValue(null)
    const manager = await import("./update-manager")

    await expect(manager.getUpdateStatus()).resolves.toEqual({
      currentVersion: "0.2.3",
      phase: "idle",
    })
  })

  it("publishes an available update and completes download and install", async () => {
    const update = createUpdate()
    mocks.check.mockResolvedValue(update)
    const manager = await import("./update-manager")
    const statuses: string[] = []
    manager.onUpdateStatus((next) => statuses.push(next.phase))

    await expect(manager.getUpdateStatus()).resolves.toMatchObject({
      phase: "available",
      releaseName: "Pi v0.2.4",
      version: "0.2.4",
    })
    await expect(manager.downloadUpdate()).resolves.toEqual({ ok: true })
    await expect(manager.installUpdate()).resolves.toEqual({ ok: true })

    expect(update.download).toHaveBeenCalledOnce()
    expect(update.install).toHaveBeenCalledOnce()
    expect(mocks.relaunch).toHaveBeenCalledOnce()
    expect(statuses).toEqual(["available", "downloading", "downloaded"])
  })

  it("keeps background update-check failures out of the update control", async () => {
    mocks.check
      .mockRejectedValueOnce(new Error("release feed unavailable"))
      .mockResolvedValueOnce(null)
    const manager = await import("./update-manager")

    await expect(manager.getUpdateStatus()).resolves.toMatchObject({
      message: "release feed unavailable",
      phase: "unavailable",
    })
  })

  it("keeps a failed download retryable", async () => {
    const update = createUpdate()
    update.download.mockRejectedValue(new Error("download interrupted"))
    mocks.check.mockResolvedValue(update)
    const manager = await import("./update-manager")

    await manager.getUpdateStatus()
    await expect(manager.downloadUpdate()).resolves.toEqual({
      error: "download interrupted",
      ok: false,
    })
    await expect(manager.getUpdateStatus()).resolves.toMatchObject({
      message: "download interrupted",
      phase: "error",
      version: "0.2.4",
    })
  })
})
