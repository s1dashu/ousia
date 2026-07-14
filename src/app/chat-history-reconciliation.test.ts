import { describe, expect, it } from "vitest"

import type { OusiaChatHistoryItem } from "@/electron/chat-types"
import { reconcilePersistedChatHistory } from "./chat-history-reconciliation"

function textItem(
  id: string,
  role: "user" | "assistant" | "thinking" | "system" | "error",
  text: string,
  isPersisted = false,
): OusiaChatHistoryItem {
  return { id, role, text, isPersisted, status: "finished" }
}

describe("reconcilePersistedChatHistory", () => {
  it("replaces live user and assistant IDs with authoritative Pi entry IDs", () => {
    const result = reconcilePersistedChatHistory(
      [
        textItem("user-live", "user", "你好呀"),
        textItem("text-1-0", "assistant", "你好！"),
      ],
      [
        textItem("d2ad9c6d", "user", "你好呀", true),
        textItem("89842033-text-0", "assistant", "你好！", true),
      ],
    )

    expect(result.missingPersistedAnchor).toBe(false)
    expect(result.unmatchedTransientIds).toEqual([])
    expect(result.resolvedIds.get("user-live")).toBe("d2ad9c6d")
    expect(result.resolvedIds.get("text-1-0")).toBe("89842033-text-0")
    expect(result.items.map((item) => item.id)).toEqual([
      "d2ad9c6d",
      "89842033-text-0",
    ])
    expect(result.items.every((item) => item.isPersisted)).toBe(true)
  })

  it("uses the latest persisted anchor and maps duplicate text by order", () => {
    const result = reconcilePersistedChatHistory(
      [
        textItem("old-user", "user", "你好", true),
        textItem("old-assistant-text-0", "assistant", "你好！", true),
        textItem("user-live", "user", "你好"),
        textItem("text-2-0", "assistant", "你好！"),
      ],
      [
        textItem("old-user", "user", "你好", true),
        textItem("old-assistant-text-0", "assistant", "你好！", true),
        textItem("new-user", "user", "你好", true),
        textItem("new-assistant-text-0", "assistant", "你好！", true),
      ],
    )

    expect(result.anchorId).toBe("old-assistant-text-0")
    expect(result.resolvedIds.get("user-live")).toBe("new-user")
    expect(result.resolvedIds.get("text-2-0")).toBe("new-assistant-text-0")
    expect(result.unmatchedTransientIds).toEqual([])
  })

  it("reconciles thinking, text blocks, and stable tool-call IDs", () => {
    const transientTool: OusiaChatHistoryItem = {
      id: "call-1",
      role: "tool",
      name: "read",
      text: "result",
      status: "finished",
    }
    const persistedTool: OusiaChatHistoryItem = {
      ...transientTool,
      isPersisted: true,
      payloadOmitted: true,
    }
    const result = reconcilePersistedChatHistory(
      [
        textItem("thinking-1-0", "thinking", "plan"),
        transientTool,
        textItem("text-1-2", "assistant", "done"),
      ],
      [
        textItem("entry-thinking-0", "thinking", "plan", true),
        persistedTool,
        textItem("entry-text-2", "assistant", "done", true),
      ],
    )

    expect(result.unmatchedTransientIds).toEqual([])
    expect(result.resolvedIds.get("thinking-1-0")).toBe("entry-thinking-0")
    expect(result.resolvedIds.get("call-1")).toBe("call-1")
    expect(result.resolvedIds.get("text-1-2")).toBe("entry-text-2")
  })

  it("retains complete live tool payloads when persistence confirms the tool", () => {
    const transientTool: OusiaChatHistoryItem = {
      id: "call-1",
      role: "tool",
      name: "bash",
      text: "alpha",
      input: '{"command":"printf alpha"}',
      output: "alpha",
      inputComplete: true,
      status: "finished",
    }
    const persistedTool: OusiaChatHistoryItem = {
      id: "call-1",
      isPersisted: true,
      role: "tool",
      name: "bash",
      text: "alpha",
      input: '{"command":"printf alpha"}',
      payloadOmitted: true,
      status: "finished",
    }

    const result = reconcilePersistedChatHistory(
      [transientTool],
      [persistedTool],
    )

    expect(result.unmatchedTransientIds).toEqual([])
    expect(result.preservedLiveToolPayloadIds).toEqual(["call-1"])
    expect(result.items[0]).toEqual({
      ...persistedTool,
      output: "alpha",
      inputComplete: true,
      payloadOmitted: undefined,
    })
  })

  it("matches prompts whose persisted form contains attached-file context", () => {
    const result = reconcilePersistedChatHistory(
      [textItem("user-live", "user", "检查附件")],
      [
        textItem(
          "entry-user",
          "user",
          '检查附件\n\n<attached_file name="a.txt">\nbody\n</attached_file>',
          true,
        ),
      ],
    )

    expect(result.unmatchedTransientIds).toEqual([])
    expect(result.resolvedIds.get("user-live")).toBe("entry-user")
  })

  it("preserves local diagnostics but exposes unmatched chat content", () => {
    const result = reconcilePersistedChatHistory(
      [
        textItem("known", "user", "old", true),
        textItem("transient", "assistant", "not persisted"),
        textItem("local-error", "error", "diagnostic"),
      ],
      [textItem("known", "user", "old", true)],
    )

    expect(result.unmatchedTransientIds).toEqual(["transient"])
    expect(result.items.map((item) => item.id)).toEqual([
      "known",
      "local-error",
    ])
  })

  it("reports a missing anchor instead of merging unrelated histories", () => {
    const result = reconcilePersistedChatHistory(
      [textItem("old", "user", "old", true)],
      [textItem("other", "user", "other", true)],
    )

    expect(result.missingPersistedAnchor).toBe(true)
  })
})
