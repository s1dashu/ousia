import { describe, expect, it } from "vitest"

import { shouldShowTurnWaitIndicator } from "./chat-turn-wait"

describe("shouldShowTurnWaitIndicator", () => {
  it("is hidden when the agent is idle", () => {
    expect(shouldShowTurnWaitIndicator([], false)).toBe(false)
  })

  it("is hidden while assistant text, thinking, or tools are streaming", () => {
    expect(
      shouldShowTurnWaitIndicator(
        [{ id: "assistant-1", role: "assistant", status: "streaming", text: "" }],
        true
      )
    ).toBe(false)
    expect(
      shouldShowTurnWaitIndicator(
        [{ id: "thinking-1", role: "thinking", status: "streaming", text: "" }],
        true
      )
    ).toBe(false)
    expect(
      shouldShowTurnWaitIndicator(
        [
          {
            id: "tool-1",
            name: "bash",
            role: "tool",
            status: "running",
            text: "{}",
          },
        ],
        true
      )
    ).toBe(false)
  })

  it("is visible when the agent is working but has not emitted output yet", () => {
    expect(shouldShowTurnWaitIndicator([], true)).toBe(true)
  })
})
