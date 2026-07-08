import { describe, expect, it } from "vitest"

import { applyChatEvent, type ChatItem } from "./chat-events"

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
        text: "hello",
        timestamp: "2026-07-07T00:00:00.000Z",
      },
    ])
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
    ).toEqual(items)
    expect(
      applyChatEvent(items, {
        followUp: ["next"],
        steering: ["stop"],
        timestamp: "2026-07-07T00:00:01.000Z",
        type: "queue_update",
      })
    ).toEqual(items)
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
