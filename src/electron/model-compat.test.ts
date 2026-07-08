import { describe, expect, it } from "vitest"

import {
  isDeprecatedProviderModelId,
  normalizeProviderModelId,
} from "./model-compat"

describe("model compatibility aliases", () => {
  it("maps deprecated Vercel AI Gateway Grok ids", () => {
    expect(
      normalizeProviderModelId(
        "vercel-ai-gateway",
        "xai/grok-4-fast-non-reasoning"
      )
    ).toBe("xai/grok-4.1-fast-non-reasoning")
    expect(
      normalizeProviderModelId(
        "vercel-ai-gateway",
        "xai/grok-4-fast-reasoning"
      )
    ).toBe("xai/grok-4.1-fast-reasoning")
  })

  it("detects deprecated ids without changing unknown ids", () => {
    expect(
      isDeprecatedProviderModelId(
        "vercel-ai-gateway",
        "xai/grok-4-fast-reasoning"
      )
    ).toBe(true)
    expect(isDeprecatedProviderModelId("openai", "gpt-5")).toBe(false)
    expect(normalizeProviderModelId("openai", "gpt-5")).toBe("gpt-5")
  })
})
