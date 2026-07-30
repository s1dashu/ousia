import { describe, expect, it } from "vitest"

import type { OusiaChatEvent } from "@/electron/chat-types"
import type { ChatItem } from "@/features/chat/chat-events"
import {
  applyPendingChatEvents,
  canMergeTextDeltaEvents,
  isTextDeltaEvent,
  queuePendingChatEvent,
  type TextDeltaChatEvent,
} from "@/features/chat/pending-chat-events"

function textDelta(id: string, delta: string): TextDeltaChatEvent {
  return { type: "assistant_text_delta", id, delta } as TextDeltaChatEvent
}

function thinkingDelta(id: string, delta: string): TextDeltaChatEvent {
  return { type: "thinking_delta", id, delta } as TextDeltaChatEvent
}

describe("isTextDeltaEvent", () => {
  it("recognizes assistant and thinking deltas", () => {
    expect(isTextDeltaEvent(textDelta("a", "x"))).toBe(true)
    expect(isTextDeltaEvent(thinkingDelta("a", "x"))).toBe(true)
    expect(isTextDeltaEvent(undefined)).toBe(false)
    expect(
      isTextDeltaEvent({ type: "turn_started" } as unknown as OusiaChatEvent)
    ).toBe(false)
  })
})

describe("canMergeTextDeltaEvents", () => {
  it("merges only same-type deltas for the same message id", () => {
    expect(
      canMergeTextDeltaEvents(textDelta("a", "x"), textDelta("a", "y"))
    ).toBe(true)
    expect(
      canMergeTextDeltaEvents(textDelta("a", "x"), textDelta("b", "y"))
    ).toBe(false)
    expect(
      canMergeTextDeltaEvents(textDelta("a", "x"), thinkingDelta("a", "y"))
    ).toBe(false)
    expect(canMergeTextDeltaEvents(undefined, textDelta("a", "y"))).toBe(false)
  })
})

describe("queuePendingChatEvent", () => {
  it("starts a new buffer for an unseen target key", () => {
    const pending = new Map<string, OusiaChatEvent[]>()
    queuePendingChatEvent(pending, "k1", textDelta("m1", "hello"))
    expect(pending.get("k1")).toEqual([textDelta("m1", "hello")])
  })

  it("coalesces consecutive deltas for the same message", () => {
    const pending = new Map<string, OusiaChatEvent[]>()
    queuePendingChatEvent(pending, "k1", textDelta("m1", "hel"))
    queuePendingChatEvent(pending, "k1", textDelta("m1", "lo"))
    queuePendingChatEvent(pending, "k1", textDelta("m1", " world"))
    expect(pending.get("k1")).toEqual([textDelta("m1", "hello world")])
  })

  it("does not coalesce across message ids or event types", () => {
    const pending = new Map<string, OusiaChatEvent[]>()
    queuePendingChatEvent(pending, "k1", textDelta("m1", "a"))
    queuePendingChatEvent(pending, "k1", textDelta("m2", "b"))
    queuePendingChatEvent(pending, "k1", thinkingDelta("m2", "t"))
    expect(pending.get("k1")).toEqual([
      textDelta("m1", "a"),
      textDelta("m2", "b"),
      thinkingDelta("m2", "t"),
    ])
  })

  it("keeps buffers isolated per target key", () => {
    const pending = new Map<string, OusiaChatEvent[]>()
    queuePendingChatEvent(pending, "k1", textDelta("m1", "a"))
    queuePendingChatEvent(pending, "k2", textDelta("m1", "b"))
    expect(pending.get("k1")).toHaveLength(1)
    expect(pending.get("k2")).toHaveLength(1)
  })
})

describe("applyPendingChatEvents", () => {
  const current: Record<string, ChatItem[]> = { k1: [] }

  it("returns the same reference when nothing changed", () => {
    const pending = new Map<string, OusiaChatEvent[]>()
    expect(applyPendingChatEvents(current, pending)).toBe(current)
  })

  it("applies buffered events per session and keeps other references", () => {
    const pending = new Map<string, OusiaChatEvent[]>()
    queuePendingChatEvent(pending, "k2", textDelta("m1", "hello"))
    const next = applyPendingChatEvents(current, pending)
    expect(next).not.toBe(current)
    expect(next.k1).toBe(current.k1)
    expect(next.k2).not.toEqual([])
  })

  it("applies merged deltas as a single message update", () => {
    const pending = new Map<string, OusiaChatEvent[]>()
    queuePendingChatEvent(pending, "k1", textDelta("m1", "hel"))
    queuePendingChatEvent(pending, "k1", textDelta("m1", "lo"))
    const next = applyPendingChatEvents(current, pending)
    const text = JSON.stringify(next.k1)
    expect(text).toContain("hello")
  })
})
