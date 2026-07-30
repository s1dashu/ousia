import { describe, expect, it } from "vitest"

import {
  clampPercentage,
  formatContextUsagePercent,
  getContextUsagePercent,
} from "@/features/chat/chat-context-usage"

describe("clampPercentage", () => {
  it("clamps into the 0-100 range", () => {
    expect(clampPercentage(-5)).toBe(0)
    expect(clampPercentage(42)).toBe(42)
    expect(clampPercentage(250)).toBe(100)
  })
})

describe("getContextUsagePercent", () => {
  it("prefers a valid explicit percent", () => {
    expect(
      getContextUsagePercent({ tokens: 10, contextWindow: 100, percent: 55 })
    ).toBe(55)
  })

  it("clamps an out-of-range explicit percent", () => {
    expect(
      getContextUsagePercent({ tokens: 0, contextWindow: 100, percent: 140 })
    ).toBe(100)
  })

  it("derives percent from tokens and context window", () => {
    expect(
      getContextUsagePercent({
        tokens: 25,
        contextWindow: 200,
        percent: Number.NaN,
      })
    ).toBeCloseTo(12.5)
  })

  it("returns undefined when nothing usable is available", () => {
    expect(getContextUsagePercent(undefined)).toBeUndefined()
    expect(
      getContextUsagePercent({ tokens: null, contextWindow: 0, percent: null })
    ).toBeUndefined()
    expect(
      getContextUsagePercent({ tokens: -1, contextWindow: 100, percent: null })
    ).toBeUndefined()
  })
})

describe("formatContextUsagePercent", () => {
  it("keeps one decimal below 10 percent", () => {
    expect(formatContextUsagePercent(3.456)).toBe("3.5")
  })

  it("rounds to an integer at or above 10 percent", () => {
    expect(formatContextUsagePercent(12.4)).toBe("12")
    expect(formatContextUsagePercent(99.6)).toBe("100")
  })
})
