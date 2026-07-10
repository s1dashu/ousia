import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name !== "appData") {
      throw new Error(`Unexpected Electron path: ${name}`)
    }
    return "/Users/test/Library/Application Support"
  }),
  setName: vi.fn(),
  setPath: vi.fn(),
}))

vi.mock("electron", () => ({
  app: electronMocks,
}))

describe("desktop app paths", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("fails before the composition root supplies a product", async () => {
    const { getCanonicalUserDataPath } = await import("./app-paths.js")
    expect(() => getCanonicalUserDataPath()).toThrow(
      "Desktop app paths have not been configured"
    )
  })

  it("uses Ousia's compile-time product definition", async () => {
    const { configureDesktopAppPaths, getCanonicalUserDataPath } = await import(
      "./app-paths.js"
    )
    const { OUSIA_DESKTOP_PATH_POLICY, OUSIA_PRODUCT_IDENTITY } = await import(
      "./ousia-product.js"
    )

    configureDesktopAppPaths(
      OUSIA_PRODUCT_IDENTITY,
      OUSIA_DESKTOP_PATH_POLICY
    )

    expect(electronMocks.setName).toHaveBeenCalledWith("Ousia")
    expect(electronMocks.setPath).toHaveBeenCalledWith(
      "userData",
      "/Users/test/Library/Application Support/ousia-desktop"
    )
    expect(getCanonicalUserDataPath()).toBe(
      "/Users/test/Library/Application Support/ousia-desktop"
    )
  })

  it("snapshots a second product without leaking Ousia constants", async () => {
    const { configureDesktopAppPaths, getCanonicalUserDataPath } = await import(
      "./app-paths.js"
    )
    const identity = { id: "other", displayName: "Other" }
    const pathPolicy = {
      userDataDirectoryName: "other-desktop",
      runtimeLog: {
        homeDirectoryName: ".other",
        directoryName: "logs",
        fileName: "other.log",
      },
    }

    configureDesktopAppPaths(identity, pathPolicy)
    pathPolicy.userDataDirectoryName = "mutated"

    expect(electronMocks.setName).toHaveBeenCalledWith("Other")
    expect(getCanonicalUserDataPath()).toBe(
      "/Users/test/Library/Application Support/other-desktop"
    )
  })
})
