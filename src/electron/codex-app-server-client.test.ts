import { EventEmitter } from "node:events"
import { delimiter, join } from "node:path"
import { PassThrough } from "node:stream"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CodexAppServerProtocolError,
  createCodexAppServerClient,
  resolveCodexNativeBinary,
  type CodexAppServerClient,
  type CodexAppServerSpawner,
  type CodexInitializeResult,
  type CodexNativeBinaryResolution,
} from "./codex-app-server-client"

type JsonMessage = Record<string, unknown>

const INITIALIZE_RESULT: CodexInitializeResult = {
  codexHome: "/Users/test/.codex",
  platformFamily: "unix",
  platformOs: "macos",
  userAgent: "codex-cli/0.144.0",
}

class FakeCodexProcess extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly sent: JsonMessage[] = []
  readonly pid = 4321
  killed = false
  kill = vi.fn((signal?: NodeJS.Signals | number) => {
    void signal
    this.killed = true
    return true
  })

  private stdinBuffer = ""

  constructor() {
    super()
    this.stdin.setEncoding("utf8")
    this.stdin.on("data", (chunk: string) => {
      this.stdinBuffer += chunk
      const lines = this.stdinBuffer.split("\n")
      this.stdinBuffer = lines.pop() ?? ""
      for (const line of lines) {
        if (line) {
          this.sent.push(JSON.parse(line) as JsonMessage)
        }
      }
    })
  }

  send(message: JsonMessage) {
    this.stdout.write(`${JSON.stringify(message)}\n`)
  }

  sendInvalid(line: string) {
    this.stdout.write(`${line}\n`)
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.emit("exit", code, signal)
  }
}

const processByClient = new Map<CodexAppServerClient, FakeCodexProcess>()

function createHarness(options: { experimentalApi?: boolean } = {}) {
  const process = new FakeCodexProcess()
  const logger = vi.fn()
  const resolution: CodexNativeBinaryResolution = {
    binaryPath: "/vendor/aarch64-apple-darwin/bin/codex",
    packageName: "@openai/codex-darwin-arm64",
    pathDirs: ["/vendor/aarch64-apple-darwin/codex-path"],
    targetTriple: "aarch64-apple-darwin",
  }
  const spawnProcess = vi.fn(() => process) as unknown as CodexAppServerSpawner
  const client = createCodexAppServerClient({
    clientVersion: "1.2.3",
    dependencies: {
      logger,
      resolveNativeBinary: () => resolution,
      spawnProcess,
    },
    env: { PATH: "/usr/bin" },
    ...(options.experimentalApi === undefined
      ? {}
      : { experimentalApi: options.experimentalApi }),
  })
  processByClient.set(client, process)
  return { client, logger, process, resolution, spawnProcess }
}

async function initialize(
  client: CodexAppServerClient,
  process: FakeCodexProcess
) {
  const started = client.start()
  await vi.waitFor(() => expect(process.sent).toHaveLength(1))
  const initializeRequest = process.sent[0]
  process.send({ id: initializeRequest.id, result: INITIALIZE_RESULT })
  await expect(started).resolves.toEqual(INITIALIZE_RESULT)
  await vi.waitFor(() => expect(process.sent).toHaveLength(2))
  return initializeRequest
}

const clients: CodexAppServerClient[] = []

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.dispose()
    processByClient.get(client)?.exit(null, "SIGTERM")
    processByClient.delete(client)
  }
  vi.useRealTimers()
})

describe("resolveCodexNativeBinary", () => {
  it("resolves the platform package binary and bundled PATH directories", () => {
    const packageJsonPath = join(
      "/packages",
      "@openai",
      "codex-darwin-arm64",
      "package.json"
    )
    const targetRoot = join(
      "/packages",
      "@openai",
      "codex-darwin-arm64",
      "vendor",
      "aarch64-apple-darwin"
    )
    const binaryPath = join(targetRoot, "bin", "codex")
    const codexPath = join(targetRoot, "codex-path")
    const zshPath = join(targetRoot, "codex-resources", "zsh", "bin")
    const existing = new Set([binaryPath, codexPath, zshPath])
    const packageJsonPathResolver = vi.fn(() => packageJsonPath)

    const result = resolveCodexNativeBinary({
      arch: "arm64",
      fileExists: (path) => existing.has(path),
      packageJsonPathResolver,
      platform: "darwin",
    })

    expect(packageJsonPathResolver).toHaveBeenCalledWith(
      "@openai/codex-darwin-arm64/package.json"
    )
    expect(result).toEqual({
      binaryPath,
      packageName: "@openai/codex-darwin-arm64",
      pathDirs: [codexPath, zshPath],
      targetTriple: "aarch64-apple-darwin",
    })
  })
})

describe("CodexAppServerClient", () => {
  it("coalesces concurrent starts and performs the required handshake", async () => {
    const harness = createHarness()
    clients.push(harness.client)

    const first = harness.client.start()
    const second = harness.client.start()

    expect(first).toBe(second)
    await vi.waitFor(() => expect(harness.process.sent).toHaveLength(1))
    expect(harness.spawnProcess).toHaveBeenCalledTimes(1)
    expect(harness.spawnProcess).toHaveBeenCalledWith(
      harness.resolution.binaryPath,
      ["app-server", "--stdio"],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: `${harness.resolution.pathDirs[0]}${delimiter}/usr/bin`,
        }),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      })
    )
    expect(harness.process.sent[0]).toEqual({
      id: 1,
      method: "initialize",
      params: {
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
        clientInfo: {
          name: "ousia_desktop",
          title: "Ousia Desktop",
          version: "1.2.3",
        },
      },
    })

    harness.process.send({ id: 1, result: INITIALIZE_RESULT })
    await expect(first).resolves.toEqual(INITIALIZE_RESULT)
    await expect(second).resolves.toEqual(INITIALIZE_RESULT)
    await vi.waitFor(() => expect(harness.process.sent).toHaveLength(2))
    expect(harness.process.sent[1]).toEqual({ method: "initialized" })
    expect(harness.client.initializeResult).toEqual(INITIALIZE_RESULT)
  })

  it("enables the experimental API only when explicitly configured", async () => {
    const harness = createHarness({ experimentalApi: true })
    clients.push(harness.client)

    const initializeRequest = await initialize(
      harness.client,
      harness.process
    )

    expect(initializeRequest).toMatchObject({
      method: "initialize",
      params: {
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      },
    })
  })

  it("rejects an invalid experimental API capability instead of defaulting it", () => {
    expect(() =>
      createHarness({ experimentalApi: "true" as never })
    ).toThrow("Codex experimentalApi option must be a boolean")
  })

  it("correlates JSONL request responses by id", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)

    const response = harness.client.request<{ models: string[] }>(
      "model/list",
      { limit: 2 }
    )
    await vi.waitFor(() => expect(harness.process.sent).toHaveLength(3))
    const request = harness.process.sent[2]
    expect(request).toMatchObject({
      method: "model/list",
      params: { limit: 2 },
    })

    harness.process.send({
      id: request.id,
      result: { models: ["gpt-5.4", "gpt-5.3-codex"] },
    })

    await expect(response).resolves.toEqual({
      models: ["gpt-5.4", "gpt-5.3-codex"],
    })

    await harness.client.notify("thread/unsubscribe", { threadId: "thread-1" })
    expect(harness.process.sent[3]).toEqual({
      method: "thread/unsubscribe",
      params: { threadId: "thread-1" },
    })
  })

  it("delivers notifications to listeners and waiters", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    const listener = vi.fn()
    const unsubscribe = harness.client.onNotification(
      "turn/completed",
      listener
    )
    const waited = harness.client.waitForNotification<{ turnId: string }>(
      "turn/completed",
      {
        predicate: (notification) => notification.params?.turnId === "turn-2",
      }
    )

    harness.process.send({
      method: "turn/completed",
      params: { turnId: "turn-1" },
    })
    harness.process.send({
      method: "turn/completed",
      params: { turnId: "turn-2" },
    })

    await expect(waited).resolves.toEqual({
      method: "turn/completed",
      params: { turnId: "turn-2" },
    })
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    harness.process.send({
      method: "turn/completed",
      params: { turnId: "turn-3" },
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("delivers server requests and writes client responses", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    const received = vi.fn()
    harness.client.onServerRequest<{ command: string }>(
      "item/commandExecution/requestApproval",
      (request) => {
        received(request)
        return { result: { decision: "accept" } }
      }
    )

    harness.process.send({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { command: "npm test" },
    })

    await vi.waitFor(() => expect(harness.process.sent).toHaveLength(3))
    expect(received).toHaveBeenCalledWith({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { command: "npm test" },
    })
    expect(harness.process.sent[2]).toEqual({
      id: "approval-1",
      result: { decision: "accept" },
    })
  })

  it("gives a method-specific server request listener priority over the wildcard", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    const wildcardListener = vi.fn(() => ({
      result: { owner: "wildcard" },
    }))
    const specificListener = vi.fn(() => ({
      result: { owner: "specific" },
    }))
    harness.client.onServerRequest(wildcardListener)
    const unsubscribeSpecific = harness.client.onServerRequest(
      "item/tool/call",
      specificListener
    )

    harness.process.send({
      id: "tool-1",
      method: "item/tool/call",
      params: { tool: "create-image" },
    })

    await vi.waitFor(() => expect(harness.process.sent).toHaveLength(3))
    expect(specificListener).toHaveBeenCalledTimes(1)
    expect(wildcardListener).not.toHaveBeenCalled()
    expect(harness.process.sent[2]).toEqual({
      id: "tool-1",
      result: { owner: "specific" },
    })

    unsubscribeSpecific()
    harness.process.send({
      id: "tool-2",
      method: "item/tool/call",
      params: { tool: "create-image" },
    })

    await vi.waitFor(() => expect(harness.process.sent).toHaveLength(4))
    expect(specificListener).toHaveBeenCalledTimes(1)
    expect(wildcardListener).toHaveBeenCalledTimes(1)
    expect(harness.process.sent[3]).toEqual({
      id: "tool-2",
      result: { owner: "wildcard" },
    })
  })

  it("rejects duplicate and invalid server request listener registrations", () => {
    const harness = createHarness()
    clients.push(harness.client)
    const methodListener = vi.fn(() => ({ result: null }))
    const wildcardListener = vi.fn(() => ({ result: null }))

    const unsubscribeMethod = harness.client.onServerRequest(
      "item/tool/call",
      methodListener
    )
    expect(() =>
      harness.client.onServerRequest("item/tool/call", () => ({ result: null }))
    ).toThrow(
      "Codex server request listener is already registered for item/tool/call"
    )

    const unsubscribeWildcard = harness.client.onServerRequest(wildcardListener)
    expect(() =>
      harness.client.onServerRequest(() => ({ result: null }))
    ).toThrow(
      "Codex wildcard server request listener is already registered"
    )
    expect(() =>
      harness.client.onServerRequest("", () => ({ result: null }))
    ).toThrow("must be a non-empty, trimmed string")
    expect(() =>
      harness.client.onServerRequest(" item/tool/call ", () => ({
        result: null,
      }))
    ).toThrow("must be a non-empty, trimmed string")
    expect(() =>
      harness.client.onServerRequest("item/missing-listener", undefined as never)
    ).toThrow(
      "Codex server request listener for item/missing-listener must be a function"
    )
    expect(() =>
      harness.client.onServerRequest(undefined as never)
    ).toThrow("Codex server request listener must be a function")
    expect(() =>
      Reflect.apply(harness.client.onServerRequest, harness.client, [
        wildcardListener,
        () => ({ result: null }),
      ])
    ).toThrow(
      "Codex wildcard server request registration does not accept a second listener"
    )

    unsubscribeMethod()
    unsubscribeWildcard()
    expect(() =>
      harness.client.onServerRequest("item/tool/call", () => ({ result: null }))
    ).not.toThrow()
    expect(() =>
      harness.client.onServerRequest(() => ({ result: null }))
    ).not.toThrow()
  })

  it("answers server requests that have no owner with method-not-found", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)

    harness.process.send({
      id: "unowned-1",
      method: "item/unrecognized",
      params: { value: true },
    })

    await vi.waitFor(() =>
      expect(harness.logger).toHaveBeenCalledWith(
        "codex.app-server",
        "warn",
        "Codex app-server request has no listener",
        { idType: "string", method: "item/unrecognized" }
      )
    )
    expect(harness.process.sent[2]).toEqual({
      id: "unowned-1",
      error: {
        code: -32601,
        message: "Unsupported Codex server request item/unrecognized.",
      },
    })
  })

  it("contains notification and server-request listener failures", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    const healthyNotificationListener = vi.fn()

    harness.client.onNotification("warning", () => {
      throw new Error("api_key=notification-secret")
    })
    harness.client.onNotification("warning", async () => {
      throw new Error("access_token=async-secret")
    })
    harness.client.onNotification("warning", healthyNotificationListener)
    harness.client.onServerRequest("approval/request", () => {
      throw new Error("Bearer request-secret")
    })

    harness.process.send({ method: "warning", params: { message: "careful" } })
    harness.process.send({
      id: "approval-2",
      method: "approval/request",
      params: { command: "npm test" },
    })

    await vi.waitFor(() => {
      expect(healthyNotificationListener).toHaveBeenCalledTimes(1)
      expect(harness.logger).toHaveBeenCalledWith(
        "codex.app-server",
        "error",
        "Codex notification listener failed",
        expect.objectContaining({ method: "warning" })
      )
      expect(harness.logger).toHaveBeenCalledWith(
        "codex.app-server",
        "error",
        "Codex server request listener failed",
        expect.objectContaining({ method: "approval/request" })
      )
    })
    expect(harness.process.kill).not.toHaveBeenCalled()
    const logs = JSON.stringify(harness.logger.mock.calls)
    expect(logs).not.toContain("notification-secret")
    expect(logs).not.toContain("async-secret")
    expect(logs).not.toContain("request-secret")
    expect(harness.process.sent[2]).toEqual({
      id: "approval-2",
      error: {
        code: -32603,
        message: "Codex server request handler failed for approval/request.",
      },
    })
  })

  it("rejects duplicate in-flight inbound ids", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    let releaseHandler!: () => void
    const handlerResponse = new Promise<{ result: { accepted: boolean } }>(
      (resolve) => {
        releaseHandler = () => resolve({ result: { accepted: true } })
      }
    )
    const handler = vi.fn(() => handlerResponse)
    harness.client.onServerRequest("item/tool/call", handler)

    harness.process.send({
      id: "tool-in-flight",
      method: "item/tool/call",
      params: { tool: "first" },
    })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    expect(harness.process.sent).toHaveLength(2)

    harness.process.send({
      id: "tool-in-flight",
      method: "item/tool/call",
      params: { tool: "duplicate" },
    })
    await vi.waitFor(() =>
      expect(harness.process.kill).toHaveBeenCalledWith("SIGTERM")
    )
    expect(harness.logger).toHaveBeenCalledWith(
      "codex.app-server",
      "error",
      "Codex app-server duplicated an in-flight server request id",
      { idType: "string", method: "item/tool/call" }
    )
    expect(handler).toHaveBeenCalledTimes(1)
    releaseHandler()
  })

  it("allows a completed inbound id to be reused", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    const handler = vi.fn(() => ({ result: { accepted: true } }))
    harness.client.onServerRequest("item/tool/call", handler)

    harness.process.send({
      id: "tool-reused",
      method: "item/tool/call",
      params: { tool: "first" },
    })
    await vi.waitFor(() => expect(harness.process.sent).toHaveLength(3))
    harness.process.send({
      id: "tool-reused",
      method: "item/tool/call",
      params: { tool: "second" },
    })

    await vi.waitFor(() => expect(harness.process.sent).toHaveLength(4))
    expect(handler).toHaveBeenCalledTimes(2)
    expect(harness.process.sent.slice(2)).toEqual([
      { id: "tool-reused", result: { accepted: true } },
      { id: "tool-reused", result: { accepted: true } },
    ])
    expect(harness.process.kill).not.toHaveBeenCalled()
  })

  it("rejects non-JSON handler results instead of silently rewriting them", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    harness.client.onServerRequest("item/tool/call", () => ({
      result: { silentlyDropped: undefined },
    }))

    harness.process.send({
      id: "tool-non-json",
      method: "item/tool/call",
      params: { tool: "bad-result" },
    })

    await vi.waitFor(() => expect(harness.process.sent).toHaveLength(3))
    expect(harness.process.sent[2]).toEqual({
      id: "tool-non-json",
      error: {
        code: -32603,
        message:
          "Codex server request handler returned an invalid response for item/tool/call.",
      },
    })
    expect(JSON.stringify(harness.process.sent)).not.toContain(
      "silentlyDropped"
    )
  })

  it("rejects only the waiter whose notification predicate throws", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    const rejectedWaiter = harness.client.waitForNotification("turn/completed", {
      predicate: () => {
        throw new Error("bad waiter predicate")
      },
    })
    const healthyWaiter = harness.client.waitForNotification<{
      turnId: string
    }>("turn/completed")

    harness.process.send({
      method: "turn/completed",
      params: { turnId: "turn-3" },
    })

    await expect(rejectedWaiter).rejects.toThrow("bad waiter predicate")
    await expect(healthyWaiter).resolves.toEqual({
      method: "turn/completed",
      params: { turnId: "turn-3" },
    })
    expect(harness.process.kill).not.toHaveBeenCalled()
  })

  it("fails fast on invalid JSON without logging the payload", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    const pending = harness.client.request("thread/list", {})
    await vi.waitFor(() => expect(harness.process.sent).toHaveLength(3))

    harness.process.sendInvalid("not-json sk-supersecretvalue")

    await expect(pending).rejects.toBeInstanceOf(CodexAppServerProtocolError)
    expect(harness.process.kill).toHaveBeenCalledWith("SIGTERM")
    expect(JSON.stringify(harness.logger.mock.calls)).not.toContain(
      "sk-supersecretvalue"
    )
    expect(harness.logger).toHaveBeenCalledWith(
      "codex.app-server",
      "error",
      "Invalid JSON received from Codex app-server",
      expect.objectContaining({ lineByteLength: expect.any(Number) })
    )
  })

  it("logs stderr and rejects pending requests when the process exits", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    const pending = harness.client.request("thread/read", { threadId: "abc" })
    await vi.waitFor(() => expect(harness.process.sent).toHaveLength(3))

    harness.process.stderr.write("authorization=Bearer private-token\n")
    harness.process.exit(17)

    await expect(pending).rejects.toThrow(
      "Codex app-server exited with code 17"
    )
    await vi.waitFor(() =>
      expect(harness.logger).toHaveBeenCalledWith(
        "codex.app-server.stderr",
        "warn",
        expect.objectContaining({ message: expect.stringContaining("[REDACTED]") })
      )
    )
    expect(JSON.stringify(harness.logger.mock.calls)).not.toContain(
      "private-token"
    )
    expect(harness.logger).toHaveBeenCalledWith(
      "codex.app-server",
      "error",
      "Codex app-server exited",
      { code: 17, signal: null, wasReady: true }
    )
  })

  it("disposes the child process and rejects outstanding work", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    const pending = harness.client.request("thread/read", { threadId: "abc" })
    await vi.waitFor(() => expect(harness.process.sent).toHaveLength(3))

    harness.client.dispose()

    await expect(pending).rejects.toThrow(
      "Codex app-server client was disposed"
    )
    expect(harness.process.kill).toHaveBeenCalledWith("SIGTERM")
    await expect(harness.client.request("thread/list", {})).rejects.toThrow(
      "Codex app-server client is disposed"
    )
  })

  it("force-kills the child when SIGTERM does not produce an exit", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    vi.useFakeTimers()

    harness.client.dispose()

    expect(harness.process.kill).toHaveBeenCalledTimes(1)
    expect(harness.process.kill).toHaveBeenNthCalledWith(1, "SIGTERM")
    await vi.advanceTimersByTimeAsync(1_999)
    expect(harness.process.kill).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.process.kill).toHaveBeenNthCalledWith(2, "SIGKILL")
    expect(harness.logger).toHaveBeenCalledWith(
      "codex.app-server",
      "warn",
      "Codex app-server did not exit after SIGTERM; forcing termination",
      { delayMs: 2_000 }
    )
    harness.process.exit(null, "SIGKILL")
  })

  it("cancels the force-kill timer when the child exits", async () => {
    const harness = createHarness()
    clients.push(harness.client)
    await initialize(harness.client, harness.process)
    vi.useFakeTimers()

    harness.client.dispose()
    harness.process.exit(null, "SIGTERM")
    await vi.advanceTimersByTimeAsync(2_000)

    expect(harness.process.kill).toHaveBeenCalledTimes(1)
    expect(harness.process.kill).toHaveBeenCalledWith("SIGTERM")
  })
})
