import { describe, expect, it } from "vitest"

import { compareVersions } from "./update-manager.js"

describe("compareVersions", () => {
  it("orders semantic release versions", () => {
    expect(compareVersions("0.1.22", "0.1.21")).toBe(1)
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0)
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1)
  })
})
