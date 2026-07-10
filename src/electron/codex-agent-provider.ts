import { writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

import {
  createCodexAppServerClient,
  resolveCodexNativeBinary,
  type CodexAppServerClient,
  type CodexAppServerNotification,
  type CodexAppServerRequest,
  type CodexNativeBinaryResolution,
} from "./codex-app-server-client.js"
import {
  bindAppStateSessionAgentThread,
  loadAppState,
} from "./app-state-store.js"
import type { AgentConversationProvider } from "./agent-provider-router.js"
import type {
  OusiaAgentMode,
  OusiaAvailableModel,
  OusiaChatAttachment,
  OusiaChatAttachmentSummary,
  OusiaChatBranchPayload,
  OusiaChatCompactPayload,
  OusiaChatContext,
  OusiaChatEvent,
  OusiaChatExportPayload,
  OusiaChatGenerateTitlePayload,
  OusiaChatGenerateTitleResult,
  OusiaChatHistoryItem,
  OusiaChatHistoryPayload,
  OusiaChatInterruptPayload,
  OusiaChatMovePayload,
  OusiaChatSendPayload,
  OusiaChatToolFilePreview,
  OusiaChatToolPayloadPayload,
  OusiaCodexAccount,
  OusiaCodexAuthResult,
  OusiaCodexEnvironmentStatus,
  OusiaCodexReasoningEffort,
} from "./chat-types.js"
import { expandHomePath } from "./host-paths.js"
import { writeRuntimeLog } from "./runtime-logger.js"

type JsonObject = Record<string, unknown>

type CodexUserInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "image"; url: string }

type CodexThreadItem = JsonObject & {
  id: string
  type: string
}

type CodexTurn = JsonObject & {
  completedAt?: number | null
  error?: unknown
  id: string
  items: CodexThreadItem[]
  startedAt?: number | null
  status: string
}

type CodexThread = JsonObject & {
  id: string
  turns: CodexTurn[]
}

type ActiveTurn = {
  context: OusiaChatContext
  threadId: string
  turnId: string
}

type QueuedTurn = {
  inputs: CodexUserInput[]
  payload: OusiaChatSendPayload
}

type CodexAgentProviderOptions = {
  client?: CodexAppServerClient
  clientVersion?: string
  emitChatEvent: (event: OusiaChatEvent, context?: OusiaChatContext) => void
  nativeBinaryResolver?: () => CodexNativeBinaryResolution
  openExternal?: (url: string) => Promise<unknown>
}

const CODEX_PROVIDER_NAME = "Codex"
const CODEX_PROVIDER_ID = "codex"
const TITLE_TIMEOUT_MS = 60_000
const LOGIN_TIMEOUT_MS = 5 * 60_000
const COMPACT_TIMEOUT_MS = 2 * 60_000

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function errorText(error: unknown, fallback = "Codex 操作失败。") {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  const text = String(error).trim()
  return text && text !== "[object Object]" ? text : fallback
}

function now() {
  return new Date().toISOString()
}

function randomId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function sessionKey(context: OusiaChatContext) {
  return `${context.projectPath}::${context.sessionId}`
}

function absoluteProjectPath(projectPath: string) {
  return resolve(expandHomePath(projectPath))
}

function timestampFromTurn(turn: CodexTurn) {
  const seconds = numberValue(turn.completedAt) ?? numberValue(turn.startedAt)
  return seconds === undefined
    ? undefined
    : new Date(seconds * 1000).toISOString()
}

function parseThread(value: unknown): CodexThread {
  if (!isObject(value) || typeof value.id !== "string") {
    throw new Error("Codex returned an invalid thread payload.")
  }
  const turns = Array.isArray(value.turns) ? value.turns.map(parseTurn) : []
  return { ...value, id: value.id, turns }
}

function parseTurn(value: unknown): CodexTurn {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.status !== "string"
  ) {
    throw new Error("Codex returned an invalid turn payload.")
  }
  const items = Array.isArray(value.items)
    ? value.items.map(parseThreadItem)
    : []
  return { ...value, id: value.id, items, status: value.status }
}

function parseThreadItem(value: unknown): CodexThreadItem {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string"
  ) {
    throw new Error("Codex returned an invalid thread item payload.")
  }
  return { ...value, id: value.id, type: value.type }
}

function filePreviewFromChanges(
  value: unknown
): OusiaChatToolFilePreview | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const changes = value.filter(isObject)
  const patch = changes
    .map((change) => stringValue(change.diff))
    .filter((diff): diff is string => Boolean(diff))
    .join("\n")
  const path = stringValue(changes[0]?.path)
  return patch
    ? { kind: "patch", patch, ...(path ? { path } : {}), source: "result" }
    : undefined
}

function joinedReasoning(item: CodexThreadItem) {
  const summary = Array.isArray(item.summary)
    ? item.summary.filter((value): value is string => typeof value === "string")
    : []
  const content = Array.isArray(item.content)
    ? item.content.filter((value): value is string => typeof value === "string")
    : []
  return [...summary, ...content].join("\n\n")
}

function attachmentSummaryFromCodexInput(
  input: JsonObject,
  itemId: string,
  index: number
): OusiaChatAttachmentSummary | undefined {
  if (input.type !== "image" && input.type !== "localImage") {
    return undefined
  }
  const url = stringValue(input.url)
  const path = stringValue(input.path)
  const mediaType = url?.match(/^data:([^;,]+)/)?.[1] ?? "image/*"
  const dataBase64 = url?.match(/^data:[^;,]+;base64,(.*)$/)?.[1]
  return {
    id: `${itemId}-image-${index}`,
    kind: "image",
    mediaType,
    name: path ? basename(path) : `image-${index + 1}`,
    size: dataBase64 ? Buffer.byteLength(dataBase64, "base64") : 0,
    ...(dataBase64 ? { dataBase64 } : {}),
  }
}

function userHistoryItem(
  item: CodexThreadItem,
  timestamp: string | undefined
): OusiaChatHistoryItem {
  const content = Array.isArray(item.content)
    ? item.content.filter(isObject)
    : []
  const text = content
    .filter((input) => input.type === "text")
    .map((input) => stringValue(input.text) ?? "")
    .filter(Boolean)
    .join("\n\n")
  const attachments = content
    .map((input, index) =>
      attachmentSummaryFromCodexInput(input, item.id, index)
    )
    .filter((value): value is OusiaChatAttachmentSummary => Boolean(value))
  return {
    id: item.id,
    role: "user",
    text,
    ...(attachments.length ? { attachments } : {}),
    ...(timestamp ? { timestamp } : {}),
    status: "finished",
  }
}

function toolHistoryItem(
  item: CodexThreadItem,
  includePayloads: boolean
): Extract<OusiaChatHistoryItem, { role: "tool" }> | undefined {
  let name: string
  let text: string
  let input: unknown
  let output: unknown
  let error: unknown
  let filePreview: OusiaChatToolFilePreview | undefined
  let failed = false

  if (item.type === "commandExecution") {
    name = "bash"
    text = stringValue(item.command) ?? "Command"
    input = { command: item.command, cwd: item.cwd }
    output = item.aggregatedOutput
    const exitCode = numberValue(item.exitCode)
    failed =
      item.status === "failed" || (exitCode !== undefined && exitCode !== 0)
  } else if (item.type === "fileChange") {
    name = "edit"
    text = "File changes"
    input = item.changes
    output = { status: item.status }
    filePreview = filePreviewFromChanges(item.changes)
    failed = item.status === "failed" || item.status === "declined"
  } else if (item.type === "mcpToolCall") {
    const server = stringValue(item.server) ?? "mcp"
    const tool = stringValue(item.tool) ?? "tool"
    name = `${server}/${tool}`
    text = name
    input = item.arguments
    output = item.result
    error = item.error
    failed = item.status === "failed" || Boolean(error)
  } else if (item.type === "dynamicToolCall") {
    name = stringValue(item.tool) ?? "tool"
    text = name
    input = item.arguments
    output = item.contentItems
    failed = item.status === "failed" || item.success === false
  } else if (item.type === "webSearch") {
    name = "web_search"
    text = stringValue(item.query) ?? "Web search"
    input = { query: item.query }
    output = item.action
  } else if (item.type === "collabAgentToolCall") {
    name = `agent/${stringValue(item.tool) ?? "collaboration"}`
    text = name
    input = { prompt: item.prompt, receiverThreadIds: item.receiverThreadIds }
    output = item.agentsStates
    failed = item.status === "failed"
  } else if (item.type === "imageView") {
    name = "view_image"
    text = stringValue(item.path) ?? "View image"
    input = { path: item.path }
  } else if (item.type === "imageGeneration") {
    name = "image_generation"
    text = "Image generation"
    input = { revisedPrompt: item.revisedPrompt }
    output = { result: item.result, savedPath: item.savedPath }
    failed = item.status === "failed"
  } else {
    return undefined
  }

  return {
    id: item.id,
    role: "tool",
    name,
    text,
    ...(includePayloads
      ? {
          ...(input === undefined
            ? {}
            : { input: JSON.stringify(input, null, 2) }),
          ...(output === undefined || output === null
            ? {}
            : {
                output:
                  typeof output === "string"
                    ? output
                    : JSON.stringify(output, null, 2),
              }),
          ...(error === undefined || error === null
            ? {}
            : {
                errorText:
                  typeof error === "string"
                    ? error
                    : JSON.stringify(error, null, 2),
              }),
        }
      : { payloadOmitted: true }),
    ...(filePreview ? { filePreview } : {}),
    status: failed
      ? "failed"
      : item.status === "inProgress" || item.status === "in_progress"
        ? "running"
        : "finished",
  }
}

function historyItemFromCodexItem(
  item: CodexThreadItem,
  timestamp: string | undefined,
  includePayloads: boolean
): OusiaChatHistoryItem | undefined {
  if (item.type === "userMessage") {
    return userHistoryItem(item, timestamp)
  }
  if (item.type === "agentMessage") {
    return {
      id: item.id,
      role: "assistant",
      text: stringValue(item.text) ?? "",
      ...(timestamp ? { timestamp } : {}),
      status: "finished",
    }
  }
  if (item.type === "reasoning" || item.type === "plan") {
    return {
      id: item.id,
      role: "thinking",
      text:
        item.type === "plan"
          ? (stringValue(item.text) ?? "")
          : joinedReasoning(item),
      ...(timestamp ? { timestamp } : {}),
      status: "finished",
    }
  }
  if (item.type === "contextCompaction") {
    return {
      id: item.id,
      role: "system",
      text: "Context compacted",
      ...(timestamp ? { timestamp } : {}),
      status: "finished",
    }
  }
  return toolHistoryItem(item, includePayloads)
}

export function codexThreadToHistory(
  thread: CodexThread,
  includePayloads = false
) {
  const items: OusiaChatHistoryItem[] = []
  for (const turn of thread.turns) {
    const timestamp = timestampFromTurn(turn)
    for (const item of turn.items) {
      const historyItem = historyItemFromCodexItem(
        item,
        timestamp,
        includePayloads
      )
      if (historyItem) {
        items.push(historyItem)
      }
    }
  }
  return items
}

function paginateHistory(
  allItems: OusiaChatHistoryItem[],
  payload: OusiaChatHistoryPayload
) {
  const requestedLimit = Math.floor(payload.limit ?? 20)
  const limit = Math.max(1, Math.min(requestedLimit, 200))
  const cursorIndex = payload.beforeItemId
    ? allItems.findIndex((item) => item.id === payload.beforeItemId)
    : allItems.length
  if (payload.beforeItemId && cursorIndex < 0) {
    throw new Error(`Unknown Codex history cursor: ${payload.beforeItemId}`)
  }
  const end = cursorIndex
  const start = Math.max(0, end - limit)
  const items = allItems.slice(start, end)
  return {
    hasMore: start > 0,
    items,
    ...(start > 0 && items[0] ? { nextCursor: items[0].id } : {}),
    totalItems: allItems.length,
  }
}

function textForQueuedInput(inputs: CodexUserInput[]) {
  return inputs
    .filter(
      (input): input is Extract<CodexUserInput, { type: "text" }> =>
        input.type === "text"
    )
    .map((input) => input.text)
    .join("\n\n")
}

function attachmentSummary(attachment: OusiaChatAttachment) {
  return {
    id: attachment.id,
    kind: attachment.kind,
    mediaType: attachment.mediaType,
    name: attachment.name,
    size: attachment.size,
    ...(attachment.kind === "image"
      ? { dataBase64: attachment.dataBase64 }
      : {}),
  } satisfies OusiaChatAttachmentSummary
}

function codexInputs(payload: OusiaChatSendPayload): CodexUserInput[] {
  const attachments = payload.attachments ?? []
  const textParts = [payload.prompt.trim()]
  for (const attachment of attachments) {
    if (attachment.kind === "text") {
      textParts.push(
        `<attachment name=${JSON.stringify(attachment.name)}>\n${attachment.text}\n</attachment>`
      )
    } else if (attachment.kind === "file") {
      textParts.push(
        `[Attached file: ${attachment.name} (${attachment.mediaType})]`
      )
    }
  }
  const text = textParts.filter(Boolean).join("\n\n") || "请查看附件图片。"
  return [
    { type: "text", text, text_elements: [] },
    ...attachments
      .filter(
        (
          attachment
        ): attachment is Extract<OusiaChatAttachment, { kind: "image" }> =>
          attachment.kind === "image"
      )
      .map((attachment) => ({
        type: "image" as const,
        url: `data:${attachment.mediaType};base64,${attachment.dataBase64}`,
      })),
  ]
}

function reasoningEffort(level: string): OusiaCodexReasoningEffort {
  const normalized = level.trim()
  if (!normalized) {
    throw new Error(`Unsupported Codex reasoning effort: ${level || "empty"}`)
  }
  return normalized
}

function sandboxForMode(mode: OusiaAgentMode | undefined) {
  if (mode === "noTerminal" || mode === "custom") {
    throw new Error(
      `Codex does not support Ousia's ${mode} permission mode. Choose Standard or Read-only.`
    )
  }
  return mode === "readOnly" ? "read-only" : "workspace-write"
}

function modelFields(modelId: string) {
  const model = modelId.trim()
  return model ? { model } : {}
}

function threadIdFromParams(params: unknown) {
  return isObject(params) ? stringValue(params.threadId) : undefined
}

function itemFromParams(params: unknown) {
  if (!isObject(params)) {
    return undefined
  }
  return parseThreadItem(params.item)
}

function modelThinkingMetadata(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Codex model has no supported reasoning efforts.")
  }
  const levels: string[] = []
  const descriptions: Record<string, string> = {}
  for (const option of value) {
    if (!isObject(option)) {
      throw new Error("Codex returned a malformed reasoning effort option.")
    }
    const level = stringValue(option.reasoningEffort)?.trim()
    const description = stringValue(option.description)?.trim()
    if (!level || !description) {
      throw new Error("Codex returned a malformed reasoning effort option.")
    }
    if (levels.includes(level)) {
      throw new Error(`Codex returned a duplicate reasoning effort: ${level}`)
    }
    levels.push(level)
    descriptions[level] = description
  }
  return { descriptions, levels }
}

function mapCodexModels(value: unknown) {
  if (!isObject(value) || !Array.isArray(value.data)) {
    throw new Error("Codex returned an invalid model list.")
  }
  const models: OusiaAvailableModel[] = []
  const modelIds = new Set<string>()
  let defaultModelId: string | undefined
  for (const entry of value.data) {
    if (!isObject(entry)) {
      throw new Error("Codex returned a malformed model entry.")
    }
    const modelId = stringValue(entry.model)?.trim()
    if (!modelId) {
      throw new Error("Codex returned a model without an id.")
    }
    if (modelIds.has(modelId)) {
      throw new Error(`Codex returned a duplicate model id: ${modelId}`)
    }
    modelIds.add(modelId)
    if (typeof entry.isDefault !== "boolean") {
      throw new Error(`Codex model ${modelId} has an invalid default marker.`)
    }
    if (entry.isDefault === true) {
      if (defaultModelId) {
        throw new Error(
          `Codex returned multiple default models: ${defaultModelId}, ${modelId}`
        )
      }
      defaultModelId = modelId
    }
    const modalities = Array.isArray(entry.inputModalities)
      ? entry.inputModalities
      : []
    const thinkingMetadata = modelThinkingMetadata(
      entry.supportedReasoningEfforts
    )
    const defaultThinkingLevel = stringValue(
      entry.defaultReasoningEffort
    )?.trim()
    if (
      !defaultThinkingLevel ||
      !thinkingMetadata.levels.includes(defaultThinkingLevel)
    ) {
      throw new Error(
        `Codex model ${modelId} returned an invalid default reasoning effort.`
      )
    }
    models.push({
      provider: CODEX_PROVIDER_ID,
      providerName: CODEX_PROVIDER_NAME,
      modelId,
      name: stringValue(entry.displayName) ?? modelId,
      label: stringValue(entry.displayName) ?? modelId,
      input: [
        "text",
        ...(modalities.includes("image") ? (["image"] as const) : []),
      ],
      thinkingLevels: thinkingMetadata.levels,
      defaultThinkingLevel,
      thinkingLevelDescriptions: thinkingMetadata.descriptions,
    })
  }
  if (models.length === 0) {
    throw new Error("Codex returned an empty model list.")
  }
  if (!defaultModelId) {
    throw new Error("Codex returned no default model.")
  }
  return { defaultModelId, models }
}

function mapCodexAccount(value: unknown): OusiaCodexAccount | null {
  if (!isObject(value)) {
    return null
  }
  if (value.type === "apiKey") {
    return { type: "apiKey" }
  }
  if (value.type === "chatgpt") {
    return {
      type: "chatgpt",
      ...(stringValue(value.email) ? { email: stringValue(value.email) } : {}),
      ...(stringValue(value.planType)
        ? { planType: stringValue(value.planType) }
        : {}),
    }
  }
  return null
}

function codexVersion(userAgent: string) {
  return userAgent.match(/Codex(?: Desktop| CLI)?\/([^\s]+)/i)?.[1]
}

export function createCodexAgentProvider({
  client: injectedClient,
  clientVersion,
  emitChatEvent,
  nativeBinaryResolver = resolveCodexNativeBinary,
  openExternal,
}: CodexAgentProviderOptions) {
  const client =
    injectedClient ??
    createCodexAppServerClient({ clientVersion: clientVersion ?? "0.0.0" })
  const contextByThreadId = new Map<string, OusiaChatContext>()
  const activeBySessionKey = new Map<string, ActiveTurn>()
  const activeByThreadId = new Map<string, ActiveTurn>()
  const pendingStartContextByThreadId = new Map<string, OusiaChatContext>()
  const completedPendingTurnKeys = new Set<string>()
  const queuedBySessionKey = new Map<string, QueuedTurn[]>()
  const continueQueueAfterInterrupt = new Map<string, boolean>()
  const usageBySessionKey = new Map<
    string,
    { tokens: number | null; contextWindow: number; percent: number | null }
  >()
  const unhandledItemTypes = new Set<string>()
  const modelById = new Map<string, OusiaAvailableModel>()
  let defaultModelId: string | undefined

  function log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    fields: JsonObject = {}
  ) {
    writeRuntimeLog("codex.provider", level, message, fields)
  }

  function rememberModelCatalog(catalog: ReturnType<typeof mapCodexModels>) {
    modelById.clear()
    for (const model of catalog.models) {
      modelById.set(model.modelId, model)
    }
    defaultModelId = catalog.defaultModelId
  }

  async function refreshModelCatalog() {
    const response = await client.request("model/list", {
      includeHidden: false,
      limit: 100,
    })
    const catalog = mapCodexModels(response)
    rememberModelCatalog(catalog)
    return catalog
  }

  async function resolveCatalogModel(modelId: string) {
    const requestedModelId = modelId.trim()
    let selectedModel = requestedModelId
      ? modelById.get(requestedModelId)
      : defaultModelId
        ? modelById.get(defaultModelId)
        : undefined
    if (!selectedModel) {
      const catalog = await refreshModelCatalog()
      const resolvedModelId = requestedModelId || catalog.defaultModelId
      selectedModel = resolvedModelId
        ? modelById.get(resolvedModelId)
        : undefined
    }
    if (!selectedModel) {
      throw new Error(
        `Codex model is unavailable: ${requestedModelId || "default"}`
      )
    }
    return selectedModel
  }

  async function validateReasoningEffort(modelId: string, effort: string) {
    const normalizedEffort = reasoningEffort(effort)
    const selectedModel = await resolveCatalogModel(modelId)
    if (!selectedModel.thinkingLevels.includes(normalizedEffort)) {
      throw new Error(
        `Codex model ${selectedModel.modelId} does not support reasoning effort ${normalizedEffort}.`
      )
    }
    return normalizedEffort
  }

  async function defaultReasoningEffort(modelId: string) {
    const selectedModel = await resolveCatalogModel(modelId)
    if (!selectedModel.defaultThinkingLevel) {
      throw new Error(
        `Codex model ${selectedModel.modelId} has no default reasoning effort.`
      )
    }
    return reasoningEffort(selectedModel.defaultThinkingLevel)
  }

  function emitForThread(threadId: string, event: OusiaChatEvent) {
    const context = contextByThreadId.get(threadId)
    if (context) {
      emitChatEvent(event, context)
    }
  }

  async function canonicalSession(context: OusiaChatContext) {
    const state = await loadAppState()
    const session = state.sessions.find(
      (candidate) => candidate.id === context.sessionId
    )
    if (!session) {
      throw new Error(`Unknown session: ${context.sessionId}`)
    }
    if (session.agentProvider !== "codex") {
      throw new Error(
        `Session ${context.sessionId} belongs to ${session.agentProvider}, not Codex.`
      )
    }
    return session
  }

  async function readThread(threadId: string) {
    const response = await client.request<{ thread?: unknown }>("thread/read", {
      includeTurns: true,
      threadId,
    })
    return parseThread(response.thread)
  }

  async function ensureThread(
    payload:
      | OusiaChatSendPayload
      | OusiaChatCompactPayload
      | OusiaChatExportPayload
  ) {
    const context = {
      projectPath: payload.projectPath,
      sessionId: payload.sessionId,
    }
    const session = await canonicalSession(context)
    const cwd = absoluteProjectPath(context.projectPath)
    const sandbox = sandboxForMode(payload.agentMode)
    let thread: CodexThread
    if (session.agentThreadId) {
      const response = await client.request<{ thread?: unknown }>(
        "thread/resume",
        {
          threadId: session.agentThreadId,
          cwd,
          approvalPolicy: "never",
          sandbox,
          ...modelFields(payload.model.modelId),
        }
      )
      thread = parseThread(response.thread)
    } else {
      const response = await client.request<{ thread?: unknown }>(
        "thread/start",
        {
          cwd,
          approvalPolicy: "never",
          sandbox,
          ephemeral: false,
          threadSource: "ousia_desktop",
          ...modelFields(payload.model.modelId),
        }
      )
      thread = parseThread(response.thread)
      const bindResult = await bindAppStateSessionAgentThread({
        agentThreadId: thread.id,
        sessionId: context.sessionId,
      })
      if (!bindResult.ok) {
        throw new Error(bindResult.error)
      }
      log("info", "Bound Ousia session to Codex thread", {
        sessionId: context.sessionId,
        threadId: thread.id,
      })
    }
    contextByThreadId.set(thread.id, context)
    return { context, session, thread }
  }

  function emitQueue(context: OusiaChatContext) {
    const queued = queuedBySessionKey.get(sessionKey(context)) ?? []
    emitChatEvent(
      {
        type: "queue_update",
        steering: [],
        followUp: queued.map((entry) => textForQueuedInput(entry.inputs)),
        timestamp: now(),
      },
      context
    )
  }

  function emitUserMessage(payload: OusiaChatSendPayload) {
    emitChatEvent(
      {
        type: "user_message",
        id: randomId("codex-user"),
        text: payload.prompt,
        ...(payload.attachments?.length
          ? { attachments: payload.attachments.map(attachmentSummary) }
          : {}),
        timestamp: now(),
      },
      { projectPath: payload.projectPath, sessionId: payload.sessionId }
    )
  }

  async function startTurn(
    payload: OusiaChatSendPayload,
    inputs: CodexUserInput[],
    shouldEmitUser: boolean
  ) {
    sandboxForMode(payload.agentMode)
    const effort = await validateReasoningEffort(
      payload.model.modelId,
      payload.thinkingLevel
    )
    const { context, thread } = await ensureThread(payload)
    const key = sessionKey(context)
    if (activeBySessionKey.has(key)) {
      throw new Error("Codex already has an active turn for this session.")
    }
    if (shouldEmitUser) {
      emitUserMessage(payload)
    }
    emitChatEvent(
      { type: "run_status", status: "starting", timestamp: now() },
      context
    )
    pendingStartContextByThreadId.set(thread.id, context)
    let turn: CodexTurn
    try {
      const response = await client.request<{ turn?: unknown }>("turn/start", {
        threadId: thread.id,
        input: inputs,
        effort,
        cwd: absoluteProjectPath(payload.projectPath),
        approvalPolicy: "never",
        sandboxPolicy:
          sandboxForMode(payload.agentMode) === "read-only"
            ? { type: "readOnly", networkAccess: false }
            : {
                type: "workspaceWrite",
                writableRoots: [absoluteProjectPath(payload.projectPath)],
                networkAccess: true,
                excludeTmpdirEnvVar: false,
                excludeSlashTmp: false,
              },
        ...modelFields(payload.model.modelId),
      })
      turn = parseTurn(response.turn)
    } finally {
      pendingStartContextByThreadId.delete(thread.id)
    }
    const completedKey = `${thread.id}:${turn.id}`
    if (!completedPendingTurnKeys.delete(completedKey)) {
      const active = { context, threadId: thread.id, turnId: turn.id }
      activeBySessionKey.set(key, active)
      activeByThreadId.set(thread.id, active)
    }
    log("info", "Started Codex turn", {
      sessionId: context.sessionId,
      threadId: thread.id,
      turnId: turn.id,
    })
  }

  async function startNextQueuedTurn(context: OusiaChatContext) {
    const key = sessionKey(context)
    if (activeBySessionKey.has(key)) {
      return
    }
    const queue = queuedBySessionKey.get(key) ?? []
    const next = queue.shift()
    if (!queue.length) {
      queuedBySessionKey.delete(key)
    }
    emitQueue(context)
    if (!next) {
      return
    }
    try {
      await startTurn(next.payload, next.inputs, false)
    } catch (error) {
      const text = errorText(error)
      emitChatEvent(
        { type: "error", id: randomId("codex-error"), text, timestamp: now() },
        context
      )
      emitChatEvent(
        { type: "run_status", status: "error", text, timestamp: now() },
        context
      )
    }
  }

  function handleItemStarted(threadId: string, item: CodexThreadItem) {
    const timestamp = now()
    if (item.type === "agentMessage") {
      emitForThread(threadId, {
        type: "assistant_text_start",
        id: item.id,
        timestamp,
      })
      return
    }
    if (item.type === "reasoning" || item.type === "plan") {
      emitForThread(threadId, {
        type: "thinking_start",
        id: item.id,
        timestamp,
      })
      return
    }
    const tool = toolHistoryItem(item, true)
    if (tool) {
      emitForThread(threadId, {
        type: "tool_start",
        id: item.id,
        name: tool.name,
        ...(tool.input ? { args: JSON.parse(tool.input) } : {}),
        ...(tool.filePreview ? { filePreview: tool.filePreview } : {}),
        timestamp,
      })
      return
    }
    if (item.type !== "userMessage" && item.type !== "contextCompaction") {
      if (!unhandledItemTypes.has(item.type)) {
        unhandledItemTypes.add(item.type)
        log("warn", "Unhandled Codex item type", {
          itemType: item.type,
          threadId,
        })
      }
    }
  }

  function handleItemCompleted(threadId: string, item: CodexThreadItem) {
    const timestamp = now()
    if (item.type === "agentMessage") {
      emitForThread(threadId, {
        type: "assistant_text_end",
        id: item.id,
        text: stringValue(item.text) ?? "",
        timestamp,
      })
      return
    }
    if (item.type === "reasoning" || item.type === "plan") {
      emitForThread(threadId, {
        type: "thinking_end",
        id: item.id,
        text:
          item.type === "plan"
            ? (stringValue(item.text) ?? "")
            : joinedReasoning(item),
        timestamp,
      })
      return
    }
    const tool = toolHistoryItem(item, true)
    if (tool) {
      emitForThread(threadId, {
        type: "tool_end",
        id: item.id,
        name: tool.name,
        ...(tool.filePreview ? { filePreview: tool.filePreview } : {}),
        result: tool.output,
        isError: tool.status === "failed",
        timestamp,
      })
    }
  }

  function notificationHandler(notification: CodexAppServerNotification) {
    const params = notification.params
    const threadId = threadIdFromParams(params)
    if (!threadId) {
      return
    }
    const timestamp = now()
    if (notification.method === "turn/started") {
      const paramsObject = isObject(params) ? params : undefined
      const turn =
        paramsObject && isObject(paramsObject.turn)
          ? parseTurn(paramsObject.turn)
          : undefined
      const context = contextByThreadId.get(threadId)
      if (turn && context) {
        const active = { context, threadId, turnId: turn.id }
        activeBySessionKey.set(sessionKey(context), active)
        activeByThreadId.set(threadId, active)
      }
      emitForThread(threadId, {
        type: "run_status",
        status: "running",
        timestamp,
      })
      return
    }
    if (notification.method === "item/started") {
      handleItemStarted(threadId, itemFromParams(params)!)
      return
    }
    if (notification.method === "item/completed") {
      handleItemCompleted(threadId, itemFromParams(params)!)
      return
    }
    if (!isObject(params)) {
      return
    }
    const itemId = stringValue(params.itemId)
    const delta = stringValue(params.delta)
    if (notification.method === "item/agentMessage/delta" && itemId && delta) {
      emitForThread(threadId, {
        type: "assistant_text_delta",
        id: itemId,
        delta,
        timestamp,
      })
      return
    }
    if (
      (notification.method === "item/reasoning/summaryTextDelta" ||
        notification.method === "item/reasoning/textDelta" ||
        notification.method === "item/plan/delta") &&
      itemId &&
      delta
    ) {
      emitForThread(threadId, {
        type: "thinking_delta",
        id: itemId,
        delta,
        timestamp,
      })
      return
    }
    if (notification.method === "item/commandExecution/outputDelta" && itemId) {
      emitForThread(threadId, {
        type: "tool_update",
        id: itemId,
        value: { outputDelta: delta ?? "" },
        phase: "output",
        timestamp,
      })
      return
    }
    if (notification.method === "item/fileChange/patchUpdated" && itemId) {
      const filePreview = filePreviewFromChanges(params.changes)
      emitForThread(threadId, {
        type: "tool_update",
        id: itemId,
        ...(filePreview ? { filePreview } : {}),
        value: params.changes,
        phase: "output",
        timestamp,
      })
      return
    }
    if (notification.method === "thread/tokenUsage/updated") {
      const usage = isObject(params.tokenUsage) ? params.tokenUsage : undefined
      const total = usage && isObject(usage.total) ? usage.total : undefined
      const contextWindow = numberValue(usage?.modelContextWindow)
      const tokens = numberValue(total?.totalTokens)
      const context = contextByThreadId.get(threadId)
      if (context && contextWindow) {
        const normalized = {
          tokens: tokens ?? null,
          contextWindow,
          percent: tokens === undefined ? null : (tokens / contextWindow) * 100,
        }
        usageBySessionKey.set(sessionKey(context), normalized)
        emitChatEvent(
          { type: "context_usage", ...normalized, timestamp },
          context
        )
      }
      return
    }
    if (notification.method === "error") {
      const context = contextByThreadId.get(threadId)
      if (context) {
        const error = isObject(params.error) ? params.error : undefined
        const text = stringValue(error?.message) ?? "Codex reported an error."
        emitChatEvent(
          { type: "error", id: randomId("codex-error"), text, timestamp },
          context
        )
      }
      return
    }
    if (notification.method === "turn/completed") {
      const active = activeByThreadId.get(threadId)
      const turn = isObject(params.turn) ? parseTurn(params.turn) : undefined
      if (turn && pendingStartContextByThreadId.has(threadId)) {
        completedPendingTurnKeys.add(`${threadId}:${turn.id}`)
      }
      if (!active) {
        return
      }
      activeByThreadId.delete(threadId)
      activeBySessionKey.delete(sessionKey(active.context))
      const failed = turn?.status === "failed"
      if (failed) {
        const turnError = isObject(turn.error) ? turn.error : undefined
        const text = stringValue(turnError?.message) ?? "Codex turn failed."
        emitChatEvent(
          { type: "error", id: randomId("codex-error"), text, timestamp },
          active.context
        )
        emitChatEvent(
          { type: "run_status", status: "error", text, timestamp },
          active.context
        )
      } else {
        emitChatEvent(
          { type: "run_status", status: "finished", timestamp },
          active.context
        )
      }
      const key = sessionKey(active.context)
      const shouldContinue =
        turn?.status !== "interrupted" ||
        continueQueueAfterInterrupt.get(key) === true
      continueQueueAfterInterrupt.delete(key)
      if (shouldContinue) {
        void startNextQueuedTurn(active.context)
      } else {
        queuedBySessionKey.delete(key)
        emitQueue(active.context)
      }
    }
  }

  function serverRequestHandler(request: CodexAppServerRequest) {
    const params = isObject(request.params) ? request.params : undefined
    log("warn", "Declining unsupported Codex server request", {
      method: request.method,
      threadId: stringValue(params?.threadId),
      turnId: stringValue(params?.turnId),
    })
    const response =
      request.method === "item/commandExecution/requestApproval" ||
      request.method === "item/fileChange/requestApproval"
        ? client.respond(request.id, { decision: "decline" })
        : request.method === "execCommandApproval" ||
            request.method === "applyPatchApproval"
          ? client.respond(request.id, { decision: "denied" })
          : client.respondError(request.id, {
              code: -32601,
              message: `Ousia does not support Codex server request ${request.method}.`,
            })
    void response.catch((error: unknown) => {
      log("error", "Failed to answer Codex server request", {
        error: errorText(error),
        method: request.method,
      })
    })
  }

  const unsubscribeNotification = client.onNotification(notificationHandler)
  const unsubscribeServerRequest = client.onServerRequest(serverRequestHandler)

  const conversations: AgentConversationProvider = {
    async sendChatMessage(payload) {
      const context = {
        projectPath: payload.projectPath,
        sessionId: payload.sessionId,
      }
      const key = sessionKey(context)
      const inputs = codexInputs(payload)
      const hadActiveTurn = activeBySessionKey.has(key)
      try {
        const active = activeBySessionKey.get(key)
        if (active) {
          if (payload.sendBehavior === "followUp") {
            const queue = queuedBySessionKey.get(key) ?? []
            queue.push({ inputs, payload })
            queuedBySessionKey.set(key, queue)
            emitUserMessage(payload)
            emitQueue(context)
            return { ok: true }
          }
          if (payload.sendBehavior !== "steer") {
            throw new Error(
              "Codex turn is already running. Queue or steer the message."
            )
          }
          await client.request("turn/steer", {
            threadId: active.threadId,
            expectedTurnId: active.turnId,
            input: inputs,
          })
          emitUserMessage(payload)
          return { ok: true }
        }
        await startTurn(payload, inputs, true)
        return { ok: true }
      } catch (error) {
        const text = errorText(error)
        log("error", "Failed to send Codex message", {
          error: text,
          sessionId: context.sessionId,
        })
        emitChatEvent(
          {
            type: "error",
            id: randomId("codex-error"),
            text,
            timestamp: now(),
          },
          context
        )
        if (!hadActiveTurn) {
          emitChatEvent(
            { type: "run_status", status: "error", text, timestamp: now() },
            context
          )
        }
        return { ok: false, error: text }
      }
    },

    async getChatHistory(payload) {
      const context = {
        projectPath: payload.projectPath,
        sessionId: payload.sessionId,
      }
      const session = await canonicalSession(context)
      if (!session.agentThreadId) {
        return { items: [], hasMore: false, totalItems: 0 }
      }
      contextByThreadId.set(session.agentThreadId, context)
      const thread = await readThread(session.agentThreadId)
      return paginateHistory(
        codexThreadToHistory(thread, payload.includeToolPayloads === true),
        payload
      )
    },

    async getChatToolPayload(payload: OusiaChatToolPayloadPayload) {
      try {
        const session = await canonicalSession(payload)
        if (!session.agentThreadId) {
          return { ok: false, error: "Codex session has no thread history." }
        }
        const items = codexThreadToHistory(
          await readThread(session.agentThreadId),
          true
        )
        const item = items.find(
          (
            candidate
          ): candidate is Extract<OusiaChatHistoryItem, { role: "tool" }> =>
            candidate.id === payload.itemId && candidate.role === "tool"
        )
        return item
          ? { ok: true, item }
          : { ok: false, error: `Unknown Codex tool item: ${payload.itemId}` }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    },

    async interruptChat(payload: OusiaChatInterruptPayload) {
      const context = {
        projectPath: payload.projectPath,
        sessionId: payload.sessionId,
      }
      const key = sessionKey(context)
      const active = activeBySessionKey.get(key)
      if (!active) {
        return { ok: true }
      }
      continueQueueAfterInterrupt.set(
        key,
        payload.continueQueuedMessages === true
      )
      if (!payload.continueQueuedMessages) {
        queuedBySessionKey.delete(key)
        emitQueue(context)
      }
      try {
        await client.request("turn/interrupt", {
          threadId: active.threadId,
          turnId: active.turnId,
        })
        return { ok: true }
      } catch (error) {
        const text = errorText(error)
        emitChatEvent(
          {
            type: "error",
            id: randomId("codex-error"),
            text,
            timestamp: now(),
          },
          context
        )
        return { ok: false }
      }
    },

    async clearChatQueue(context) {
      queuedBySessionKey.delete(sessionKey(context))
      emitQueue(context)
      return { ok: true }
    },

    async getContextUsage(context) {
      const usage = usageBySessionKey.get(sessionKey(context))
      return usage ? { ok: true, usage } : { ok: true }
    },

    async compactChat(payload) {
      const context = {
        projectPath: payload.projectPath,
        sessionId: payload.sessionId,
      }
      try {
        const session = await canonicalSession(context)
        if (!session.agentThreadId) {
          return {
            ok: false,
            error: "Codex session has no context to compact.",
          }
        }
        contextByThreadId.set(session.agentThreadId, context)
        const controller = new AbortController()
        const completed = client.waitForNotification<JsonObject>(
          "item/completed",
          {
            signal: controller.signal,
            timeoutMs: COMPACT_TIMEOUT_MS,
            predicate: (notification) => {
              const params = notification.params
              return (
                isObject(params) &&
                params.threadId === session.agentThreadId &&
                isObject(params.item) &&
                params.item.type === "contextCompaction"
              )
            },
          }
        )
        try {
          await client.request("thread/compact/start", {
            threadId: session.agentThreadId,
          })
          await completed
        } finally {
          controller.abort()
        }
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          error: errorText(error, "Codex context compaction failed."),
        }
      }
    },

    async branchChat(payload: OusiaChatBranchPayload) {
      try {
        const source = await canonicalSession(payload)
        if (!source.agentThreadId) {
          return { ok: false, error: "Codex session has no history to branch." }
        }
        const sourceThread = await readThread(source.agentThreadId)
        const sourceTurnIndex = sourceThread.turns.findIndex((turn) =>
          turn.items.some((item) => item.id === payload.messageId)
        )
        if (sourceTurnIndex < 0) {
          return {
            ok: false,
            error: `Codex message was not found: ${payload.messageId}`,
          }
        }
        const sourceTurn = sourceThread.turns[sourceTurnIndex]
        const forkResponse = await client.request<{ thread?: unknown }>(
          "thread/fork",
          {
            threadId: source.agentThreadId,
            lastTurnId: sourceTurn.id,
            cwd: absoluteProjectPath(payload.projectPath),
            approvalPolicy: "never",
            sandbox: "workspace-write",
            threadSource: "ousia_desktop",
          }
        )
        const fork = parseThread(forkResponse.thread)
        const bindResult = await bindAppStateSessionAgentThread({
          agentThreadId: fork.id,
          sessionId: payload.targetSessionId,
        })
        if (!bindResult.ok) {
          throw new Error(bindResult.error)
        }
        const targetContext = {
          projectPath: payload.projectPath,
          sessionId: payload.targetSessionId,
        }
        contextByThreadId.set(fork.id, targetContext)
        const finalThread = fork.turns.length ? fork : await readThread(fork.id)
        return { ok: true, items: codexThreadToHistory(finalThread, false) }
      } catch (error) {
        return { ok: false, error: errorText(error, "Codex branch failed.") }
      }
    },

    async moveChatSession(payload: OusiaChatMovePayload) {
      try {
        await canonicalSession({
          projectPath: payload.sourceProjectPath,
          sessionId: payload.sessionId,
        })
        log("info", "Codex session cwd will update on next resume", {
          sessionId: payload.sessionId,
          sourceProjectPath: payload.sourceProjectPath,
          targetProjectPath: payload.targetProjectPath,
        })
        return { ok: true, moved: false }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    },

    async exportChat(payload: OusiaChatExportPayload, outputPath: string) {
      try {
        if (payload.format === "markdown") {
          await writeFile(outputPath, payload.markdown ?? "", "utf8")
          return { ok: true, path: outputPath }
        }
        const session = await canonicalSession(payload)
        if (!session.agentThreadId) {
          await writeFile(outputPath, "", "utf8")
          return { ok: true, path: outputPath }
        }
        const thread = await readThread(session.agentThreadId)
        const lines = [
          JSON.stringify({ type: "thread", id: thread.id }),
          ...thread.turns.map((turn) =>
            JSON.stringify({ type: "turn", ...turn })
          ),
        ]
        await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8")
        return { ok: true, path: outputPath }
      } catch (error) {
        return { ok: false, error: errorText(error, "Codex export failed.") }
      }
    },
  }

  async function checkEnvironment(): Promise<OusiaCodexEnvironmentStatus> {
    let resolution: CodexNativeBinaryResolution
    try {
      resolution = nativeBinaryResolver()
      const initialize = await client.start()
      const accountResponse = await client.request<{
        account?: unknown
        requiresOpenaiAuth?: unknown
      }>("account/read", { refreshToken: false })
      const { defaultModelId, models } = await refreshModelCatalog()
      return {
        account: mapCodexAccount(accountResponse.account),
        available: true,
        binaryPath: resolution.binaryPath,
        codexHome: initialize.codexHome,
        defaultModelId,
        models,
        requiresOpenaiAuth: accountResponse.requiresOpenaiAuth === true,
        runtime: "bundled",
        version: codexVersion(initialize.userAgent),
      }
    } catch (error) {
      const text = errorText(error, "Bundled Codex runtime is unavailable.")
      log("error", "Codex environment check failed", { error: text })
      return {
        account: null,
        available: false,
        error: text,
        models: [],
        requiresOpenaiAuth: true,
        runtime: "bundled",
      }
    }
  }

  async function loginWithChatGPT(): Promise<OusiaCodexAuthResult> {
    if (!openExternal) {
      return {
        ok: false,
        error: "No browser opener is configured for Codex login.",
      }
    }
    const controller = new AbortController()
    try {
      const completed = client.waitForNotification<JsonObject>(
        "account/login/completed",
        { signal: controller.signal, timeoutMs: LOGIN_TIMEOUT_MS }
      )
      const response = await client.request<{
        authUrl?: unknown
        loginId?: unknown
        type?: unknown
      }>("account/login/start", {
        type: "chatgpt",
        codexStreamlinedLogin: true,
      })
      const authUrl = stringValue(response.authUrl)
      if (!authUrl) {
        throw new Error("Codex did not return a ChatGPT login URL.")
      }
      await openExternal(authUrl)
      const notification = await completed
      const params = notification.params
      if (!isObject(params) || params.success !== true) {
        throw new Error(
          stringValue(isObject(params) ? params.error : undefined) ??
            "Codex login failed."
        )
      }
      return { ok: true, status: await checkEnvironment() }
    } catch (error) {
      const text = errorText(error, "Codex login failed.")
      return { ok: false, error: text, status: await checkEnvironment() }
    } finally {
      controller.abort()
    }
  }

  async function logout(): Promise<OusiaCodexAuthResult> {
    try {
      await client.request("account/logout")
      return { ok: true, status: await checkEnvironment() }
    } catch (error) {
      const text = errorText(error, "Codex logout failed.")
      return { ok: false, error: text, status: await checkEnvironment() }
    }
  }

  async function generateTitle(
    payload: OusiaChatGenerateTitlePayload
  ): Promise<OusiaChatGenerateTitleResult> {
    try {
      const effort = await defaultReasoningEffort(payload.model.modelId)
      const response = await client.request<{ thread?: unknown }>(
        "thread/start",
        {
          cwd: absoluteProjectPath(payload.projectPath),
          approvalPolicy: "never",
          sandbox: "read-only",
          ephemeral: true,
          threadSource: "ousia_desktop_title",
          ...modelFields(payload.model.modelId),
        }
      )
      const thread = parseThread(response.thread)
      const controller = new AbortController()
      const completedItem = client.waitForNotification<JsonObject>(
        "item/completed",
        {
          signal: controller.signal,
          timeoutMs: TITLE_TIMEOUT_MS,
          predicate: (notification) => {
            const params = notification.params
            return (
              isObject(params) &&
              params.threadId === thread.id &&
              isObject(params.item) &&
              params.item.type === "agentMessage"
            )
          },
        }
      )
      try {
        await client.request("turn/start", {
          threadId: thread.id,
          input: [
            {
              type: "text",
              text: `为下面的用户请求生成一个简短会话标题，不超过 20 个中文字符或 8 个英文单词。只返回 JSON。\n\n${payload.prompt}`,
              text_elements: [],
            },
          ],
          effort,
          outputSchema: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
          },
        })
        const notification = await completedItem
        const params = notification.params
        const item =
          isObject(params) && isObject(params.item) ? params.item : undefined
        const text = stringValue(item?.text)
        if (!text) {
          throw new Error("Codex returned an empty title.")
        }
        const parsed: unknown = JSON.parse(text)
        const title = isObject(parsed)
          ? stringValue(parsed.title)?.trim()
          : undefined
        if (!title) {
          throw new Error("Codex returned an invalid title response.")
        }
        return { ok: true, title: title.slice(0, 80) }
      } finally {
        controller.abort()
      }
    } catch (error) {
      return {
        ok: false,
        error: errorText(error, "Codex title generation failed."),
      }
    }
  }

  return {
    ...conversations,
    checkEnvironment,
    dispose() {
      unsubscribeNotification()
      unsubscribeServerRequest()
      client.dispose()
    },
    generateTitle,
    loginWithChatGPT,
    logout,
  }
}

export type CodexAgentProvider = ReturnType<typeof createCodexAgentProvider>
