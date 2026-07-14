import { describe, expect, it } from "vitest"

import { streamedToolPreviewReveals } from "./chat-tool-preview-motion"

describe("streamed tool preview motion", () => {
  it("reveals only the appended suffix of an existing line", () => {
    expect(
      streamedToolPreviewReveals(
        [{ key: "line-1", text: "const answer =" }],
        [{ key: "line-1", text: "const answer = 42" }],
        8,
      ),
    ).toEqual([{ key: "line-1", startOffset: 14, text: "const answer = 42" }])
  })

  it("reveals the whole line when existing text is replaced", () => {
    expect(
      streamedToolPreviewReveals(
        [{ key: "line-1", text: "const oldValue = 1" }],
        [{ key: "line-1", text: "const newValue = 1" }],
        8,
      ),
    ).toEqual([{ key: "line-1", startOffset: 0, text: "const newValue = 1" }])
  })

  it("does not animate unchanged rows and bounds large streamed batches", () => {
    expect(
      streamedToolPreviewReveals(
        [{ key: "line-1", text: "unchanged" }],
        [
          { key: "line-1", text: "unchanged" },
          { key: "line-2", text: "second" },
          { key: "line-3", text: "third" },
          { key: "line-4", text: "fourth" },
        ],
        2,
      ),
    ).toEqual([
      { key: "line-3", startOffset: 0, text: "third" },
      { key: "line-4", startOffset: 0, text: "fourth" },
    ])
  })
})
