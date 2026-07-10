import { describe, expect, it, vi } from "vitest"

import type { OusiaChatContext, OusiaChatEvent } from "./chat-types"
import { createChatEventBatcher } from "./chat-event-batcher"

const context: OusiaChatContext = {
  projectPath: "/workspace",
  sessionId: "session-1",
}

function delta(
  value: string,
  id = "assistant-1"
): Extract<OusiaChatEvent, { type: "assistant_text_delta" }> {
  return {
    delta: value,
    id,
    timestamp: `2026-07-10T00:00:0${value.length}.000Z`,
    type: "assistant_text_delta",
  }
}

function createHarness() {
  const emitted: Array<{ context?: OusiaChatContext; event: OusiaChatEvent }> =
    []
  const callbacks = new Map<number, () => void>()
  let nextHandle = 1
  const cancel = vi.fn((handle: number) => {
    callbacks.delete(handle)
  })
  const batcher = createChatEventBatcher({
    cancel,
    emit: (event, eventContext) =>
      emitted.push({ context: eventContext, event }),
    schedule: (callback) => {
      const handle = nextHandle
      nextHandle += 1
      callbacks.set(handle, callback)
      return handle
    },
  })
  return { batcher, callbacks, emitted }
}

describe("chat event batching", () => {
  it("coalesces adjacent text deltas for the same item and context", () => {
    const { batcher, callbacks, emitted } = createHarness()

    batcher.enqueue(delta("a"), context)
    batcher.enqueue(delta("bc"), { ...context })
    expect(callbacks.size).toBe(1)

    callbacks.values().next().value?.()
    expect(emitted).toEqual([
      {
        context,
        event: expect.objectContaining({
          delta: "abc",
          id: "assistant-1",
          type: "assistant_text_delta",
        }),
      },
    ])
  })

  it("flushes pending deltas before terminal or status events", () => {
    const { batcher, emitted } = createHarness()
    const end: OusiaChatEvent = {
      id: "assistant-1",
      text: "complete",
      timestamp: "2026-07-10T00:00:02.000Z",
      type: "assistant_text_end",
    }

    batcher.enqueue(delta("partial"), context)
    batcher.enqueue(end, context)

    expect(emitted.map(({ event }) => event.type)).toEqual([
      "assistant_text_delta",
      "assistant_text_end",
    ])
  })

  it("preserves boundaries between item ids, event types, and sessions", () => {
    const { batcher, emitted } = createHarness()
    batcher.enqueue(delta("one"), context)
    batcher.enqueue(delta("two", "assistant-2"), context)
    batcher.enqueue(
      {
        delta: "thought",
        id: "assistant-2",
        timestamp: "2026-07-10T00:00:03.000Z",
        type: "thinking_delta",
      },
      context
    )
    batcher.enqueue(delta("other"), { ...context, sessionId: "session-2" })

    batcher.flush()
    expect(emitted.map(({ event }) => event.type)).toEqual([
      "assistant_text_delta",
      "assistant_text_delta",
      "thinking_delta",
      "assistant_text_delta",
    ])
    expect(emitted.map(({ event }) => "delta" in event && event.delta)).toEqual(
      ["one", "two", "thought", "other"]
    )
  })
})
