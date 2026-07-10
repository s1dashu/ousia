import { describe, expect, it } from "vitest"

import type { OusiaCodexEnvironmentStatus } from "@/electron/chat-types"
import { codexSendBlockReason } from "./chat-provider-readiness"

function status(
  overrides: Partial<OusiaCodexEnvironmentStatus> = {}
): OusiaCodexEnvironmentStatus {
  return {
    account: { type: "chatgpt" },
    available: true,
    models: [],
    requiresOpenaiAuth: true,
    runtime: "bundled",
    ...overrides,
  }
}

describe("Codex send readiness", () => {
  it("allows a send while cold environment discovery is still pending", () => {
    expect(codexSendBlockReason(undefined)).toBeUndefined()
  })

  it("blocks only a confirmed unavailable or unauthenticated environment", () => {
    expect(codexSendBlockReason(status({ available: false }))).toBe(
      "unavailable"
    )
    expect(codexSendBlockReason(status({ account: null }))).toBe(
      "sign-in-required"
    )
    expect(codexSendBlockReason(status())).toBeUndefined()
  })
})
