import { describe, expect, it } from "vitest"

import {
  chatMessageIdFingerprint,
  ChatMessageReplayGuard,
} from "./chat-message-replay-guard"

describe("ChatMessageReplayGuard", () => {
  it("rejects a repeated message id in the same session", () => {
    const guard = new ChatMessageReplayGuard()
    guard.claim("session-a", "user-1")

    expect(() => guard.claim("session-a", "user-1")).toThrow(
      "Duplicate chat message id"
    )
    expect(() => guard.claim("session-b", "user-1")).not.toThrow()
  })

  it("keeps message and session registries bounded", () => {
    const guard = new ChatMessageReplayGuard(2, 2)
    guard.claim("session-a", "user-1")
    guard.claim("session-a", "user-2")
    guard.claim("session-a", "user-3")
    expect(() => guard.claim("session-a", "user-1")).not.toThrow()

    guard.claim("session-b", "user-1")
    guard.claim("session-c", "user-1")
    expect(() => guard.claim("session-a", "user-3")).not.toThrow()
  })

  it("fails fast for invalid bounds", () => {
    expect(() => new ChatMessageReplayGuard(0, 1)).toThrow("positive integers")
    expect(() => new ChatMessageReplayGuard(1, 1.5)).toThrow(
      "positive integers"
    )
  })
})

describe("chatMessageIdFingerprint", () => {
  it("creates a stable non-reversible log identifier", () => {
    const fingerprint = chatMessageIdFingerprint("user-private-value")

    expect(fingerprint).toMatch(/^[a-f0-9]{12}$/)
    expect(fingerprint).toBe(chatMessageIdFingerprint("user-private-value"))
    expect(fingerprint).not.toContain("private")
  })
})
