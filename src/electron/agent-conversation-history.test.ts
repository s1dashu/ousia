import { describe, expect, it } from "vitest"

import type { OusiaChatAttachment, OusiaChatHistoryItem } from "./chat-types.js"
import {
  branchEntriesToHistoryItems,
  buildPromptWithTextAttachments,
  imageContentFromAttachments,
  messageEntryToHistoryItems,
  previewToolInput,
  shouldShowThinkingForLevel,
  textFromContent,
} from "./agent-conversation-history.js"

describe("Pi conversation content conversion", () => {
  it("extracts text blocks while ignoring images and unknown content", () => {
    expect(
      textFromContent([
        { type: "text", text: "first" },
        { type: "image", data: "ignored" },
        { type: "text", text: "second" },
        { type: "unknown", text: "ignored" },
      ])
    ).toBe("first\nsecond")
    expect(textFromContent("plain")).toBe("plain")
    expect(textFromContent({ type: "text" })).toBe("")
  })

  it("builds a prompt from text and non-image file attachments", () => {
    const attachments: OusiaChatAttachment[] = [
      {
        id: "text-1",
        kind: "text",
        mediaType: "text/plain",
        name: "notes.txt",
        size: 12,
        text: "attached notes",
      },
      {
        id: "file-1",
        kind: "file",
        mediaType: "application/pdf",
        name: "brief.pdf",
        size: 2048,
      },
      {
        dataBase64: "YWJj",
        id: "image-1",
        kind: "image",
        mediaType: "image/png",
        name: "image.png",
        size: 3,
      },
    ]

    const prompt = buildPromptWithTextAttachments("  question  ", attachments)
    expect(prompt).toContain("question")
    expect(prompt).toContain('<attached_file name="notes.txt"')
    expect(prompt).toContain("attached notes")
    expect(prompt).toContain("brief.pdf (application/pdf, 2.0 KB)")
    expect(prompt).not.toContain("image.png")
  })

  it("converts only image attachments to Pi image content", () => {
    expect(
      imageContentFromAttachments([
        {
          dataBase64: "YWJj",
          id: "image-1",
          kind: "image",
          mediaType: "image/jpeg",
          name: "image.jpg",
          size: 3,
        },
        {
          id: "text-1",
          kind: "text",
          mediaType: "text/plain",
          name: "notes.txt",
          size: 4,
          text: "note",
        },
      ])
    ).toEqual([
      {
        data: "YWJj",
        mimeType: "image/jpeg",
        type: "image",
      },
    ])
  })

  it("summarizes sensitive tool input fields for lightweight history", () => {
    expect(
      previewToolInput(
        JSON.stringify({
          command: "npm test",
          ignoredLargePayload: "not selected",
          path: "/workspace/file.ts",
        })
      )
    ).toBe(
      JSON.stringify({
        path: "/workspace/file.ts",
        command: "npm test",
      })
    )
  })

  it("correlates a tool result with its preceding tool call", () => {
    const items: OusiaChatHistoryItem[] = []
    const toolIndexes = new Map<string, number>()
    messageEntryToHistoryItems(
      {
        id: "assistant-1",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [
            {
              type: "toolCall",
              id: "tool-1",
              name: "read",
              arguments: { path: "/workspace/file.ts" },
            },
          ],
        },
      } as never,
      items,
      toolIndexes,
      { includeToolPayloads: false, showThinking: false }
    )
    messageEntryToHistoryItems(
      {
        id: "result-1",
        message: {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "read",
          content: [{ type: "text", text: "file contents" }],
          isError: false,
        },
      } as never,
      items,
      toolIndexes,
      { includeToolPayloads: false, showThinking: false }
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: "tool-1",
      name: "read",
      payloadOmitted: true,
      role: "tool",
      status: "finished",
      text: "file contents",
    })
  })

  it("tracks thinking visibility changes across a Pi branch", () => {
    const items: OusiaChatHistoryItem[] = []
    branchEntriesToHistoryItems(
      [
        {
          type: "thinking_level_change",
          id: "level-high",
          thinkingLevel: "high",
        },
        {
          type: "message",
          id: "assistant-visible",
          timestamp: "2026-07-30T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "visible thought" },
              { type: "text", text: "visible answer" },
            ],
          },
        },
        {
          type: "thinking_level_change",
          id: "level-off",
          thinkingLevel: "off",
        },
        {
          type: "message",
          id: "assistant-hidden",
          timestamp: "2026-07-30T00:01:00.000Z",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "hidden thought" },
              { type: "text", text: "second answer" },
            ],
          },
        },
      ] as never,
      items,
      false
    )

    expect(items.map((item) => [item.role, item.text])).toEqual([
      ["thinking", "visible thought"],
      ["assistant", "visible answer"],
      ["assistant", "second answer"],
    ])
  })

  it("reconstructs user image attachment metadata from Pi content", () => {
    const items: OusiaChatHistoryItem[] = []
    messageEntryToHistoryItems(
      {
        id: "user-1",
        timestamp: "2026-07-30T00:00:00.000Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image", data: "YWJj", mimeType: "image/jpeg" },
          ],
        },
      } as never,
      items,
      new Map()
    )

    expect(items[0]).toMatchObject({
      attachments: [
        {
          dataBase64: "YWJj",
          kind: "image",
          mediaType: "image/jpeg",
          name: "image.jpg",
          size: 3,
        },
      ],
      id: "user-1",
      role: "user",
      text: "look",
    })
  })

  it("treats every configured level except off as visible thinking", () => {
    expect(shouldShowThinkingForLevel(undefined)).toBe(false)
    expect(shouldShowThinkingForLevel("off")).toBe(false)
    expect(shouldShowThinkingForLevel("minimal")).toBe(true)
    expect(shouldShowThinkingForLevel("high")).toBe(true)
  })
})
