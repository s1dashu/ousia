import { describe, expect, it } from "vitest"

import {
  defineDesktopPathPolicy,
  defineProductIdentity,
  snapshotDesktopPathPolicy,
} from "../src/index.js"

describe("product identity and desktop path policy", () => {
  it("validates and snapshots product-owned values", () => {
    const source = {
      id: "test-product",
      displayName: "Test Product",
    }
    const identity = defineProductIdentity(source)

    source.displayName = "Mutated"
    expect(identity).toEqual({
      id: "test-product",
      displayName: "Test Product",
    })
    expect(Object.isFrozen(identity)).toBe(true)
  })

  it("keeps path policy independent from product identity and freezes it", () => {
    const runtimeLog = {
      homeDirectoryName: ".test-product",
      directoryName: "logs",
      fileName: "desktop.log",
    }
    const policy = defineDesktopPathPolicy({
      userDataDirectoryName: "test-product-desktop",
      runtimeLog,
    })

    runtimeLog.fileName = "mutated.log"
    expect(policy.runtimeLog.fileName).toBe("desktop.log")
    expect(Object.isFrozen(policy)).toBe(true)
    expect(Object.isFrozen(policy.runtimeLog)).toBe(true)
  })

  it("rejects unknown fields and unsafe path components", () => {
    const invalidIdentity = {
        id: "test",
        displayName: "Test",
        protocol: "test-asset",
      } as unknown
    expect(() =>
      defineProductIdentity(invalidIdentity as { id: string; displayName: string })
    ).toThrow("productIdentity.protocol is not supported")

    expect(() =>
      snapshotDesktopPathPolicy({
        userDataDirectoryName: "nested/path",
        runtimeLog: {
          homeDirectoryName: ".test",
          directoryName: "logs",
          fileName: "desktop.log",
        },
      })
    ).toThrow("single safe path component")
  })
})
