import { describe, expect, it } from "vitest"

import { sidebarDragLandingDurationMs } from "./sidebar-drag-motion"

describe("sidebar drag landing motion", () => {
  it("uses a bounded distance-aware tween duration", () => {
    expect(sidebarDragLandingDurationMs(0)).toBe(180)
    expect(sidebarDragLandingDurationMs(120)).toBe(230)
    expect(sidebarDragLandingDurationMs(336)).toBe(320)
    expect(sidebarDragLandingDurationMs(1_000)).toBe(320)
  })

  it("rejects invalid landing distances", () => {
    expect(() => sidebarDragLandingDurationMs(-1)).toThrow(
      "finite non-negative number",
    )
    expect(() => sidebarDragLandingDurationMs(Number.NaN)).toThrow(
      "finite non-negative number",
    )
    expect(() =>
      sidebarDragLandingDurationMs(Number.POSITIVE_INFINITY),
    ).toThrow("finite non-negative number")
  })
})
