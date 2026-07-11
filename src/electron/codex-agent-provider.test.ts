import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  CodexAppServerClient,
  CodexAppServerNotification,
  CodexAppServerRequest,
  CodexInitializeResult,
  WaitForCodexNotificationOptions,
} from "./codex-app-server-client.js"
import type { OusiaAppState, OusiaChatEvent } from "./chat-types.js"

const mocks = vi.hoisted(() => ({
  bindThread: vi.fn(),
  loadAppState: vi.fn<() => Promise<OusiaAppState>>(),
  writeRuntimeLog: vi.fn(),
}))

vi.mock("./app-state-store.js", () => ({
  bindAppStateSessionAgentThread: mocks.bindThread,
  loadAppState: mocks.loadAppState,
}))

vi.mock("./runtime-logger.js", () => ({
  writeRuntimeLog: mocks.writeRuntimeLog,
}))

import {
  codexThreadToHistory,
  createCodexAgentProvider,
} from "./codex-agent-provider.js"
import { createDefaultOusiaAppState } from "./chat-types.js"

class FakeCodexClient {
  readonly notifications = new Set<
    (notification: CodexAppServerNotification) => void
  >()
  readonly requests: Array<{ method: string; params: unknown }> = []
  readonly responses: Array<{ id: number | string; result: unknown }> = []
  readonly serverRequests = new Set<(request: CodexAppServerRequest) => void>()
  disposed = false
  requestHandler: (method: string, params: unknown) => unknown = () => ({})

  start(): Promise<CodexInitializeResult> {
    return Promise.resolve({
      codexHome: "/tmp/codex-home",
      platformFamily: "unix",
      platformOs: "macos",
      userAgent: "Codex Desktop/0.144.0 test",
    })
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    this.requests.push({ method, params })
    return this.requestHandler(method, params) as T
  }

  onNotification(listener: (notification: CodexAppServerNotification) => void) {
    this.notifications.add(listener)
    return () => this.notifications.delete(listener)
  }

  onServerRequest(listener: (request: CodexAppServerRequest) => void) {
    this.serverRequests.add(listener)
    return () => this.serverRequests.delete(listener)
  }

  waitForNotification<TParams = unknown>(
    method: string,
    options: WaitForCodexNotificationOptions<TParams> = {}
  ): Promise<CodexAppServerNotification<TParams>> {
    return new Promise((resolve, reject) => {
      const listener = (notification: CodexAppServerNotification) => {
        if (notification.method !== method) {
          return
        }
        const typed = notification as CodexAppServerNotification<TParams>
        if (options.predicate && !options.predicate(typed)) {
          return
        }
        this.notifications.delete(listener)
        resolve(typed)
      }
      this.notifications.add(listener)
      options.signal?.addEventListener(
        "abort",
        () => {
          this.notifications.delete(listener)
          const error = new Error("aborted")
          error.name = "AbortError"
          reject(error)
        },
        { once: true }
      )
    })
  }

  respond(id: number | string, result: unknown) {
    this.responses.push({ id, result })
    return Promise.resolve()
  }

  respondError() {
    return Promise.resolve()
  }

  emit(method: string, params: unknown) {
    for (const listener of [...this.notifications]) {
      listener({ method, params })
    }
  }

  emitServerRequest(request: CodexAppServerRequest) {
    for (const listener of [...this.serverRequests]) {
      listener(request)
    }
  }

  dispose() {
    this.disposed = true
  }
}

function codexState() {
  const state = createDefaultOusiaAppState()
  state.sessions[0] = {
    ...state.sessions[0],
    agentProvider: "codex",
  }
  return state
}

function codexModelEntry(model: string, isDefault: boolean) {
  return {
    model,
    displayName: model,
    inputModalities: ["text"],
    isDefault,
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Fast" },
    ],
  }
}

describe("Codex agent provider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("maps persisted Codex turns into canonical Ousia history", () => {
    const history = codexThreadToHistory(
      {
        id: "thread-1",
        turns: [
          {
            id: "turn-1",
            status: "completed",
            startedAt: 1_700_000_000,
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [{ type: "text", text: "hello", text_elements: [] }],
              },
              { id: "agent-1", type: "agentMessage", text: "hi" },
              {
                id: "command-1",
                type: "commandExecution",
                command: "pwd",
                cwd: "/tmp",
                status: "completed",
                aggregatedOutput: "/tmp\n",
                exitCode: 0,
              },
              {
                id: "edit-1",
                type: "fileChange",
                status: "completed",
                changes: [
                  { path: "a.ts", kind: "update", diff: "@@ -1 +1 @@" },
                ],
              },
            ],
          },
        ],
      },
      true
    )

    expect(history.map((item) => item.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
    ])
    expect(history[2]).toMatchObject({
      name: "bash",
      output: "/tmp\n",
      status: "finished",
    })
    expect(history[3]).toMatchObject({
      filePreview: { kind: "patch", path: "a.ts" },
      name: "edit",
    })
  })

  it("keeps an in-progress command with no exit code running", () => {
    const history = codexThreadToHistory(
      {
        id: "thread-1",
        turns: [
          {
            id: "turn-1",
            status: "inProgress",
            items: [
              {
                id: "command-1",
                type: "commandExecution",
                command: "npm test",
                cwd: "/tmp/project",
                status: "inProgress",
                aggregatedOutput: "",
                exitCode: null,
              },
            ],
          },
        ],
      },
      true
    )

    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      name: "bash",
      role: "tool",
      status: "running",
    })
  })

  it("starts, binds, streams, and completes a Codex turn", async () => {
    const state = codexState()
    mocks.loadAppState.mockImplementation(async () => state)
    mocks.bindThread.mockImplementation(async ({ agentThreadId }) => {
      state.sessions[0] = { ...state.sessions[0], agentThreadId }
      return { ok: true, state, session: state.sessions[0] }
    })
    const client = new FakeCodexClient()
    client.requestHandler = (method) => {
      if (method === "model/list") {
        return {
          data: [
            {
              model: "gpt-test",
              displayName: "GPT Test",
              inputModalities: ["text"],
              isDefault: true,
              defaultReasoningEffort: "low",
              supportedReasoningEfforts: [
                { reasoningEffort: "low", description: "Fast" },
                { reasoningEffort: "ultra", description: "Delegates" },
              ],
            },
          ],
        }
      }
      if (method === "thread/start") {
        return { thread: { id: "thread-1", turns: [] } }
      }
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn-1",
            items: [],
            status: "inProgress",
          },
        }
      }
      return {}
    }
    const events: Array<{ event: OusiaChatEvent; sessionId?: string }> = []
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: (event, context) =>
        events.push({ event, sessionId: context?.sessionId }),
      nativeBinaryResolver: () => ({
        binaryPath: "/tmp/codex",
        packageName: "@openai/codex-test",
        pathDirs: [],
        targetTriple: "test",
      }),
    })

    const result = await provider.sendChatMessage({
      agentMode: "standard",
      messageId: "user-client-start",
      model: { provider: "openai", modelId: "gpt-test" },
      projectPath: "/tmp/project",
      prompt: "hello",
      sessionId: state.sessions[0].id,
      thinkingLevel: "ultra",
    })

    expect(result).toEqual({ ok: true })
    expect(mocks.bindThread).toHaveBeenCalledWith({
      agentThreadId: "thread-1",
      sessionId: state.sessions[0].id,
    })
    expect(client.requests).toContainEqual({
      method: "turn/start",
      params: expect.objectContaining({ effort: "ultra" }),
    })
    client.emit("item/started", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: { id: "agent-1", type: "agentMessage", text: "" },
    })
    client.emit("item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "agent-1",
      delta: "hi",
    })
    client.emit("item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: { id: "agent-1", type: "agentMessage", text: "hi" },
    })
    client.emit("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", items: [], status: "completed" },
    })

    expect(events.map(({ event }) => event.type)).toEqual(
      expect.arrayContaining([
        "assistant_text_start",
        "assistant_text_delta",
        "assistant_text_end",
        "run_status",
      ])
    )
    expect(events.filter(({ event }) => event.type === "user_message")).toEqual(
      []
    )
    expect(
      events.every((entry) => entry.sessionId === state.sessions[0].id)
    ).toBe(true)
    const eventCountBeforeRelease = events.length
    expect(provider.releaseChatSession).toBeTypeOf("function")
    await provider.releaseChatSession?.({
      projectPath: "/tmp/project",
      sessionId: state.sessions[0].id,
    })
    client.emit("item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "agent-1",
      delta: "ignored-after-release",
    })
    expect(events).toHaveLength(eventCountBeforeRelease)
    provider.dispose()
    expect(client.disposed).toBe(true)
  })

  it("keeps the active turn working when a steer request fails", async () => {
    const state = codexState()
    mocks.loadAppState.mockImplementation(async () => state)
    mocks.bindThread.mockImplementation(async ({ agentThreadId }) => {
      state.sessions[0] = { ...state.sessions[0], agentThreadId }
      return { ok: true, state, session: state.sessions[0] }
    })
    const client = new FakeCodexClient()
    client.requestHandler = (method) => {
      if (method === "model/list") {
        return {
          data: [
            {
              model: "gpt-test",
              displayName: "GPT Test",
              inputModalities: ["text"],
              isDefault: true,
              defaultReasoningEffort: "low",
              supportedReasoningEfforts: [
                { reasoningEffort: "low", description: "Fast" },
              ],
            },
          ],
        }
      }
      if (method === "thread/start") {
        return { thread: { id: "thread-1", turns: [] } }
      }
      if (method === "turn/start") {
        return {
          turn: { id: "turn-1", items: [], status: "inProgress" },
        }
      }
      if (method === "turn/steer") {
        throw new Error("Steer was rejected")
      }
      return {}
    }
    const events: OusiaChatEvent[] = []
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: (event) => events.push(event),
    })
    const commonPayload = {
      agentMode: "standard" as const,
      model: { provider: "openai", modelId: "gpt-test" },
      projectPath: "/tmp/project",
      sessionId: state.sessions[0].id,
      thinkingLevel: "low",
    }

    await expect(
      provider.sendChatMessage({
        ...commonPayload,
        messageId: "user-client-start",
        prompt: "start",
      })
    ).resolves.toEqual({ ok: true })
    const eventCountBeforeSteer = events.length

    await expect(
      provider.sendChatMessage({
        ...commonPayload,
        messageId: "user-client-steer",
        prompt: "steer",
        sendBehavior: "steer",
      })
    ).resolves.toMatchObject({ ok: false, error: "Steer was rejected" })

    const steerEvents = events.slice(eventCountBeforeSteer)
    expect(
      steerEvents.filter((event) => event.type === "user_message")
    ).toHaveLength(1)
    expect(steerEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          delivery: "failed",
          id: "user-client-steer",
          type: "user_message",
        }),
      ])
    )
    expect(steerEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "error" })])
    )
    expect(
      steerEvents.some(
        (event) => event.type === "run_status" && event.status === "error"
      )
    ).toBe(false)

    provider.dispose()
  })

  it("publishes an atomic failed user state when turn start is rejected", async () => {
    const state = codexState()
    mocks.loadAppState.mockImplementation(async () => state)
    mocks.bindThread.mockImplementation(async ({ agentThreadId }) => {
      state.sessions[0] = { ...state.sessions[0], agentThreadId }
      return { ok: true, state, session: state.sessions[0] }
    })
    const client = new FakeCodexClient()
    client.requestHandler = (method) => {
      if (method === "model/list") {
        return { data: [codexModelEntry("gpt-test", true)] }
      }
      if (method === "thread/start") {
        return { thread: { id: "thread-1", turns: [] } }
      }
      if (method === "turn/start") {
        throw new Error("Turn start was rejected")
      }
      return {}
    }
    const events: OusiaChatEvent[] = []
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: (event) => events.push(event),
    })

    await expect(
      provider.sendChatMessage({
        agentMode: "standard",
        messageId: "user-client-rejected-start",
        model: { provider: "openai", modelId: "gpt-test" },
        projectPath: "/tmp/project",
        prompt: "hello",
        sessionId: state.sessions[0].id,
        thinkingLevel: "low",
      })
    ).resolves.toMatchObject({
      error: "Turn start was rejected",
      ok: false,
    })

    expect(
      events.flatMap((event) =>
        event.type === "user_message"
          ? [{ delivery: event.delivery, id: event.id, text: event.text }]
          : []
      )
    ).toEqual([
      {
        delivery: "failed",
        id: "user-client-rejected-start",
        text: "hello",
      },
    ])

    provider.dispose()
  })

  it("rejects Pi-only custom permissions before starting a Codex thread", async () => {
    const state = codexState()
    mocks.loadAppState.mockResolvedValue(state)
    const client = new FakeCodexClient()
    const events: OusiaChatEvent[] = []
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: (event) => events.push(event),
      nativeBinaryResolver: () => ({
        binaryPath: "/tmp/codex",
        packageName: "test",
        pathDirs: [],
        targetTriple: "test",
      }),
    })

    const result = await provider.sendChatMessage({
      agentMode: "custom",
      messageId: "user-client-custom",
      model: { provider: "openai", modelId: "" },
      projectPath: "/tmp/project",
      prompt: "hello",
      sessionId: state.sessions[0].id,
      thinkingLevel: "medium",
    })

    expect(result).toMatchObject({ ok: false })
    expect(result.error).toContain("does not support")
    expect(client.requests).toEqual([])
    expect(events.some((event) => event.type === "error")).toBe(true)
  })

  it("rejects the Pi-only automatic retry setting at the Codex boundary", async () => {
    const state = codexState()
    mocks.loadAppState.mockResolvedValue(state)
    const client = new FakeCodexClient()
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: vi.fn(),
    })

    await expect(
      provider.sendChatMessage({
        agentMode: "standard",
        autoRetryOnFailure: true,
        messageId: "user-client-pi-retry",
        model: { provider: "openai", modelId: "gpt-test" },
        projectPath: "/tmp/project",
        prompt: "hello",
        sessionId: state.sessions[0].id,
        thinkingLevel: "medium",
      })
    ).resolves.toMatchObject({
      error: "Codex received Pi-only autoRetryOnFailure configuration.",
      ok: false,
    })
    expect(client.requests).toEqual([])
  })

  it("rejects a reasoning effort that the selected Codex model does not support", async () => {
    const state = codexState()
    mocks.loadAppState.mockResolvedValue(state)
    const client = new FakeCodexClient()
    client.requestHandler = (method) => {
      if (method === "model/list") {
        return {
          data: [
            {
              model: "gpt-test",
              displayName: "GPT Test",
              inputModalities: ["text"],
              isDefault: true,
              defaultReasoningEffort: "low",
              supportedReasoningEfforts: [
                { reasoningEffort: "low", description: "Fast" },
              ],
            },
          ],
        }
      }
      return {}
    }
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: vi.fn(),
    })

    await expect(
      provider.sendChatMessage({
        agentMode: "standard",
        messageId: "user-client-unsupported",
        model: { provider: "openai", modelId: "gpt-test" },
        projectPath: "/tmp/project",
        prompt: "hello",
        sessionId: state.sessions[0].id,
        thinkingLevel: "ultra",
      })
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("does not support reasoning effort ultra"),
    })
    expect(
      client.requests.some(({ method }) => method === "thread/start")
    ).toBe(false)
  })

  it("passes an arbitrary app-server-advertised reasoning effort unchanged", async () => {
    const state = codexState()
    mocks.loadAppState.mockResolvedValue(state)
    mocks.bindThread.mockResolvedValue({
      ok: true,
      state,
      session: state.sessions[0],
    })
    const client = new FakeCodexClient()
    client.requestHandler = (method) => {
      if (method === "model/list") {
        return {
          data: [
            {
              model: "gpt-future",
              displayName: "GPT Future",
              inputModalities: ["text"],
              isDefault: true,
              defaultReasoningEffort: "future-depth",
              supportedReasoningEfforts: [
                {
                  reasoningEffort: "future-depth",
                  description: "A future catalog value",
                },
              ],
            },
          ],
        }
      }
      if (method === "thread/start") {
        return { thread: { id: "thread-future", turns: [] } }
      }
      if (method === "turn/start") {
        return {
          turn: { id: "turn-future", items: [], status: "inProgress" },
        }
      }
      return {}
    }
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: vi.fn(),
    })

    await expect(
      provider.sendChatMessage({
        agentMode: "standard",
        messageId: "user-client-future",
        model: { provider: "openai", modelId: "gpt-future" },
        projectPath: "/tmp/project",
        prompt: "hello",
        sessionId: state.sessions[0].id,
        thinkingLevel: "future-depth",
      })
    ).resolves.toEqual({ ok: true })
    expect(client.requests).toContainEqual({
      method: "turn/start",
      params: expect.objectContaining({ effort: "future-depth" }),
    })
  })

  it("uses the selected model default effort for title generation", async () => {
    const client = new FakeCodexClient()
    client.requestHandler = (method) => {
      if (method === "model/list") {
        return {
          data: [
            {
              model: "gpt-no-reasoning",
              displayName: "GPT No Reasoning",
              inputModalities: ["text"],
              isDefault: true,
              defaultReasoningEffort: "off",
              supportedReasoningEfforts: [
                { reasoningEffort: "off", description: "No reasoning" },
              ],
            },
          ],
        }
      }
      if (method === "thread/start") {
        return { thread: { id: "thread-title", turns: [] } }
      }
      if (method === "turn/start") {
        queueMicrotask(() => {
          client.emit("item/completed", {
            threadId: "thread-title",
            item: {
              id: "title-item",
              type: "agentMessage",
              text: JSON.stringify({ title: "Dynamic title" }),
            },
          })
        })
        return { turn: { id: "turn-title", items: [], status: "inProgress" } }
      }
      return {}
    }
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: vi.fn(),
    })

    await expect(
      provider.generateTitle({
        agentProvider: "codex",
        language: "en",
        model: { provider: "openai", modelId: "gpt-no-reasoning" },
        projectPath: "/tmp/project",
        prompt: "Build the feature",
        sessionId: "session-title",
      })
    ).resolves.toEqual({ ok: true, title: "Dynamic title" })
    expect(client.requests).toContainEqual({
      method: "turn/start",
      params: expect.objectContaining({ effort: "off" }),
    })
  })

  it("forks through the selected turn without using deprecated rollback", async () => {
    const state = codexState()
    state.sessions[0] = {
      ...state.sessions[0],
      agentThreadId: "thread-source",
    }
    state.sessions.push({
      agentProvider: "codex",
      id: "session-target",
      time: "2026-07-10T00:00:00.000Z",
      title: "Fork",
    })
    mocks.loadAppState.mockResolvedValue(state)
    mocks.bindThread.mockResolvedValue({
      ok: true,
      session: state.sessions[1],
      state,
    })
    const client = new FakeCodexClient()
    client.requestHandler = (method) => {
      if (method === "thread/read") {
        return {
          thread: {
            id: "thread-source",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [{ id: "agent-1", type: "agentMessage", text: "first" }],
              },
              {
                id: "turn-2",
                status: "completed",
                items: [
                  { id: "agent-2", type: "agentMessage", text: "second" },
                ],
              },
            ],
          },
        }
      }
      if (method === "thread/fork") {
        return {
          thread: {
            id: "thread-fork",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [{ id: "agent-1", type: "agentMessage", text: "first" }],
              },
            ],
          },
        }
      }
      return {}
    }
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: vi.fn(),
    })

    await expect(
      provider.branchChat({
        messageId: "agent-1",
        projectPath: "/tmp/project",
        sessionId: state.sessions[0].id,
        targetSessionId: "session-target",
      })
    ).resolves.toMatchObject({ ok: true })
    expect(client.requests).toContainEqual({
      method: "thread/fork",
      params: expect.objectContaining({
        lastTurnId: "turn-1",
        threadId: "thread-source",
      }),
    })
    expect(
      client.requests.some(({ method }) => method === "thread/rollback")
    ).toBe(false)
    expect(mocks.bindThread).toHaveBeenCalledWith({
      agentThreadId: "thread-fork",
      sessionId: "session-target",
    })
  })

  it("declines current and legacy approval requests with protocol-valid decisions", async () => {
    const client = new FakeCodexClient()
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: vi.fn(),
    })

    client.emitServerRequest({
      id: 1,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1" },
    })
    client.emitServerRequest({
      id: 2,
      method: "execCommandApproval",
      params: { conversationId: "thread-1" },
    })
    await Promise.resolve()

    expect(client.responses).toEqual([
      { id: 1, result: { decision: "decline" } },
      { id: 2, result: { decision: "denied" } },
    ])
    provider.dispose()
  })

  it("maps account and model discovery without exposing credentials", async () => {
    const client = new FakeCodexClient()
    client.requestHandler = (method) => {
      if (method === "account/read") {
        return {
          account: {
            type: "chatgpt",
            email: "dev@example.com",
            planType: "pro",
          },
          requiresOpenaiAuth: true,
        }
      }
      if (method === "model/list") {
        return {
          data: [
            {
              id: "model-id",
              model: "gpt-test",
              displayName: "GPT Test",
              inputModalities: ["text", "image"],
              isDefault: true,
              defaultReasoningEffort: "low",
              supportedReasoningEfforts: [
                { reasoningEffort: "low", description: "Fast" },
                { reasoningEffort: "high", description: "Deep" },
                { reasoningEffort: "max", description: "Maximum" },
                { reasoningEffort: "ultra", description: "Delegates" },
                {
                  reasoningEffort: "future-depth",
                  description: "Future catalog value",
                },
              ],
            },
          ],
        }
      }
      return {}
    }
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: vi.fn(),
      nativeBinaryResolver: () => ({
        binaryPath: "/bundled/codex",
        packageName: "test",
        pathDirs: [],
        targetTriple: "test",
      }),
    })

    await expect(provider.checkEnvironment()).resolves.toMatchObject({
      account: { type: "chatgpt", email: "dev@example.com", planType: "pro" },
      available: true,
      binaryPath: "/bundled/codex",
      defaultModelId: "gpt-test",
      models: [
        {
          input: ["text", "image"],
          modelId: "gpt-test",
          thinkingLevels: ["low", "high", "max", "ultra", "future-depth"],
          defaultThinkingLevel: "low",
          thinkingLevelDescriptions: {
            high: "Deep",
            low: "Fast",
            max: "Maximum",
            ultra: "Delegates",
            "future-depth": "Future catalog value",
          },
        },
      ],
      version: "0.144.0",
    })
  })

  it("fails environment discovery when Codex model reasoning metadata is inconsistent", async () => {
    const client = new FakeCodexClient()
    client.requestHandler = (method) => {
      if (method === "account/read") {
        return { account: null, requiresOpenaiAuth: true }
      }
      if (method === "model/list") {
        return {
          data: [
            {
              model: "broken-model",
              displayName: "Broken",
              inputModalities: ["text"],
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [
                { reasoningEffort: "low", description: "Fast" },
              ],
            },
          ],
        }
      }
      return {}
    }
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: vi.fn(),
      nativeBinaryResolver: () => ({
        binaryPath: "/bundled/codex",
        packageName: "test",
        pathDirs: [],
        targetTriple: "test",
      }),
    })

    await expect(provider.checkEnvironment()).resolves.toMatchObject({
      available: false,
      error: expect.stringContaining("invalid default reasoning effort"),
    })
  })

  it.each([
    {
      name: "malformed row",
      data: [null],
      error: "malformed model entry",
    },
    {
      name: "duplicate model id",
      data: [
        codexModelEntry("duplicate", true),
        codexModelEntry("duplicate", false),
      ],
      error: "duplicate model id",
    },
    {
      name: "multiple defaults",
      data: [codexModelEntry("first", true), codexModelEntry("second", true)],
      error: "multiple default models",
    },
    {
      name: "missing default",
      data: [codexModelEntry("only", false)],
      error: "no default model",
    },
  ])("fails model discovery for $name", async ({ data, error }) => {
    const client = new FakeCodexClient()
    client.requestHandler = (method) => {
      if (method === "account/read") {
        return { account: null, requiresOpenaiAuth: true }
      }
      if (method === "model/list") {
        return { data }
      }
      return {}
    }
    const provider = createCodexAgentProvider({
      client: client as unknown as CodexAppServerClient,
      emitChatEvent: vi.fn(),
      nativeBinaryResolver: () => ({
        binaryPath: "/bundled/codex",
        packageName: "test",
        pathDirs: [],
        targetTriple: "test",
      }),
    })

    await expect(provider.checkEnvironment()).resolves.toMatchObject({
      available: false,
      error: expect.stringContaining(error),
    })
  })
})
