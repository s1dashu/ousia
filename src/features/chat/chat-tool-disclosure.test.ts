import { describe, expect, it } from "vitest"

import {
  shouldAutoCollapseToolDisclosure,
  shouldAutoExpandToolDisclosure,
} from "./chat-tool-disclosure"

describe("chat tool disclosure lifecycle", () => {
  it("collapses a write when its input finishes while another write keeps streaming", () => {
    const firstStreaming = {
      inputComplete: false,
      name: "write",
      status: "running",
    } as const
    const firstComplete = {
      ...firstStreaming,
      inputComplete: true,
    } as const
    const secondStreaming = {
      inputComplete: false,
      name: "write",
      status: "running",
    } as const

    expect(
      shouldAutoCollapseToolDisclosure(firstStreaming, firstComplete)
    ).toBe(true)
    expect(shouldAutoCollapseToolDisclosure(firstComplete, firstComplete)).toBe(
      false
    )
    expect(shouldAutoExpandToolDisclosure(firstComplete)).toBe(true)
    expect(shouldAutoExpandToolDisclosure(secondStreaming)).toBe(true)
  })

  it("reveals a write first identified in the same update that completes its input", () => {
    const unidentified = {
      inputComplete: false,
      name: "tool",
      status: "running",
    } as const
    const completedWrite = {
      inputComplete: true,
      name: "write",
      status: "running",
    } as const

    expect(shouldAutoCollapseToolDisclosure(unidentified, completedWrite)).toBe(
      false
    )
    expect(shouldAutoExpandToolDisclosure(completedWrite)).toBe(true)
  })

  it("still collapses write and edit tools when execution ends", () => {
    expect(
      shouldAutoCollapseToolDisclosure(
        { name: "edit", status: "running" },
        { name: "edit", status: "failed" }
      )
    ).toBe(true)
    expect(
      shouldAutoCollapseToolDisclosure(
        { name: "bash", status: "running" },
        { name: "bash", status: "finished" }
      )
    ).toBe(false)
  })
})
