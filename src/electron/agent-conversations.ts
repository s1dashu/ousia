import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { app } from "electron"
import type { ImageContent } from "@earendil-works/pi-ai"
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  CURRENT_SESSION_VERSION,
  type AgentSession,
  type AgentSessionEvent,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent"

import type {
  OusiaChatContext,
  OusiaChatBranchPayload,
  OusiaChatBranchResult,
  OusiaChatEvent,
  OusiaChatHistoryItem,
  OusiaChatHistoryResult,
  OusiaChatInterruptPayload,
  OusiaChatInterruptResult,
  OusiaChatAttachment,
  OusiaAgentToolName,
  OusiaChatContextUsageResult,
  OusiaChatExportPayload,
  OusiaChatExportResult,
  OusiaChatSendPayload,
  OusiaChatSendResult,
  OusiaAgentMode,
  OusiaModelSettings,
  OusiaThinkingLevel,
} from "./chat-types.js"
import { normalizeProviderModelId } from "./model-compat.js"
import { isVercelAiGatewayModelAvailable } from "./vercel-ai-gateway-models.js"
import { writeRuntimeLog } from "./runtime-logger.js"

type AgentSessionBundle = {
  authStorage: AuthStorage
  modelRegistry: ModelRegistry
  runtimeApiKeyProvider?: string
  session: AgentSession
}

type AgentConversationModuleOptions = {
  enabledTools: string[]
  emitChatEvent: (event: OusiaChatEvent, context?: OusiaChatContext) => void
}

type PiSessionEntry = ReturnType<SessionManager["getEntries"]>[number]

const require = createRequire(__filename)

type AgentStreamState = {
  textId: string
  thinkingId: string
  currentAssistantMessageId: string
  toolDisplayIdsByContentIndex: Map<number, string>
  toolDisplayIdsByProviderId: Map<string, string>
  startedToolIds: Set<string>
}

function now() {
  return new Date().toISOString()
}

function randomId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createStreamState(): AgentStreamState {
  return {
    textId: "",
    thinkingId: "",
    currentAssistantMessageId: "",
    toolDisplayIdsByContentIndex: new Map(),
    toolDisplayIdsByProviderId: new Map(),
    startedToolIds: new Set(),
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function markdownToFallbackHtml(markdown: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ousia Chat Export</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      background: #fff;
      color: #1f1f1d;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.7;
    }
    main {
      box-sizing: border-box;
      max-width: 880px;
      margin: 0 auto;
      padding: 48px 28px;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: inherit;
    }
  </style>
</head>
<body>
  <main><pre>${escapeHtml(markdown)}</pre></main>
</body>
</html>
`
}

function ensurePiPackageDirForHtmlExport() {
  if (process.env.PI_PACKAGE_DIR) {
    return
  }
  try {
    const packageEntry = require.resolve("@earendil-works/pi-coding-agent")
    process.env.PI_PACKAGE_DIR = dirname(dirname(packageEntry))
  } catch (error) {
    writeRuntimeLog("chat.export", "warn", {
      reason: "resolve-pi-package-dir-failed",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function safePathSegment(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "default"
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
  thinkingLevel: OusiaThinkingLevel,
  agentMode?: OusiaAgentMode,
  customAgentTools?: OusiaAgentToolName[],
  autoCompactContext?: boolean
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
  items: OusiaChatHistoryItem[]
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
        items.push({
          id:
            typeof block.id === "string"
              ? block.id
              : `${entry.id}-tool-${index}`,
          role: "tool",
          name: typeof block.name === "string" ? block.name : "tool",
          text: input,
          input,
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
    const existing = index >= 0 ? items[index] : undefined
    const resultText = textFromContent(message.content)
    const item: OusiaChatHistoryItem = {
      id: toolCallId,
      role: "tool",
      name:
        typeof message.toolName === "string"
          ? message.toolName
          : existing?.role === "tool"
            ? existing.name
            : "tool",
      text: resultText || (existing?.role === "tool" ? existing.text : ""),
      input: existing?.role === "tool" ? existing.input : undefined,
      output: message.isError ? undefined : resultText,
      errorText: message.isError ? resultText : undefined,
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
      input: command,
      output,
      errorText: message.exitCode === 0 ? undefined : output,
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

async function findRecentPiSessionFile(cwd: string, conversationDir: string) {
  if (!existsSync(conversationDir)) {
    return undefined
  }
  const sessions = await SessionManager.list(cwd, conversationDir)
  return sessions.sort(
    (left, right) => right.modified.getTime() - left.modified.getTime()
  )[0]?.path
}

export function createAgentConversationModule({
  enabledTools,
  emitChatEvent,
}: AgentConversationModuleOptions) {
  const sessionPromises = new Map<string, Promise<AgentSessionBundle>>()
  const streamState = new Map<string, AgentStreamState>()
  const interruptGenerations = new Map<string, number>()

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

  async function branchChat(
    payload: OusiaChatBranchPayload
  ): Promise<OusiaChatBranchResult> {
    const cwd = expandHomePath(payload.projectPath)
    const sourceConversationDir = getConversationDir(payload)
    const sourceSessionFile = await findRecentPiSessionFile(
      cwd,
      sourceConversationDir
    )
    if (!sourceSessionFile) {
      return {
        ok: false,
        error: "当前会话还没有可分支的 pi 历史。",
      }
    }

    try {
      const sourceSessionManager = SessionManager.open(
        sourceSessionFile,
        sourceConversationDir,
        cwd
      )
      const leafId = findBranchLeafId(
        sourceSessionManager,
        payload.messageId,
        payload.messageText
      )
      if (!leafId) {
        return {
          ok: false,
          error: "没有在 pi 会话树中找到这条消息，无法创建真实分支。",
        }
      }

      const targetContext = {
        projectPath: payload.projectPath,
        sessionId: payload.targetSessionId,
      }
      const targetConversationDir = getConversationDir(targetContext)
      const targetFile = createBranchedSessionFile({
        cwd,
        parentSessionFile: sourceSessionFile,
        sourceSessionManager,
        targetConversationDir,
        targetSessionId: payload.targetSessionId,
        leafId,
      })
      sessionPromises.delete(sessionKey(targetContext))
      const targetSessionManager = SessionManager.open(
        targetFile,
        targetConversationDir,
        cwd
      )
      const items: OusiaChatHistoryItem[] = []
      targetSessionManager.getBranch().forEach((entry) => {
        if (entry.type === "message") {
          messageEntryToHistoryItems(entry, items)
        }
      })
      return { ok: true, items }
    } catch (error) {
      writeRuntimeLog("chat.branch", "error", {
        payload,
        sourceSessionFile,
        error,
      })
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
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

    if (event.type === "agent_start") {
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
      emitChatEvent(
        { type: "run_status", status: "finished", timestamp },
        context
      )
      void emitContextUsage(context, key)
      state.textId = ""
      state.thinkingId = ""
      state.currentAssistantMessageId = ""
      state.toolDisplayIdsByContentIndex.clear()
      state.toolDisplayIdsByProviderId.clear()
      state.startedToolIds.clear()
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
        state.toolDisplayIdsByContentIndex.clear()
        state.toolDisplayIdsByProviderId.clear()
        state.startedToolIds.clear()
      }
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
                : "智能体响应失败。",
            timestamp,
          },
          context
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
      emitChatEvent(
        {
          type: "tool_start",
          id: displayId,
          name: source.toolName ?? "tool",
          args: source.args,
          timestamp,
        },
        context
      )
      state.startedToolIds.add(displayId)
      return
    }
    if (event.type === "tool_execution_update") {
      const source = event as unknown as {
        toolCallId?: string
        partialResult?: unknown
        toolName?: string
      }
      const displayId =
        displayToolCallId(state, source.toolCallId) ?? randomId("tool")
      emitChatEvent(
        {
          type: "tool_update",
          id: displayId,
          name: source.toolName,
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
      return
    }
    if (event.type !== "message_update") {
      return
    }

    const messageEvent = (
      event as unknown as {
        message?: {
          role?: string
          id?: string
          content?: unknown
        }
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
    const message = (
      event as unknown as {
        message?: {
          role?: string
          id?: string
          content?: unknown
        }
      }
    ).message

    if (!messageEvent) {
      return
    }

    if (message?.role === "assistant" && Array.isArray(message.content)) {
      message.content.forEach((part, index) => {
        if (!part || typeof part !== "object") {
          return
        }
        const block = part as Record<string, unknown>
        if (block.type !== "toolCall") {
          return
        }
        const providerToolCallId =
          typeof block.id === "string" && block.id ? block.id : undefined
        const existingDisplayId = state.toolDisplayIdsByContentIndex.get(index)
        const toolCallId =
          existingDisplayId ??
          providerToolCallId ??
          `${state.currentAssistantMessageId || message.id || "tool"}-${index}`
        state.toolDisplayIdsByContentIndex.set(index, toolCallId)
        if (providerToolCallId) {
          state.toolDisplayIdsByProviderId.set(providerToolCallId, toolCallId)
        }
        const toolName = typeof block.name === "string" ? block.name : "tool"
        if (!state.startedToolIds.has(toolCallId)) {
          state.startedToolIds.add(toolCallId)
          emitChatEvent(
            {
              type: "tool_start",
              id: toolCallId,
              name: toolName,
              args: block.arguments,
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
            value: block.arguments,
            phase: "input",
            timestamp,
          },
          context
        )
      })
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
      emitChatEvent(
        {
          type: "error",
          id: randomId("error"),
          text: messageEvent.error?.errorMessage ?? "智能体响应失败。",
          timestamp,
        },
        context
      )
      emitChatEvent({ type: "run_status", status: "error", timestamp }, context)
    }
  }

  async function createSession(
    context: OusiaChatContext,
    key: string,
    modelSettings: OusiaModelSettings,
    thinkingLevel: OusiaThinkingLevel,
    agentMode?: OusiaAgentMode,
    customAgentTools?: OusiaAgentToolName[],
    autoCompactContext?: boolean
  ) {
    const cwd = expandHomePath(context.projectPath)
    const userData = app.getPath("userData")
    const agentDir = join(userData, "pi-agent")
    const conversationDir = getConversationDir(context)
    mkdirSync(cwd, { recursive: true })
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
        ? await findConfiguredModel(modelRegistry, model)
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
    thinkingLevel: OusiaThinkingLevel,
    agentMode?: OusiaAgentMode,
    customAgentTools?: OusiaAgentToolName[],
    autoCompactContext?: boolean
  ) {
    const key = sessionKey(context)
    if (!sessionPromises.has(key)) {
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
    }
    return sessionPromises.get(key)!
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
                ? `会话历史加载失败：${error.message}`
                : "会话历史加载失败。",
          },
        ],
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
    try {
      const bundle = await getAgentSession(
        context,
        payload.model,
        payload.thinkingLevel,
        payload.agentMode,
        payload.customAgentTools,
        payload.autoCompactContext
      )
      await configureSessionBundle(
        bundle,
        payload.model,
        payload.thinkingLevel,
        payload.agentMode,
        payload.customAgentTools,
        payload.autoCompactContext
      )
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
            emitChatEvent(
              {
                type: "error",
                id: randomId("error"),
                text: error instanceof Error ? error.message : String(error),
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
      emitChatEvent(
        {
          type: "error",
          id: randomId("error"),
          text: error instanceof Error ? error.message : String(error),
          timestamp,
        },
        context
      )
      emitChatEvent(
        { type: "run_status", status: "error", timestamp },
        context
      )
      return { ok: false }
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
        emitChatEvent(
          {
            type: "run_status",
            status: "finished",
            text: "已中断智能体。",
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
            emitChatEvent(
              {
                type: "error",
                id: randomId("error"),
                text: error instanceof Error ? error.message : String(error),
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
        error: error instanceof Error ? error.message : String(error),
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
      const bundle = await getAgentSession(
        context,
        payload.model,
        payload.thinkingLevel,
        payload.agentMode,
        payload.customAgentTools,
        payload.autoCompactContext
      )
      await configureSessionBundle(
        bundle,
        payload.model,
        payload.thinkingLevel,
        payload.agentMode,
        payload.customAgentTools,
        payload.autoCompactContext
      )
      if (payload.format === "html") {
        ensurePiPackageDirForHtmlExport()
      }
      const path =
        payload.format === "html"
          ? await bundle.session.exportToHtml(outputPath)
          : bundle.session.exportToJsonl(outputPath)
      return { ok: true, path }
    } catch (error) {
      if (payload.format === "html" && payload.markdown !== undefined) {
        try {
          const { writeFile } = await import("node:fs/promises")
          await writeFile(outputPath, markdownToFallbackHtml(payload.markdown), "utf8")
          writeRuntimeLog("chat.export", "warn", {
            fallback: "html-from-markdown",
            outputPath,
            originalError: error instanceof Error ? error.message : String(error),
            projectPath: payload.projectPath,
            sessionId: payload.sessionId,
          })
          return { ok: true, path: outputPath }
        } catch (fallbackError) {
          writeRuntimeLog("chat.export", "error", {
            fallback: "html-from-markdown",
            outputPath,
            originalError: error instanceof Error ? error.message : String(error),
            fallbackError:
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError),
            projectPath: payload.projectPath,
            sessionId: payload.sessionId,
          })
        }
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    branchChat,
    exportChat,
    getContextUsage,
    getChatHistory,
    interruptChat,
    sendChatMessage,
  }
}
