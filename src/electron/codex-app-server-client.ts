import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { delimiter, dirname, join } from "node:path"
import { createInterface, type Interface as ReadlineInterface } from "node:readline"

import { writeRuntimeLog } from "./runtime-logger.js"

const requireFromHere = createRequire(__filename)
const FORCE_KILL_DELAY_MS = 2_000

const TARGET_BY_PLATFORM = {
  "darwin:arm64": {
    packageName: "@openai/codex-darwin-arm64",
    triple: "aarch64-apple-darwin",
  },
  "darwin:x64": {
    packageName: "@openai/codex-darwin-x64",
    triple: "x86_64-apple-darwin",
  },
  "linux:arm64": {
    packageName: "@openai/codex-linux-arm64",
    triple: "aarch64-unknown-linux-musl",
  },
  "linux:x64": {
    packageName: "@openai/codex-linux-x64",
    triple: "x86_64-unknown-linux-musl",
  },
  "win32:arm64": {
    packageName: "@openai/codex-win32-arm64",
    triple: "aarch64-pc-windows-msvc",
  },
  "win32:x64": {
    packageName: "@openai/codex-win32-x64",
    triple: "x86_64-pc-windows-msvc",
  },
} as const

type RuntimeLogLevel = "debug" | "info" | "warn" | "error"

export type CodexAppServerRequestId = number | string

export interface CodexNativeBinaryResolution {
  binaryPath: string
  packageName: string
  pathDirs: string[]
  targetTriple: string
}

export interface CodexNativeBinaryResolverOptions {
  arch?: string
  fileExists?: (path: string) => boolean
  packageJsonPathResolver?: (specifier: string) => string
  platform?: NodeJS.Platform
}

export interface CodexInitializeResult {
  codexHome: string
  platformFamily: string
  platformOs: string
  userAgent: string
}

export interface CodexAppServerNotification<TParams = unknown> {
  method: string
  params?: TParams
}

export interface CodexAppServerRequest<TParams = unknown> {
  id: CodexAppServerRequestId
  method: string
  params?: TParams
}

export interface CodexAppServerRpcErrorShape {
  code: number
  data?: unknown
  message: string
}

export class CodexAppServerRpcError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(error: CodexAppServerRpcErrorShape) {
    super(error.message)
    this.name = "CodexAppServerRpcError"
    this.code = error.code
    this.data = error.data
  }
}

export class CodexAppServerProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CodexAppServerProtocolError"
  }
}

export interface CodexAppServerSpawnOptions {
  cwd?: string
  env: NodeJS.ProcessEnv
  shell: false
  stdio: ["pipe", "pipe", "pipe"]
  windowsHide: true
}

export type CodexAppServerSpawner = (
  command: string,
  args: string[],
  options: CodexAppServerSpawnOptions
) => ChildProcessWithoutNullStreams

export type CodexRuntimeLogger = (
  source: string,
  level: RuntimeLogLevel,
  ...values: unknown[]
) => void

export interface CodexAppServerClientDependencies {
  logger?: CodexRuntimeLogger
  resolveNativeBinary?: () => CodexNativeBinaryResolution
  spawnProcess?: CodexAppServerSpawner
}

export interface CodexAppServerClientOptions {
  clientVersion?: string
  cwd?: string
  dependencies?: CodexAppServerClientDependencies
  env?: NodeJS.ProcessEnv
}

export interface WaitForCodexNotificationOptions<TParams = unknown> {
  predicate?: (notification: CodexAppServerNotification<TParams>) => boolean
  signal?: AbortSignal
  timeoutMs?: number
}

type PendingRequest = {
  reject: (error: Error) => void
  resolve: (result: unknown) => void
}

type NotificationListener = {
  listener: (
    notification: CodexAppServerNotification
  ) => Promise<void> | void
  method?: string
}

type ServerRequestListener = {
  listener: (request: CodexAppServerRequest) => Promise<void> | void
  method?: string
}

type NotificationWaiter = {
  matches: (notification: CodexAppServerNotification) => boolean
  reject: (error: Error) => void
  resolve: (notification: CodexAppServerNotification) => void
}

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOwn(object: JsonObject, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function isRequestId(value: unknown): value is CodexAppServerRequestId {
  return typeof value === "number" || typeof value === "string"
}

function isRpcError(value: unknown): value is CodexAppServerRpcErrorShape {
  return (
    isJsonObject(value) &&
    typeof value.code === "number" &&
    typeof value.message === "string"
  )
}

function isInitializeResult(value: unknown): value is CodexInitializeResult {
  return (
    isJsonObject(value) &&
    typeof value.codexHome === "string" &&
    typeof value.platformFamily === "string" &&
    typeof value.platformOs === "string" &&
    typeof value.userAgent === "string"
  )
}

function normalizePlatform(platform: NodeJS.Platform) {
  return platform === "android" ? "linux" : platform
}

export function resolveCodexNativeBinary(
  options: CodexNativeBinaryResolverOptions = {}
): CodexNativeBinaryResolution {
  const platform = normalizePlatform(options.platform ?? process.platform)
  const arch = options.arch ?? process.arch
  const target =
    TARGET_BY_PLATFORM[
      `${platform}:${arch}` as keyof typeof TARGET_BY_PLATFORM
    ]

  if (!target) {
    throw new Error(`Unsupported Codex platform: ${platform} (${arch})`)
  }

  const resolvePackageJson =
    options.packageJsonPathResolver ??
    ((specifier: string) => requireFromHere.resolve(specifier))
  const fileExists = options.fileExists ?? existsSync

  let packageJsonPath: string
  try {
    packageJsonPath = resolvePackageJson(`${target.packageName}/package.json`)
  } catch (error) {
    throw new Error(
      `Missing Codex native package ${target.packageName}. Reinstall @openai/codex for this platform.`,
      { cause: error }
    )
  }

  const targetRoot = join(dirname(packageJsonPath), "vendor", target.triple)
  const binaryPath = join(
    targetRoot,
    "bin",
    platform === "win32" ? "codex.exe" : "codex"
  )
  if (!fileExists(binaryPath)) {
    throw new Error(
      `Codex native binary is missing from ${target.packageName}: ${binaryPath}`
    )
  }

  const pathDirs = [
    join(targetRoot, "codex-path"),
    join(targetRoot, "codex-resources", "zsh", "bin"),
  ].filter(fileExists)

  return {
    binaryPath,
    packageName: target.packageName,
    pathDirs,
    targetTriple: target.triple,
  }
}

function defaultSpawnProcess(
  command: string,
  args: string[],
  options: CodexAppServerSpawnOptions
) {
  return spawn(command, args, options)
}

function errorDetails(error: unknown) {
  const normalized = error instanceof Error ? error : new Error(String(error))
  return {
    message: redactSensitiveText(normalized.message),
    name: normalized.name,
  }
}

function redactSensitiveText(text: string) {
  const redacted = text
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[REDACTED]"
    )
  return redacted.length > 600 ? `${redacted.slice(0, 600)}…` : redacted
}

function summarizeStderrLine(line: string) {
  const byteLength = Buffer.byteLength(line)
  const trimmed = line.trim()

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!isJsonObject(parsed)) {
      return { byteLength, format: "json" }
    }

    if (
      typeof parsed.method === "string" &&
      (hasOwn(parsed, "params") || hasOwn(parsed, "result"))
    ) {
      return {
        byteLength,
        format: "rpc-like-json",
        method: parsed.method,
      }
    }

    const fields = isJsonObject(parsed.fields) ? parsed.fields : undefined
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof fields?.message === "string"
          ? fields.message
          : undefined

    return {
      byteLength,
      format: "json",
      ...(typeof parsed.level === "string" ? { level: parsed.level } : {}),
      ...(message ? { message: redactSensitiveText(message) } : {}),
      ...(typeof parsed.target === "string" ? { target: parsed.target } : {}),
    }
  } catch {
    return {
      byteLength,
      format: "text",
      message: redactSensitiveText(trimmed),
    }
  }
}

function buildSpawnEnvironment(
  environmentOverrides: NodeJS.ProcessEnv | undefined,
  pathDirs: string[]
) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...environmentOverrides,
  }
  const pathKey =
    Object.keys(environment).find((key) => key.toLowerCase() === "path") ??
    "PATH"
  const inheritedPath = environment[pathKey]
  environment[pathKey] = [...pathDirs, inheritedPath]
    .filter((entry): entry is string => Boolean(entry))
    .join(delimiter)
  return environment
}

function createAbortError(message: string) {
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

export class CodexAppServerClient {
  private readonly clientVersion: string
  private readonly cwd: string | undefined
  private readonly environmentOverrides: NodeJS.ProcessEnv | undefined
  private readonly logger: CodexRuntimeLogger
  private readonly notificationListeners = new Set<NotificationListener>()
  private readonly notificationWaiters = new Set<NotificationWaiter>()
  private readonly pendingRequests = new Map<
    CodexAppServerRequestId,
    PendingRequest
  >()
  private readonly resolveNativeBinary: () => CodexNativeBinaryResolution
  private readonly serverRequestListeners = new Set<ServerRequestListener>()
  private readonly spawnProcess: CodexAppServerSpawner

  private childProcess: ChildProcessWithoutNullStreams | undefined
  private disposed = false
  private forceKillTimer: NodeJS.Timeout | undefined
  private nextRequestId = 1
  private processExited = false
  private terminationRequested = false
  private ready = false
  private startPromise: Promise<CodexInitializeResult> | undefined
  private stderrReader: ReadlineInterface | undefined
  private stdoutReader: ReadlineInterface | undefined
  private terminalError: Error | undefined
  private _initializeResult: CodexInitializeResult | undefined

  constructor(options: CodexAppServerClientOptions = {}) {
    this.clientVersion = options.clientVersion ?? "0.0.0"
    this.cwd = options.cwd
    this.environmentOverrides = options.env
    this.logger = options.dependencies?.logger ?? writeRuntimeLog
    this.resolveNativeBinary =
      options.dependencies?.resolveNativeBinary ?? resolveCodexNativeBinary
    this.spawnProcess = options.dependencies?.spawnProcess ?? defaultSpawnProcess
  }

  get initializeResult() {
    return this._initializeResult
  }

  start(): Promise<CodexInitializeResult> {
    if (this.disposed) {
      return Promise.reject(new Error("Codex app-server client is disposed"))
    }
    if (this.terminalError) {
      return Promise.reject(this.terminalError)
    }
    if (this._initializeResult && this.ready) {
      return Promise.resolve(this._initializeResult)
    }

    this.startPromise ??= this.launchAndInitialize()
    return this.startPromise
  }

  async request<TResult = unknown>(
    method: string,
    params?: unknown
  ): Promise<TResult> {
    await this.start()
    return this.requestRaw<TResult>(method, params)
  }

  async notify(method: string, params?: unknown) {
    await this.start()
    this.writeMessage({ method, ...(params === undefined ? {} : { params }) })
  }

  async respond(id: CodexAppServerRequestId, result: unknown) {
    await this.start()
    this.writeMessage({ id, result })
  }

  async respondError(
    id: CodexAppServerRequestId,
    error: CodexAppServerRpcErrorShape
  ) {
    await this.start()
    this.writeMessage({ error, id })
  }

  onNotification(
    listener: (
      notification: CodexAppServerNotification
    ) => Promise<void> | void
  ): () => void
  onNotification<TParams = unknown>(
    method: string,
    listener: (
      notification: CodexAppServerNotification<TParams>
    ) => Promise<void> | void
  ): () => void
  onNotification<TParams = unknown>(
    methodOrListener:
      | string
      | ((
          notification: CodexAppServerNotification
        ) => Promise<void> | void),
    maybeListener?: (
      notification: CodexAppServerNotification<TParams>
    ) => Promise<void> | void
  ) {
    const registration: NotificationListener =
      typeof methodOrListener === "string"
        ? {
            listener: maybeListener as (
              notification: CodexAppServerNotification
            ) => Promise<void> | void,
            method: methodOrListener,
          }
        : { listener: methodOrListener }
    this.notificationListeners.add(registration)
    return () => this.notificationListeners.delete(registration)
  }

  onServerRequest(
    listener: (request: CodexAppServerRequest) => Promise<void> | void
  ): () => void
  onServerRequest<TParams = unknown>(
    method: string,
    listener: (
      request: CodexAppServerRequest<TParams>
    ) => Promise<void> | void
  ): () => void
  onServerRequest<TParams = unknown>(
    methodOrListener:
      | string
      | ((request: CodexAppServerRequest) => Promise<void> | void),
    maybeListener?: (
      request: CodexAppServerRequest<TParams>
    ) => Promise<void> | void
  ) {
    const registration: ServerRequestListener =
      typeof methodOrListener === "string"
        ? {
            listener: maybeListener as (
              request: CodexAppServerRequest
            ) => Promise<void> | void,
            method: methodOrListener,
          }
        : { listener: methodOrListener }
    this.serverRequestListeners.add(registration)
    return () => this.serverRequestListeners.delete(registration)
  }

  waitForNotification<TParams = unknown>(
    method: string,
    options: WaitForCodexNotificationOptions<TParams> = {}
  ): Promise<CodexAppServerNotification<TParams>> {
    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
    ) {
      return Promise.reject(
        new Error("waitForNotification timeoutMs must be a non-negative number")
      )
    }
    if (options.signal?.aborted) {
      return Promise.reject(
        createAbortError(`Waiting for Codex notification ${method} was aborted`)
      )
    }

    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout | undefined
      const abort = () => {
        cleanup()
        reject(
          createAbortError(`Waiting for Codex notification ${method} was aborted`)
        )
      }
      const waiter: NotificationWaiter = {
        matches: (notification) => {
          if (notification.method !== method) {
            return false
          }
          return options.predicate
            ? options.predicate(
                notification as CodexAppServerNotification<TParams>
              )
            : true
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
        resolve: (notification) => {
          cleanup()
          resolve(notification as CodexAppServerNotification<TParams>)
        },
      }
      const cleanup = () => {
        this.notificationWaiters.delete(waiter)
        if (timeout) {
          clearTimeout(timeout)
        }
        options.signal?.removeEventListener("abort", abort)
      }

      this.notificationWaiters.add(waiter)
      options.signal?.addEventListener("abort", abort, { once: true })
      if (options.timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          cleanup()
          reject(
            new Error(
              `Timed out waiting for Codex notification ${method} after ${options.timeoutMs}ms`
            )
          )
        }, options.timeoutMs)
      }

      void this.start().catch((error: unknown) => {
        waiter.reject(
          error instanceof Error ? error : new Error(String(error))
        )
      })
    })
  }

  dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    const error = new Error("Codex app-server client was disposed")
    this.fail(error)
    this.stdoutReader?.close()
    this.stderrReader?.close()
    this.terminateChildProcess()
  }

  private async launchAndInitialize(): Promise<CodexInitializeResult> {
    try {
      const resolution = this.resolveNativeBinary()
      const environment = buildSpawnEnvironment(
        this.environmentOverrides,
        resolution.pathDirs
      )
      const childProcess = this.spawnProcess(
        resolution.binaryPath,
        ["app-server", "--stdio"],
        {
          ...(this.cwd ? { cwd: this.cwd } : {}),
          env: environment,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        }
      )
      this.childProcess = childProcess
      this.attachProcessListeners(childProcess)

      this.logger("codex.app-server", "info", "Codex app-server started", {
        binaryPath: resolution.binaryPath,
        pid: childProcess.pid,
        targetTriple: resolution.targetTriple,
      })

      const initializeResult = await this.requestRaw<unknown>("initialize", {
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
        clientInfo: {
          name: "ousia_desktop",
          title: "Ousia Desktop",
          version: this.clientVersion,
        },
      })
      if (!isInitializeResult(initializeResult)) {
        throw this.protocolFailure("Invalid initialize response from Codex")
      }

      this.writeMessage({ method: "initialized" })
      this._initializeResult = Object.freeze({ ...initializeResult })
      this.ready = true
      return this._initializeResult
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error))
      this.fail(normalized)
      this.logger(
        "codex.app-server",
        "error",
        "Failed to initialize Codex app-server",
        errorDetails(normalized)
      )
      this.terminateChildProcess()
      throw normalized
    }
  }

  private attachProcessListeners(
    childProcess: ChildProcessWithoutNullStreams
  ) {
    this.stdoutReader = createInterface({
      crlfDelay: Infinity,
      input: childProcess.stdout,
    })
    this.stdoutReader.on("line", (line) => this.handleStdoutLine(line))

    this.stderrReader = createInterface({
      crlfDelay: Infinity,
      input: childProcess.stderr,
    })
    this.stderrReader.on("line", (line) => {
      if (line.trim()) {
        this.logger(
          "codex.app-server.stderr",
          "warn",
          summarizeStderrLine(line)
        )
      }
    })

    childProcess.once("error", (error) => {
      this.logger(
        "codex.app-server",
        "error",
        "Codex app-server process error",
        errorDetails(error)
      )
      this.fail(error)
      this.terminateChildProcess()
    })
    childProcess.once("exit", (code, signal) => {
      this.processExited = true
      this.clearForceKillTimer()
      this.logger(
        "codex.app-server",
        this.disposed || code === 0 ? "info" : "error",
        "Codex app-server exited",
        { code, signal, wasReady: this.ready }
      )
      this.fail(
        new Error(
          `Codex app-server exited${
            signal ? ` from signal ${signal}` : ` with code ${code ?? "unknown"}`
          }`
        )
      )
    })
  }

  private handleStdoutLine(line: string) {
    if (!line.trim()) {
      return
    }

    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      this.protocolFailure("Invalid JSON received from Codex app-server", {
        lineByteLength: Buffer.byteLength(line),
      })
      return
    }

    if (!isJsonObject(message)) {
      this.protocolFailure("Codex app-server emitted a non-object message")
      return
    }

    if (typeof message.method === "string") {
      if (hasOwn(message, "id")) {
        if (!isRequestId(message.id)) {
          this.protocolFailure("Codex app-server request has an invalid id")
          return
        }
        this.dispatchServerRequest({
          id: message.id,
          method: message.method,
          ...(hasOwn(message, "params") ? { params: message.params } : {}),
        })
      } else {
        this.dispatchNotification({
          method: message.method,
          ...(hasOwn(message, "params") ? { params: message.params } : {}),
        })
      }
      return
    }

    if (!hasOwn(message, "id") || !isRequestId(message.id)) {
      this.protocolFailure("Codex app-server emitted an unrecognized message")
      return
    }

    const pending = this.pendingRequests.get(message.id)
    if (!pending) {
      this.logger(
        "codex.app-server",
        "warn",
        "Codex app-server responded with an unknown request id",
        { idType: typeof message.id }
      )
      return
    }
    this.pendingRequests.delete(message.id)

    if (hasOwn(message, "error")) {
      if (!isRpcError(message.error)) {
        const error = this.protocolFailure(
          "Codex app-server returned an invalid RPC error"
        )
        pending.reject(error)
        return
      }
      pending.reject(new CodexAppServerRpcError(message.error))
      return
    }
    if (!hasOwn(message, "result")) {
      const error = this.protocolFailure(
        "Codex app-server response has neither result nor error"
      )
      pending.reject(error)
      return
    }
    pending.resolve(message.result)
  }

  private dispatchNotification(notification: CodexAppServerNotification) {
    for (const registration of this.notificationListeners) {
      if (!registration.method || registration.method === notification.method) {
        this.invokeListener(
          "notification",
          notification.method,
          registration.listener,
          notification
        )
      }
    }

    for (const waiter of [...this.notificationWaiters]) {
      try {
        if (waiter.matches(notification)) {
          waiter.resolve(notification)
        }
      } catch (error) {
        waiter.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  private dispatchServerRequest(request: CodexAppServerRequest) {
    let handled = false
    for (const registration of this.serverRequestListeners) {
      if (!registration.method || registration.method === request.method) {
        handled = true
        this.invokeListener(
          "server request",
          request.method,
          registration.listener,
          request
        )
      }
    }
    if (!handled) {
      this.logger(
        "codex.app-server",
        "warn",
        "Codex app-server request has no listener",
        { idType: typeof request.id, method: request.method }
      )
    }
  }

  private requestRaw<TResult>(method: string, params?: unknown) {
    const id = this.nextRequestId++
    return new Promise<TResult>((resolve, reject) => {
      this.pendingRequests.set(id, {
        reject,
        resolve: (result) => resolve(result as TResult),
      })
      try {
        this.writeMessage({
          id,
          method,
          ...(params === undefined ? {} : { params }),
        })
      } catch (error) {
        this.pendingRequests.delete(id)
        reject(error)
      }
    })
  }

  private writeMessage(message: JsonObject) {
    if (this.terminalError) {
      throw this.terminalError
    }
    if (!this.childProcess) {
      throw new Error("Codex app-server process has not started")
    }

    const serialized = `${JSON.stringify(message)}\n`
    try {
      this.childProcess.stdin.write(serialized, (error) => {
        if (error) {
          this.logger(
            "codex.app-server",
            "error",
            "Failed to write to Codex app-server",
            errorDetails(error)
          )
          this.fail(error)
          this.terminateChildProcess()
        }
      })
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error))
      this.fail(normalized)
      this.terminateChildProcess()
      throw normalized
    }
  }

  private protocolFailure(message: string, details?: JsonObject) {
    const error = new CodexAppServerProtocolError(message)
    this.logger(
      "codex.app-server",
      "error",
      message,
      ...(details ? [details] : [])
    )
    this.fail(error)
    this.terminateChildProcess()
    return error
  }

  private terminateChildProcess() {
    if (!this.childProcess || this.processExited || this.terminationRequested) {
      return
    }
    this.terminationRequested = true
    try {
      this.childProcess.kill("SIGTERM")
    } catch (error) {
      this.logger(
        "codex.app-server",
        "error",
        "Failed to terminate Codex app-server",
        errorDetails(error)
      )
    }

    if (this.processExited) {
      return
    }
    this.forceKillTimer = setTimeout(() => {
      this.forceKillTimer = undefined
      if (!this.childProcess || this.processExited) {
        return
      }
      this.logger(
        "codex.app-server",
        "warn",
        "Codex app-server did not exit after SIGTERM; forcing termination",
        { delayMs: FORCE_KILL_DELAY_MS }
      )
      try {
        this.childProcess.kill("SIGKILL")
      } catch (error) {
        this.logger(
          "codex.app-server",
          "error",
          "Failed to force-terminate Codex app-server",
          errorDetails(error)
        )
      }
    }, FORCE_KILL_DELAY_MS)
    this.forceKillTimer.unref()
  }

  private clearForceKillTimer() {
    if (!this.forceKillTimer) {
      return
    }
    clearTimeout(this.forceKillTimer)
    this.forceKillTimer = undefined
  }

  private invokeListener<TValue>(
    kind: "notification" | "server request",
    method: string,
    listener: (value: TValue) => Promise<void> | void,
    value: TValue
  ) {
    try {
      const result = listener(value)
      if (result && typeof result.then === "function") {
        void Promise.resolve(result).catch((error: unknown) => {
          this.logListenerError(kind, method, error)
        })
      }
    } catch (error) {
      this.logListenerError(kind, method, error)
    }
  }

  private logListenerError(
    kind: "notification" | "server request",
    method: string,
    error: unknown
  ) {
    this.logger(
      "codex.app-server",
      "error",
      `Codex ${kind} listener failed`,
      { error: errorDetails(error), method }
    )
  }

  private fail(error: Error) {
    this.terminalError ??= error
    this.ready = false
    for (const pending of this.pendingRequests.values()) {
      pending.reject(this.terminalError)
    }
    this.pendingRequests.clear()
    for (const waiter of [...this.notificationWaiters]) {
      waiter.reject(this.terminalError)
    }
  }
}

export function createCodexAppServerClient(
  options: CodexAppServerClientOptions = {}
) {
  return new CodexAppServerClient(options)
}
