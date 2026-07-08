import { describe, expect, it } from "vitest"

import { formatToolName, shouldAutoExpandTool } from "./chat-tool-format"

describe("chat tool formatting", () => {
  it("normalizes built-in tool names", () => {
    expect(formatToolName("tool-write")).toBe("write")
    expect(formatToolName("tool_read")).toBe("read")
    expect(formatToolName("tool:bash")).toBe("bash")
  })

  it("keeps readable custom tool names", () => {
    expect(formatToolName("webSearch")).toBe("web Search")
    expect(formatToolName("")).toBe("tool")
  })

  it("auto-expands write and edit tools only", () => {
    expect(shouldAutoExpandTool("tool-write")).toBe(true)
    expect(shouldAutoExpandTool("edit")).toBe(true)
    expect(shouldAutoExpandTool("bash")).toBe(false)
  })
})
