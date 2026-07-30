/**
 * Integration tests for the sequenced replay store.
 *
 * These exercise the replay store the way main.ts uses it during a real
 * streamed run: many events recorded across interleaved sessions, with a
 * renderer subscribing mid-run and hydrating from snapshot(). The contract
 * under test is that a mid-run snapshot always replays in global sequence
 * order and reconstructs the in-flight turn — and that a finished run
 * leaves nothing behind for the next hydration.
 */
import { describe, expect, it } from "vitest"

import type { OusiaChatContext, OusiaChatEvent } from "./chat-types"
import { createChatEventReplayStore } from "./chat-event-replay"

const contextA: OusiaChatContext = {
  projectPath: "/tmp/project-a",
  sessionId: "session-a",
}
const contextB: OusiaChatContext = {
  projectPath: "/tmp/project-b",
  sessionId: "session-b",
}

let tick = 0
function timestamp() {
  tick += 1
  return `2026-01-01T00:00:${String(tick).padStart(2, "0")}.000Z`
}

function runStatus(
  status: "starting" | "running" | "finished" | "error"
): OusiaChatEvent {
  return { type: "run_status", status, timestamp: timestamp() }
}

function textStart(id: string): OusiaChatEvent {
  return { type: "assistant_text_start", id, timestamp: timestamp() }
}

function textDelta(id: string, delta: string): OusiaChatEvent {
  return { type: "assistant_text_delta", id, delta, timestamp: timestamp() }
}

function textEnd(id: string): OusiaChatEvent {
  return { type: "assistant_text_end", id, timestamp: timestamp() }
}

function toolStart(id: string, name: string): OusiaChatEvent {
  return { type: "tool_start", id, name, timestamp: timestamp() }
}

function toolEnd(id: string): OusiaChatEvent {
  return { type: "tool_end", id, timestamp: timestamp() }
}

function replayedTypes(
  snapshot: ReturnType<
    ReturnType<typeof createChatEventReplayStore>["snapshot"]
  >
) {
  return snapshot.events.map((entry) => entry.event.type)
}

describe("chat event replay integration", () => {
  it("hydrates a mid-run subscriber with a compacted, sequence-ordered stream", () => {
    const store = createChatEventReplayStore()

    store.record(runStatus("starting"), contextA)
    store.record(runStatus("running"), contextA)
    store.record(textStart("msg-1"), contextA)
    store.record(textDelta("msg-1", "hello"), contextA)
    store.record(textDelta("msg-1", " world"), contextA)
    store.record(toolStart("tool-1", "bash"), contextA)

    const snapshot = store.snapshot()

    // Global ordering is preserved for the subscriber.
    const sequences = snapshot.events.map((entry) => entry.sequence)
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b))
    expect(snapshot.latestSequence).toBe(sequences[sequences.length - 1])

    // Deltas were compacted into one, keeping replay cheap on reload.
    expect(replayedTypes(snapshot)).toEqual([
      "run_status",
      "assistant_text_start",
      "assistant_text_delta",
      "tool_start",
    ])
    const delta = snapshot.events.find(
      (entry) => entry.event.type === "assistant_text_delta"
    )
    expect(
      delta?.event.type === "assistant_text_delta" && delta.event.delta
    ).toBe("hello world")
  })

  it("keeps interleaved sessions isolated while sharing one global sequence", () => {
    const store = createChatEventReplayStore()

    store.record(runStatus("starting"), contextA)
    store.record(textStart("a-1"), contextA)
    store.record(runStatus("starting"), contextB)
    store.record(textStart("b-1"), contextB)
    store.record(textDelta("a-1", "from A"), contextA)
    store.record(textDelta("b-1", "from B"), contextB)

    const snapshot = store.snapshot()
    const bySession = new Map<string, string[]>()
    for (const entry of snapshot.events) {
      const key = entry.event.context?.sessionId ?? "none"
      bySession.set(key, [...(bySession.get(key) ?? []), entry.event.type])
    }
    expect(bySession.get("session-a")).toEqual([
      "run_status",
      "assistant_text_start",
      "assistant_text_delta",
    ])
    expect(bySession.get("session-b")).toEqual([
      "run_status",
      "assistant_text_start",
      "assistant_text_delta",
    ])

    // B finishing must not disturb A's in-flight replay state.
    store.record(textEnd("b-1"), contextB)
    store.record(runStatus("finished"), contextB)
    const afterFinish = store.snapshot()
    expect(
      afterFinish.events.every(
        (entry) => entry.event.context?.sessionId !== "session-b"
      )
    ).toBe(true)
    expect(
      afterFinish.events.some(
        (entry) => entry.event.context?.sessionId === "session-a"
      )
    ).toBe(true)
  })

  it("a new run resets the session buffer so stale turns never replay", () => {
    const store = createChatEventReplayStore()

    store.record(runStatus("starting"), contextA)
    store.record(textStart("old-1"), contextA)
    store.record(textDelta("old-1", "stale"), contextA)
    // The previous run died without a finished event (e.g. renderer reloaded
    // and the provider restarted). A new "starting" must reset the buffer.
    store.record(runStatus("starting"), contextA)
    store.record(textStart("new-1"), contextA)

    const snapshot = store.snapshot()
    expect(replayedTypes(snapshot)).toEqual([
      "run_status",
      "assistant_text_start",
    ])
    const ids = snapshot.events.map((entry) =>
      "id" in entry.event ? entry.event.id : undefined
    )
    expect(ids).not.toContain("old-1")
  })

  it("completed turns collapse and finished runs empty the snapshot", () => {
    const store = createChatEventReplayStore()

    store.record(runStatus("starting"), contextA)
    store.record(textStart("msg-1"), contextA)
    store.record(textDelta("msg-1", "done"), contextA)
    store.record(textEnd("msg-1"), contextA)
    store.record(toolStart("tool-1", "read"), contextA)
    store.record(toolEnd("tool-1"), contextA)
    store.record(runStatus("finished"), contextA)

    const snapshot = store.snapshot()
    expect(snapshot.events).toEqual([])
    expect(snapshot.latestSequence).toBeGreaterThan(0)
  })
})
