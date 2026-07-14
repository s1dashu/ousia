/// <reference types="node" />

import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  CHAT_MESSAGE_MEASURED_ATTRIBUTE,
  formatMeasuredChatMessageBlockSize,
} from "./chat-message-containment"

describe("chat message containment", () => {
  it("preserves a measured fractional block size for the intrinsic placeholder", () => {
    expect(formatMeasuredChatMessageBlockSize(137.3332)).toBe("137.334px")
  })

  it("rejects invalid measurements instead of installing a bogus placeholder", () => {
    expect(() => formatMeasuredChatMessageBlockSize(0)).toThrow(
      "positive finite number",
    )
    expect(() => formatMeasuredChatMessageBlockSize(Number.NaN)).toThrow(
      "positive finite number",
    )
  })

  it("enables offscreen rendering only after an exact message measurement", () => {
    const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8")

    expect(css).toContain(`[${CHAT_MESSAGE_MEASURED_ATTRIBUTE}="true"]`)
    expect(css).not.toContain("contain-intrinsic-block-size: auto 120px")
  })
})
