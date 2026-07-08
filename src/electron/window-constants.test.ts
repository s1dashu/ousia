import { describe, expect, it } from "vitest"

import { resolveMacTrafficLightPosition } from "./window-constants"

describe("window constants", () => {
  it("keeps traffic lights aligned at default zoom", () => {
    expect(resolveMacTrafficLightPosition()).toEqual({ x: 14, y: 13 })
  })

  it("scales traffic light y position with zoom", () => {
    expect(resolveMacTrafficLightPosition(1.5)).toEqual({ x: 14, y: 23 })
  })
})
