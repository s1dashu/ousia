import "./pi-package-dir.js"
import { mkdirSync, type Stats } from "node:fs"
import { stat, unlink } from "node:fs/promises"
import { ensurePiPackageDir } from "./pi-package-dir.js"
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ModelRuntime,
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
import {
  createOusiaUserMessageEvent,
  isOusiaPiThinkingLevel,
  requireOusiaChatMessageId,
} from "./chat-types.js"
import { normalizeProviderModelId } from "./model-compat.js"
import { chatMessageIdFingerprint } from "./chat-message-replay-guard.js"
import {
  PiToolInputTracker,
  type PiToolInputCompletionSource,
} from "./pi-tool-input.js"
import { createPiModelRuntime, resolvePiAgentDir } from "./pi-environment.js"
import { createToolFilePreview } from "./tool-file-preview.js"
import { isVercelAiGatewayModelAvailable } from "./vercel-ai-gateway-models.js"
import {
  branchEntriesToHistoryItems,
  buildPromptWithTextAttachments,
  historyItemsFromActivePiSession,
  imageContentFromAttachments,
  shouldShowThinkingForLevel,
  stringifyUnknown,
} from "./agent-conversation-history.js"
import { expandHomePath } from "./host-paths.js"
import {
  createBranchedSessionFile,
  createMovedSessionFile,
  deletePersistedPiSessionFile,
  findBranchLeafId,
  findPiSessionByExactId,
  findPiSessionFileForHistory,
  getDefaultPiSessionDir,
  openOrCreatePiSessionManager,
  piSessionKey as sessionKey,
} from "./pi-session-files.js"
import { describePiFailure, describePiRetry } from "./pi-retry-status.js"
import { writeRuntimeLog } from "./runtime-logger.js"

type AgentSessionBundle = {
  modelRuntime: ModelRuntime
  runtimeApiKeyProvider?: string
  session: AgentSession
  unsubscribe: () => void
}

export function disposePiSessionBundle(
  bundle: Pick<AgentSessionBundle, "session" | "unsubscribe">
) {
  try {
    bundle.unsubscribe()
  } finally {
    bundle.session.dispose()
  }
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

type AgentStreamState = {
  toolInputTracker: PiToolInputTracker
  textId: string
  thinkingId: string
  showThinking: boolean
  currentAssistantMessageId: string
  lastErrorText: string
  pendingErrorText: string
  reconnectStatusVisible: boolean
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

type HistoryCacheEntry = {
  fullItems?: OusiaChatHistoryItem[]
  lightweightItems?: OusiaChatHistoryItem[]
  mtimeMs: number
  sessionFile: string
}

const MAX_HISTORY_CACHE_ENTRIES = 12
const MAX_AGENT_SESSION_ENTRIES = 8
const MAX_SESSION_FILE_CACHE_ENTRIES = 64

function now() {
  return new Date().toISOString()
}

function randomId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createStreamState(
  thinkingLevel: string | undefined = "off"
): AgentStreamState {
  return {
    toolInputTracker: new PiToolInputTracker(),
    textId: "",
    thinkingId: "",
    showThinking: shouldShowThinkingForLevel(thinkingLevel),
    currentAssistantMessageId: "",
    lastErrorText: "",
    pendingErrorText: "",
    reconnectStatusVisible: false,
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
  return (
    state.toolDisplayIdsByProviderId.get(providerToolCallId) ??
    providerToolCallId
  )
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

async function applyRuntimeApiKey(
  bundle: AgentSessionBundle,
  model: OusiaModelSettings
) {
  const nextProvider = model.apiKey ? model.provider : undefined
  if (
    bundle.runtimeApiKeyProvider &&
    bundle.runtimeApiKeyProvider !== nextProvider
  ) {
    await bundle.modelRuntime.removeRuntimeApiKey(bundle.runtimeApiKeyProvider)
  }
  if (model.apiKey) {
    await bundle.modelRuntime.setRuntimeApiKey(model.provider, model.apiKey, {
      allowNetwork: false,
    })
  }
  bundle.runtimeApiKeyProvider = nextProvider
}

async function findConfiguredModel(
  modelRuntime: ModelRuntime,
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
  const selected = modelRuntime.getModel(model.provider, model.modelId)
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
  await applyRuntimeApiKey(bundle, model)
  const selectedModel = await findConfiguredModel(bundle.modelRuntime, model)
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

export function createAgentConversationModule({
  enabledTools,
  emitChatEvent,
}: AgentConversationModuleOptions) {
  const sessionPromises = new Map<string, Promise<AgentSessionBundle>>()
  const historyCache = new Map<string, HistoryCacheEntry>()
  const sessionFileByKey = new Map<string, string>()
  const streamState = new Map<string, AgentStreamState>()
  const interruptGenerations = new Map<string, number>()
  let sessionEvictionQueue: Promise<void> = Promise.resolve()

  function setHistoryCacheEntry(key: string, entry: HistoryCacheEntry) {
    historyCache.delete(key)
    historyCache.set(key, entry)
    while (historyCache.size > MAX_HISTORY_CACHE_ENTRIES) {
      const oldestKey = historyCache.keys().next().value
      if (typeof oldestKey !== "string") {
        break
      }
      historyCache.delete(oldestKey)
    }
  }

  function setSessionFile(key: string, sessionFile: string) {
    sessionFileByKey.delete(key)
    sessionFileByKey.set(key, sessionFile)
    while (sessionFileByKey.size > MAX_SESSION_FILE_CACHE_ENTRIES) {
      const oldestKey = sessionFileByKey.keys().next().value
      if (typeof oldestKey !== "string") {
        break
      }
      sessionFileByKey.delete(oldestKey)
    }
  }

  async function clearSessionRuntimeState(key: string) {
    const sessionPromise = sessionPromises.get(key)
    sessionPromises.delete(key)
    historyCache.delete(key)
    sessionFileByKey.delete(key)
    streamState.delete(key)
    interruptGenerations.delete(key)
    if (sessionPromise) {
      try {
        disposePiSessionBundle(await sessionPromise)
      } catch (error) {
        writeRuntimeLog("pi.session", "error", {
          error: errorTextFromUnknown(error, "Failed to dispose Pi session."),
          key,
        })
      }
    }
  }

  function isSessionBusy(bundle: AgentSessionBundle) {
    return (
      bundle.session.isStreaming ||
      bundle.session.pendingMessageCount > 0 ||
      bundle.session.isBashRunning
    )
  }

  async function enforceSessionCacheLimit() {
    while (sessionPromises.size > MAX_AGENT_SESSION_ENTRIES) {
      let releasedKey: string | undefined
      for (const [key, promise] of sessionPromises) {
        const bundle = await promise.catch(() => undefined)
        if (!bundle || sessionPromises.get(key) !== promise) {
          continue
        }
        if (isSessionBusy(bundle)) {
          continue
        }
        releasedKey = key
        break
      }
      if (!releasedKey) {
        return
      }
      await clearSessionRuntimeState(releasedKey)
      writeRuntimeLog("pi.session", "debug", {
        key: releasedKey,
        message: "Released least-recently-used idle Pi session.",
        retainedSessions: sessionPromises.size,
      })
    }
  }

  function scheduleSessionCacheEnforcement() {
    sessionEvictionQueue = sessionEvictionQueue.then(
      enforceSessionCacheLimit,
      enforceSessionCacheLimit
    )
  }

  function setStreamThinkingLevel(
    key: string,
    thinkingLevel: string | undefined
  ) {
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
    const key = sessionKey(context)
    const activeBundle = await sessionPromises.get(key)?.catch(() => undefined)
    const activeItems = historyItemsFromActivePiSession(
      activeBundle?.session,
      includeToolPayloads
    )
    if (activeItems) {
      writeRuntimeLog("chat.history", "debug", {
        itemCount: activeItems.length,
        message: "Read Pi history from the active in-memory session.",
        sessionId: context.sessionId,
      })
      return activeItems
    }

    let sessionFile = sessionFileByKey.get(key)
    let fileStat: Stats | undefined

    if (sessionFile) {
      try {
        fileStat = await stat(sessionFile)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error
        }
        sessionFileByKey.delete(key)
        sessionFile = undefined
      }
    }

    if (!sessionFile) {
      const lookup = await findPiSessionFileForHistory(context)
      if (!lookup) {
        return []
      }
      sessionFile = lookup.sessionFile
      fileStat = await stat(sessionFile)
    }
    setSessionFile(key, sessionFile)
    if (!fileStat) {
      throw new Error(`Unable to stat Pi session file: ${sessionFile}`)
    }

    const cached = historyCache.get(key)
    const cacheEntry: HistoryCacheEntry =
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
      setHistoryCacheEntry(key, cacheEntry)
      return cacheEntry[cacheField]
    }

    const sessionManager = SessionManager.open(sessionFile)
    const items: OusiaChatHistoryItem[] = []
    branchEntriesToHistoryItems(
      sessionManager.getBranch(),
      items,
      includeToolPayloads
    )
    cacheEntry[cacheField] = items
    setHistoryCacheEntry(key, cacheEntry)
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
    } catch (error) {
      writeRuntimeLog("chat.context_usage", "warn", {
        error: errorTextFromUnknown(error, "Failed to read Pi context usage."),
        message: "Skipped an unavailable informational context usage update.",
        sessionId: context.sessionId,
      })
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
        await Promise.all([
          clearSessionRuntimeState(sourceKey),
          clearSessionRuntimeState(targetKey),
        ])
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

      await Promise.all([
        clearSessionRuntimeState(sourceKey),
        clearSessionRuntimeState(targetKey),
      ])
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
      await clearSessionRuntimeState(
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
    key: string,
    provider?: string,
    modelId?: string
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
    const reconnectStatusId = `pi-reconnect-${context.sessionId}`
    const clearReconnectStatus = () => {
      if (!state.reconnectStatusVisible) {
        return
      }
      state.reconnectStatusVisible = false
      emitChatEvent(
        {
          type: "status_message",
          id: reconnectStatusId,
          status: "removed",
          text: "",
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
      clearReconnectStatus()
      if (state.pendingErrorText) {
        emitError(state.pendingErrorText)
        state.pendingErrorText = ""
        emitChatEvent(
          { type: "run_status", status: "error", timestamp },
          context
        )
        scheduleSessionCacheEnforcement()
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
      state.toolInputTracker.reset()
      state.toolDisplayIdsByContentIndex.clear()
      state.toolDisplayIdsByProviderId.clear()
      state.toolFilePreviewsById.clear()
      state.startedToolIds.clear()
      state.activeToolIds.clear()
      scheduleSessionCacheEnforcement()
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
        state.toolInputTracker.reset()
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
        state.pendingErrorText = describePiFailure({
          errorMessage: errorTextFromUnknown(
            message.errorMessage ?? message.error ?? message,
            "智能体响应失败。"
          ),
          provider,
        }).text
      } else if (message.role === "assistant") {
        state.pendingErrorText = ""
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
      writeRuntimeLog("pi.tool.lifecycle", "debug", {
        phase: "execution_start",
        providerToolCallId: source.toolCallId,
        sessionId: context.sessionId,
        toolCallId: displayId,
        toolName: source.toolName,
      })
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
      writeRuntimeLog("pi.tool.lifecycle", "debug", {
        isError: source.isError ?? false,
        phase: "execution_end",
        providerToolCallId: source.toolCallId,
        sessionId: context.sessionId,
        toolCallId: displayId,
        toolName: source.toolName,
      })
      state.activeToolIds.delete(displayId)
      return
    }
    if (event.type === "auto_retry_start") {
      const retry = event as typeof event & {
        attempt?: number
        maxAttempts?: number
        delayMs?: number
        errorMessage?: string
      }
      const retryStatus = describePiRetry({
        attempt: retry.attempt,
        delayMs: retry.delayMs,
        errorMessage: retry.errorMessage ?? state.pendingErrorText,
        maxAttempts: retry.maxAttempts,
        provider,
      })
      state.reconnectStatusVisible = true
      writeRuntimeLog("pi.retry", "warn", {
        attempt: retry.attempt,
        delayMs: retry.delayMs,
        detail: retryStatus.detail,
        errorCode: retryStatus.errorCode,
        errorType: retryStatus.errorType,
        failureSource: retryStatus.source,
        httpStatus: retryStatus.httpStatus,
        maxAttempts: retry.maxAttempts,
        modelId,
        phase: "start",
        provider,
        sessionId: context.sessionId,
        transportCode: retryStatus.transportCode,
      })
      emitChatEvent(
        {
          type: "status_message",
          id: reconnectStatusId,
          status: "streaming",
          text: retryStatus.text,
          timestamp,
        },
        context
      )
      return
    }
    if (event.type === "auto_retry_end") {
      clearReconnectStatus()
      const finalFailure = event.success
        ? undefined
        : describePiFailure({
            errorMessage: errorTextFromUnknown(
              event.finalError,
              "智能体响应失败。"
            ),
            provider,
          })
      writeRuntimeLog("pi.retry", event.success ? "info" : "error", {
        attempt: event.attempt,
        detail: finalFailure?.detail,
        errorCode: finalFailure?.errorCode,
        errorType: finalFailure?.errorType,
        failureSource: finalFailure?.source,
        httpStatus: finalFailure?.httpStatus,
        modelId,
        phase: "end",
        provider,
        sessionId: context.sessionId,
        success: event.success,
        transportCode: finalFailure?.transportCode,
      })
      if (finalFailure) {
        const text = finalFailure.text
        if (text !== state.lastErrorText) {
          emitError(text)
        }
        emitChatEvent(
          { type: "run_status", status: "error", timestamp },
          context
        )
      } else {
        state.lastErrorText = ""
        state.pendingErrorText = ""
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
      state.toolInputTracker.start(messageEvent.contentIndex)
    }
    if (
      messageEvent.type === "toolcall_delta" &&
      typeof messageEvent.contentIndex === "number" &&
      typeof messageEvent.delta === "string"
    ) {
      const displayId = state.toolDisplayIdsByContentIndex.get(
        messageEvent.contentIndex
      )
      if (
        state.toolInputTracker.receivedDataAfterCompletion(
          displayId,
          messageEvent.delta
        )
      ) {
        writeRuntimeLog("pi.tool.lifecycle", "error", {
          contentIndex: messageEvent.contentIndex,
          message: "Pi tool input received data after JSON completion",
          phase: "input_delta_after_end",
          sessionId: context.sessionId,
          toolCallId: displayId,
        })
      }
      state.toolInputTracker.append(
        messageEvent.contentIndex,
        messageEvent.delta
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
      const rawArguments = state.toolInputTracker.rawArguments(index)
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
      } else {
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
      return { id: toolCallId, name: toolName }
    }

    const emitToolInputEnd = (
      target: { id: string; name: string },
      index: number,
      completionSource: PiToolInputCompletionSource
    ) => {
      emitChatEvent(
        {
          type: "tool_input_end",
          id: target.id,
          timestamp,
        },
        context
      )
      writeRuntimeLog("pi.tool.lifecycle", "debug", {
        completionSource,
        contentIndex: index,
        phase: "input_end",
        sessionId: context.sessionId,
        toolCallId: target.id,
        toolName: target.name,
      })
    }

    if (toolMessage && Array.isArray(toolMessage.content)) {
      toolMessage.content.forEach((part, index) => {
        if (!part || typeof part !== "object") {
          return
        }
        const target = emitToolCallInputUpdate(
          part as Record<string, unknown>,
          index,
          toolMessage.id || message?.id
        )
        const completionSource = target
          ? state.toolInputTracker.finishIfComplete({
              authoritativeEnd:
                messageEvent.type === "toolcall_end" &&
                messageEvent.contentIndex === index,
              contentIndex: index,
              toolCallId: target.id,
            })
          : undefined
        if (target && completionSource) {
          emitToolInputEnd(target, index, completionSource)
        }
      })
    } else if (
      messageEvent.type === "toolcall_end" &&
      typeof messageEvent.contentIndex === "number" &&
      messageEvent.toolCall
    ) {
      const target = emitToolCallInputUpdate(
        { ...messageEvent.toolCall, type: "toolCall" },
        messageEvent.contentIndex,
        message?.id
      )
      const completionSource = target
        ? state.toolInputTracker.finishIfComplete({
            authoritativeEnd: true,
            contentIndex: messageEvent.contentIndex,
            toolCallId: target.id,
          })
        : undefined
      if (target && completionSource) {
        emitToolInputEnd(target, messageEvent.contentIndex, completionSource)
      }
    }

    if (
      messageEvent.type === "toolcall_end" &&
      typeof messageEvent.contentIndex === "number" &&
      !state.toolInputTracker.isComplete(
        state.toolDisplayIdsByContentIndex.get(messageEvent.contentIndex)
      )
    ) {
      writeRuntimeLog("pi.tool.lifecycle", "warn", {
        contentIndex: messageEvent.contentIndex,
        message: "Could not correlate completed Pi tool input",
        phase: "input_end_unmatched",
        sessionId: context.sessionId,
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
      emitError(
        describePiFailure({
          errorMessage: errorTextFromUnknown(
            messageEvent.error,
            "智能体响应失败。"
          ),
          provider,
        }).text
      )
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

    const modelRuntime = await createPiModelRuntime(agentDir)
    const settingsManager = SettingsManager.create(cwd, agentDir)
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
    })
    await resourceLoader.reload()
    if (model.apiKey) {
      await modelRuntime.setRuntimeApiKey(model.provider, model.apiKey, {
        allowNetwork: false,
      })
    }
    const selectedModel =
      model.provider && model.modelId
        ? await findConfiguredModel(modelRuntime, model)
        : undefined

    const { session, modelFallbackMessage } = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime,
      resourceLoader,
      sessionManager: sessionFileByKey.get(key)
        ? SessionManager.open(sessionFileByKey.get(key)!)
        : await openOrCreatePiSessionManager(cwd, context.sessionId),
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
    const sessionFile = session.sessionManager.getSessionFile()
    if (sessionFile) {
      setSessionFile(key, sessionFile)
    }
    const unsubscribe = session.subscribe((event) =>
      translateAgentEvent(
        event,
        context,
        key,
        session.model?.provider,
        session.model?.id
      )
    )
    return {
      modelRuntime,
      runtimeApiKeyProvider: model.apiKey ? model.provider : undefined,
      session,
      unsubscribe,
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
      sessionPromises.delete(key)
      sessionPromises.set(key, existingPromise)
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
    void promise.then(scheduleSessionCacheEnforcement, () => undefined)
    return promise
  }

  async function releaseChatSession(context: OusiaChatContext) {
    await clearSessionRuntimeState(sessionKey(context))
  }

  async function deleteChatSession(context: OusiaChatContext) {
    const key = sessionKey(context)
    const sessionPromise = sessionPromises.get(key)
    if (sessionPromise) {
      const bundle = await sessionPromise
      if (isSessionBusy(bundle)) {
        throw new Error(`Cannot delete active Pi session: ${context.sessionId}`)
      }
    }

    await clearSessionRuntimeState(key)
    const cwd = expandHomePath(context.projectPath)
    const sessionFile = await deletePersistedPiSessionFile(
      cwd,
      context.sessionId
    )
    if (!sessionFile) {
      writeRuntimeLog("pi.session", "info", {
        message:
          "No persisted Pi session file existed during permanent deletion.",
        sessionId: context.sessionId,
      })
      return
    }

    writeRuntimeLog("pi.session", "info", {
      message: "Permanently deleted Pi session file.",
      sessionFile,
      sessionId: context.sessionId,
    })
  }

  async function dispose() {
    const pendingSessions = [...sessionPromises.values()]
    sessionPromises.clear()
    historyCache.clear()
    sessionFileByKey.clear()
    streamState.clear()
    interruptGenerations.clear()

    const settledSessions = await Promise.allSettled(pendingSessions)
    for (const result of settledSessions) {
      if (result.status === "fulfilled") {
        disposePiSessionBundle(result.value)
      }
    }
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
        (candidate) =>
          candidate.role === "tool" && candidate.id === payload.itemId
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
    const text = buildPromptWithTextAttachments(
      payload.prompt,
      attachments
    ).trim()
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
    let messageId: string | undefined
    try {
      messageId = requireOusiaChatMessageId(payload.messageId)
      const thinkingLevel = requirePiThinkingLevel(payload.thinkingLevel)
      writeRuntimeLog("pi.message", "debug", {
        messageIdFingerprint: chatMessageIdFingerprint(messageId),
        sessionId: context.sessionId,
      })
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
        throw new Error(
          "当前模型不支持图片输入，请切换到支持识图的模型后重试。"
        )
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
              createOusiaUserMessageEvent(payload, timestamp, "failed"),
              context
            )
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
      if (messageId) {
        emitChatEvent(
          createOusiaUserMessageEvent(payload, timestamp, "failed"),
          context
        )
      }
      emitChatEvent(
        {
          type: "error",
          id: randomId("error"),
          text,
          timestamp,
        },
        context
      )
      emitChatEvent({ type: "run_status", status: "error", timestamp }, context)
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
        void session
          .prompt(combinedMessage, { source: "interactive" })
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
    deleteChatSession,
    exportChat,
    getContextUsage,
    getChatHistory,
    getChatToolPayload,
    interruptChat,
    moveChatSession,
    releaseChatSession,
    sendChatMessage,
    dispose,
  }
}
