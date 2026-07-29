import { describe, expect, it } from "vitest"

import type { OusiaChatContext, OusiaChatEvent } from "./chat-types"
import { createChatEventReplayStore } from "./chat-event-replay"

const context: OusiaChatContext = {
  projectPath: "/workspace",
  sessionId: "session-1",
}

function runStatus(
  status: Extract<OusiaChatEvent, { type: "run_status" }>["status"]
): OusiaChatEvent {
  return {
    status,
    timestamp: `2026-07-29T00:00:0${status.length}.000Z`,
    type: "run_status",
  }
}

describe("chat event replay", () => {
  it("replays an active turn to a renderer that reconnects", () => {
    const replay = createChatEventReplayStore()

    replay.record(runStatus("starting"), context)
    replay.record(
      {
        id: "assistant-1",
        timestamp: "2026-07-29T00:00:01.000Z",
        type: "assistant_text_start",
      },
      context
    )
    replay.record(
      {
        delta: "hello ",
        id: "assistant-1",
        timestamp: "2026-07-29T00:00:02.000Z",
        type: "assistant_text_delta",
      },
      context
    )
    replay.record(
      {
        delta: "world",
        id: "assistant-1",
        timestamp: "2026-07-29T00:00:03.000Z",
        type: "assistant_text_delta",
      },
      context
    )

    const snapshot = replay.snapshot()
    expect(snapshot.latestSequence).toBe(4)
    expect(snapshot.events.map(({ event }) => event.type)).toEqual([
      "run_status",
      "assistant_text_start",
      "assistant_text_delta",
    ])
    expect(snapshot.events.at(-1)?.event).toMatchObject({
      delta: "hello world",
      id: "assistant-1",
    })
    expect(
      snapshot.events.every(
        ({ event }) =>
          event.context?.projectPath === context.projectPath &&
          event.context.sessionId === context.sessionId
      )
    ).toBe(true)
  })

  it("keeps failed turns observable but clears durably completed turns", () => {
    const replay = createChatEventReplayStore()

    replay.record(runStatus("starting"), context)
    replay.record(
      {
        id: "error-1",
        text: "failed",
        timestamp: "2026-07-29T00:00:02.000Z",
        type: "error",
      },
      context
    )
    replay.record(runStatus("error"), context)
    expect(replay.snapshot().events.map(({ event }) => event.type)).toEqual([
      "error",
      "run_status",
    ])

    replay.record(runStatus("starting"), context)
    replay.record(runStatus("finished"), context)
    expect(replay.snapshot()).toEqual({
      events: [],
      latestSequence: 5,
    })
  })

  it("drops completed stream items that the canonical history can restore", () => {
    const replay = createChatEventReplayStore()
    replay.record(runStatus("starting"), context)
    replay.record(
      {
        id: "assistant-1",
        timestamp: "2026-07-29T00:00:01.000Z",
        type: "assistant_text_start",
      },
      context
    )
    replay.record(
      {
        delta: "partial",
        id: "assistant-1",
        timestamp: "2026-07-29T00:00:02.000Z",
        type: "assistant_text_delta",
      },
      context
    )
    replay.record(
      {
        id: "assistant-1",
        text: "complete",
        timestamp: "2026-07-29T00:00:03.000Z",
        type: "assistant_text_end",
      },
      context
    )

    expect(replay.snapshot().events.map(({ event }) => event.type)).toEqual([
      "run_status",
    ])
  })

  it("returns a sequence watermark that closes the snapshot subscription race", () => {
    const replay = createChatEventReplayStore()
    replay.record(runStatus("starting"), context)
    const snapshot = replay.snapshot()
    const liveEvent = replay.record(runStatus("running"), context)

    expect(snapshot.latestSequence).toBe(1)
    expect(liveEvent.sequence).toBe(2)
  })
})
