import { describe, expect, it } from "vitest"

import {
  shouldResetEmptyChatHistory,
  shouldRetryChatHistoryAfterSelection,
  shouldScheduleAutomaticChatHistoryRetry,
} from "./chat-history-state"

describe("chat history state", () => {
  it("does not clear a failed load and trigger an automatic retry loop", () => {
    expect(shouldResetEmptyChatHistory("error", 0)).toBe(false)
  })

  it("clears only an inconsistent ready state with no items", () => {
    expect(shouldResetEmptyChatHistory("ready", 0)).toBe(true)
    expect(shouldResetEmptyChatHistory("ready", 1)).toBe(false)
    expect(shouldResetEmptyChatHistory("empty", 0)).toBe(false)
  })

  it("allows a failed history to retry only after the user changes selection", () => {
    expect(
      shouldRetryChatHistoryAfterSelection("session-a", "session-b", "error")
    ).toBe(true)
    expect(
      shouldRetryChatHistoryAfterSelection("session-b", "session-b", "error")
    ).toBe(false)
    expect(
      shouldRetryChatHistoryAfterSelection("session-a", "session-b", "ready")
    ).toBe(false)
  })

  it("permits one bounded automatic retry instead of an unbounded loop", () => {
    expect(shouldScheduleAutomaticChatHistoryRetry(0)).toBe(true)
    expect(shouldScheduleAutomaticChatHistoryRetry(1)).toBe(false)
  })
})
