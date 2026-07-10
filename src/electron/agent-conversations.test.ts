import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  writeRuntimeLog: vi.fn(),
}))

vi.mock("./runtime-logger.js", () => ({
  writeRuntimeLog: mocks.writeRuntimeLog,
}))

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => "/tmp/ousia-test-user-data",
  },
}))

vi.mock("./pi-package-dir.js", () => ({
  ensurePiPackageDir: () => "/tmp/pi-coding-agent",
}))

import { createAgentConversationModule } from "./agent-conversations.js"

describe("Pi agent conversation boundaries", () => {
  it("contains an invalid Codex reasoning effort at the Pi provider boundary", async () => {
    const emitChatEvent = vi.fn()
    const conversations = createAgentConversationModule({
      enabledTools: [],
      emitChatEvent,
    })

    await expect(
      conversations.sendChatMessage({
        agentMode: "standard",
        model: { provider: "openai", modelId: "gpt-test" },
        projectPath: "/tmp/project",
        prompt: "hello",
        sessionId: "pi-session",
        thinkingLevel: "ultra",
      })
    ).resolves.toMatchObject({
      ok: false,
      error: "Unsupported Pi thinking level: ultra",
    })
    expect(emitChatEvent.mock.calls.map(([event]) => event.type)).toEqual([
      "error",
      "run_status",
    ])
    expect(mocks.writeRuntimeLog).toHaveBeenCalledWith(
      "pi.thinking",
      "error",
      expect.objectContaining({ thinkingLevel: "ultra" })
    )
  })
})
