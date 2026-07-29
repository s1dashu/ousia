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
  createAgentConversationModule,
  deletePersistedPiSessionFile,
  disposePiSessionBundle,
  historyItemsFromActivePiSession,
} from "./agent-conversations.js"

describe("Pi agent conversation boundaries", () => {
  it("permanently deletes only the exact Pi session file in its canonical directory", async () => {
    const deleteFile = vi.fn(async () => undefined)
    const deletedPath = await deletePersistedPiSessionFile(
      "/tmp/project",
      "session-target",
      {
        deleteFile,
        getSessionDir: () => "/tmp/pi-sessions",
        listSessions: vi.fn(async () => [
          {
            id: "session-other",
            path: "/tmp/pi-sessions/other.jsonl",
          },
          {
            id: "session-target",
            path: "/tmp/pi-sessions/target.jsonl",
          },
        ]) as never,
      }
    )

    expect(deletedPath).toBe("/tmp/pi-sessions/target.jsonl")
    expect(deleteFile).toHaveBeenCalledExactlyOnceWith(
      "/tmp/pi-sessions/target.jsonl"
    )
  })

  it("refuses a Pi session path outside the SDK canonical directory", async () => {
    await expect(
      deletePersistedPiSessionFile("/tmp/project", "session-target", {
        deleteFile: vi.fn(async () => undefined),
        getSessionDir: () => "/tmp/pi-sessions",
        listSessions: vi.fn(async () => [
          {
            id: "session-target",
            path: "/tmp/untrusted/target.jsonl",
          },
        ]) as never,
      })
    ).rejects.toThrow("outside its canonical directory")
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
