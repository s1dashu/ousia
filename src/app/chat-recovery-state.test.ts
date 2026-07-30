import { describe, expect, it } from "vitest"

import type { OusiaChatEvent } from "@/electron/chat-types"
import { discardSupersededPendingChatEvents } from "./chat-recovery-state"

describe("chat recovery state", () => {
  it("discards only the completed session events superseded by canonical history", () => {
    const completedEvents: OusiaChatEvent[] = [
      {
        id: "assistant-live",
        text: "complete",
        timestamp: "2026-07-30T00:00:00.000Z",
        type: "assistant_text_end",
      },
      {
        status: "finished",
        timestamp: "2026-07-30T00:00:01.000Z",
        type: "run_status",
      },
    ]
    const otherSessionEvents: OusiaChatEvent[] = [
      {
        delta: "still streaming",
        id: "assistant-other",
        timestamp: "2026-07-30T00:00:02.000Z",
        type: "assistant_text_delta",
      },
    ]
    const pendingEvents = new Map([
      ["session-completed", completedEvents],
      ["session-other", otherSessionEvents],
    ])

    expect(
      discardSupersededPendingChatEvents(
        pendingEvents,
        "session-completed"
      )
    ).toEqual({
      eventCount: 2,
      eventTypes: ["assistant_text_end", "run_status"],
    })
    expect(pendingEvents).toEqual(
      new Map([["session-other", otherSessionEvents]])
    )
  })

  it("reports an empty barrier without changing unrelated pending events", () => {
    const pendingEvents = new Map<string, OusiaChatEvent[]>([
      [
        "session-other",
        [
          {
            status: "running",
            timestamp: "2026-07-30T00:00:00.000Z",
            type: "run_status",
          },
        ],
      ],
    ])

    expect(
      discardSupersededPendingChatEvents(pendingEvents, "session-completed")
    ).toEqual({
      eventCount: 0,
      eventTypes: [],
    })
    expect(pendingEvents.has("session-other")).toBe(true)
  })
})
