import { homedir } from "node:os"
import { join } from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { OusiaAppState, OusiaSessionRecord } from "./chat-types.js"

const mocks = vi.hoisted(() => ({
  loadAppState: vi.fn<() => Promise<OusiaAppState>>(),
  writeRuntimeLog: vi.fn(),
}))

vi.mock("./app-state-store.js", () => ({
  loadAppState: mocks.loadAppState,
}))

vi.mock("./runtime-logger.js", () => ({
  writeRuntimeLog: mocks.writeRuntimeLog,
}))

import {
  createAgentProviderRouter,
  resolveCanonicalAgentContext,
  type AgentConversationProvider,
} from "./agent-provider-router.js"
import { createDefaultOusiaAppState } from "./chat-types.js"

function createProvider(): AgentConversationProvider {
  return {
    branchChat: vi.fn(async () => ({ ok: true as const, items: [] })),
    clearChatQueue: vi.fn(async () => ({ ok: true })),
    compactChat: vi.fn(async () => ({ ok: true })),
    exportChat: vi.fn(async (_payload, outputPath) => ({
      ok: true,
      path: outputPath,
    })),
    getContextUsage: vi.fn(async () => ({ ok: true as const })),
    getChatHistory: vi.fn(async () => ({ items: [] })),
    getChatToolPayload: vi.fn(async () => ({
      ok: false as const,
      error: "missing",
    })),
    interruptChat: vi.fn(async () => ({ ok: true })),
    moveChatSession: vi.fn(async () => ({ ok: true as const, moved: true })),
    sendChatMessage: vi.fn(async () => ({ ok: true })),
  }
}

function withSession(
  state: OusiaAppState,
  session: Partial<OusiaSessionRecord>
) {
  state.sessions[0] = { ...state.sessions[0], ...session }
  return state.sessions[0]
}

describe("agent provider router", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(["pi", "codex"] as const)(
    "routes a %s session to its immutable provider with canonical cwd",
    async (agentProvider) => {
      const state = createDefaultOusiaAppState()
      state.settings = {
        ...state.settings,
        defaultWorkDir: "~/Documents/Ousia",
      }
      const session = withSession(state, { agentProvider })
      mocks.loadAppState.mockResolvedValue(state)
      const pi = createProvider()
      const codex = createProvider()
      const router = createAgentProviderRouter({ codex, pi })
      const payload = {
        projectPath: join(homedir(), "Documents", "Ousia"),
        sessionId: session.id,
        prompt: "hello",
        model: { provider: "openai", modelId: "model" },
        thinkingLevel: "medium" as const,
      }

      await expect(router.sendChatMessage(payload)).resolves.toEqual({ ok: true })

      expect(
        providersFor(agentProvider, { codex, pi }).sendChatMessage
      ).toHaveBeenCalledWith({
        ...payload,
        projectPath: "~/Documents/Ousia",
      })
      expect(
        providersFor(agentProvider === "pi" ? "codex" : "pi", { codex, pi })
          .sendChatMessage
      ).not.toHaveBeenCalled()
      expect(mocks.writeRuntimeLog).toHaveBeenCalledWith(
        "agent.context",
        "debug",
        expect.objectContaining({
          message: "Canonicalized equivalent agent project path",
          sessionId: session.id,
        })
      )
    }
  )

  it("rejects a forged cwd instead of passing it to an agent", async () => {
    const state = createDefaultOusiaAppState()
    state.settings = { ...state.settings, defaultWorkDir: "/trusted/default" }
    const session = withSession(state, { agentProvider: "codex" })
    mocks.loadAppState.mockResolvedValue(state)
    const codex = createProvider()
    const router = createAgentProviderRouter({ codex, pi: createProvider() })

    await expect(
      router.getChatHistory({
        projectPath: "/forged/writable-root",
        sessionId: session.id,
      })
    ).rejects.toThrow(`Project path mismatch for session: ${session.id}`)

    expect(codex.getChatHistory).not.toHaveBeenCalled()
    expect(mocks.writeRuntimeLog).toHaveBeenCalledWith(
      "agent.context",
      "warn",
      expect.objectContaining({
        canonicalProjectPath: "/trusted/default",
        requestedProjectPath: "/forged/writable-root",
        sessionId: session.id,
      })
    )
  })

  it("derives a project session cwd from its canonical project record", async () => {
    const state = createDefaultOusiaAppState()
    state.projects = [{ id: "project-a", name: "A", path: "/trusted/project" }]
    const session = withSession(state, {
      agentProvider: "codex",
      projectId: "project-a",
    })
    mocks.loadAppState.mockResolvedValue(state)
    const codex = createProvider()
    const router = createAgentProviderRouter({ codex, pi: createProvider() })

    await router.getContextUsage({
      projectPath: "/trusted/parent/../project",
      sessionId: session.id,
    })

    expect(codex.getContextUsage).toHaveBeenCalledWith({
      projectPath: "/trusted/project",
      sessionId: session.id,
    })
  })

  it("preserves move semantics while canonicalizing source and target paths", async () => {
    const state = createDefaultOusiaAppState()
    state.projects = [
      { id: "old-project", name: "Old", path: "/trusted/old" },
      { id: "new-project", name: "New", path: "/trusted/new" },
    ]
    const session = withSession(state, {
      agentProvider: "codex",
      projectId: "old-project",
    })
    mocks.loadAppState.mockResolvedValue(state)
    const pi = createProvider()
    const codex = createProvider()
    const router = createAgentProviderRouter({ codex, pi })
    const payload = {
      sessionId: session.id,
      sourceProjectPath: "/trusted/source/../old",
      targetProjectId: "new-project",
      targetProjectPath: "/trusted/target/../new",
    }

    await router.moveChatSession(payload)

    expect(codex.moveChatSession).toHaveBeenCalledWith({
      ...payload,
      sourceProjectPath: "/trusted/old",
      targetProjectPath: "/trusted/new",
    })
  })

  it("rejects a forged move target even when the project id is valid", async () => {
    const state = createDefaultOusiaAppState()
    state.projects = [
      { id: "old-project", name: "Old", path: "/trusted/old" },
      { id: "new-project", name: "New", path: "/trusted/new" },
    ]
    const session = withSession(state, {
      agentProvider: "pi",
      projectId: "old-project",
    })
    mocks.loadAppState.mockResolvedValue(state)
    const pi = createProvider()
    const router = createAgentProviderRouter({ codex: createProvider(), pi })

    await expect(
      router.moveChatSession({
        sessionId: session.id,
        sourceProjectPath: "/trusted/old",
        targetProjectId: "new-project",
        targetProjectPath: "/forged/target",
      })
    ).rejects.toThrow(`Target project path mismatch for session: ${session.id}`)

    expect(pi.moveChatSession).not.toHaveBeenCalled()
  })

  it("fails fast when a move target project is unknown", async () => {
    const state = createDefaultOusiaAppState()
    state.settings = { ...state.settings, defaultWorkDir: "/trusted/default" }
    const session = state.sessions[0]
    mocks.loadAppState.mockResolvedValue(state)
    const router = createAgentProviderRouter({
      codex: createProvider(),
      pi: createProvider(),
    })

    await expect(
      router.moveChatSession({
        sessionId: session.id,
        sourceProjectPath: "/trusted/default",
        targetProjectId: "missing-project",
        targetProjectPath: "/forged/target",
      })
    ).rejects.toThrow("Unknown project: missing-project")
  })

  it("fails fast when a session references an unknown project", async () => {
    const state = createDefaultOusiaAppState()
    const session = withSession(state, { projectId: "missing-project" })
    mocks.loadAppState.mockResolvedValue(state)
    const router = createAgentProviderRouter({
      codex: createProvider(),
      pi: createProvider(),
    })

    await expect(
      router.getChatHistory({ projectPath: "/tmp", sessionId: session.id })
    ).rejects.toThrow(`Unknown project: missing-project (session: ${session.id})`)
  })

  it("fails fast when the canonical session is missing", async () => {
    mocks.loadAppState.mockResolvedValue(createDefaultOusiaAppState())
    const router = createAgentProviderRouter({
      codex: createProvider(),
      pi: createProvider(),
    })

    await expect(
      router.getChatHistory({ projectPath: "/tmp", sessionId: "missing" })
    ).rejects.toThrow("Unknown session: missing")
  })

  it("validates branch target session against the same canonical project", async () => {
    const state = createDefaultOusiaAppState()
    state.settings = { ...state.settings, defaultWorkDir: "/trusted/default" }
    const source = withSession(state, { agentProvider: "codex" })
    state.sessions.push({
      ...source,
      id: "target-session",
      projectId: "other-project",
    })
    state.projects = [
      { id: "other-project", name: "Other", path: "/trusted/other" },
    ]
    mocks.loadAppState.mockResolvedValue(state)
    const codex = createProvider()
    const router = createAgentProviderRouter({ codex, pi: createProvider() })

    await expect(
      router.branchChat({
        projectPath: "/trusted/default",
        sessionId: source.id,
        messageId: "message",
        targetSessionId: "target-session",
      })
    ).rejects.toThrow("Project path mismatch for session: target-session")

    expect(codex.branchChat).not.toHaveBeenCalled()
  })

  it("exposes the same canonical resolver for non-router agent IPC", async () => {
    const state = createDefaultOusiaAppState()
    state.settings = { ...state.settings, defaultWorkDir: "/trusted/default" }
    const session = withSession(state, { agentProvider: "codex" })
    mocks.loadAppState.mockResolvedValue(state)

    await expect(
      resolveCanonicalAgentContext({
        projectPath: "/trusted/default",
        sessionId: session.id,
      })
    ).resolves.toEqual({
      agentProvider: "codex",
      context: {
        projectPath: "/trusted/default",
        sessionId: session.id,
      },
    })
  })
})

function providersFor(
  provider: "pi" | "codex",
  providers: { pi: AgentConversationProvider; codex: AgentConversationProvider }
) {
  return providers[provider]
}
