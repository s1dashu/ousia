import { afterEach, describe, expect, it, vi } from "vitest"

import { getMessages } from "@/app/i18n"
import type { ChatItem } from "@/features/chat/chat-events"

import {
  formatSessionHistoryForClipboard,
  writeTextToClipboard,
} from "./chat-history-clipboard"

const t = getMessages("en")

describe("formatSessionHistoryForClipboard", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("formats empty histories with session and project metadata", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-07T00:00:00.000Z"))

    expect(
      formatSessionHistoryForClipboard({
        items: [],
        projectPath: "/tmp/project",
        sessionTitle: "Demo",
        t,
      })
    ).toBe(
      [
        "# Chat History",
        "",
        "Chat: Demo",
        "Project: /tmp/project",
        "Exported at: 2026-07-07T00:00:00.000Z",
        "",
        "(No messages in this chat)",
      ].join("\n")
    )
  })

  it("formats text and tool history items", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-07T00:00:00.000Z"))
    const items: ChatItem[] = [
      { id: "user-1", role: "user", text: "Hello" },
      {
        id: "tool-1",
        input: '{"cmd":"pwd"}',
        name: "tool-bash",
        output: "/tmp/project",
        role: "tool",
        status: "finished",
        text: "{}",
      },
      { id: "assistant-1", role: "assistant", text: "Done" },
    ]

    expect(
      formatSessionHistoryForClipboard({
        items,
        sessionTitle: "Demo",
        t,
      })
    ).toContain(
      [
        "## User",
        "Hello",
        "",
        "## Tool Call: bash",
        "Status: finished",
        "Input:",
        '{"cmd":"pwd"}',
        "Output:",
        "/tmp/project",
        "",
        "## Agent",
        "Done",
      ].join("\n")
    )
  })

  it("writes to the async clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })

    await writeTextToClipboard("hello")

    expect(writeText).toHaveBeenCalledWith("hello")
  })

  it("falls back to a hidden textarea when async clipboard is unavailable", async () => {
    const textArea = {
      focus: vi.fn(),
      remove: vi.fn(),
      select: vi.fn(),
      style: {} as Record<string, string>,
      value: "",
    }
    const append = vi.fn()
    const execCommand = vi.fn(() => true)
    vi.stubGlobal("navigator", {})
    vi.stubGlobal("document", {
      body: { append },
      createElement: vi.fn(() => textArea),
      execCommand,
    })

    await writeTextToClipboard("fallback text")

    expect(textArea.value).toBe("fallback text")
    expect(textArea.style).toMatchObject({ opacity: "0", position: "fixed" })
    expect(append).toHaveBeenCalledWith(textArea)
    expect(textArea.focus).toHaveBeenCalled()
    expect(textArea.select).toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith("copy")
    expect(textArea.remove).toHaveBeenCalled()
  })

  it("fails loudly when fallback clipboard copy fails", async () => {
    const textArea = {
      focus: vi.fn(),
      remove: vi.fn(),
      select: vi.fn(),
      style: {} as Record<string, string>,
      value: "",
    }
    vi.stubGlobal("navigator", {})
    vi.stubGlobal("document", {
      body: { append: vi.fn() },
      createElement: vi.fn(() => textArea),
      execCommand: vi.fn(() => false),
    })

    await expect(writeTextToClipboard("fallback text")).rejects.toThrow(
      "Clipboard copy failed"
    )
    expect(textArea.remove).toHaveBeenCalled()
  })
})
