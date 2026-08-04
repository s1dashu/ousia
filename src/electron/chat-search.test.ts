import { describe, expect, it, vi } from "vitest"

import { createDefaultOusiaAppState } from "./chat-types.js"
import {
  optionalChatSearchSessionId,
  requireChatSearchQuery,
  searchChatHistories,
} from "./chat-search.js"

describe("chat search", () => {
  it("matches titles without reading that conversation history", async () => {
    const state = createDefaultOusiaAppState()
    state.sessions[0].title = "Release checklist"
    const getHistory = vi.fn(async () => [])

    const result = await searchChatHistories({
      getHistory,
      query: "release",
      state,
    })

    expect(result.items).toMatchObject([
      { match: "title", sessionId: state.sessions[0].id },
    ])
    expect(getHistory).not.toHaveBeenCalled()
  })

  it("matches user and assistant content and returns a compact snippet", async () => {
    const state = createDefaultOusiaAppState()
    const result = await searchChatHistories({
      getHistory: async () => [
        {
          id: "message-1",
          role: "assistant",
          text: "The deployment uses a blue green release strategy.",
        },
      ],
      query: "BLUE GREEN",
      state,
    })

    expect(result.items).toMatchObject([
      {
        match: "content",
        sessionId: state.sessions[0].id,
        snippet: "The deployment uses a blue green release strategy.",
      },
    ])
  })

  it("returns individual message matches when scoped to one conversation", async () => {
    const state = createDefaultOusiaAppState()
    const sessionId = state.sessions[0].id
    const result = await searchChatHistories({
      getHistory: async () => [
        { id: "user-1", role: "user", text: "Find the release notes" },
        { id: "assistant-1", role: "assistant", text: "Release notes found" },
      ],
      query: "release",
      sessionId,
      state,
    })

    expect(result.items).toMatchObject([
      { itemId: "assistant-1", role: "assistant", sessionId },
      { itemId: "user-1", role: "user", sessionId },
    ])
  })

  it("rejects malformed and oversized IPC queries", () => {
    expect(() => requireChatSearchQuery({})).toThrow(/contain a query/)
    expect(() => requireChatSearchQuery({ query: "x".repeat(201) })).toThrow(
      /must not exceed/
    )
    expect(() => optionalChatSearchSessionId({ sessionId: 42 })).toThrow(
      /non-empty string/
    )
  })
})
