import { describe, expect, it } from "vitest"

import type { ChatItem } from "@/features/chat/chat-events"
import {
  isScrolledToLatest,
  latestAssistantItem,
  latestFinishedAssistantId,
  maxChatScrollTop,
} from "@/features/chat/use-chat-scroll"

function assistant(
  id: string,
  status: "streaming" | "finished" | "failed" | undefined
): ChatItem {
  return {
    id,
    role: "assistant",
    status,
    text: id,
  }
}

describe("chat scroll calculations", () => {
  it("detects the latest-position tolerance", () => {
    expect(
      isScrolledToLatest({
        clientHeight: 400,
        scrollHeight: 1000,
        scrollTop: 577,
      })
    ).toBe(true)
    expect(
      isScrolledToLatest({
        clientHeight: 400,
        scrollHeight: 1000,
        scrollTop: 576,
      })
    ).toBe(false)
  })

  it("clamps the maximum scroll position at zero", () => {
    expect(
      maxChatScrollTop({
        clientHeight: 400,
        scrollHeight: 100,
        scrollTop: 0,
      })
    ).toBe(0)
    expect(
      maxChatScrollTop({
        clientHeight: 400,
        scrollHeight: 1000,
        scrollTop: 0,
      })
    ).toBe(600)
  })

  it("finds the latest assistant and latest finished assistant separately", () => {
    const items: ChatItem[] = [
      assistant("finished", "finished"),
      {
        id: "tool",
        role: "tool",
        name: "test",
        status: "finished",
        text: "tool",
      },
      assistant("streaming", "streaming"),
    ]
    expect(latestAssistantItem(items)?.id).toBe("streaming")
    expect(latestFinishedAssistantId(items)).toBe("finished")
    expect(latestFinishedAssistantId([])).toBeNull()
  })
})
