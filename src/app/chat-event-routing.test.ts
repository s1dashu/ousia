import { describe, expect, it } from "vitest"

import {
  findWorkingChatSession,
  resolveChatEventTarget,
} from "./chat-event-routing"

const sessions = [
  { id: "session-a", title: "A" },
  { id: "session-b", title: "B" },
]

describe("resolveChatEventTarget", () => {
  it("routes contextual events to their existing session", () => {
    expect(
      resolveChatEventTarget(
        sessions,
        { projectPath: "/workspace/b", sessionId: "session-b" },
        "/workspace/a::session-a"
      )
    ).toEqual({
      kind: "context",
      session: sessions[1],
      targetKey: "/workspace/b::session-b",
    })
  })

  it("drops contextual events for a deleted session instead of using the selected chat", () => {
    expect(
      resolveChatEventTarget(
        sessions,
        { projectPath: "/workspace/deleted", sessionId: "deleted-session" },
        "/workspace/a::session-a"
      )
    ).toEqual({
      context: {
        projectPath: "/workspace/deleted",
        sessionId: "deleted-session",
      },
      kind: "drop",
      reason: "unknown-context-session",
    })
  })

  it("keeps the selected-chat behavior for legacy events without context", () => {
    expect(
      resolveChatEventTarget(sessions, undefined, "/workspace/a::session-a")
    ).toEqual({
      kind: "selected",
      targetKey: "/workspace/a::session-a",
    })
  })

  it("drops context-free events when there is no selected chat", () => {
    expect(resolveChatEventTarget(sessions, undefined, "")).toEqual({
      kind: "drop",
      reason: "missing-selected-chat",
    })
  })
})

describe("findWorkingChatSession", () => {
  it("finds an active session using its project-scoped chat key", () => {
    expect(
      findWorkingChatSession(sessions, "/workspace", {
        "/workspace::session-a": "idle",
        "/workspace::session-b": "working",
      })
    ).toBe(sessions[1])
  })

  it("does not confuse matching session ids from a different project", () => {
    expect(
      findWorkingChatSession(sessions, "/workspace", {
        "/other::session-a": "working",
      })
    ).toBeUndefined()
  })
})
