import { describe, expect, it, vi } from "vitest"

vi.mock("./pi-package-dir.js", () => ({}))

import { createPiPackageService } from "./pi-package-service.js"

type ConfiguredPackage = {
  filtered: boolean
  installedPath?: string
  scope: "project" | "user"
  source: string
}

function createHarness(initialPackages: ConfiguredPackage[] = []) {
  const configuredPackages = [...initialPackages]
  const installAndPersist = vi.fn(async (source: string) => {
    configuredPackages.push({
      filtered: false,
      installedPath: `/installed/${source.slice("npm:".length)}`,
      scope: "user",
      source,
    })
  })
  const removeAndPersist = vi.fn(async (source: string) => {
    const index = configuredPackages.findIndex(
      (configured) => configured.source === source
    )
    if (index < 0) {
      return false
    }
    configuredPackages.splice(index, 1)
    return true
  })
  const setProgressCallback = vi.fn()
  const flushSettings = vi.fn(async () => {})
  const drainSettingsErrors = vi.fn(
    (): Array<{ error: Error; scope: string }> => []
  )
  const log = vi.fn()
  const createRuntime = vi.fn(() => ({
    drainSettingsErrors,
    flushSettings,
    packageManager: {
      installAndPersist,
      listConfiguredPackages: () => configuredPackages,
      removeAndPersist,
      setProgressCallback,
    },
  }))
  const service = createPiPackageService({
    allowedPackageNames: new Set(["pi-web-access", "@scope/example"]),
    createRuntime,
    log,
  })

  return {
    configuredPackages,
    createRuntime,
    drainSettingsErrors,
    flushSettings,
    installAndPersist,
    log,
    removeAndPersist,
    service,
  }
}

describe("Pi package service", () => {
  it("reports installed and configured-but-missing packages separately", async () => {
    const { service } = createHarness([
      {
        filtered: false,
        installedPath: "/installed/pi-web-access",
        scope: "user",
        source: "npm:pi-web-access",
      },
      {
        filtered: false,
        scope: "user",
        source: "npm:@scope/example@1.2.3",
      },
      {
        filtered: false,
        installedPath: "/installed/outside-catalog",
        scope: "user",
        source: "npm:outside-catalog@2.0.0",
      },
    ])

    await expect(service.listPackages()).resolves.toEqual({
      installedPackageNames: ["pi-web-access", "outside-catalog"],
      missingPackageNames: ["@scope/example"],
    })
  })

  it("installs an allowlisted package and flushes Pi settings", async () => {
    const { flushSettings, installAndPersist, service } = createHarness()

    await expect(
      service.installPackage({ packageName: "pi-web-access" })
    ).resolves.toEqual({
      installedPackageNames: ["pi-web-access"],
      missingPackageNames: [],
    })
    expect(installAndPersist).toHaveBeenCalledWith("npm:pi-web-access")
    expect(flushSettings).toHaveBeenCalledOnce()
  })

  it("removes the exact configured source, including its pinned version", async () => {
    const { flushSettings, removeAndPersist, service } = createHarness([
      {
        filtered: false,
        installedPath: "/installed/example",
        scope: "user",
        source: "npm:@scope/example@1.2.3",
      },
    ])

    await expect(
      service.removePackage({ packageName: "@scope/example" })
    ).resolves.toEqual({
      installedPackageNames: [],
      missingPackageNames: [],
    })
    expect(removeAndPersist).toHaveBeenCalledWith("npm:@scope/example@1.2.3")
    expect(flushSettings).toHaveBeenCalledOnce()
  })

  it("removes an installed npm package that is outside the Explore catalog", async () => {
    const { removeAndPersist, service } = createHarness([
      {
        filtered: false,
        installedPath: "/installed/outside-catalog",
        scope: "user",
        source: "npm:outside-catalog@2.0.0",
      },
    ])

    await expect(
      service.removePackage({ packageName: "outside-catalog" })
    ).resolves.toEqual({
      installedPackageNames: [],
      missingPackageNames: [],
    })
    expect(removeAndPersist).toHaveBeenCalledWith("npm:outside-catalog@2.0.0")
  })

  it("rejects packages outside the catalog before creating a runtime", async () => {
    const { createRuntime, service } = createHarness()

    await expect(
      service.installPackage({ packageName: "not-in-the-catalog" })
    ).rejects.toThrow("not present in the local catalog")
    expect(createRuntime).not.toHaveBeenCalled()
  })

  it("surfaces Pi settings persistence failures after installation", async () => {
    const { drainSettingsErrors, service } = createHarness()
    drainSettingsErrors
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { error: new Error("settings write failed"), scope: "global" },
      ])

    await expect(
      service.installPackage({ packageName: "pi-web-access" })
    ).rejects.toThrow("settings write failed")
  })
})
