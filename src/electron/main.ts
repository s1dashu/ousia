import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session as electronSession,
  shell,
  type WebAuthnAccount,
} from "electron"
import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs"
import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { env, platform } from "node:process"
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"
import { transform } from "esbuild"
import * as pty from "node-pty"
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type SessionMessageEntry,
} from "@mariozechner/pi-coding-agent"
import type {
  OusiaChatContext,
  OusiaChatEvent,
  OusiaChatHistoryItem,
  OusiaChatHistoryResult,
  OusiaChatInterruptResult,
  OusiaChatSendPayload,
  OusiaChatSendResult,
  OusiaEditorFileEntry,
  OusiaEditorListFilesPayload,
  OusiaEditorListFilesResult,
  OusiaEditorReadFilePayload,
  OusiaEditorReadFileResult,
  OusiaEditorSaveFilePayload,
  OusiaEditorSaveFileResult,
  OusiaModelSettings,
  OusiaRuntimeWidget,
  OusiaRuntimeWidgetsChangedEvent,
  OusiaRuntimeWidgetError,
  OusiaRuntimeWidgetSlot,
  OusiaRuntimeWidgetsPayload,
  OusiaRuntimeWidgetsResult,
  OusiaTerminalCreatePayload,
  OusiaTerminalCreateResult,
  OusiaTerminalDisposePayload,
  OusiaTerminalOperationResult,
  OusiaTerminalResizePayload,
  OusiaTerminalWritePayload,
  OusiaThinkingLevel,
} from "./chat-types.js"

const enabledTools = ["read", "write", "edit", "bash", "grep", "find", "ls"]
const browserPartition = "persist:ousia-browser"
const editorIgnoredDirs = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  ".ousia",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
])
const editorFileExtensions = new Set([
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".svelte",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
])

type AgentSessionBundle = {
  authStorage: AuthStorage
  modelRegistry: ModelRegistry
  runtimeApiKeyProvider?: string
  session: AgentSession
}

let mainWindow: BrowserWindow | undefined
const sessionPromises = new Map<string, Promise<AgentSessionBundle>>()
const streamState = new Map<string, { textId: string; thinkingId: string }>()
const interruptGenerations = new Map<string, number>()
const terminalSessions = new Map<string, pty.IPty>()
let runtimeWidgetWatchers: FSWatcher[] = []
let runtimeWidgetWatchDirs: string[] = []
let runtimeWidgetWatchDebounce: ReturnType<typeof setTimeout> | undefined
let runtimeWidgetWatchGeneration = 0
const runtimeWidgetWatchDebounceMs = 1000

function now() {
  return new Date().toISOString()
}

function randomId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function emitChatEvent(event: OusiaChatEvent, context?: OusiaChatContext) {
  mainWindow?.webContents.send(
    "ousia:chat:event",
    context ? { ...event, context } : event
  )
}

function emitWindowFullscreenState() {
  mainWindow?.webContents.send("ousia:window:fullscreen", {
    isFullscreen: mainWindow.isFullScreen(),
  })
}

function stringifyUnknown(value: unknown) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === "string") {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function safePathSegment(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "default"
  )
}

function expandHomePath(path: string) {
  if (path === "~") {
    return homedir()
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2))
  }
  return path
}

function getRuntimeWidgetsDir() {
  return join(app.getPath("userData"), "widgets")
}

function getProjectRuntimeWidgetsDir(projectPath?: string) {
  return projectPath
    ? join(expandHomePath(projectPath), ".ousia", "widgets")
    : undefined
}

function isPathInside(parent: string, child: string) {
  const segment = relative(parent, child)
  return segment === "" || (!segment.startsWith("..") && !isAbsolute(segment))
}

function resolveEditorProjectPath(projectPath: string) {
  const projectRoot = resolve(expandHomePath(projectPath))
  if (!projectPath.trim() || !existsSync(projectRoot)) {
    throw new Error("Select a project before opening the editor.")
  }
  return projectRoot
}

function resolveEditorFilePath(projectPath: string, filePath: string) {
  const projectRoot = resolveEditorProjectPath(projectPath)
  const absoluteFilePath = resolve(projectRoot, filePath)
  if (!isPathInside(projectRoot, absoluteFilePath)) {
    throw new Error("Editor file path must stay inside the project.")
  }
  return { absoluteFilePath, projectRoot }
}

function shouldShowEditorFile(name: string) {
  if (name === "AGENTS.md" || name === "README" || name === "Dockerfile") {
    return true
  }
  return editorFileExtensions.has(extname(name).toLowerCase())
}

function isRuntimeWidgetSlot(value: unknown): value is OusiaRuntimeWidgetSlot {
  return value === "workspace.tab"
}

function sessionKey(context: OusiaChatContext) {
  return `${context.projectPath}::${context.sessionId}`
}

function getConversationDir(context: OusiaChatContext) {
  const cwd = expandHomePath(context.projectPath)
  return join(
    app.getPath("userData"),
    "sessions",
    safePathSegment(cwd),
    safePathSegment(context.sessionId)
  )
}

function normalizeModelSettings(model: OusiaModelSettings) {
  return {
    provider: model.provider.trim(),
    modelId: model.modelId.trim(),
    apiKey: model.apiKey?.trim(),
  }
}

function applyRuntimeApiKey(
  bundle: AgentSessionBundle,
  model: OusiaModelSettings
) {
  const nextProvider = model.apiKey ? model.provider : undefined
  if (
    bundle.runtimeApiKeyProvider &&
    bundle.runtimeApiKeyProvider !== nextProvider
  ) {
    bundle.authStorage.removeRuntimeApiKey(bundle.runtimeApiKeyProvider)
  }
  if (model.apiKey) {
    bundle.authStorage.setRuntimeApiKey(model.provider, model.apiKey)
  }
  bundle.runtimeApiKeyProvider = nextProvider
}

function findConfiguredModel(
  modelRegistry: ModelRegistry,
  model: OusiaModelSettings
) {
  const selected = modelRegistry.find(model.provider, model.modelId)
  if (!selected) {
    throw new Error(`Unknown model: ${model.provider}/${model.modelId}`)
  }
  return selected
}

async function configureSessionBundle(
  bundle: AgentSessionBundle,
  modelSettings: OusiaModelSettings,
  thinkingLevel: OusiaThinkingLevel
) {
  const model = normalizeModelSettings(modelSettings)
  if (!model.provider || !model.modelId) {
    throw new Error("Model provider and model ID are required.")
  }
  applyRuntimeApiKey(bundle, model)
  const selectedModel = findConfiguredModel(bundle.modelRegistry, model)
  if (
    bundle.session.model?.provider !== selectedModel.provider ||
    bundle.session.model?.id !== selectedModel.id
  ) {
    await bundle.session.setModel(selectedModel)
  }
  bundle.session.setThinkingLevel(thinkingLevel)
}

async function listEditorFiles(
  payload: OusiaEditorListFilesPayload
): Promise<OusiaEditorListFilesResult> {
  const projectRoot = resolveEditorProjectPath(payload.projectPath)
  const files: OusiaEditorFileEntry[] = []
  const maxFiles = 700

  async function walk(directory: string, depth: number) {
    if (files.length >= maxFiles) {
      return
    }

    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        return
      }

      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!editorIgnoredDirs.has(entry.name) && depth < 8) {
          await walk(absolutePath, depth + 1)
        }
        continue
      }

      if (!entry.isFile() || !shouldShowEditorFile(entry.name)) {
        continue
      }

      files.push({
        path: relative(projectRoot, absolutePath),
        name: entry.name,
        depth,
        extension: extname(entry.name).slice(1).toLowerCase(),
      })
    }
  }

  await walk(projectRoot, 0)
  return { files }
}

async function readEditorFile(
  payload: OusiaEditorReadFilePayload
): Promise<OusiaEditorReadFileResult> {
  const { absoluteFilePath, projectRoot } = resolveEditorFilePath(
    payload.projectPath,
    payload.path
  )
  const fileStat = await stat(absoluteFilePath)
  if (!fileStat.isFile()) {
    throw new Error("Editor can only open files.")
  }
  if (fileStat.size > 1024 * 1024) {
    throw new Error("Editor file is larger than 1 MB.")
  }
  const content = await readFile(absoluteFilePath, "utf8")
  return {
    content,
    path: relative(projectRoot, absoluteFilePath),
  }
}

async function saveEditorFile(
  payload: OusiaEditorSaveFilePayload
): Promise<OusiaEditorSaveFileResult> {
  const { absoluteFilePath } = resolveEditorFilePath(
    payload.projectPath,
    payload.path
  )
  const fileStat = await stat(absoluteFilePath)
  if (!fileStat.isFile()) {
    throw new Error("Editor can only save files.")
  }
  await writeFile(absoluteFilePath, payload.content, "utf8")
  return { ok: true }
}

function terminalKey(context: OusiaTerminalDisposePayload) {
  return `${context.projectPath}::${context.sessionId}::${context.terminalId}`
}

function emitTerminalEvent(
  event:
    | { type: "data"; terminalId: string; data: string }
    | {
        type: "exit"
        terminalId: string
        exitCode?: number
        signal?: number
      }
    | { type: "error"; terminalId: string; message: string }
) {
  mainWindow?.webContents.send("ousia:terminal:event", event)
}

function clampTerminalSize(value: number, fallback: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.min(Math.max(Math.floor(value), 2), max)
}

function defaultShell() {
  if (platform === "win32") {
    return process.env.COMSPEC || "powershell.exe"
  }
  return process.env.SHELL || "/bin/zsh"
}

function defaultShellArgs(shellPath: string) {
  if (platform === "win32") {
    return []
  }
  if (basename(shellPath) === "zsh") {
    return ["-l"]
  }
  if (basename(shellPath) === "bash") {
    return ["-l"]
  }
  return []
}

async function createTerminal(
  payload: OusiaTerminalCreatePayload
): Promise<OusiaTerminalCreateResult> {
  const cwd = resolveEditorProjectPath(payload.projectPath)
  const key = terminalKey(payload)
  const previousTerminal = terminalSessions.get(key)
  terminalSessions.delete(key)
  previousTerminal?.kill()

  const cols = clampTerminalSize(payload.cols, 80, 500)
  const rows = clampTerminalSize(payload.rows, 24, 200)
  const shellPath = defaultShell()
  const terminalProcess = pty.spawn(shellPath, defaultShellArgs(shellPath), {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      COLORTERM: "truecolor",
      TERM: "xterm-256color",
      TERM_PROGRAM: "Ousia",
    },
  })

  terminalSessions.set(key, terminalProcess)
  terminalProcess.onData((data) => {
    if (terminalSessions.get(key) !== terminalProcess) {
      return
    }
    emitTerminalEvent({
      type: "data",
      terminalId: payload.terminalId,
      data,
    })
  })
  terminalProcess.onExit(({ exitCode, signal }) => {
    if (terminalSessions.get(key) !== terminalProcess) {
      return
    }
    terminalSessions.delete(key)
    emitTerminalEvent({
      type: "exit",
      terminalId: payload.terminalId,
      exitCode,
      signal,
    })
  })

  return { terminalId: payload.terminalId }
}

async function writeTerminal(
  payload: OusiaTerminalWritePayload
): Promise<OusiaTerminalOperationResult> {
  terminalSessions.get(terminalKey(payload))?.write(payload.data)
  return { ok: true }
}

async function resizeTerminal(
  payload: OusiaTerminalResizePayload
): Promise<OusiaTerminalOperationResult> {
  const terminal = terminalSessions.get(terminalKey(payload))
  if (terminal) {
    terminal.resize(
      clampTerminalSize(payload.cols, terminal.cols, 500),
      clampTerminalSize(payload.rows, terminal.rows, 200)
    )
  }
  return { ok: true }
}

async function disposeTerminal(
  payload: OusiaTerminalDisposePayload
): Promise<OusiaTerminalOperationResult> {
  const key = terminalKey(payload)
  const terminal = terminalSessions.get(key)
  if (terminal) {
    terminalSessions.delete(key)
    terminal.kill()
  }
  return { ok: true }
}

async function getAgentSession(
  context: OusiaChatContext,
  model: OusiaModelSettings,
  thinkingLevel: OusiaThinkingLevel
) {
  const key = sessionKey(context)
  if (!sessionPromises.has(key)) {
    const promise = createSession(context, key, model, thinkingLevel).catch(
      (error) => {
        if (sessionPromises.get(key) === promise) {
          sessionPromises.delete(key)
        }
        throw error
      }
    )
    sessionPromises.set(key, promise)
  }
  return sessionPromises.get(key)!
}

async function createSession(
  context: OusiaChatContext,
  key: string,
  modelSettings: OusiaModelSettings,
  thinkingLevel: OusiaThinkingLevel
) {
  const cwd = expandHomePath(context.projectPath)
  const userData = app.getPath("userData")
  const agentDir = join(userData, "pi-agent")
  const conversationDir = getConversationDir(context)
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(conversationDir, { recursive: true })

  const authStorage = AuthStorage.create(join(agentDir, "auth.json"))
  const modelRegistry = ModelRegistry.create(
    authStorage,
    join(agentDir, "models.json")
  )
  const settingsManager = SettingsManager.create(cwd, agentDir)
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
  })
  await resourceLoader.reload()
  const model = normalizeModelSettings(modelSettings)
  if (model.apiKey) {
    authStorage.setRuntimeApiKey(model.provider, model.apiKey)
  }
  const selectedModel =
    model.provider && model.modelId
      ? findConfiguredModel(modelRegistry, model)
      : undefined

  const { session, modelFallbackMessage } = await createAgentSession({
    authStorage,
    cwd,
    agentDir,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.continueRecent(cwd, conversationDir),
    settingsManager,
    model: selectedModel,
    thinkingLevel,
    tools: enabledTools,
  })

  if (modelFallbackMessage) {
    emitChatEvent(
      {
        type: "run_status",
        status: "running",
        text: modelFallbackMessage,
        timestamp: now(),
      },
      context
    )
  }

  streamState.set(key, { textId: "", thinkingId: "" })
  session.subscribe((event) => translateAgentEvent(event, context, key))
  return {
    authStorage,
    modelRegistry,
    runtimeApiKeyProvider: model.apiKey ? model.provider : undefined,
    session,
  }
}

function translateAgentEvent(
  event: AgentSessionEvent,
  context: OusiaChatContext,
  key: string
) {
  const timestamp = now()
  const state = streamState.get(key) ?? { textId: "", thinkingId: "" }
  streamState.set(key, state)

  if (event.type === "agent_start") {
    emitChatEvent(
      { type: "run_status", status: "starting", timestamp },
      context
    )
    return
  }
  if (event.type === "turn_start") {
    emitChatEvent({ type: "run_status", status: "running", timestamp }, context)
    return
  }
  if (event.type === "agent_end") {
    emitChatEvent(
      { type: "run_status", status: "finished", timestamp },
      context
    )
    state.textId = ""
    state.thinkingId = ""
    return
  }
  if (event.type === "message_end") {
    const message = event.message as unknown as Record<string, unknown>
    if (message.role === "assistant" && message.stopReason === "error") {
      emitChatEvent(
        {
          type: "error",
          id: randomId("error"),
          text:
            typeof message.errorMessage === "string"
              ? message.errorMessage
              : "Agent response failed.",
          timestamp,
        },
        context
      )
    }
    return
  }
  if (event.type === "tool_execution_start") {
    const source = event as unknown as {
      toolCallId?: string
      toolName?: string
      args?: unknown
    }
    emitChatEvent(
      {
        type: "tool_start",
        id: source.toolCallId ?? randomId("tool"),
        name: source.toolName ?? "tool",
        args: source.args,
        timestamp,
      },
      context
    )
    return
  }
  if (event.type === "tool_execution_update") {
    const source = event as unknown as {
      toolCallId?: string
      partialResult?: unknown
    }
    emitChatEvent(
      {
        type: "tool_update",
        id: source.toolCallId ?? randomId("tool"),
        value: source.partialResult,
        timestamp,
      },
      context
    )
    return
  }
  if (event.type === "tool_execution_end") {
    const source = event as unknown as {
      toolCallId?: string
      toolName?: string
      result?: unknown
      isError?: boolean
    }
    emitChatEvent(
      {
        type: "tool_end",
        id: source.toolCallId ?? randomId("tool"),
        name: source.toolName,
        result: source.result,
        isError: source.isError,
        timestamp,
      },
      context
    )
    return
  }
  if (event.type !== "message_update") {
    return
  }

  const messageEvent = (
    event as unknown as {
      assistantMessageEvent?: {
        type?: string
        contentIndex?: number
        delta?: string
        content?: string
        error?: {
          errorMessage?: string
        }
      }
    }
  ).assistantMessageEvent

  if (!messageEvent) {
    return
  }

  if (messageEvent.type === "text_start") {
    state.textId = `text-${messageEvent.contentIndex ?? 0}-${Date.now()}`
    emitChatEvent(
      { type: "assistant_text_start", id: state.textId, timestamp },
      context
    )
    return
  }
  if (messageEvent.type === "text_delta") {
    state.textId ||= `text-${messageEvent.contentIndex ?? 0}-${Date.now()}`
    emitChatEvent(
      {
        type: "assistant_text_delta",
        id: state.textId,
        delta: messageEvent.delta ?? "",
        timestamp,
      },
      context
    )
    return
  }
  if (messageEvent.type === "text_end") {
    const id =
      state.textId || `text-${messageEvent.contentIndex ?? 0}-${Date.now()}`
    emitChatEvent(
      {
        type: "assistant_text_end",
        id,
        text: messageEvent.content,
        timestamp,
      },
      context
    )
    state.textId = ""
    return
  }
  if (messageEvent.type === "thinking_start") {
    state.thinkingId = `thinking-${messageEvent.contentIndex ?? 0}-${Date.now()}`
    emitChatEvent(
      { type: "thinking_start", id: state.thinkingId, timestamp },
      context
    )
    return
  }
  if (messageEvent.type === "thinking_delta") {
    state.thinkingId ||= `thinking-${messageEvent.contentIndex ?? 0}-${Date.now()}`
    emitChatEvent(
      {
        type: "thinking_delta",
        id: state.thinkingId,
        delta: messageEvent.delta ?? "",
        timestamp,
      },
      context
    )
    return
  }
  if (messageEvent.type === "thinking_end") {
    const id =
      state.thinkingId ||
      `thinking-${messageEvent.contentIndex ?? 0}-${Date.now()}`
    emitChatEvent(
      { type: "thinking_end", id, text: messageEvent.content, timestamp },
      context
    )
    state.thinkingId = ""
    return
  }
  if (messageEvent.type === "error") {
    emitChatEvent(
      {
        type: "error",
        id: randomId("error"),
        text: messageEvent.error?.errorMessage ?? "Agent response failed.",
        timestamp,
      },
      context
    )
  }
}

function textFromContent(content: unknown) {
  if (typeof content === "string") {
    return content
  }
  if (!Array.isArray(content)) {
    return ""
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return ""
      }
      const block = part as Record<string, unknown>
      if (block.type === "text") {
        return typeof block.text === "string" ? block.text : ""
      }
      if (block.type === "image") {
        return "[image]"
      }
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function messageEntryToHistoryItems(
  entry: SessionMessageEntry,
  items: OusiaChatHistoryItem[]
) {
  const message = entry.message as unknown as Record<string, unknown>
  const role = message.role
  if (role === "user") {
    items.push({
      id: entry.id,
      role: "user",
      text: textFromContent(message.content),
      status: "finished",
    })
    return
  }
  if (role === "assistant") {
    const content = Array.isArray(message.content) ? message.content : []
    content.forEach((part, index) => {
      if (!part || typeof part !== "object") {
        return
      }
      const block = part as Record<string, unknown>
      if (block.type === "thinking") {
        const text = typeof block.thinking === "string" ? block.thinking : ""
        if (text) {
          items.push({
            id: `${entry.id}-thinking-${index}`,
            role: "thinking",
            text,
            status: "finished",
          })
        }
      } else if (block.type === "text") {
        const text = typeof block.text === "string" ? block.text : ""
        if (text) {
          items.push({
            id: `${entry.id}-text-${index}`,
            role: "assistant",
            text,
            status: "finished",
          })
        }
      } else if (block.type === "toolCall") {
        items.push({
          id:
            typeof block.id === "string"
              ? block.id
              : `${entry.id}-tool-${index}`,
          role: "tool",
          name: typeof block.name === "string" ? block.name : "tool",
          text: stringifyUnknown(block.arguments) ?? "",
          status: "running",
        })
      }
    })
    return
  }
  if (role === "toolResult") {
    const toolCallId =
      typeof message.toolCallId === "string" ? message.toolCallId : entry.id
    const index = items.findIndex(
      (item) => item.role === "tool" && item.id === toolCallId
    )
    const item: OusiaChatHistoryItem = {
      id: toolCallId,
      role: "tool",
      name: typeof message.toolName === "string" ? message.toolName : "tool",
      text: textFromContent(message.content),
      status: message.isError ? "failed" : "finished",
    }
    if (index >= 0) {
      items[index] = item
    } else {
      items.push(item)
    }
    return
  }
  if (role === "bashExecution") {
    const command = typeof message.command === "string" ? message.command : ""
    const output = typeof message.output === "string" ? message.output : ""
    items.push({
      id: entry.id,
      role: "tool",
      name: "bash",
      text: [command ? `$ ${command}` : "", output].filter(Boolean).join("\n"),
      status: message.exitCode === 0 ? "finished" : "failed",
    })
    return
  }
  if (role === "custom" && message.display !== false) {
    const text = textFromContent(message.content)
    if (text) {
      items.push({
        id: entry.id,
        role: "system",
        text,
        status: "finished",
      })
    }
  }
}

async function findRecentPiSessionFile(cwd: string, conversationDir: string) {
  if (!existsSync(conversationDir)) {
    return undefined
  }
  const sessions = await SessionManager.list(cwd, conversationDir)
  return sessions.sort(
    (left, right) => right.modified.getTime() - left.modified.getTime()
  )[0]?.path
}

async function getChatHistory(
  context: OusiaChatContext
): Promise<OusiaChatHistoryResult> {
  const cwd = expandHomePath(context.projectPath)
  const conversationDir = getConversationDir(context)
  const sessionFile = await findRecentPiSessionFile(cwd, conversationDir)
  if (!sessionFile) {
    return { items: [] }
  }

  try {
    const sessionManager = SessionManager.open(
      sessionFile,
      conversationDir,
      cwd
    )
    const items: OusiaChatHistoryItem[] = []
    sessionManager.getBranch().forEach((entry) => {
      if (entry.type === "message") {
        messageEntryToHistoryItems(entry, items)
      }
    })
    return { items }
  } catch (error) {
    return {
      items: [
        {
          id: randomId("history-error"),
          role: "error",
          text:
            error instanceof Error
              ? `Failed to load session history: ${error.message}`
              : "Failed to load session history.",
        },
      ],
    }
  }
}

type RuntimeWidgetManifest = {
  id?: unknown
  title?: unknown
  slot?: unknown
  entry?: unknown
}

function normalizeRuntimeWidgetManifest(
  scope: string,
  dirname: string,
  manifest: RuntimeWidgetManifest
) {
  const id = typeof manifest.id === "string" ? manifest.id.trim() : dirname
  const title =
    typeof manifest.title === "string" && manifest.title.trim()
      ? manifest.title.trim()
      : id
  const slot = manifest.slot ?? "workspace.tab"
  const entry =
    typeof manifest.entry === "string" && manifest.entry.trim()
      ? manifest.entry.trim()
      : "Widget.tsx"

  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error(
      "Widget id must contain only letters, numbers, dots, underscores, and dashes."
    )
  }
  if (!isRuntimeWidgetSlot(slot)) {
    throw new Error("Only the workspace.tab runtime widget slot is supported.")
  }
  if (entry.includes("\0") || entry.startsWith("/")) {
    throw new Error("Widget entry must be a relative path.")
  }

  return { id: `runtime.${scope}.${id}`, title, slot, entry }
}

async function compileRuntimeWidget(sourcePath: string) {
  const loader = extname(sourcePath) === ".ts" ? "ts" : "tsx"
  const source = await readFile(sourcePath, "utf8")
  const result = await transform(source, {
    loader,
    format: "cjs",
    target: "es2022",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    sourcemap: "inline",
  })
  return result.code
}

async function loadRuntimeWidget(
  widgetsDir: string,
  scope: string,
  dirname: string
): Promise<
  | { widget: OusiaRuntimeWidget; error?: never }
  | { widget?: never; error: OusiaRuntimeWidgetError }
> {
  const widgetDir = resolve(widgetsDir, dirname)
  const manifestPath = join(widgetDir, "widget.json")
  try {
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as RuntimeWidgetManifest
    const normalized = normalizeRuntimeWidgetManifest(scope, dirname, manifest)
    const sourcePath = resolve(widgetDir, normalized.entry)
    if (!isPathInside(widgetDir, sourcePath)) {
      throw new Error("Widget entry must stay inside its widget directory.")
    }
    const code = await compileRuntimeWidget(sourcePath)
    return {
      widget: {
        id: normalized.id,
        title: normalized.title,
        slot: normalized.slot,
        sourcePath,
        code,
      },
    }
  } catch (error) {
    return {
      error: {
        id: `runtime.${scope}.${dirname}`,
        title: dirname,
        sourcePath: existsSync(manifestPath) ? manifestPath : undefined,
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

async function loadRuntimeWidgetRoot(widgetsDir: string, scope: string) {
  mkdirSync(widgetsDir, { recursive: true })
  const entries = await readdir(widgetsDir, { withFileTypes: true })
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => loadRuntimeWidget(widgetsDir, scope, entry.name))
  )
}

async function listRuntimeWidgets(
  payload?: OusiaRuntimeWidgetsPayload
): Promise<OusiaRuntimeWidgetsResult> {
  const globalWidgetsDir = getRuntimeWidgetsDir()
  const projectWidgetsDir = getProjectRuntimeWidgetsDir(payload?.projectPath)
  const roots = [
    { dir: globalWidgetsDir, scope: "global" },
    ...(projectWidgetsDir
      ? [{ dir: projectWidgetsDir, scope: "project" }]
      : []),
  ]
  const loaded = (
    await Promise.all(
      roots.map((root) => loadRuntimeWidgetRoot(root.dir, root.scope))
    )
  ).flat()
  return {
    widgetsDir: projectWidgetsDir ?? globalWidgetsDir,
    widgetsDirs: roots.map((root) => root.dir),
    widgets: loaded.flatMap((result) => (result.widget ? [result.widget] : [])),
    errors: loaded.flatMap((result) => (result.error ? [result.error] : [])),
  }
}

function closeRuntimeWidgetWatchers(invalidate = true) {
  if (invalidate) {
    runtimeWidgetWatchGeneration += 1
  }
  for (const watcher of runtimeWidgetWatchers) {
    watcher.close()
  }
  runtimeWidgetWatchers = []
  runtimeWidgetWatchDirs = []
  if (runtimeWidgetWatchDebounce) {
    clearTimeout(runtimeWidgetWatchDebounce)
    runtimeWidgetWatchDebounce = undefined
  }
}

function emitRuntimeWidgetsChanged() {
  if (runtimeWidgetWatchDebounce) {
    clearTimeout(runtimeWidgetWatchDebounce)
  }
  runtimeWidgetWatchDebounce = setTimeout(() => {
    runtimeWidgetWatchDebounce = undefined
    const event: OusiaRuntimeWidgetsChangedEvent = {
      widgetsDirs: runtimeWidgetWatchDirs,
    }
    mainWindow?.webContents.send("ousia:widgets:changed", event)
  }, runtimeWidgetWatchDebounceMs)
}

async function watchRuntimeWidgets(
  payload?: OusiaRuntimeWidgetsPayload
): Promise<OusiaRuntimeWidgetsResult> {
  const watchGeneration = runtimeWidgetWatchGeneration + 1
  runtimeWidgetWatchGeneration = watchGeneration
  closeRuntimeWidgetWatchers(false)

  const result = await listRuntimeWidgets(payload)
  if (watchGeneration !== runtimeWidgetWatchGeneration) {
    return result
  }
  runtimeWidgetWatchDirs = result.widgetsDirs

  for (const dir of runtimeWidgetWatchDirs) {
    if (watchGeneration !== runtimeWidgetWatchGeneration) {
      break
    }
    mkdirSync(dir, { recursive: true })
    try {
      const watcher = watch(dir, { recursive: true }, emitRuntimeWidgetsChanged)
      watcher.on("error", () => {
        watcher.close()
      })
      runtimeWidgetWatchers.push(watcher)
    } catch {
      try {
        const watcher = watch(dir, emitRuntimeWidgetsChanged)
        watcher.on("error", () => {
          watcher.close()
        })
        runtimeWidgetWatchers.push(watcher)
      } catch {
        // Runtime widget refresh stays available through the manual button.
      }
    }
  }

  return result
}

async function sendChatMessage(
  payload: OusiaChatSendPayload
): Promise<OusiaChatSendResult> {
  const text = payload.prompt.trim()
  const context = {
    projectPath: payload.projectPath,
    sessionId: payload.sessionId,
  }
  const key = sessionKey(context)
  const interruptGeneration = interruptGenerations.get(key) ?? 0
  if (!text) {
    return { ok: true }
  }
  emitChatEvent(
    {
      type: "user_message",
      id: randomId("user"),
      text,
      timestamp: now(),
    },
    context
  )
  try {
    const bundle = await getAgentSession(
      context,
      payload.model,
      payload.thinkingLevel
    )
    await configureSessionBundle(bundle, payload.model, payload.thinkingLevel)
    const { session } = bundle
    if ((interruptGenerations.get(key) ?? 0) !== interruptGeneration) {
      return { ok: true }
    }
    if (session.isStreaming) {
      await session.prompt(text, {
        source: "interactive",
        streamingBehavior: "steer",
      })
    } else {
      void session.prompt(text, { source: "interactive" }).catch((error) => {
        emitChatEvent(
          {
            type: "error",
            id: randomId("error"),
            text: error instanceof Error ? error.message : String(error),
            timestamp: now(),
          },
          context
        )
      })
    }
    return { ok: true }
  } catch (error) {
    emitChatEvent(
      {
        type: "error",
        id: randomId("error"),
        text: error instanceof Error ? error.message : String(error),
        timestamp: now(),
      },
      context
    )
    return { ok: false }
  }
}

async function interruptChat(
  context: OusiaChatContext
): Promise<OusiaChatInterruptResult> {
  const key = sessionKey(context)
  interruptGenerations.set(key, (interruptGenerations.get(key) ?? 0) + 1)
  const promise = sessionPromises.get(key)
  if (!promise) {
    return { ok: true }
  }
  try {
    const { session } = await promise
    const hadActiveWork =
      session.isStreaming ||
      session.pendingMessageCount > 0 ||
      session.isBashRunning
    session.clearQueue()
    await session.abort()
    if (hadActiveWork) {
      emitChatEvent(
        {
          type: "run_status",
          status: "finished",
          text: "Agent interrupted.",
          timestamp: now(),
        },
        context
      )
    }
    return { ok: true }
  } catch (error) {
    emitChatEvent(
      {
        type: "error",
        id: randomId("error"),
        text: error instanceof Error ? error.message : String(error),
        timestamp: now(),
      },
      context
    )
    return { ok: false }
  }
}

function isExternalUrl(url: string) {
  try {
    const parsed = new URL(url)
    return ["http:", "https:", "mailto:"].includes(parsed.protocol)
  } catch {
    return false
  }
}

function isAllowedWebviewUrl(url: string) {
  try {
    const parsed = new URL(url)
    return ["about:", "file:", "http:", "https:"].includes(parsed.protocol)
  } catch {
    return false
  }
}

function getWebAuthnKeychainAccessGroup() {
  const configuredGroup = env.OUSIA_WEBAUTHN_KEYCHAIN_ACCESS_GROUP?.trim()
  if (configuredGroup) {
    return configuredGroup
  }

  const teamId = env.OUSIA_APPLE_TEAM_ID?.trim() || env.APPLE_TEAM_ID?.trim()
  if (!teamId) {
    return undefined
  }

  return `${teamId}.com.ousia.desktop.webauthn`
}

function describeWebAuthnAccount(account: WebAuthnAccount) {
  return (
    account.displayName ||
    account.name ||
    account.userHandle ||
    account.credentialId
  )
}

function configureBrowserWebAuthn() {
  const browserSession = electronSession.fromPartition(browserPartition)

  browserSession.on(
    "select-webauthn-account",
    async (_event, details, callback) => {
      try {
        if (details.accounts.length === 0) {
          callback()
          return
        }

        if (details.accounts.length === 1) {
          callback(details.accounts[0].credentialId)
          return
        }

        const buttons = details.accounts.map(describeWebAuthnAccount)
        const cancelId = buttons.length
        const result = await dialog.showMessageBox(mainWindow!, {
          type: "question",
          title: "Choose Passkey",
          message: `Choose a passkey for ${details.relyingPartyId}`,
          buttons: [...buttons, "Cancel"],
          cancelId,
          defaultId: 0,
          noLink: true,
        })

        callback(
          result.response === cancelId
            ? undefined
            : details.accounts[result.response]?.credentialId
        )
      } catch {
        callback()
      }
    }
  )

  if (platform !== "darwin") {
    return
  }

  const keychainAccessGroup = getWebAuthnKeychainAccessGroup()
  if (!keychainAccessGroup) {
    console.warn(
      "Skipping macOS WebAuthn platform authenticator: set OUSIA_WEBAUTHN_KEYCHAIN_ACCESS_GROUP or OUSIA_APPLE_TEAM_ID."
    )
    return
  }

  app.configureWebAuthn({
    touchID: {
      keychainAccessGroup,
      promptReason: "sign in to $1",
    },
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Ousia",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: "#111111",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.js"),
      webviewTag: true,
    },
  })

  mainWindow.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      delete webPreferences.preload
      webPreferences.contextIsolation = true
      webPreferences.nodeIntegration = false
      webPreferences.sandbox = true

      if (!isAllowedWebviewUrl(params.src)) {
        event.preventDefault()
      }
    }
  )

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: "deny" }
  })

  mainWindow.webContents.once("did-finish-load", emitWindowFullscreenState)
  mainWindow.on("enter-full-screen", emitWindowFullscreenState)
  mainWindow.on("leave-full-screen", emitWindowFullscreenState)
  mainWindow.on("closed", () => {
    closeRuntimeWidgetWatchers()
    mainWindow = undefined
  })

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    const indexHtml = join(
      __dirname,
      `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
    )
    if (!existsSync(indexHtml)) {
      throw new Error(`Renderer build not found: ${indexHtml}`)
    }
    await mainWindow.loadFile(indexHtml)
  }
}

ipcMain.handle("ousia:chat:send", (_event, payload: OusiaChatSendPayload) =>
  sendChatMessage(payload)
)

ipcMain.handle("ousia:chat:history", (_event, payload: OusiaChatContext) =>
  getChatHistory(payload)
)

ipcMain.handle("ousia:chat:interrupt", (_event, payload: OusiaChatContext) =>
  interruptChat(payload)
)

ipcMain.handle("ousia:project:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
  })
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true }
  }
  const path = result.filePaths[0]
  return {
    canceled: false,
    path,
    name: basename(path),
  }
})

ipcMain.handle(
  "ousia:editor:list-files",
  (_event, payload: OusiaEditorListFilesPayload) => listEditorFiles(payload)
)

ipcMain.handle(
  "ousia:editor:read-file",
  (_event, payload: OusiaEditorReadFilePayload) => readEditorFile(payload)
)

ipcMain.handle(
  "ousia:editor:save-file",
  (_event, payload: OusiaEditorSaveFilePayload) => saveEditorFile(payload)
)

ipcMain.handle(
  "ousia:widgets:list",
  (_event, payload?: OusiaRuntimeWidgetsPayload) => listRuntimeWidgets(payload)
)

ipcMain.handle(
  "ousia:widgets:watch",
  (_event, payload?: OusiaRuntimeWidgetsPayload) => watchRuntimeWidgets(payload)
)

ipcMain.handle("ousia:widgets:unwatch", () => {
  closeRuntimeWidgetWatchers()
})

ipcMain.handle(
  "ousia:terminal:create",
  (_event, payload: OusiaTerminalCreatePayload) => createTerminal(payload)
)

ipcMain.handle(
  "ousia:terminal:write",
  (_event, payload: OusiaTerminalWritePayload) => writeTerminal(payload)
)

ipcMain.handle(
  "ousia:terminal:resize",
  (_event, payload: OusiaTerminalResizePayload) => resizeTerminal(payload)
)

ipcMain.handle(
  "ousia:terminal:dispose",
  (_event, payload: OusiaTerminalDisposePayload) => disposeTerminal(payload)
)

app.whenReady().then(async () => {
  configureBrowserWebAuthn()
  await createWindow()
})

app.on("window-all-closed", () => {
  terminalSessions.forEach((terminal) => terminal.kill())
  terminalSessions.clear()
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow()
  }
})
