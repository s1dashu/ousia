import { describe, expect, it } from "vitest"

import type { OusiaChatHistoryItem } from "@/electron/chat-types"

import { toolFilePreviewFromItem } from "./chat-tool-file-preview"

type ToolItem = Extract<OusiaChatHistoryItem, { role: "tool" }>

function toolItem(overrides: Partial<ToolItem>): ToolItem {
  return {
    id: "tool-1",
    name: "write",
    role: "tool",
    status: "running",
    text: "",
    ...overrides,
  }
}

describe("toolFilePreviewFromItem", () => {
  it("normalizes stored write diffs to an empty oldContent", () => {
    expect(
      toolFilePreviewFromItem(
        toolItem({
          filePreview: {
            kind: "diff",
            newContent: "new",
            oldContent: "stale historical content",
            path: "src/App.tsx",
            source: "input",
          },
        })
      )
    ).toEqual({
      kind: "diff",
      newContent: "new",
      oldContent: "",
      path: "src/App.tsx",
      source: "input",
    })
  })

  it("preserves non-write stored previews", () => {
    const preview = {
      kind: "error",
      message: "Unable to preview",
      path: "src/App.tsx",
      source: "input",
    } as const

    expect(
      toolFilePreviewFromItem(
        toolItem({
          filePreview: preview,
          name: "edit",
        })
      )
    ).toBe(preview)
  })

  it("adds a missing patch path from stored tool input", () => {
    expect(
      toolFilePreviewFromItem(
        toolItem({
          filePreview: {
            kind: "patch",
            patch: "@@ -1 +1 @@\n-old\n+new",
            source: "result",
          },
          input: '{"file_path":"src/App.tsx"}',
          name: "edit",
        })
      )
    ).toEqual({
      kind: "patch",
      patch: "@@ -1 +1 @@\n-old\n+new",
      path: "src/App.tsx",
      source: "result",
    })
  })

  it("builds fallback write previews from JSON input", () => {
    expect(
      toolFilePreviewFromItem(
        toolItem({
          input: JSON.stringify({
            content: "export const ok = true\n",
            path: "src/value.ts",
          }),
        })
      )
    ).toEqual({
      kind: "diff",
      newContent: "export const ok = true\n",
      oldContent: "",
      path: "src/value.ts",
      source: "input",
    })
  })

  it("builds fallback write previews from partial streaming JSON text", () => {
    expect(
      toolFilePreviewFromItem(
        toolItem({
          input: '{"path":"src/value.ts","content":"A\\tB\\u0021',
        })
      )
    ).toEqual({
      kind: "diff",
      newContent: "A\tB!",
      oldContent: "",
      path: "src/value.ts",
      source: "input",
    })
  })

  it("keeps streaming write content when path is serialized last", () => {
    expect(
      toolFilePreviewFromItem(
        toolItem({
          input: '{"content":"first\\nsecond',
        })
      )
    ).toEqual({
      kind: "diff",
      newContent: "first\nsecond",
      oldContent: "",
      path: "write",
      source: "input",
    })
  })

  it("decodes partial JSON escapes while building fallback write previews", () => {
    expect(
      toolFilePreviewFromItem(
        toolItem({
          input:
            '{"filePath":"src/value.ts","content":"A\\bB\\fC\\rD\\\\E',
        })
      )
    ).toEqual({
      kind: "diff",
      newContent: "A\bB\fC\rD\\E",
      oldContent: "",
      path: "src/value.ts",
      source: "input",
    })
  })

  it("falls back to pending previews when write input lacks content", () => {
    expect(
      toolFilePreviewFromItem(
        toolItem({
          input: '{"path":"src/value.ts"}',
        })
      )
    ).toEqual({
      kind: "diff",
      newContent: "",
      oldContent: "",
      path: "src/value.ts",
      source: "input",
    })
  })

  it("creates pending edit previews when content is not available yet", () => {
    expect(
      toolFilePreviewFromItem(
        toolItem({
          input: '{"path":"src/App.tsx"}',
          name: "tool-edit",
        })
      )
    ).toEqual({
      kind: "diff",
      newContent: "",
      oldContent: "",
      path: "src/App.tsx",
      source: "input",
    })
  })

  it("uses the tool name as a pending path when no path has streamed yet", () => {
    expect(
      toolFilePreviewFromItem(
        toolItem({
          name: "tool-write",
          text: "",
        })
      )
    ).toEqual({
      kind: "diff",
      newContent: "",
      oldContent: "",
      path: "write",
      source: "input",
    })
  })

  it("returns undefined for non-file tools without previews", () => {
    expect(
      toolFilePreviewFromItem(
        toolItem({
          name: "bash",
          text: '{"cmd":"pwd"}',
        })
      )
    ).toBeUndefined()
  })

  it("preserves patch previews when no path can be recovered", () => {
    expect(
      toolFilePreviewFromItem(
        toolItem({
          filePreview: {
            kind: "patch",
            patch: "@@ patch",
            source: "result",
          },
          input: "not-json",
          name: "edit",
        })
      )
    ).toEqual({
      kind: "patch",
      patch: "@@ patch",
      source: "result",
    })
  })
})
