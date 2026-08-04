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

import {
  activePiToolsForAgentMode,
  createAgentConversationModule,
  disposePiSessionBundle,
  includePiExtensionTools,
  preparePiSessionsForConfigurationReload,
  stripPiSystemPromptRuntimeDirectory,
} from "./agent-conversations.js"
import { historyItemsFromActivePiSession } from "./agent-conversation-history.js"

describe("Pi agent conversation boundaries", () => {
  it("loads Pi's generated built-in prompt for the editor", async () => {
    const conversations = createAgentConversationModule({
      enabledTools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
      emitChatEvent: vi.fn(),
    })

    const prompt = await conversations.getBuiltinSystemPrompt({
      agentMode: "standard",
      modelId: "",
      projectPath: "/tmp/ousia-builtin-prompt-test",
    })

    expect(prompt).toContain("You are an expert coding assistant")
    expect(prompt).toContain("Available tools:")
    expect(prompt).not.toContain("Current working directory:")
  })

  it("removes only Pi's dynamic cwd suffix from the editable built-in prompt", () => {
    expect(
      stripPiSystemPromptRuntimeDirectory(
        "Built-in prompt\nCurrent working directory: /tmp/project",
        "/tmp/project"
      )
    ).toBe("Built-in prompt")
    expect(() =>
      stripPiSystemPromptRuntimeDirectory("Built-in prompt", "/tmp/project")
    ).toThrow("missing its runtime directory suffix")
  })

  it("unsubscribes and disposes a released Pi session even if unsubscribe fails", () => {
    const dispose = vi.fn()
    const unsubscribe = vi.fn(() => {
      throw new Error("unsubscribe failed")
    })

    expect(() =>
      disposePiSessionBundle({
        session: { dispose } as never,
        unsubscribe,
      })
    ).toThrow("unsubscribe failed")
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it("defers configuration reload while an agent is running", async () => {
    const session = {
      abort: vi.fn(async () => {}),
      clearQueue: vi.fn(),
      isBashRunning: false,
      isStreaming: true,
      pendingMessageCount: 0,
    }

    await expect(
      preparePiSessionsForConfigurationReload([session], false)
    ).resolves.toEqual({ busySessionCount: 1, status: "agent-running" })
    expect(session.abort).not.toHaveBeenCalled()
    expect(session.clearQueue).not.toHaveBeenCalled()
  })

  it("stops active work before a forced configuration reload", async () => {
    const session = {
      abort: vi.fn(async () => {}),
      clearQueue: vi.fn(),
      isBashRunning: true,
      isStreaming: false,
      pendingMessageCount: 1,
    }

    await expect(
      preparePiSessionsForConfigurationReload([session], true)
    ).resolves.toEqual({ busySessionCount: 1, status: "reloaded" })
    expect(session.clearQueue).toHaveBeenCalledOnce()
    expect(session.abort).toHaveBeenCalledOnce()
  })

  it("includes installed extension tools in standard agent sessions", () => {
    const extensionTools = new Map([
      ["web_search", {}],
      ["fetch_content", {}],
    ])

    expect(
      includePiExtensionTools(["read", "bash"], "standard", {
        errors: [],
        extensions: [{ tools: extensionTools }],
      } as never)
    ).toEqual(["read", "bash", "web_search", "fetch_content"])
  })

  it("does not silently broaden restricted agent modes with extension tools", () => {
    expect(
      includePiExtensionTools(["read"], "readOnly", {
        errors: [],
        extensions: [{ tools: new Map([["write_anywhere", {}]]) }],
      } as never)
    ).toEqual(["read"])
  })

  it("keeps extension tools active when standard sessions are reconfigured", () => {
    const session = {
      getAllTools: () => [
        {
          name: "read",
          sourceInfo: { source: "builtin" },
        },
        {
          name: "web_search",
          sourceInfo: { source: "npm:pi-web-access" },
        },
      ],
    }

    expect(activePiToolsForAgentMode(session as never, "standard")).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "ls",
      "web_search",
    ])
  })

  it("fails fast when a configured Pi extension cannot load", () => {
    expect(() =>
      includePiExtensionTools(["read"], "standard", {
        errors: [{ error: "module failed", path: "/extension/index.ts" }],
        extensions: [],
      } as never)
    ).toThrow(
      "Failed to load 1 Pi extension(s): /extension/index.ts: module failed"
    )
  })

  it("reads unflushed history from an active Pi session manager", () => {
    const session = {
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            id: "pi-user-1",
            parentId: null,
            timestamp: "2026-07-29T00:00:00.000Z",
            message: {
              role: "user",
              content: [{ type: "text", text: "survives HMR" }],
              timestamp: Date.parse("2026-07-29T00:00:00.000Z"),
            },
          },
        ],
      },
    } as never

    expect(historyItemsFromActivePiSession(session, false)).toEqual([
      {
        attachments: undefined,
        id: "pi-user-1",
        role: "user",
        status: "finished",
        text: "survives HMR",
        timestamp: "2026-07-29T00:00:00.000Z",
      },
    ])
    expect(historyItemsFromActivePiSession(undefined, false)).toBeUndefined()
  })

  it("contains an invalid Codex reasoning effort at the Pi provider boundary", async () => {
    const emitChatEvent = vi.fn()
    const conversations = createAgentConversationModule({
      enabledTools: [],
      emitChatEvent,
    })

    await expect(
      conversations.sendChatMessage({
        agentMode: "standard",
        messageId: "user-client-1",
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
      "user_message",
      "error",
      "run_status",
    ])
    expect(emitChatEvent.mock.calls[0]?.[0]).toMatchObject({
      delivery: "failed",
      id: "user-client-1",
      text: "hello",
    })
    expect(mocks.writeRuntimeLog).toHaveBeenCalledWith(
      "pi.thinking",
      "error",
      expect.objectContaining({ thinkingLevel: "ultra" })
    )
  })
})
