import { describe, expect, it, vi } from "vitest"

import { permanentlyDeleteArchivedSessions } from "./permanent-session-deletion.js"
import { createDefaultOusiaAppState, type OusiaAppState } from "./chat-types.js"

function archivedState(): OusiaAppState {
  const state = createDefaultOusiaAppState()
  state.sessions = [
    {
      ...state.sessions[0],
      archivedAt: "2026-07-12T10:00:00.000Z",
      id: "session-1",
    },
    {
      ...state.sessions[0],
      archivedAt: "2026-07-12T11:00:00.000Z",
      id: "session-2",
    },
  ]
  state.selectedSessionId = ""
  return state
}

describe("permanent session deletion", () => {
  it("deletes provider data before removing each canonical app-state record", async () => {
    let state = archivedState()
    const order: string[] = []
    const result = await permanentlyDeleteArchivedSessions(
      { sessionIds: ["session-1", "session-2"] },
      {
        deleteAppStateSessions: async ({ sessionIds }) => {
          order.push(`state:${sessionIds[0]}`)
          const removedSessions = state.sessions.filter((session) =>
            sessionIds.includes(session.id)
          )
          state = {
            ...state,
            sessions: state.sessions.filter(
              (session) => !sessionIds.includes(session.id)
            ),
          }
          return { ok: true, removedSessions, state }
        },
        loadAppState: async () => state,
        provider: {
          deleteChatSession: vi.fn(async ({ sessionId }) => {
            order.push(`provider:${sessionId}`)
          }),
        },
        writeLog: vi.fn(),
      }
    )

    expect(result.ok).toBe(true)
    expect(order).toEqual([
      "provider:session-1",
      "state:session-1",
      "provider:session-2",
      "state:session-2",
    ])
    expect(state.sessions).toEqual([])
  })

  it("keeps the failed and remaining records when provider deletion fails", async () => {
    let state = archivedState()
    const result = await permanentlyDeleteArchivedSessions(
      { sessionIds: ["session-1", "session-2"] },
      {
        deleteAppStateSessions: async ({ sessionIds }) => {
          state = {
            ...state,
            sessions: state.sessions.filter(
              (session) => !sessionIds.includes(session.id)
            ),
          }
          return { ok: true, state }
        },
        loadAppState: async () => state,
        provider: {
          deleteChatSession: vi.fn(async ({ sessionId }) => {
            if (sessionId === "session-2") {
              throw new Error("disk denied")
            }
          }),
        },
        writeLog: vi.fn(),
      }
    )

    expect(result).toMatchObject({
      error: expect.stringContaining("disk denied"),
      ok: false,
    })
    expect(state.sessions.map((session) => session.id)).toEqual(["session-2"])
  })

  it("rejects active sessions without touching provider data", async () => {
    const state = createDefaultOusiaAppState()
    const deleteChatSession = vi.fn(async () => undefined)
    const result = await permanentlyDeleteArchivedSessions(
      { sessionIds: [state.sessions[0].id] },
      {
        deleteAppStateSessions: vi.fn(),
        loadAppState: async () => state,
        provider: { deleteChatSession },
        writeLog: vi.fn(),
      }
    )

    expect(result).toMatchObject({ ok: false })
    expect(deleteChatSession).not.toHaveBeenCalled()
  })
})
