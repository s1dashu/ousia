import { describe, expect, it } from "vitest"

import {
  editReplacementsForFilePreview,
  editToolInputDraft,
  parseEditToolInput,
} from "./tool-edit-input"

describe("partial edit tool input", () => {
  it("streams newText before oldText and a trailing path arrive", () => {
    const input = parseEditToolInput(
      '{"edits":[{"newText":"line one\\nline two'
    )

    expect(input).toEqual({
      edits: [
        {
          newText: "line one\nline two",
          newTextComplete: false,
          oldTextComplete: false,
        },
      ],
      isPartial: true,
      path: undefined,
      pathComplete: false,
    })
    expect(input && editToolInputDraft(input)).toEqual({
      newContent: "line one\nline two",
      oldContent: "",
    })
    expect(input && editReplacementsForFilePreview(input)).toBeUndefined()
  })

  it("pairs newText-first replacements and tracks an incomplete path", () => {
    const input = parseEditToolInput(
      '{"edits":[{"newText":"BETA","oldText":"beta"}],"path":"src/note'
    )

    expect(input).toEqual({
      edits: [
        {
          newText: "BETA",
          newTextComplete: true,
          oldText: "beta",
          oldTextComplete: true,
        },
      ],
      isPartial: true,
      path: "src/note",
      pathComplete: false,
    })
    expect(input && editReplacementsForFilePreview(input)).toEqual([
      { newText: "BETA", oldText: "beta" },
    ])
  })

  it("preserves multiple replacements while the latest newText is growing", () => {
    const input = parseEditToolInput(
      '{"path":"note.txt","edits":[{"newText":"A","oldText":"a"},{"oldText":"b","newText":"B'
    )

    expect(input).toMatchObject({
      edits: [
        {
          newText: "A",
          newTextComplete: true,
          oldText: "a",
          oldTextComplete: true,
        },
        {
          newText: "B",
          newTextComplete: false,
          oldText: "b",
          oldTextComplete: true,
        },
      ],
      isPartial: true,
      path: "note.txt",
      pathComplete: true,
    })
    expect(input && editReplacementsForFilePreview(input)).toEqual([
      { newText: "A", oldText: "a" },
      { newText: "B", oldText: "b" },
    ])
  })

  it("parses complete edits arrays and legacy top-level replacements", () => {
    expect(
      parseEditToolInput({
        edits: [
          { newText: "A", oldText: "a" },
          { new_text: "B", old_text: "b" },
        ],
        path: "note.txt",
      })
    ).toMatchObject({
      edits: [
        { newText: "A", oldText: "a" },
        { newText: "B", oldText: "b" },
      ],
      isPartial: false,
      path: "note.txt",
      pathComplete: true,
    })

    expect(
      parseEditToolInput({
        filePath: "note.txt",
        newText: "new",
        oldText: "old",
      })
    ).toMatchObject({
      edits: [{ newText: "new", oldText: "old" }],
      isPartial: false,
      path: "note.txt",
    })
  })

  it("rejects non-JSON strings", () => {
    expect(parseEditToolInput("not-json")).toBeUndefined()
    expect(parseEditToolInput(undefined)).toBeUndefined()
  })
})
