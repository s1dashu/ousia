import { describe, expect, it } from "vitest"

import {
  historyPageStateFromResult,
  mergePersistedChatItems,
  moveRecordKey,
} from "@/app/app-session-state"
import type { ChatItem } from "@/features/chat/chat-events"

function chatItem(id: string): ChatItem {
  return {
    id,
    role: "assistant",
    status: "finished",
    text: id,
  }
}

describe("renderer session state transforms", () => {
  it("moves a record key without mutating the source", () => {
    const source = { old: ["item"], untouched: ["same"] }
    const result = moveRecordKey(source, "old", "new")
    expect(result).toEqual({ new: ["item"], untouched: ["same"] })
    expect(result.untouched).toBe(source.untouched)
    expect(source).toHaveProperty("old")
  })

  it("preserves the record when no key move is possible", () => {
    const source = { old: 1 }
    expect(moveRecordKey(source, "old", "old")).toBe(source)
    expect(moveRecordKey(source, "missing", "new")).toBe(source)
  })

  it("builds empty and ready history page states", () => {
    expect(historyPageStateFromResult([], { totalItems: 0 })).toEqual({
      hasMore: false,
      status: "empty",
      totalItems: 0,
    })
    expect(
      historyPageStateFromResult([chatItem("first")], {
        hasMore: true,
        totalItems: 12,
      })
    ).toEqual({
      cursor: "first",
      hasMore: true,
      status: "ready",
      totalItems: 12,
    })
  })

  it("merges persisted history before live-only items and de-duplicates ids", () => {
    const liveOnly = chatItem("live")
    const persisted = chatItem("persisted")
    const duplicate = chatItem("duplicate")
    expect(
      mergePersistedChatItems(
        [duplicate, liveOnly],
        [persisted, { ...duplicate, text: "disk" }]
      ).map((item) => [item.id, item.text])
    ).toEqual([
      ["persisted", "persisted"],
      ["duplicate", "disk"],
      ["live", "live"],
    ])
  })

  it("preserves an existing array when persisted history is empty", () => {
    const existing: ChatItem[] = [chatItem("live")]
    expect(mergePersistedChatItems(existing, [])).toBe(existing)
  })
})
