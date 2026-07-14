import { describe, expect, it } from "vitest"

import { AuthoritativeState } from "@/app/authoritative-state"
import { reconcilePersistedChatHistory } from "@/app/chat-history-reconciliation"
import type { OusiaChatEvent, OusiaTextChatItem } from "@/electron/chat-types"
import {
  applyChatEvent,
  applyChatEventBatchBySession,
  type ChatItem,
  type ChatItemsBySession,
} from "./chat-events"
import { toolFilePreviewFromItem } from "./chat-tool-file-preview"

const targetKey = "~/Documents/Ousia::session-race"
const timestamp = "2026-07-14T09:31:00.000Z"

function textItem(
  id: string,
  role: "user" | "assistant",
  text: string,
  isPersisted = false,
): OusiaTextChatItem {
  return { id, role, text, isPersisted, status: "finished" }
}

describe("applyChatEventBatchBySession", () => {
  it("streams content-first input for three consecutive write calls", () => {
    let items: ChatItem[] = []

    for (const [index, path] of [
      "first.html",
      "second.html",
      "third.html",
    ].entries()) {
      const id = `write-${index + 1}`
      items = applyChatEvent(items, {
        type: "tool_start",
        id,
        name: "write",
        args: {},
        timestamp,
      })

      const partialInput = `{"content":"<main>page ${index + 1}`
      items = applyChatEvent(items, {
        type: "tool_update",
        id,
        name: "write",
        phase: "input",
        value: partialInput,
        timestamp,
      })
      const partialTool = items.find((item) => item.id === id)
      if (partialTool?.role !== "tool") {
        throw new Error(`Expected partial tool item ${id}`)
      }
      expect(partialTool.input).toBe(partialInput)
      expect(toolFilePreviewFromItem(partialTool)).toMatchObject({
        kind: "diff",
        newContent: `<main>page ${index + 1}`,
        path: "write",
        source: "input",
      })

      const completeInput = JSON.stringify({
        content: `<main>page ${index + 1}</main>`,
        path,
      })
      items = applyChatEvent(items, {
        type: "tool_update",
        id,
        name: "write",
        phase: "input",
        value: completeInput,
        timestamp,
      })
      items = applyChatEvent(items, {
        type: "tool_input_end",
        id,
        timestamp,
      })
      items = applyChatEvent(items, {
        type: "tool_end",
        id,
        name: "write",
        result: `Successfully wrote ${path}`,
        isError: false,
        timestamp,
      })
    }

    const tools = items.filter((item) => item.role === "tool")
    expect(tools).toHaveLength(3)
    expect(tools.map((item) => item.id)).toEqual([
      "write-1",
      "write-2",
      "write-3",
    ])
    for (const [index, tool] of tools.entries()) {
      expect(tool).toMatchObject({
        inputComplete: true,
        status: "finished",
      })
      if (tool.role !== "tool") {
        throw new Error(`Expected completed tool item ${tool.id}`)
      }
      expect(toolFilePreviewFromItem(tool)).toMatchObject({
        kind: "diff",
        newContent: `<main>page ${index + 1}</main>`,
        path: ["first.html", "second.html", "third.html"][index],
        source: "input",
      })
    }
  })

  it("flushes the final stream events before persisted-history reconciliation", () => {
    const current = {
      [targetKey]: [
        textItem("user-live", "user", "hi"),
        {
          ...textItem("text-1-0", "assistant", "Hey! 👋 How can I help you"),
          status: "streaming" as const,
        },
      ],
    }
    const pendingEvents = new Map<string, OusiaChatEvent[]>([
      [
        targetKey,
        [
          {
            type: "assistant_text_delta",
            id: "text-1-0",
            delta: " today?",
            timestamp,
          },
          {
            type: "assistant_text_end",
            id: "text-1-0",
            text: "Hey! 👋 How can I help you today?",
            timestamp,
          },
          {
            type: "run_status",
            generation: 1,
            status: "finished",
            timestamp,
          },
        ],
      ],
    ])

    const flushed = applyChatEventBatchBySession(current, pendingEvents)
    const reconciliation = reconcilePersistedChatHistory(flushed[targetKey], [
      textItem("878e0fc7", "user", "hi", true),
      textItem(
        "d65603ba-text-0",
        "assistant",
        "Hey! 👋 How can I help you today?",
        true,
      ),
    ])

    expect(flushed[targetKey][1]).toMatchObject({
      id: "text-1-0",
      status: "finished",
      text: "Hey! 👋 How can I help you today?",
    })
    expect(reconciliation.unmatchedTransientIds).toEqual([])
    expect(reconciliation.resolvedIds.get("text-1-0")).toBe("d65603ba-text-0")
  })

  it("reconciles from the authoritative source while rendering is delayed", () => {
    const staleRenderedState = {
      [targetKey]: [
        textItem("user-live", "user", "hi"),
        {
          ...textItem(
            "text-1-1-0",
            "assistant",
            "Hi! How can I help you today",
          ),
          status: "streaming" as const,
        },
      ],
    }
    const source = new AuthoritativeState<ChatItemsBySession>(
      staleRenderedState,
    )
    const pendingCompletion = new Map<string, OusiaChatEvent[]>([
      [
        targetKey,
        [
          {
            type: "assistant_text_end",
            id: "text-1-1-0",
            text: "Hi! How can I help you today?",
            timestamp,
          },
          {
            type: "run_status",
            generation: 1,
            status: "finished",
            timestamp,
          },
        ],
      ],
    ])

    const nextSource = source.update((current) =>
      applyChatEventBatchBySession(current, pendingCompletion),
    )
    const reconciliation = reconcilePersistedChatHistory(
      source.current[targetKey],
      [
        textItem("6caf47b3", "user", "hi", true),
        textItem(
          "ed983895-text-0",
          "assistant",
          "Hi! How can I help you today?",
          true,
        ),
      ],
    )

    expect(staleRenderedState[targetKey][1]).toMatchObject({
      status: "streaming",
      text: "Hi! How can I help you today",
    })
    expect(nextSource[targetKey][1]).toMatchObject({
      status: "finished",
      text: "Hi! How can I help you today?",
    })
    expect(reconciliation.unmatchedTransientIds).toEqual([])
    expect(reconciliation.resolvedIds.get("text-1-1-0")).toBe("ed983895-text-0")
  })

  it("preserves assistant message order around streamed tool calls", () => {
    const pendingEvents = new Map<string, OusiaChatEvent[]>([
      [
        targetKey,
        [
          {
            type: "assistant_text_start",
            id: "text-1-1-0",
            timestamp,
          },
          {
            type: "assistant_text_delta",
            id: "text-1-1-0",
            delta: "我先检查系统。",
            timestamp,
          },
          {
            type: "assistant_text_end",
            id: "text-1-1-0",
            text: "我先检查系统。",
            timestamp,
          },
          {
            type: "tool_start",
            id: "call-1",
            name: "bash",
            args: {},
            timestamp,
          },
          {
            type: "tool_update",
            id: "call-1",
            name: "bash",
            phase: "input",
            value: { command: "sw_vers" },
            timestamp,
          },
          { type: "tool_input_end", id: "call-1", timestamp },
          {
            type: "tool_start",
            id: "call-1",
            name: "bash",
            args: { command: "sw_vers" },
            timestamp,
          },
          {
            type: "tool_end",
            id: "call-1",
            name: "bash",
            result: "ProductName: macOS",
            isError: false,
            timestamp,
          },
          {
            type: "assistant_text_start",
            id: "text-1-2-0",
            timestamp,
          },
          {
            type: "assistant_text_delta",
            id: "text-1-2-0",
            delta: "你的系统是 macOS。",
            timestamp,
          },
          {
            type: "assistant_text_end",
            id: "text-1-2-0",
            text: "你的系统是 macOS。",
            timestamp,
          },
          {
            type: "run_status",
            generation: 1,
            status: "finished",
            timestamp,
          },
        ],
      ],
    ])

    const flushed = applyChatEventBatchBySession(
      { [targetKey]: [textItem("user-live", "user", "检查系统")] },
      pendingEvents,
    )
    expect(flushed[targetKey].map((item) => item.id)).toEqual([
      "user-live",
      "text-1-1-0",
      "call-1",
      "text-1-2-0",
    ])
    const streamedTool = flushed[targetKey][2]
    expect(streamedTool).toMatchObject({
      id: "call-1",
      inputComplete: true,
      output: "ProductName: macOS",
      status: "finished",
    })
    if (streamedTool.role !== "tool" || !streamedTool.input) {
      throw new Error("Expected the streamed tool input to be retained")
    }
    expect(JSON.parse(streamedTool.input)).toEqual({
      command: "sw_vers",
    })

    const persistedTool = {
      id: "call-1",
      role: "tool" as const,
      name: "bash",
      text: "ProductName: macOS",
      status: "finished" as const,
      isPersisted: true,
      payloadOmitted: true,
    }
    const reconciliation = reconcilePersistedChatHistory(flushed[targetKey], [
      textItem("persisted-user", "user", "检查系统", true),
      textItem("persisted-opening-text-0", "assistant", "我先检查系统。", true),
      persistedTool,
      textItem(
        "persisted-final-text-0",
        "assistant",
        "你的系统是 macOS。",
        true,
      ),
    ])

    expect(reconciliation.unmatchedTransientIds).toEqual([])
    expect(reconciliation.items[2]).toMatchObject({
      id: "call-1",
      input: expect.stringContaining("sw_vers"),
      inputComplete: true,
      output: "ProductName: macOS",
      payloadOmitted: undefined,
    })
    expect(reconciliation.items.map((item) => item.id)).toEqual([
      "persisted-user",
      "persisted-opening-text-0",
      "call-1",
      "persisted-final-text-0",
    ])
  })
})
