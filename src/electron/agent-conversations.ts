import {
  mkdirSync,
  writeFileSync,
} from "node:fs"
import { stat, unlink } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { ensurePiPackageDir } from "./pi-package-dir.js"
import type { ImageContent } from "@earendil-works/pi-ai"
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  CURRENT_SESSION_VERSION,
  type AuthStorage,
  type AgentSession,
  type AgentSessionEvent,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent"

import type {
  OusiaChatContext,
  OusiaChatBranchPayload,
  OusiaChatBranchResult,
  OusiaChatClearQueueResult,
  OusiaChatCompactPayload,
  OusiaChatCompactResult,
  OusiaChatEvent,
  OusiaChatHistoryItem,
  OusiaChatHistoryPayload,
  OusiaChatHistoryResult,
  OusiaChatInterruptPayload,
  OusiaChatInterruptResult,
  OusiaChatMovePayload,
  OusiaChatMoveResult,
  OusiaChatAttachment,
  OusiaAgentToolName,
  OusiaChatContextUsageResult,
  OusiaChatExportPayload,
  OusiaChatExportResult,
  OusiaChatSendPayload,
  OusiaChatSendResult,
  OusiaChatToolFilePreview,
  OusiaChatToolPayloadPayload,
  OusiaChatToolPayloadResult,
  OusiaAgentMode,
  OusiaModelSettings,
  OusiaPiThinkingLevel,
} from "./chat-types.js"
import { isOusiaPiThinkingLevel } from "./chat-types.js"
import { normalizeProviderModelId } from "./model-compat.js"
import {
  createWritablePiAuthStorage,
  resolvePiAgentDir,
} from "./pi-environment.js"
import {
  createHistoricalToolInputFilePreview,
  createToolFilePreview,
  createToolResultFilePreview,
} from "./tool-file-preview.js"
import { isVercelAiGatewayModelAvailable } from "./vercel-ai-gateway-models.js"
import { writeRuntimeLog } from "./runtime-logger.js"

type AgentSessionBundle = {
  authStorage: AuthStorage
  modelRegistry: ModelRegistry
  runtimeApiKeyProvider?: string
  session: AgentSession
}

function requirePiThinkingLevel(level: string): OusiaPiThinkingLevel {
  if (!isOusiaPiThinkingLevel(level)) {
    writeRuntimeLog("pi.thinking", "error", {
      message: "Rejected unsupported Pi thinking level",
      thinkingLevel: level,
    })
    throw new Error(`Unsupported Pi thinking level: ${level}`)
  }
  return level
}

type AgentConversationModuleOptions = {
  enabledTools: string[]
  emitChatEvent: (event: OusiaChatEvent, context?: OusiaChatContext) => void
}

type PiSessionEntry = ReturnType<SessionManager["getEntries"]>[number]

type AgentStreamState = {
  textId: string
  thinkingId: string
  showThinking: boolean
  currentAssistantMessageId: string
  lastErrorText: string
  toolArgumentJsonByContentIndex: Map<number, string>
  toolDisplayIdsByContentIndex: Map<number, string>
  toolDisplayIdsByProviderId: Map<string, string>
  toolFilePreviewsById: Map<string, OusiaChatToolFilePreview>
  startedToolIds: Set<string>
  activeToolIds: Set<string>
}

type StreamAssistantMessage = {
  role?: string
  id?: string
  content?: unknown
}

type StreamAssistantMessageEvent = {
  type?: string
  contentIndex?: number
  delta?: string
  content?: string
  error?: unknown
  partial?: StreamAssistantMessage
  toolCall?: {
    id?: string
    name?: string
    type?: string
    arguments?: unknown
  }
}

type HistoryBuildOptions = {
  includeToolPayloads: boolean
  showThinking: boolean
}

type HistoryCacheEntry = {
  fullItems?: OusiaChatHistoryItem[]
  lightweightItems?: OusiaChatHistoryItem[]
  mtimeMs: number
  sessionFile: string
}

function now() {
  return new Date().toISOString()
}

function randomId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function shouldShowThinkingForLevel(level: string | undefined) {
  return Boolean(level && level !== "off")
}

function createStreamState(thinkingLevel: string | undefined = "off"): AgentStreamState {
  return {
    textId: "",
    thinkingId: "",
    showThinking: shouldShowThinkingForLevel(thinkingLevel),
    currentAssistantMessageId: "",
    lastErrorText: "",
    toolArgumentJsonByContentIndex: new Map(),
    toolDisplayIdsByContentIndex: new Map(),
    toolDisplayIdsByProviderId: new Map(),
    toolFilePreviewsById: new Map(),
    startedToolIds: new Set(),
    activeToolIds: new Set(),
  }
}

function displayToolCallId(
  state: AgentStreamState,
  providerToolCallId: string | undefined
) {
  if (!providerToolCallId) {
    return undefined
  }
  return state.toolDisplayIdsByProviderId.get(providerToolCallId) ?? providerToolCallId
}

function createStreamToolFilePreview({
  args,
  context,
  state,
  toolCallId,
  toolName,
}: {
  args: unknown
  context: OusiaChatContext
  state: AgentStreamState
  toolCallId: string
  toolName?: string
}) {
  const filePreview = createToolFilePreview({
    args,
    previousPreview: state.toolFilePreviewsById.get(toolCallId),
    projectPath: context.projectPath,
    toolName,
  })
  if (filePreview) {
    state.toolFilePreviewsById.set(toolCallId, filePreview)
    return filePreview
  }
  return state.toolFilePreviewsById.get(toolCallId)
}

function finishActiveTools(
  state: AgentStreamState,
  context: OusiaChatContext,
  emitChatEvent: (event: OusiaChatEvent, context?: OusiaChatContext) => void,
  timestamp = now()
) {
  for (const toolId of state.activeToolIds) {
    emitChatEvent(
      {
        type: "tool_end",
        id: toolId,
        timestamp,
      },
      context
    )
  }
  state.activeToolIds.clear()
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

function errorTextFromUnknown(
  value: unknown,
  fallback = "智能体响应失败。"
): string {
  if (value === undefined || value === null) {
    return fallback
  }
  if (value instanceof Error) {
    return value.message || fallback
  }
  if (typeof value === "string") {
    return value.trim() || fallback
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const key of ["errorMessage", "message", "reason", "detail"]) {
      const field = record[key]
      if (typeof field === "string" && field.trim()) {
        return field.trim()
      }
    }
    for (const key of ["error", "cause"]) {
      if (key in record) {
        const text: string = errorTextFromUnknown(record[key], "")
        if (text) {
          return text
        }
      }
    }
    return stringifyUnknown(value) ?? fallback
  }
  return String(value)
}

function previewText(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`
}

function previewToolInput(value: string) {
  const fallback = previewText(value || "{}")
  if (!value) {
    return fallback
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fallback
    }

    const record = parsed as Record<string, unknown>
    const summary: Record<string, string> = {}
    for (const key of [
      "path",
      "filePath",
      "file_path",
      "target",
      "cwd",
      "command",
      "cmd",
      "shell",
      "pattern",
      "query",
      "search",
    ]) {
      const field = record[key]
      if (typeof field === "string" && field.trim()) {
        summary[key] = previewText(field)
      }
    }

    return Object.keys(summary).length ? JSON.stringify(summary) : fallback
  } catch {
    return fallback
  }
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

function sessionKey(context: OusiaChatContext) {
  return `${context.projectPath}::${context.sessionId}`
}

function getDefaultPiSessionDir(cwd: string) {
  return SessionManager.create(cwd).getSessionDir()
}

async function findPiSessionByExactId(cwd: string, sessionId: string) {
  const sessions = await SessionManager.list(cwd)
  return sessions.find((session) => session.id === sessionId)
}

async function openOrCreatePiSessionManager(cwd: string, sessionId: string) {
  const existingSession = await findPiSessionByExactId(cwd, sessionId)
  return existingSession
    ? SessionManager.open(existingSession.path)
    : SessionManager.create(cwd, undefined, { id: sessionId })
}

function normalizeModelSettings(model: OusiaModelSettings) {
  const provider = model.provider.trim()
  const modelId = model.modelId.trim()
  return {
    provider,
    modelId: normalizeProviderModelId(provider, modelId),
    apiKey: model.apiKey?.trim(),
  }
}

function toolsForAgentMode(
  mode: OusiaAgentMode | undefined,
  customTools?: OusiaAgentToolName[]
) {
  if (mode === "custom") {
    return customTools?.length ? customTools : ["read", "grep", "find", "ls"]
  }
  if (mode === "readOnly") {
    return ["read", "grep", "find", "ls"]
  }
  if (mode === "noTerminal") {
    return ["read", "write", "edit", "grep", "find", "ls"]
  }
  return ["read", "write", "edit", "bash", "grep", "find", "ls"]
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

async function findConfiguredModel(
  modelRegistry: ModelRegistry,
  model: OusiaModelSettings
) {
  if (
    model.provider === "vercel-ai-gateway" &&
    !(await isVercelAiGatewayModelAvailable(model.modelId))
  ) {
    throw new Error(
      `Vercel AI Gateway 当前不支持模型：${model.modelId}。请重新选择一个模型。`
    )
  }
  const selected = modelRegistry.find(model.provider, model.modelId)
  if (!selected) {
    throw new Error(`未知模型：${model.provider}/${model.modelId}`)
  }
  return selected
}

async function configureSessionBundle(
  bundle: AgentSessionBundle,
  modelSettings: OusiaModelSettings,
  thinkingLevel: OusiaPiThinkingLevel,
  agentMode?: OusiaAgentMode,
  customAgentTools?: OusiaAgentToolName[],
  autoCompactContext?: boolean,
  autoRetryOnFailure?: boolean
) {
  const model = normalizeModelSettings(modelSettings)
  if (!model.provider || !model.modelId) {
    throw new Error("模型服务商和模型 ID 不能为空。")
  }
  applyRuntimeApiKey(bundle, model)
  const selectedModel = await findConfiguredModel(bundle.modelRegistry, model)
  if (
    bundle.session.model?.provider !== selectedModel.provider ||
    bundle.session.model?.id !== selectedModel.id
  ) {
    await bundle.session.setModel(selectedModel)
  }
  bundle.session.setThinkingLevel(thinkingLevel)
  bundle.session.setActiveToolsByName(
    toolsForAgentMode(agentMode, customAgentTools)
  )
  if (typeof autoCompactContext === "boolean") {
    bundle.session.setAutoCompactionEnabled(autoCompactContext)
  }
  if (typeof autoRetryOnFailure === "boolean") {
    bundle.session.setAutoRetryEnabled(autoRetryOnFailure)
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
        return ""
      }
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function attachmentSummary(attachments: OusiaChatAttachment[] | undefined) {
  if (!attachments?.length) {
    return []
  }
  return attachments.map((attachment) => ({
    id: attachment.id,
    kind: attachment.kind,
    mediaType: attachment.mediaType,
    name: attachment.name,
    size: attachment.size,
    ...(attachment.kind === "image"
      ? { dataBase64: attachment.dataBase64 }
      : {}),
  }))
}

function imageExtension(mediaType: string) {
  if (mediaType === "image/jpeg") {
    return "jpg"
  }
  return mediaType.split("/")[1]?.split("+")[0] || "png"
}

function base64ByteLength(data: string) {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding)
}

function attachmentSummaryFromContent(content: unknown) {
  if (!Array.isArray(content)) {
    return []
  }

  return content.flatMap((part, index) => {
    if (!part || typeof part !== "object") {
      return []
    }
    const block = part as Record<string, unknown>
    if (block.type !== "image") {
      return []
    }
    const mediaType =
      typeof block.mimeType === "string" && block.mimeType
        ? block.mimeType
        : "image/png"
    const data = typeof block.data === "string" ? block.data : ""
    return [
      {
        id: `history-image-${index}`,
        kind: "image" as const,
        mediaType,
        name: `image.${imageExtension(mediaType)}`,
        size: base64ByteLength(data),
        dataBase64: data,
      },
    ]
  })
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B"
  }
  const units = ["B", "KB", "MB", "GB"]
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function buildPromptWithTextAttachments(
  text: string,
  attachments: OusiaChatAttachment[] | undefined
) {
  const blocks = [text.trim()]
  const textAttachments = attachments?.filter(
    (attachment) => attachment.kind === "text"
  )
  const fileAttachments = attachments?.filter(
    (attachment) => attachment.kind === "file"
  )

  for (const attachment of textAttachments ?? []) {
    blocks.push(
      [
        `<attached_file name="${attachment.name}" mediaType="${attachment.mediaType}" size="${attachment.size}">`,
        attachment.text,
        "</attached_file>",
      ].join("\n")
    )
  }

  if (fileAttachments?.length) {
    blocks.push(
      [
        "用户还附加了以下非文本文件，当前只能看到文件元信息：",
        ...fileAttachments.map(
          (attachment) =>
            `- ${attachment.name} (${attachment.mediaType || "application/octet-stream"}, ${formatBytes(attachment.size)})`
        ),
      ].join("\n")
    )
  }

  return blocks.filter(Boolean).join("\n\n")
}

function imageContentFromAttachments(
  attachments: OusiaChatAttachment[] | undefined
): ImageContent[] {
  return (attachments ?? [])
    .filter((attachment) => attachment.kind === "image")
    .map((attachment) => ({
      type: "image",
      data: attachment.dataBase64,
      mimeType: attachment.mediaType || "image/png",
    }))
}

function messageEntryToHistoryItems(
  entry: SessionMessageEntry,
  items: OusiaChatHistoryItem[],
  options: HistoryBuildOptions = {
    includeToolPayloads: true,
    showThinking: true,
  }
) {
  const message = entry.message as unknown as Record<string, unknown>
  const role = message.role
  if (role === "user") {
    const attachments = attachmentSummaryFromContent(message.content)
    items.push({
      id: entry.id,
      role: "user",
      text: textFromContent(message.content),
      attachments: attachments.length ? attachments : undefined,
      status: "finished",
      timestamp: entry.timestamp,
    })
    return
  }
  if (role === "assistant") {
    const content = Array.isArray(message.content) ? message.content : []
    const stopReason =
      typeof message.stopReason === "string" ? message.stopReason : undefined
    const orphanedToolStatus = stopReason === "aborted" ? "finished" : "running"
    content.forEach((part, index) => {
      if (!part || typeof part !== "object") {
        return
      }
      const block = part as Record<string, unknown>
      if (block.type === "thinking") {
        if (!options.showThinking) {
          return
        }
        const text = typeof block.thinking === "string" ? block.thinking : ""
        if (text) {
          items.push({
            id: `${entry.id}-thinking-${index}`,
            role: "thinking",
            text,
            status: "finished",
            timestamp: entry.timestamp,
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
            timestamp: entry.timestamp,
          })
        }
      } else if (block.type === "toolCall") {
        const input = stringifyUnknown(block.arguments) ?? ""
        const inputPreview = previewToolInput(input)
        const toolName = typeof block.name === "string" ? block.name : "tool"
        const filePreview = createHistoricalToolInputFilePreview({
          args: block.arguments,
          toolName,
        })
        items.push({
          id:
            typeof block.id === "string"
              ? block.id
              : `${entry.id}-tool-${index}`,
          role: "tool",
          name: toolName,
          text: options.includeToolPayloads ? input : inputPreview,
          input: options.includeToolPayloads ? input : inputPreview,
          filePreview,
          payloadOmitted: options.includeToolPayloads ? undefined : true,
          status: orphanedToolStatus,
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
    const existing = index >= 0 ? items[index] : undefined
    const resultText = textFromContent(message.content)
    const toolName =
      typeof message.toolName === "string"
        ? message.toolName
        : existing?.role === "tool"
        ? existing.name
        : "tool"
    const filePreview =
      createToolResultFilePreview({
        result: message,
        toolName,
      }) ?? (existing?.role === "tool" ? existing.filePreview : undefined)
    const text = message.isError
      ? resultText
      : resultText || (existing?.role === "tool" ? existing.text : "")
    const item: OusiaChatHistoryItem = {
      id: toolCallId,
      role: "tool",
      name: toolName,
      text: options.includeToolPayloads ? text : previewText(text),
      input: existing?.role === "tool" ? existing.input : undefined,
      output:
        options.includeToolPayloads && !message.isError ? resultText : undefined,
      errorText:
        options.includeToolPayloads && message.isError ? resultText : undefined,
      filePreview,
      payloadOmitted: options.includeToolPayloads ? undefined : true,
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
    const text = [command ? `$ ${command}` : "", output].filter(Boolean).join("\n")
    items.push({
      id: entry.id,
      role: "tool",
      name: "bash",
      text: options.includeToolPayloads ? text : previewText(text),
      input: command
        ? options.includeToolPayloads
          ? command
          : previewText(command)
        : undefined,
      output: options.includeToolPayloads ? output : undefined,
      errorText:
        options.includeToolPayloads && message.exitCode !== 0 ? output : undefined,
      payloadOmitted: options.includeToolPayloads ? undefined : true,
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
        timestamp: entry.timestamp,
      })
    }
  }
}

function branchEntriesToHistoryItems(
  entries: PiSessionEntry[],
  items: OusiaChatHistoryItem[],
  includeToolPayloads = true
) {
  let thinkingLevel: string | undefined = "off"
  entries.forEach((entry) => {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel
      return
    }
    if (entry.type === "message") {
      messageEntryToHistoryItems(entry, items, {
        includeToolPayloads,
        showThinking: shouldShowThinkingForLevel(thinkingLevel),
      })
    }
  })
}

function piEntryIdFromChatItemId(messageId: string) {
  return messageId
    .replace(/-text-\d+$/, "")
    .replace(/-thinking-\d+$/, "")
}

function assistantTextFromSessionEntry(entry: PiSessionEntry) {
  if (entry.type !== "message") {
    return ""
  }
  const message = entry.message as unknown as Record<string, unknown>
  if (message.role !== "assistant") {
    return ""
  }
  return textFromContent(message.content)
}

function findBranchLeafId(
  sessionManager: SessionManager,
  messageId: string,
  messageText: string | undefined
) {
  const directId = piEntryIdFromChatItemId(messageId)
  if (sessionManager.getEntry(directId)) {
    return directId
  }

  const normalizedMessageText = messageText?.trim()
  if (!normalizedMessageText) {
    return undefined
  }
  const entries = sessionManager.getEntries()
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (assistantTextFromSessionEntry(entry).trim() === normalizedMessageText) {
      return entry.id
    }
  }
  return undefined
}

function createBranchedSessionFile({
  cwd,
  parentSessionFile,
  sourceSessionManager,
  targetConversationDir,
  targetSessionId,
  leafId,
}: {
  cwd: string
  parentSessionFile: string
  sourceSessionManager: SessionManager
  targetConversationDir: string
  targetSessionId: string
  leafId: string
}) {
  const path = sourceSessionManager.getBranch(leafId)
  if (!path.length) {
    throw new Error(`Entry ${leafId} not found`)
  }

  mkdirSync(targetConversationDir, { recursive: true })
  const timestamp = now()
  const fileTimestamp = timestamp.replace(/[:.]/g, "-")
  const targetFile = join(
    targetConversationDir,
    `${fileTimestamp}_${targetSessionId}.jsonl`
  )
  const header = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: targetSessionId,
    timestamp,
    cwd,
    parentSession: parentSessionFile,
  }
  let parentId: string | null = null
  const entries = path
    .filter((entry) => entry.type !== "label")
    .map((entry) => {
      const nextEntry = { ...entry, parentId }
      parentId = entry.id
      return nextEntry
    })

  writeFileSync(
    targetFile,
    [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") +
      "\n",
    { encoding: "utf8", flag: "wx" }
  )
  return targetFile
}

function createMovedSessionFile({
  sourceSessionManager,
  targetConversationDir,
  targetCwd,
  targetSessionId,
}: {
  sourceSessionManager: SessionManager
  targetConversationDir: string
  targetCwd: string
  targetSessionId: string
}) {
  const sourceHeader = sourceSessionManager.getHeader()
  if (!sourceHeader) {
    throw new Error("Cannot move session: source session has no header.")
  }

  mkdirSync(targetConversationDir, { recursive: true })
  const timestamp =
    typeof sourceHeader.timestamp === "string" ? sourceHeader.timestamp : now()
  const fileTimestamp = timestamp.replace(/[:.]/g, "-")
  const targetFile = join(
    targetConversationDir,
    `${fileTimestamp}_${targetSessionId}.jsonl`
  )
  const targetHeader = {
    ...sourceHeader,
    version: CURRENT_SESSION_VERSION,
    id: targetSessionId,
    cwd: targetCwd,
  }
  writeFileSync(
    targetFile,
    [targetHeader, ...sourceSessionManager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
    { encoding: "utf8", flag: "wx" }
  )
  return targetFile
}

async function findPiSessionFileForHistory(context: OusiaChatContext) {
  const cwd = expandHomePath(context.projectPath)
  const session = await findPiSessionByExactId(cwd, context.sessionId)
  return session ? { cwd, sessionFile: session.path } : undefined
}

export function createAgentConversationModule({
  enabledTools,
  emitChatEvent,
}: AgentConversationModuleOptions) {
  const sessionPromises = new Map<string, Promise<AgentSessionBundle>>()
  const historyCache = new Map<string, HistoryCacheEntry>()
  const streamState = new Map<string, AgentStreamState>()
  const interruptGenerations = new Map<string, number>()

  function clearSessionRuntimeState(key: string) {
    sessionPromises.delete(key)
    historyCache.delete(key)
    streamState.delete(key)
    interruptGenerations.delete(key)
  }

  function setStreamThinkingLevel(key: string, thinkingLevel: string | undefined) {
    const state = streamState.get(key) ?? createStreamState(thinkingLevel)
    state.showThinking = shouldShowThinkingForLevel(thinkingLevel)
    if (!state.showThinking) {
      state.thinkingId = ""
    }
    streamState.set(key, state)
  }

  async function getHistoryItems(
    context: OusiaChatContext,
    includeToolPayloads: boolean
  ) {
    const lookup = await findPiSessionFileForHistory(context)
    if (!lookup) {
      return []
    }
    const { sessionFile } = lookup

    const fileStat = await stat(sessionFile)
    const key = sessionKey(context)
    const cached = historyCache.get(key)
    const cacheEntry =
      cached &&
      cached.sessionFile === sessionFile &&
      cached.mtimeMs === fileStat.mtimeMs
        ? cached
        : {
            mtimeMs: fileStat.mtimeMs,
            sessionFile,
          }
    const cacheField = includeToolPayloads ? "fullItems" : "lightweightItems"
    if (cacheEntry[cacheField]) {
      historyCache.set(key, cacheEntry)
      return cacheEntry[cacheField]
    }

    const sessionManager = SessionManager.open(sessionFile)
    const items: OusiaChatHistoryItem[] = []
    branchEntriesToHistoryItems(sessionManager.getBranch(), items, includeToolPayloads)
    cacheEntry[cacheField] = items
    historyCache.set(key, cacheEntry)
    return items
  }

  async function emitContextUsage(context: OusiaChatContext, key: string) {
    const promise = sessionPromises.get(key)
    if (!promise) {
      return
    }
    try {
      const bundle = await promise
      const contextUsage = bundle.session.getContextUsage()
      if (!contextUsage) {
        return
      }
      emitChatEvent(
        {
          type: "context_usage",
          tokens: contextUsage.tokens,
          contextWindow: contextUsage.contextWindow,
          percent: contextUsage.percent,
          timestamp: now(),
        },
        context
      )
    } catch {
      // Context usage is informative only; chat errors are emitted elsewhere.
    }
  }

  async function moveChatSession(
    payload: OusiaChatMovePayload
  ): Promise<OusiaChatMoveResult> {
    const sourceCwd = expandHomePath(payload.sourceProjectPath)
    const targetCwd = expandHomePath(payload.targetProjectPath)
    const sourceContext = {
      projectPath: payload.sourceProjectPath,
      sessionId: payload.sessionId,
    }
    const targetContext = {
      projectPath: payload.targetProjectPath,
      sessionId: payload.sessionId,
    }
    const sourceKey = sessionKey(sourceContext)
    const targetKey = sessionKey(targetContext)

    if (sourceCwd === targetCwd) {
      return { ok: true, moved: false }
    }

    try {
      const activeBundle = await sessionPromises
        .get(sourceKey)
        ?.catch(() => undefined)
      if (
        activeBundle &&
        (activeBundle.session.isStreaming ||
          activeBundle.session.pendingMessageCount > 0 ||
          activeBundle.session.isBashRunning)
      ) {
        return {
          ok: false,
          error: "会话正在运行，完成或停止后再移动。",
        }
      }

      const sourceSession = await findPiSessionByExactId(
        sourceCwd,
        payload.sessionId
      )
      if (!sourceSession) {
        clearSessionRuntimeState(sourceKey)
        clearSessionRuntimeState(targetKey)
        return { ok: true, moved: false }
      }

      const existingTargetSession = await findPiSessionByExactId(
        targetCwd,
        payload.sessionId
      )
      if (existingTargetSession) {
        return {
          ok: false,
          error: "目标项目里已存在同 id 的 Pi 会话，无法覆盖。",
        }
      }

      const sourceSessionManager = SessionManager.open(sourceSession.path)
      const targetConversationDir = getDefaultPiSessionDir(targetCwd)
      let targetFile = ""
      try {
        targetFile = createMovedSessionFile({
          sourceSessionManager,
          targetConversationDir,
          targetCwd,
          targetSessionId: payload.sessionId,
        })
        await unlink(sourceSession.path).catch((error: unknown) => {
          if (
            !error ||
            typeof error !== "object" ||
            (error as NodeJS.ErrnoException).code !== "ENOENT"
          ) {
            throw error
          }
        })
      } catch (error) {
        if (targetFile) {
          await unlink(targetFile).catch(() => undefined)
        }
        throw error
      }

      clearSessionRuntimeState(sourceKey)
      clearSessionRuntimeState(targetKey)
      writeRuntimeLog("chat.move", "info", {
        sessionId: payload.sessionId,
        sourceProjectPath: payload.sourceProjectPath,
        targetProjectPath: payload.targetProjectPath,
        sourceSessionFile: sourceSession.path,
        targetSessionFile: targetFile,
      })
      return { ok: true, moved: true }
    } catch (error) {
      writeRuntimeLog("chat.move", "error", {
        payload,
        error,
      })
      return {
        ok: false,
        error: errorTextFromUnknown(error, "移动会话失败。"),
      }
    }
  }

  async function branchChat(
    payload: OusiaChatBranchPayload
  ): Promise<OusiaChatBranchResult> {
    const cwd = expandHomePath(payload.projectPath)
    const sourceSession = await findPiSessionByExactId(cwd, payload.sessionId)
    if (!sourceSession) {
      return {
        ok: false,
        error: "当前会话还没有可分支的 Pi 历史。",
      }
    }

    try {
      const existingTargetSession = await findPiSessionByExactId(
        cwd,
        payload.targetSessionId
      )
      if (existingTargetSession) {
        return {
          ok: false,
          error: "目标 Pi 会话已存在，无法覆盖。",
        }
      }

      const sourceSessionManager = SessionManager.open(sourceSession.path)
      const leafId = findBranchLeafId(
        sourceSessionManager,
        payload.messageId,
        payload.messageText
      )
      if (!leafId) {
        return {
          ok: false,
          error: "没有在 Pi 会话树中找到这条消息，无法创建真实分支。",
        }
      }

      const targetConversationDir = getDefaultPiSessionDir(cwd)
      const targetFile = createBranchedSessionFile({
        cwd,
        parentSessionFile: sourceSession.path,
        sourceSessionManager,
        targetConversationDir,
        targetSessionId: payload.targetSessionId,
        leafId,
      })
      sessionPromises.delete(
        sessionKey({
          projectPath: payload.projectPath,
          sessionId: payload.targetSessionId,
        })
      )
      const targetSessionManager = SessionManager.open(targetFile)
      const items: OusiaChatHistoryItem[] = []
      branchEntriesToHistoryItems(targetSessionManager.getBranch(), items)
      return { ok: true, items }
    } catch (error) {
      writeRuntimeLog("chat.branch", "error", {
        payload,
        sourceSessionFile: sourceSession.path,
        error,
      })
      return {
        ok: false,
        error: errorTextFromUnknown(error, "创建分支失败。"),
      }
    }
  }

  function translateAgentEvent(
    event: AgentSessionEvent,
    context: OusiaChatContext,
    key: string
  ) {
    const timestamp = now()
    const state = streamState.get(key) ?? createStreamState()
    streamState.set(key, state)
    const emitError = (text: string) => {
      state.lastErrorText = text
      emitChatEvent(
        {
          type: "error",
          id: randomId("error"),
          text,
          timestamp,
        },
        context
      )
    }

    if (event.type === "agent_start") {
      state.lastErrorText = ""
      emitChatEvent(
        { type: "run_status", status: "starting", timestamp },
        context
      )
      return
    }
    if (event.type === "turn_start") {
      emitChatEvent(
        { type: "run_status", status: "running", timestamp },
        context
      )
      return
    }
    if (event.type === "queue_update") {
      emitChatEvent(
        {
          type: "queue_update",
          steering: [...event.steering],
          followUp: [...event.followUp],
          timestamp,
        },
        context
      )
      return
    }
    if (event.type === "agent_end") {
      finishActiveTools(state, context, emitChatEvent, timestamp)
      if (event.willRetry) {
        emitChatEvent(
          { type: "run_status", status: "running", timestamp },
          context
        )
        return
      }
      emitChatEvent(
        { type: "run_status", status: "finished", timestamp },
        context
      )
      void emitContextUsage(context, key)
      state.textId = ""
      state.thinkingId = ""
      state.currentAssistantMessageId = ""
      state.toolArgumentJsonByContentIndex.clear()
      state.toolDisplayIdsByContentIndex.clear()
      state.toolDisplayIdsByProviderId.clear()
      state.toolFilePreviewsById.clear()
      state.startedToolIds.clear()
      state.activeToolIds.clear()
      return
    }
    if (event.type === "message_start") {
      const source = event as unknown as {
        message?: Record<string, unknown>
      }
      if (source.message?.role === "assistant") {
        state.currentAssistantMessageId =
          typeof source.message.id === "string"
            ? source.message.id
            : randomId("assistant-message")
        state.toolArgumentJsonByContentIndex.clear()
        state.toolDisplayIdsByContentIndex.clear()
        state.toolDisplayIdsByProviderId.clear()
        state.toolFilePreviewsById.clear()
        state.startedToolIds.clear()
      }
      return
    }
    if (event.type === "message_end") {
      const message = event.message as unknown as Record<string, unknown>
      if (message.role === "assistant" && message.stopReason === "aborted") {
        finishActiveTools(state, context, emitChatEvent, timestamp)
      }
      if (message.role === "assistant" && message.stopReason === "error") {
        emitError(
          errorTextFromUnknown(
            message.errorMessage ?? message.error ?? message,
            "智能体响应失败。"
          )
        )
        emitChatEvent(
          { type: "run_status", status: "error", timestamp },
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
      const displayId =
        displayToolCallId(state, source.toolCallId) ?? randomId("tool")
      const filePreview = createStreamToolFilePreview({
        args: source.args,
        context,
        state,
        toolCallId: displayId,
        toolName: source.toolName,
      })
      emitChatEvent(
        {
          type: "tool_start",
          id: displayId,
          name: source.toolName ?? "tool",
          args: source.args,
          filePreview,
          timestamp,
        },
        context
      )
      state.startedToolIds.add(displayId)
      state.activeToolIds.add(displayId)
      return
    }
    if (event.type === "tool_execution_update") {
      const source = event as unknown as {
        args?: unknown
        toolCallId?: string
        partialResult?: unknown
        toolName?: string
      }
      const displayId =
        displayToolCallId(state, source.toolCallId) ?? randomId("tool")
      const filePreview = createStreamToolFilePreview({
        args: source.args,
        context,
        state,
        toolCallId: displayId,
        toolName: source.toolName,
      })
      emitChatEvent(
        {
          type: "tool_update",
          id: displayId,
          name: source.toolName,
          filePreview,
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
      const displayId =
        displayToolCallId(state, source.toolCallId) ?? randomId("tool")
      emitChatEvent(
        {
          type: "tool_end",
          id: displayId,
          name: source.toolName,
          result: source.result,
          isError: source.isError,
          timestamp,
        },
        context
      )
      state.activeToolIds.delete(displayId)
      return
    }
    if (event.type === "auto_retry_end") {
      if (!event.success) {
        const text = errorTextFromUnknown(
          event.finalError,
          "智能体响应失败。"
        )
        if (text !== state.lastErrorText) {
          emitError(text)
        }
        emitChatEvent(
          { type: "run_status", status: "error", timestamp },
          context
        )
      } else {
        state.lastErrorText = ""
      }
      return
    }
    if (event.type !== "message_update") {
      return
    }

    const messageEvent = (
      event as unknown as {
        message?: StreamAssistantMessage
        assistantMessageEvent?: StreamAssistantMessageEvent
      }
    ).assistantMessageEvent
    const message = (
      event as unknown as {
        message?: StreamAssistantMessage
      }
    ).message

    if (!messageEvent) {
      return
    }

    if (
      messageEvent.type === "toolcall_start" &&
      typeof messageEvent.contentIndex === "number"
    ) {
      state.toolArgumentJsonByContentIndex.set(messageEvent.contentIndex, "")
    }
    if (
      messageEvent.type === "toolcall_delta" &&
      typeof messageEvent.contentIndex === "number" &&
      typeof messageEvent.delta === "string"
    ) {
      const current =
        state.toolArgumentJsonByContentIndex.get(messageEvent.contentIndex) ?? ""
      state.toolArgumentJsonByContentIndex.set(
        messageEvent.contentIndex,
        current + messageEvent.delta
      )
    }

    const toolMessage =
      messageEvent.partial?.role === "assistant" &&
      Array.isArray(messageEvent.partial.content)
        ? messageEvent.partial
        : message?.role === "assistant" && Array.isArray(message.content)
        ? message
        : undefined

    const emitToolCallInputUpdate = (
      part: Record<string, unknown>,
      index: number,
      messageId: string | undefined
    ) => {
      if (part.type !== "toolCall") {
        return
      }
      const providerToolCallId =
        typeof part.id === "string" && part.id ? part.id : undefined
      const existingDisplayId = state.toolDisplayIdsByContentIndex.get(index)
      const toolCallId =
        existingDisplayId ??
        providerToolCallId ??
        `${state.currentAssistantMessageId || messageId || "tool"}-${index}`
      state.toolDisplayIdsByContentIndex.set(index, toolCallId)
      if (providerToolCallId) {
        state.toolDisplayIdsByProviderId.set(providerToolCallId, toolCallId)
      }
      const toolName = typeof part.name === "string" ? part.name : "tool"
      const rawArguments = state.toolArgumentJsonByContentIndex.get(index)
      const argsForPreview =
        rawArguments && rawArguments.trim() ? rawArguments : part.arguments
      const filePreview = createStreamToolFilePreview({
        args: argsForPreview,
        context,
        state,
        toolCallId,
        toolName,
      })
      if (!state.startedToolIds.has(toolCallId)) {
        state.startedToolIds.add(toolCallId)
        state.activeToolIds.add(toolCallId)
        emitChatEvent(
          {
            type: "tool_start",
            id: toolCallId,
            name: toolName,
            args: argsForPreview,
            filePreview,
            timestamp,
          },
          context
        )
        return
      }
      emitChatEvent(
        {
          type: "tool_update",
          id: toolCallId,
          name: toolName,
          filePreview,
          value: argsForPreview,
          phase: "input",
          timestamp,
        },
        context
      )
    }

    if (toolMessage && Array.isArray(toolMessage.content)) {
      toolMessage.content.forEach((part, index) => {
        if (!part || typeof part !== "object") {
          return
        }
        emitToolCallInputUpdate(
          part as Record<string, unknown>,
          index,
          toolMessage.id || message?.id
        )
      })
    } else if (
      messageEvent.type === "toolcall_end" &&
      typeof messageEvent.contentIndex === "number" &&
      messageEvent.toolCall
    ) {
      emitToolCallInputUpdate(
        { ...messageEvent.toolCall, type: "toolCall" },
        messageEvent.contentIndex,
        message?.id
      )
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
      state.thinkingId ||=
        `thinking-${messageEvent.contentIndex ?? 0}-${Date.now()}`
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
      emitError(errorTextFromUnknown(messageEvent.error, "智能体响应失败。"))
      emitChatEvent({ type: "run_status", status: "error", timestamp }, context)
    }
  }

  async function createSession(
    context: OusiaChatContext,
    key: string,
    modelSettings: OusiaModelSettings,
    thinkingLevel: OusiaPiThinkingLevel,
    agentMode?: OusiaAgentMode,
    customAgentTools?: OusiaAgentToolName[],
    autoCompactContext?: boolean
  ) {
    ensurePiPackageDir()
    const cwd = expandHomePath(context.projectPath)
    const model = normalizeModelSettings(modelSettings)
    const agentDir = resolvePiAgentDir()
    mkdirSync(cwd, { recursive: true })
    mkdirSync(agentDir, { recursive: true })

    const authStorage = createWritablePiAuthStorage(agentDir)
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
    if (model.apiKey) {
      authStorage.setRuntimeApiKey(model.provider, model.apiKey)
    }
    const selectedModel =
      model.provider && model.modelId
        ? await findConfiguredModel(modelRegistry, model)
        : undefined

    const { session, modelFallbackMessage } = await createAgentSession({
      authStorage,
      cwd,
      agentDir,
      modelRegistry,
      resourceLoader,
      sessionManager: await openOrCreatePiSessionManager(cwd, context.sessionId),
      settingsManager,
      model: selectedModel,
      thinkingLevel,
      tools: toolsForAgentMode(agentMode, customAgentTools).filter((tool) =>
        enabledTools.includes(tool)
      ),
    })

    if (typeof autoCompactContext === "boolean") {
      session.setAutoCompactionEnabled(autoCompactContext)
    }

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

    streamState.set(key, createStreamState())
    session.subscribe((event) => translateAgentEvent(event, context, key))
    return {
      authStorage,
      modelRegistry,
      runtimeApiKeyProvider: model.apiKey ? model.provider : undefined,
      session,
    }
  }

  async function getAgentSession(
    context: OusiaChatContext,
    model: OusiaModelSettings,
    thinkingLevel: OusiaPiThinkingLevel,
    agentMode?: OusiaAgentMode,
    customAgentTools?: OusiaAgentToolName[],
    autoCompactContext?: boolean
  ): Promise<AgentSessionBundle> {
    const key = sessionKey(context)
    const existingPromise = sessionPromises.get(key)
    if (existingPromise) {
      return existingPromise
    }

    const promise = createSession(
      context,
      key,
      model,
      thinkingLevel,
      agentMode,
      customAgentTools,
      autoCompactContext
    ).catch((error) => {
      if (sessionPromises.get(key) === promise) {
        sessionPromises.delete(key)
      }
      throw error
    })
    sessionPromises.set(key, promise)
    return promise
  }

  async function getChatHistory(
    payload: OusiaChatHistoryPayload
  ): Promise<OusiaChatHistoryResult> {
    try {
      const allItems = await getHistoryItems(
        payload,
        payload.includeToolPayloads === true
      )
      const limit =
        typeof payload.limit === "number" && Number.isFinite(payload.limit)
          ? Math.max(1, Math.floor(payload.limit))
          : 0
      const endIndex = payload.beforeItemId
        ? allItems.findIndex((item) => item.id === payload.beforeItemId)
        : allItems.length
      if (endIndex < 0) {
        return {
          hasMore: false,
          isPartial: true,
          items: [],
          totalItems: allItems.length,
        }
      }
      const startIndex = limit ? Math.max(0, endIndex - limit) : 0
      const items = allItems.slice(startIndex, endIndex)
      const hasMore = startIndex > 0
      writeRuntimeLog("chat.history", "info", {
        beforeItemId: payload.beforeItemId,
        includeToolPayloads: payload.includeToolPayloads === true,
        limit,
        projectPath: payload.projectPath,
        returnedItems: items.length,
        sessionId: payload.sessionId,
        totalItems: allItems.length,
      })
      if (!items.length) {
        writeRuntimeLog("chat.history", "warn", {
          beforeItemId: payload.beforeItemId,
          includeToolPayloads: payload.includeToolPayloads === true,
          limit,
          projectPath: payload.projectPath,
          sessionId: payload.sessionId,
          totalItems: allItems.length,
        })
      }
      if (limit || payload.beforeItemId) {
        return {
          hasMore,
          isPartial: items.length !== allItems.length,
          items,
          nextCursor: hasMore ? items[0]?.id : undefined,
          totalItems: allItems.length,
        }
      }
      return {
        hasMore: false,
        isPartial: false,
        items: allItems,
        totalItems: allItems.length,
      }
    } catch (error) {
      return {
        hasMore: false,
        isPartial: false,
        items: [
          {
            id: randomId("history-error"),
            role: "error",
            text:
              error instanceof Error
                ? `会话历史加载失败：${error.message}`
                : "会话历史加载失败。",
          },
        ],
      }
    }
  }

  async function getChatToolPayload(
    payload: OusiaChatToolPayloadPayload
  ): Promise<OusiaChatToolPayloadResult> {
    try {
      const items = await getHistoryItems(payload, true)
      const item = items.find(
        (candidate) => candidate.role === "tool" && candidate.id === payload.itemId
      )
      if (!item || item.role !== "tool") {
        writeRuntimeLog("chat.toolPayload", "warn", {
          itemId: payload.itemId,
          projectPath: payload.projectPath,
          sessionId: payload.sessionId,
          toolItemCount: items.filter((candidate) => candidate.role === "tool")
            .length,
          totalItems: items.length,
        })
        return { ok: false, error: "没有找到这条工具调用。" }
      }
      return { ok: true, item }
    } catch (error) {
      return {
        ok: false,
        error: errorTextFromUnknown(error, "工具调用详情加载失败。"),
      }
    }
  }

  async function sendChatMessage(
    payload: OusiaChatSendPayload
  ): Promise<OusiaChatSendResult> {
    const attachments = payload.attachments ?? []
    const text = buildPromptWithTextAttachments(payload.prompt, attachments).trim()
    const images = imageContentFromAttachments(attachments)
    const context = {
      projectPath: payload.projectPath,
      sessionId: payload.sessionId,
    }
    const key = sessionKey(context)
    const interruptGeneration = interruptGenerations.get(key) ?? 0
    if (!text && images.length === 0) {
      return { ok: true }
    }
    try {
      const thinkingLevel = requirePiThinkingLevel(payload.thinkingLevel)
      emitChatEvent(
        {
          type: "user_message",
          id: randomId("user"),
          text: payload.prompt.trim(),
          attachments: attachmentSummary(attachments),
          timestamp: now(),
        },
        context
      )
      const bundle = await getAgentSession(
        context,
        payload.model,
        thinkingLevel,
        payload.agentMode,
        payload.customAgentTools,
        payload.autoCompactContext
      )
      await configureSessionBundle(
        bundle,
        payload.model,
        thinkingLevel,
        payload.agentMode,
        payload.customAgentTools,
        payload.autoCompactContext
      )
      setStreamThinkingLevel(key, thinkingLevel)
      const { session } = bundle
      if (images.length && !session.model?.input.includes("image")) {
        throw new Error("当前模型不支持图片输入，请切换到支持识图的模型后重试。")
      }
      if ((interruptGenerations.get(key) ?? 0) !== interruptGeneration) {
        return { ok: true }
      }
      if (session.isStreaming) {
        const streamingBehavior =
          payload.sendBehavior === "followUp" ? "followUp" : "steer"
        await session.prompt(text || "请查看附件图片。", {
          images,
          source: "interactive",
          streamingBehavior,
        })
      } else {
        void session
          .prompt(text || "请查看附件图片。", { images, source: "interactive" })
          .catch((error) => {
            const timestamp = now()
            const text = errorTextFromUnknown(error)
            emitChatEvent(
              {
                type: "error",
                id: randomId("error"),
                text,
                timestamp,
              },
              context
            )
            emitChatEvent(
              { type: "run_status", status: "error", timestamp },
              context
            )
          })
      }
      return { ok: true }
    } catch (error) {
      const timestamp = now()
      const text = errorTextFromUnknown(error)
      emitChatEvent(
        {
          type: "error",
          id: randomId("error"),
          text,
          timestamp,
        },
        context
      )
      emitChatEvent(
        { type: "run_status", status: "error", timestamp },
        context
      )
      return { ok: false, error: text }
    }
  }

  async function interruptChat(
    context: OusiaChatInterruptPayload
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
      const queuedMessages = session.clearQueue()
      await session.abort()
      if (hadActiveWork) {
        const state = streamState.get(key)
        if (state) {
          finishActiveTools(state, context, emitChatEvent)
        }
        emitChatEvent(
          {
            type: "run_status",
            status: "finished",
            text: "已中断",
            timestamp: now(),
          },
          context
        )
      }
      const messagesToContinue = [
        ...queuedMessages.steering,
        ...queuedMessages.followUp,
      ].filter((message) => message.trim())
      if (context.continueQueuedMessages && messagesToContinue.length) {
        const combinedMessage = messagesToContinue.join("\n\n")
        void session.prompt(combinedMessage, { source: "interactive" }).catch(
          (error) => {
            const timestamp = now()
            const text = errorTextFromUnknown(error)
            emitChatEvent(
              {
                type: "error",
                id: randomId("error"),
                text,
                timestamp,
              },
              context
            )
            emitChatEvent(
              { type: "run_status", status: "error", timestamp },
              context
            )
          }
        )
      }
      return { ok: true }
    } catch (error) {
      const text = errorTextFromUnknown(error)
      emitChatEvent(
        {
          type: "error",
          id: randomId("error"),
          text,
          timestamp: now(),
        },
        context
      )
      return { ok: false }
    }
  }

  async function getContextUsage(
    context: OusiaChatContext
  ): Promise<OusiaChatContextUsageResult> {
    const promise = sessionPromises.get(sessionKey(context))
    if (!promise) {
      return { ok: true }
    }
    try {
      const bundle = await promise
      return { ok: true, usage: bundle.session.getContextUsage() }
    } catch (error) {
      return {
        ok: false,
        error: errorTextFromUnknown(error, "上下文信息读取失败。"),
      }
    }
  }

  async function clearChatQueue(
    context: OusiaChatContext
  ): Promise<OusiaChatClearQueueResult> {
    const promise = sessionPromises.get(sessionKey(context))
    if (!promise) {
      return { ok: true }
    }
    try {
      const bundle = await promise
      bundle.session.clearQueue()
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: errorTextFromUnknown(error, "清空队列失败。"),
      }
    }
  }

  async function compactChat(
    payload: OusiaChatCompactPayload
  ): Promise<OusiaChatCompactResult> {
    const context = {
      projectPath: payload.projectPath,
      sessionId: payload.sessionId,
    }
    try {
      const thinkingLevel = requirePiThinkingLevel(payload.thinkingLevel)
      const bundle = await getAgentSession(
        context,
        payload.model,
        thinkingLevel,
        payload.agentMode,
        payload.customAgentTools,
        payload.autoCompactContext
      )
      await configureSessionBundle(
        bundle,
        payload.model,
        thinkingLevel,
        payload.agentMode,
        payload.customAgentTools,
        payload.autoCompactContext
      )
      await bundle.session.compact()
      void emitContextUsage(context, sessionKey(context))
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: errorTextFromUnknown(error, "手动压缩失败。"),
      }
    }
  }

  async function exportChat(
    payload: OusiaChatExportPayload,
    outputPath: string
  ): Promise<OusiaChatExportResult> {
    try {
      if (payload.format === "markdown") {
        const { writeFile } = await import("node:fs/promises")
        await writeFile(outputPath, payload.markdown ?? "", "utf8")
        return { ok: true, path: outputPath }
      }

      const context = {
        projectPath: payload.projectPath,
        sessionId: payload.sessionId,
      }
      const thinkingLevel = requirePiThinkingLevel(payload.thinkingLevel)
      const bundle = await getAgentSession(
        context,
        payload.model,
        thinkingLevel,
        payload.agentMode,
        payload.customAgentTools,
        payload.autoCompactContext
      )
      await configureSessionBundle(
        bundle,
        payload.model,
        thinkingLevel,
        payload.agentMode,
        payload.customAgentTools,
        payload.autoCompactContext,
        payload.autoRetryOnFailure
      )
      const path = await bundle.session.exportToJsonl(outputPath)
      return { ok: true, path }
    } catch (error) {
      return {
        ok: false,
        error: errorTextFromUnknown(error, "导出会话失败。"),
      }
    }
  }

  return {
    branchChat,
    clearChatQueue,
    compactChat,
    exportChat,
    getContextUsage,
    getChatHistory,
    getChatToolPayload,
    interruptChat,
    moveChatSession,
    sendChatMessage,
  }
}
