import { describe, expect, it } from "vitest"

import {
  reasoningEffortLabel,
  reasoningPreferencePatch,
  resolveModelReasoningEffort,
} from "./reasoning-efforts"

describe("resolveModelReasoningEffort", () => {
  const sol = {
    modelId: "gpt-5.6-sol",
    thinkingLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultThinkingLevel: "low",
  }

  it("uses the Codex model default when no explicit preference exists", () => {
    expect(resolveModelReasoningEffort(sol, null)).toBe("low")
  })

  it("keeps an explicit supported Codex preference", () => {
    expect(resolveModelReasoningEffort(sol, "ultra")).toBe("ultra")
  })

  it("uses the selected model default when a preference is unsupported", () => {
    expect(
      resolveModelReasoningEffort(
        {
          modelId: "gpt-5.3-codex-spark",
          thinkingLevels: ["low", "medium", "high", "xhigh"],
          defaultThinkingLevel: "high",
        },
        "ultra"
      )
    ).toBe("high")
  })

  it("retains the existing Pi fallback behavior without model metadata", () => {
    expect(
      resolveModelReasoningEffort(
        {
          modelId: "pi-model",
          thinkingLevels: ["off", "medium", "high"],
        },
        "ultra"
      )
    ).toBe("medium")
  })

  it("fails fast for invalid model reasoning metadata", () => {
    expect(() =>
      resolveModelReasoningEffort(
        {
          modelId: "broken-model",
          thinkingLevels: ["low", "high"],
          defaultThinkingLevel: "medium",
        },
        null
      )
    ).toThrow("invalid default reasoning effort")
  })
})

describe("reasoningEffortLabel", () => {
  it("labels known Codex efforts and preserves future protocol values", () => {
    expect(reasoningEffortLabel("max")).toBe("Max")
    expect(reasoningEffortLabel("ultra")).toBe("Ultra")
    expect(reasoningEffortLabel("future-depth")).toBe("future-depth")
  })
})

describe("reasoningPreferencePatch", () => {
  it("stores Pi and Codex preferences in separate settings", () => {
    expect(reasoningPreferencePatch("pi", "high")).toEqual({
      thinkingLevel: "high",
    })
    expect(reasoningPreferencePatch("codex", " ultra ")).toEqual({
      codexReasoningEffort: "ultra",
    })
    expect(() => reasoningPreferencePatch("pi", "ultra")).toThrow(
      "Unsupported Pi thinking level"
    )
  })
})
