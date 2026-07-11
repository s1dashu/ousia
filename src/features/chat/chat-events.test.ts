import { describe, expect, it } from "vitest"

import { applyChatEvent, type ChatItem } from "./chat-events"
import {
  shouldAutoCollapseToolDisclosure,
  shouldAutoExpandToolDisclosure,
} from "./chat-tool-disclosure"

describe("applyChatEvent", () => {
  it("appends user messages with attachment summaries", () => {
    const items = applyChatEvent([], {
      attachments: [
        {
          id: "attachment-1",
          kind: "text",
          mediaType: "text/plain",
          name: "note.txt",
          size: 12,
        },
      ],
      id: "user-1",
      text: "hello",
      delivery: "optimistic",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "user_message",
    })

    expect(items).toEqual([
      {
        attachments: [
          {
            id: "attachment-1",
            kind: "text",
            mediaType: "text/plain",
            name: "note.txt",
            size: 12,
          },
        ],
        id: "user-1",
        role: "user",
        status: "finished",
        text: "hello",
        timestamp: "2026-07-07T00:00:00.000Z",
      },
    ])
  })

  it("treats a repeated optimistic user message as idempotent", () => {
    const optimistic = applyChatEvent([], {
      delivery: "optimistic",
      id: "user-client-1",
      text: "hello",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "user_message",
    })
    expect(optimistic[0].status).toBe("finished")
    const repeated = applyChatEvent(optimistic, {
      delivery: "optimistic",
      id: "user-client-1",
      text: "hello",
      timestamp: "2026-07-07T00:00:01.000Z",
      type: "user_message",
    })

    expect(repeated).toBe(optimistic)
    expect(repeated).toHaveLength(1)
    expect(repeated[0].timestamp).toBe("2026-07-07T00:00:00.000Z")
    expect(repeated[0].status).toBe("finished")
    expect(
      applyChatEvent(repeated, {
        delivery: "optimistic",
        id: "user-client-1",
        text: "hello",
        timestamp: "2026-07-07T00:00:02.000Z",
        type: "user_message",
      })
    ).toBe(repeated)
  })

  it("keeps the earliest timestamp when a repeated optimistic event is reduced first", () => {
    const laterFirst = applyChatEvent([], {
      delivery: "optimistic",
      id: "user-client-1",
      text: "hello",
      timestamp: "2026-07-07T00:00:01.000Z",
      type: "user_message",
    })
    const optimisticSecond = applyChatEvent(laterFirst, {
      delivery: "optimistic",
      id: "user-client-1",
      text: "hello",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "user_message",
    })

    expect(optimisticSecond).toHaveLength(1)
    expect(optimisticSecond[0].timestamp).toBe("2026-07-07T00:00:00.000Z")
    expect(optimisticSecond[0].status).toBe("finished")
  })

  it("keeps a failed optimistic message failed after a repeated local event", () => {
    const optimistic = applyChatEvent([], {
      delivery: "optimistic",
      id: "user-client-1",
      text: "hello",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "user_message",
    })
    const failed = applyChatEvent(optimistic, {
      id: "user-client-1",
      timestamp: "2026-07-07T00:00:01.000Z",
      type: "user_message_failed",
    })
    const lateOptimisticEvent = applyChatEvent(failed, {
      delivery: "optimistic",
      id: "user-client-1",
      text: "hello",
      timestamp: "2026-07-07T00:00:02.000Z",
      type: "user_message",
    })

    expect(failed[0].status).toBe("failed")
    expect(lateOptimisticEvent).toBe(failed)
  })

  it("reconstructs an atomic provider failure when local optimistic state is gone", () => {
    const failed = applyChatEvent([], {
      delivery: "failed",
      id: "user-client-1",
      text: "hello",
      timestamp: "2026-07-07T00:00:01.000Z",
      type: "user_message",
    })

    expect(failed).toEqual([
      expect.objectContaining({
        id: "user-client-1",
        role: "user",
        status: "failed",
        text: "hello",
      }),
    ])
  })

  it("keeps equal user message text when client ids differ", () => {
    const first = applyChatEvent([], {
      id: "user-client-1",
      text: "same text",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "user_message",
    })
    const second = applyChatEvent(first, {
      id: "user-client-2",
      text: "same text",
      timestamp: "2026-07-07T00:00:01.000Z",
      type: "user_message",
    })

    expect(second.map((item) => item.id)).toEqual([
      "user-client-1",
      "user-client-2",
    ])
  })

  it("fails fast when a user confirmation reuses an id with new content", () => {
    const optimistic = applyChatEvent([], {
      id: "user-client-1",
      text: "original",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "user_message",
    })

    expect(() =>
      applyChatEvent(optimistic, {
        id: "user-client-1",
        text: "changed",
        timestamp: "2026-07-07T00:00:01.000Z",
        type: "user_message",
      })
    ).toThrow("Conflicting user message confirmation")
  })

  it("fails fast when a user message collides with another event role", () => {
    expect(() =>
      applyChatEvent([{ id: "shared-id", role: "assistant", text: "answer" }], {
        id: "shared-id",
        text: "question",
        timestamp: "2026-07-07T00:00:00.000Z",
        type: "user_message",
      })
    ).toThrow("Chat event id collision")
  })

  it("streams assistant text through start, delta, and end events", () => {
    const started = applyChatEvent([], {
      id: "assistant-1",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "assistant_text_start",
    })
    const withText = applyChatEvent(started, {
      delta: "hello",
      id: "assistant-1",
      timestamp: "2026-07-07T00:00:01.000Z",
      type: "assistant_text_delta",
    })
    const finished = applyChatEvent(withText, {
      id: "assistant-1",
      timestamp: "2026-07-07T00:00:02.000Z",
      type: "assistant_text_end",
    })

    expect(finished).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        status: "finished",
        text: "hello",
        timestamp: "2026-07-07T00:00:02.000Z",
      },
    ])
  })

  it("updates a streaming tail in a long history without scanning old item ids", () => {
    const firstItem = new Proxy<ChatItem>(
      { id: "user-0", role: "user", text: "old" },
      {
        get(target, property, receiver) {
          if (property === "id") {
            throw new Error(
              "historical ids should not be read for a tail update"
            )
          }
          return Reflect.get(target, property, receiver)
        },
      }
    )
    const historicalItems: ChatItem[] = [
      firstItem,
      ...Array.from({ length: 2_000 }, (_, index) => ({
        id: `user-${index + 1}`,
        role: "user" as const,
        text: `message ${index + 1}`,
      })),
    ]
    const streamingItem: ChatItem = {
      id: "assistant-live",
      role: "assistant",
      status: "streaming",
      text: "hello",
      timestamp: "2026-07-07T00:00:00.000Z",
    }
    const items = [...historicalItems, streamingItem]

    const updated = applyChatEvent(items, {
      delta: " world",
      id: streamingItem.id,
      timestamp: "2026-07-07T00:00:01.000Z",
      type: "assistant_text_delta",
    })

    expect(updated).not.toBe(items)
    expect(updated).toHaveLength(items.length)
    expect(updated[0]).toBe(firstItem)
    expect(updated[1_000]).toBe(items[1_000])
    expect(updated.at(-1)).not.toBe(streamingItem)
    expect(updated.at(-1)).toMatchObject({
      id: "assistant-live",
      status: "streaming",
      text: "hello world",
      timestamp: "2026-07-07T00:00:01.000Z",
    })
  })

  it("creates thinking items when deltas arrive before start", () => {
    const items = applyChatEvent([], {
      delta: "reasoning",
      id: "thinking-1",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "thinking_delta",
    })

    expect(items).toEqual([
      {
        id: "thinking-1",
        role: "thinking",
        status: "streaming",
        text: "reasoning",
        timestamp: "2026-07-07T00:00:00.000Z",
      },
    ])
  })

  it("updates tool input, output, file preview, and status", () => {
    const started = applyChatEvent([], {
      args: { path: "src/App.tsx" },
      filePreview: {
        kind: "diff",
        newContent: "new",
        oldContent: "",
        path: "src/App.tsx",
        source: "input",
      },
      id: "tool-1",
      name: "write",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "tool_start",
    })
    const updated = applyChatEvent(started, {
      id: "tool-1",
      name: "write",
      phase: "output",
      timestamp: "2026-07-07T00:00:01.000Z",
      type: "tool_update",
      value: { ok: true },
    })
    const finished = applyChatEvent(updated, {
      id: "tool-1",
      name: "write",
      result: "wrote file",
      timestamp: "2026-07-07T00:00:02.000Z",
      type: "tool_end",
    })

    expect(finished).toEqual([
      {
        filePreview: {
          kind: "diff",
          newContent: "new",
          oldContent: "",
          path: "src/App.tsx",
          source: "input",
        },
        id: "tool-1",
        input: '{\n  "path": "src/App.tsx"\n}',
        name: "write",
        output: "wrote file",
        role: "tool",
        status: "finished",
        text: "wrote file",
      },
    ])
  })

  it("updates a tool at the tail of a long history and preserves old references", () => {
    const historicalItems: ChatItem[] = Array.from(
      { length: 2_000 },
      (_, index) => ({
        id: `user-${index}`,
        role: "user",
        text: `message ${index}`,
      })
    )
    const runningTool: ChatItem = {
      id: "tool-live",
      input: "{}",
      name: "bash",
      role: "tool",
      status: "running",
      text: "{}",
    }
    const items = [...historicalItems, runningTool]

    const updated = applyChatEvent(items, {
      id: runningTool.id,
      name: "bash",
      phase: "output",
      timestamp: "2026-07-07T00:00:01.000Z",
      type: "tool_update",
      value: { chunk: "done" },
    })

    expect(updated).not.toBe(items)
    expect(updated).toHaveLength(items.length)
    expect(updated[0]).toBe(items[0])
    expect(updated[1_000]).toBe(items[1_000])
    expect(updated.at(-1)).not.toBe(runningTool)
    expect(updated.at(-1)).toMatchObject({
      id: "tool-live",
      name: "bash",
      output: '{\n  "chunk": "done"\n}',
      status: "running",
      text: '{\n  "chunk": "done"\n}',
    })
  })

  it("updates an existing tool when a duplicate start event arrives", () => {
    const started = applyChatEvent([], {
      args: { cmd: "pwd" },
      id: "tool-1",
      name: "bash",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "tool_start",
    })

    expect(
      applyChatEvent(started, {
        args: { cmd: "ls" },
        id: "tool-1",
        name: "bash",
        timestamp: "2026-07-07T00:00:01.000Z",
        type: "tool_start",
      })
    ).toEqual([
      {
        id: "tool-1",
        input: '{\n  "cmd": "ls"\n}',
        name: "bash",
        role: "tool",
        status: "running",
        text: '{\n  "cmd": "ls"\n}',
      },
    ])
  })

  it("updates tool input during input-phase streaming", () => {
    const started = applyChatEvent([], {
      id: "tool-1",
      name: "write",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "tool_start",
    })

    expect(
      applyChatEvent(started, {
        filePreview: {
          kind: "diff",
          newContent: "new",
          oldContent: "",
          path: "src/App.tsx",
          source: "input",
        },
        id: "tool-1",
        name: "write",
        phase: "input",
        timestamp: "2026-07-07T00:00:01.000Z",
        type: "tool_update",
        value: { path: "src/App.tsx" },
      })
    ).toEqual([
      {
        filePreview: {
          kind: "diff",
          newContent: "new",
          oldContent: "",
          path: "src/App.tsx",
          source: "input",
        },
        id: "tool-1",
        input: '{\n  "path": "src/App.tsx"\n}',
        name: "write",
        role: "tool",
        status: "running",
        text: '{\n  "path": "src/App.tsx"\n}',
      },
    ])
  })

  it("keeps each tool input completion independent and sticky", () => {
    let items = applyChatEvent([], {
      id: "write-1",
      name: "write",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "tool_start",
    })
    items = applyChatEvent(items, {
      id: "write-1",
      timestamp: "2026-07-07T00:00:01.000Z",
      type: "tool_input_end",
    })
    items = applyChatEvent(items, {
      args: { path: "first.html" },
      id: "write-1",
      name: "write",
      timestamp: "2026-07-07T00:00:01.500Z",
      type: "tool_start",
    })
    items = applyChatEvent(items, {
      id: "write-2",
      name: "write",
      timestamp: "2026-07-07T00:00:02.000Z",
      type: "tool_start",
    })
    items = applyChatEvent(items, {
      id: "write-1",
      name: "write",
      phase: "input",
      timestamp: "2026-07-07T00:00:03.000Z",
      type: "tool_update",
      value: { path: "first.html" },
    })

    const tools = items.filter(
      (item): item is Extract<ChatItem, { role: "tool" }> =>
        item.role === "tool"
    )
    expect(tools).toMatchObject([
      { id: "write-1", inputComplete: true, status: "running" },
      { id: "write-2", status: "running" },
    ])
    expect(tools.map(shouldAutoExpandToolDisclosure)).toEqual([true, true])
    expect(
      shouldAutoCollapseToolDisclosure(
        { ...tools[0], inputComplete: false },
        tools[0]
      )
    ).toBe(true)
  })

  it("stores failed tool results as error text", () => {
    const started = applyChatEvent([], {
      id: "tool-1",
      name: "bash",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "tool_start",
    })
    const failed = applyChatEvent(started, {
      id: "tool-1",
      isError: true,
      result: "command failed",
      timestamp: "2026-07-07T00:00:01.000Z",
      type: "tool_end",
    })

    expect(failed[0]).toMatchObject({
      errorText: "command failed",
      output: undefined,
      status: "failed",
      text: "command failed",
    })
  })

  it("marks running tools finished when the run finishes", () => {
    const items: ChatItem[] = [
      {
        id: "tool-1",
        input: "{}",
        name: "bash",
        role: "tool",
        status: "running",
        text: "{}",
      },
    ]

    expect(
      applyChatEvent(items, {
        status: "finished",
        text: "Done",
        timestamp: "2026-07-07T00:00:00.000Z",
        type: "run_status",
      })
    ).toEqual([
      {
        id: "tool-1",
        input: "{}",
        name: "bash",
        role: "tool",
        status: "finished",
        text: "{}",
      },
      {
        id: "status-2026-07-07T00:00:00.000Z",
        role: "system",
        text: "Done",
      },
    ])
  })

  it("upserts status messages", () => {
    const first = applyChatEvent([], {
      id: "status-1",
      role: "system",
      status: "streaming",
      text: "Working",
      timestamp: "2026-07-07T00:00:00.000Z",
      type: "status_message",
    })
    const second = applyChatEvent(first, {
      id: "status-1",
      role: "error",
      status: "finished",
      text: "Failed",
      timestamp: "2026-07-07T00:00:01.000Z",
      type: "status_message",
    })

    expect(second).toEqual([
      {
        id: "status-1",
        role: "error",
        status: "finished",
        text: "Failed",
        timestamp: "2026-07-07T00:00:01.000Z",
      },
    ])
  })

  it("appends error events", () => {
    expect(
      applyChatEvent([], {
        id: "error-1",
        text: "Boom",
        timestamp: "2026-07-07T00:00:00.000Z",
        type: "error",
      })
    ).toEqual([{ id: "error-1", role: "error", text: "Boom" }])
  })

  it("ignores context usage and queue events in chat history", () => {
    const items: ChatItem[] = [{ id: "user-1", role: "user", text: "hello" }]

    expect(
      applyChatEvent(items, {
        contextWindow: 100,
        percent: 50,
        timestamp: "2026-07-07T00:00:00.000Z",
        tokens: 50,
        type: "context_usage",
      })
    ).toBe(items)
    expect(
      applyChatEvent(items, {
        followUp: ["next"],
        steering: ["stop"],
        timestamp: "2026-07-07T00:00:01.000Z",
        type: "queue_update",
      })
    ).toBe(items)
  })

  it("returns the original array for explicit no-op events", () => {
    const items: ChatItem[] = [
      {
        id: "assistant-1",
        role: "assistant",
        status: "streaming",
        text: "hello",
        timestamp: "2026-07-07T00:00:00.000Z",
      },
      {
        id: "tool-1",
        input: "{}",
        name: "bash",
        role: "tool",
        status: "running",
        text: "{}",
      },
    ]

    expect(
      applyChatEvent(items, {
        id: "assistant-1",
        timestamp: "2026-07-07T00:00:00.000Z",
        type: "assistant_text_start",
      })
    ).toBe(items)
    expect(
      applyChatEvent(items, {
        id: "tool-1",
        timestamp: "2026-07-07T00:00:01.000Z",
        type: "tool_update",
      })
    ).toBe(items)
    expect(
      applyChatEvent(items, {
        id: "missing-tool",
        result: "ignored",
        timestamp: "2026-07-07T00:00:02.000Z",
        type: "tool_end",
      })
    ).toBe(items)
    expect(
      applyChatEvent(items, {
        status: "running",
        timestamp: "2026-07-07T00:00:03.000Z",
        type: "run_status",
      })
    ).toBe(items)
  })

  it("stringifies unstringifiable tool payloads without failing the reducer", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(
      applyChatEvent([], {
        args: circular,
        id: "tool-1",
        name: "bash",
        timestamp: "2026-07-07T00:00:00.000Z",
        type: "tool_start",
      })[0]
    ).toMatchObject({
      input: "[object Object]",
      text: "[object Object]",
    })
  })
})
