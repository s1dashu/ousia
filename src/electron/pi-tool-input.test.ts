import { describe, expect, it, vi } from "vitest"

import {
  isCompletePiToolInputJson,
  PiToolInputTracker,
} from "./pi-tool-input.js"

describe("Pi streamed tool input", () => {
  it("recognizes only complete JSON object arguments", () => {
    expect(isCompletePiToolInputJson(undefined)).toBe(false)
    expect(isCompletePiToolInputJson("")).toBe(false)
    expect(isCompletePiToolInputJson("  {}\n")).toBe(true)
    expect(isCompletePiToolInputJson('{"path":"todo.html"')).toBe(false)
    expect(isCompletePiToolInputJson('["todo.html"]')).toBe(false)
    expect(isCompletePiToolInputJson("null")).toBe(false)
    expect(isCompletePiToolInputJson('"value"')).toBe(false)
    expect(isCompletePiToolInputJson("1")).toBe(false)
    expect(isCompletePiToolInputJson("true")).toBe(false)
    expect(isCompletePiToolInputJson("{}{}")).toBe(false)
    expect(isCompletePiToolInputJson('{"value":1,}')).toBe(false)
    expect(
      isCompletePiToolInputJson(
        JSON.stringify({
          path: "todo.html",
          edits: [{ old: '\\"', new: "nested" }],
          meta: { ok: true },
        })
      )
    ).toBe(true)
  })

  it("rejects a partial object that merely ends with a code brace", () => {
    expect(
      isCompletePiToolInputJson(
        '{"path":"todo.html","content":"function render() {\\n} '
      )
    ).toBe(false)
  })

  it("completes interleaved tool inputs independently and only once", () => {
    const tracker = new PiToolInputTracker()
    tracker.start(0)
    tracker.start(1)
    tracker.append(0, '{"path":"first.html"')
    tracker.append(1, '{"path":"second.html"')
    expect(tracker.rawArguments(0)).toBe('{"path":"first.html"')

    expect(
      tracker.finishIfComplete({
        authoritativeEnd: false,
        contentIndex: 0,
        toolCallId: "display-1",
      })
    ).toBeUndefined()

    tracker.append(0, "}")
    expect(
      tracker.finishIfComplete({
        authoritativeEnd: false,
        contentIndex: 0,
        toolCallId: "display-1",
      })
    ).toBe("json")
    expect(tracker.isComplete("display-1")).toBe(true)
    expect(tracker.isComplete("display-2")).toBe(false)
    expect(tracker.receivedDataAfterCompletion("display-1", "  ")).toBe(false)
    expect(tracker.receivedDataAfterCompletion("display-1", "extra")).toBe(true)
    expect(
      tracker.finishIfComplete({
        authoritativeEnd: true,
        contentIndex: 0,
        toolCallId: "display-1",
      })
    ).toBeUndefined()

    expect(
      tracker.finishIfComplete({
        authoritativeEnd: true,
        contentIndex: 1,
        toolCallId: "display-2",
      })
    ).toBe("toolcall_end")
    expect(tracker.isComplete("display-2")).toBe(true)

    tracker.reset()
    expect(tracker.rawArguments(0)).toBeUndefined()
    expect(tracker.isComplete("display-1")).toBe(false)
  })

  it("strictly parses a large code argument only after its root object closes", () => {
    const parseCompleteJson = vi.fn(isCompletePiToolInputJson)
    const tracker = new PiToolInputTracker(parseCompleteJson)
    const rawArguments = JSON.stringify({
      path: "large.ts",
      content: Array.from(
        { length: 500 },
        (_, index) => `if (ready) { return { index: ${index} } }`
      ).join("\n"),
    })
    let completion: string | undefined

    tracker.start(0)
    for (const character of rawArguments) {
      tracker.append(0, character)
      completion ??= tracker.finishIfComplete({
        authoritativeEnd: false,
        contentIndex: 0,
        toolCallId: "large-write",
      })
    }

    expect(completion).toBe("json")
    expect(parseCompleteJson).toHaveBeenCalledOnce()
  })

  it("rejects invalid incremental roots and keeps authoritative end as fallback", () => {
    const tracker = new PiToolInputTracker()

    tracker.append(0, ' \n{"nested":[{"value":"ok"}]}')
    expect(
      tracker.finishIfComplete({
        authoritativeEnd: false,
        contentIndex: 0,
        toolCallId: "nested",
      })
    ).toBe("json")

    tracker.start(1)
    tracker.append(1, "x")
    tracker.append(1, "still-invalid")
    expect(
      tracker.finishIfComplete({
        authoritativeEnd: true,
        contentIndex: 1,
        toolCallId: "invalid-root",
      })
    ).toBe("toolcall_end")

    tracker.start(2)
    tracker.append(2, "{]")
    expect(
      tracker.finishIfComplete({
        authoritativeEnd: false,
        contentIndex: 2,
        toolCallId: "mismatched",
      })
    ).toBeUndefined()

    tracker.start(3)
    tracker.append(3, "{}")
    tracker.append(3, "{}")
    expect(
      tracker.finishIfComplete({
        authoritativeEnd: false,
        contentIndex: 3,
        toolCallId: "trailing-data",
      })
    ).toBeUndefined()
  })
})
