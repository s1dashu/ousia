import { describe, expect, it } from "vitest"

import {
  buildPlainChatTitleRequest,
  buildStructuredChatTitlePrompt,
  normalizeGeneratedChatTitle,
} from "./chat-title-policy.js"

describe("chat title language policy", () => {
  it("requires an English title when the interface language is English", () => {
    const plain = buildPlainChatTitleRequest("en", "帮我写一个 HTML 应用")
    const structured = buildStructuredChatTitlePrompt(
      "en",
      "帮我写一个 HTML 应用"
    )

    expect(plain.systemPrompt).toContain("English titles")
    expect(plain.userPrompt).toContain("帮我写一个 HTML 应用")
    expect(structured).toContain("English title")
  })

  it("requires a Chinese title when the interface language is Chinese", () => {
    const plain = buildPlainChatTitleRequest("zh", "Build an HTML app")
    const structured = buildStructuredChatTitlePrompt("zh", "Build an HTML app")

    expect(plain.systemPrompt).toContain("中文短标题")
    expect(structured).toContain("中文会话标题")
  })

  it("limits English titles by words without truncating normal words", () => {
    expect(
      normalizeGeneratedChatTitle(
        "Title: Build a delightful tiny HTML particle playground today",
        "en"
      )
    ).toBe("Build a delightful tiny HTML particle playground today")
  })

  it("limits Chinese titles by characters", () => {
    expect(
      normalizeGeneratedChatTitle(
        "会话标题：写一个有趣的HTML粒子互动应用演示",
        "zh"
      )
    ).toBe("写一个有趣的HTML粒子互动应用")
  })
})
