import { describe, expect, it } from "vitest"

import {
  composerScrollTopAfterResize,
  isComposerSelectionAtLatest,
} from "@/features/chat/chat-composer-scroll"

describe("chat composer scroll", () => {
  it("follows the new bottom after a short append at the end", () => {
    expect(
      composerScrollTopAfterResize({
        followLatest: true,
        maxScrollTop: 124,
        previousScrollTop: 100,
      }),
    ).toBe(124)
  })

  it("follows the new bottom after a long append at the end", () => {
    expect(
      composerScrollTopAfterResize({
        followLatest: true,
        maxScrollTop: 500,
        previousScrollTop: 100,
      }),
    ).toBe(500)
  })

  it("preserves the viewport while editing away from the end", () => {
    expect(
      composerScrollTopAfterResize({
        followLatest: false,
        maxScrollTop: 500,
        previousScrollTop: 100,
      }),
    ).toBe(100)
  })

  it("clamps a preserved position when the content shrinks", () => {
    expect(
      composerScrollTopAfterResize({
        followLatest: false,
        maxScrollTop: 50,
        previousScrollTop: 100,
      }),
    ).toBe(50)
  })

  it("only treats a collapsed selection at the end as latest", () => {
    expect(isComposerSelectionAtLatest(20, 20, 20)).toBe(true)
    expect(isComposerSelectionAtLatest(20, 10, 10)).toBe(false)
    expect(isComposerSelectionAtLatest(20, 10, 20)).toBe(false)
  })
})
