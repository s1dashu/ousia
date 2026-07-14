import { describe, expect, it } from "vitest"

import type { OusiaChatEvent } from "@/electron/chat-types"
import {
  appendBufferedChatEvent,
  chatEventRequiresNonStarvableCommit,
  chatEventRenderInterval,
  CHAT_TEXT_STREAM_RENDER_INTERVAL_MS,
  CHAT_TOOL_INPUT_RENDER_INTERVAL_MS,
} from "@/features/chat/chat-event-buffer"

const timestamp = "2026-07-15T00:00:00.000Z"

describe("chat event render buffering", () => {
  it("concatenates adjacent incremental text deltas", () => {
    const events: OusiaChatEvent[] = []

    expect(
      appendBufferedChatEvent(events, {
        type: "assistant_text_delta",
        id: "assistant-1",
        delta: "hello ",
        timestamp,
      }),
    ).toBe(false)
    expect(
      appendBufferedChatEvent(events, {
        type: "assistant_text_delta",
        id: "assistant-1",
        delta: "world",
        timestamp,
      }),
    ).toBe(true)

    expect(events).toEqual([
      {
        type: "assistant_text_delta",
        id: "assistant-1",
        delta: "hello world",
        timestamp,
      },
    ])
  })

  it("keeps only the newest adjacent complete tool-input snapshot", () => {
    const events: OusiaChatEvent[] = []

    appendBufferedChatEvent(events, {
      type: "tool_update",
      id: "tool-1",
      name: "write",
      phase: "input",
      value: '{"content":"a',
      timestamp,
    })
    expect(
      appendBufferedChatEvent(events, {
        type: "tool_update",
        id: "tool-1",
        phase: "input",
        value: '{"content":"abc"}',
        filePreview: {
          kind: "file",
          path: "/tmp/example.txt",
          content: "abc",
          source: "input",
        },
        timestamp,
      }),
    ).toBe(true)

    expect(events).toEqual([
      {
        type: "tool_update",
        id: "tool-1",
        name: "write",
        phase: "input",
        value: '{"content":"abc"}',
        filePreview: {
          kind: "file",
          path: "/tmp/example.txt",
          content: "abc",
          source: "input",
        },
        timestamp,
      },
    ])
  })

  it("never folds updates across protocol boundaries", () => {
    const events: OusiaChatEvent[] = []

    appendBufferedChatEvent(events, {
      type: "assistant_text_delta",
      id: "assistant-1",
      delta: "hello",
      timestamp,
    })
    appendBufferedChatEvent(events, {
      type: "assistant_text_end",
      id: "assistant-1",
      timestamp,
    })
    appendBufferedChatEvent(events, {
      type: "assistant_text_delta",
      id: "assistant-1",
      delta: "next",
      timestamp,
    })

    expect(events.map((event) => event.type)).toEqual([
      "assistant_text_delta",
      "assistant_text_end",
      "assistant_text_delta",
    ])
  })

  it("uses a lower update cadence for live tool previews", () => {
    expect(
      chatEventRenderInterval({
        type: "assistant_text_delta",
        id: "assistant-1",
        delta: "text",
        timestamp,
      }),
    ).toBe(CHAT_TEXT_STREAM_RENDER_INTERVAL_MS)
    expect(
      chatEventRenderInterval({
        type: "tool_update",
        id: "tool-1",
        phase: "input",
        value: "snapshot",
        timestamp,
      }),
    ).toBe(CHAT_TOOL_INPUT_RENDER_INTERVAL_MS)
    expect(
      chatEventRenderInterval({
        type: "tool_input_end",
        id: "tool-1",
        timestamp,
      }),
    ).toBe(0)
  })

  it("keeps bounded tool-input commits from being starved by transitions", () => {
    expect(
      chatEventRequiresNonStarvableCommit({
        type: "tool_update",
        id: "tool-1",
        phase: "input",
        value: "snapshot",
        timestamp,
      }),
    ).toBe(true)
    expect(
      chatEventRequiresNonStarvableCommit({
        type: "tool_input_end",
        id: "tool-1",
        timestamp,
      }),
    ).toBe(true)
    expect(
      chatEventRequiresNonStarvableCommit({
        type: "assistant_text_delta",
        id: "assistant-1",
        delta: "text",
        timestamp,
      }),
    ).toBe(false)
  })
})
