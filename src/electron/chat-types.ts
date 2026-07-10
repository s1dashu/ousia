export type OusiaChatContext = {
  projectPath: string
  sessionId: string
}

export const OUSIA_PI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const
export type OusiaPiThinkingLevel = (typeof OUSIA_PI_THINKING_LEVELS)[number]

export type OusiaThinkingLevel = OusiaPiThinkingLevel
export type OusiaCodexReasoningEffort = string
export type OusiaReasoningEffort = OusiaPiThinkingLevel | string

export function isOusiaPiThinkingLevel(
  value: unknown
): value is OusiaPiThinkingLevel {
  return OUSIA_PI_THINKING_LEVELS.includes(value as OusiaPiThinkingLevel)
}

export function isOusiaCodexReasoningEffort(
  value: unknown
): value is OusiaCodexReasoningEffort {
  return typeof value === "string" && value.trim().length > 0
}

export type OusiaAgentProvider = "pi" | "codex"

export const OUSIA_APPEARANCE_COLOR_SCALES = [
  "tea",
  "paper",
  "sand",
  "gray",
  "slate",
  "mauve",
  "sage",
] as const

export type OusiaAppearanceColorScale =
  (typeof OUSIA_APPEARANCE_COLOR_SCALES)[number]

export type OusiaAppStateSchemaVersion = 2
export type OusiaThemePreference = "dark" | "light" | "system"
export type OusiaResolvedTheme = "dark" | "light"
export type OusiaSendDuringRunMode = "steer" | "queue"
export type OusiaAgentMode = "standard" | "readOnly" | "noTerminal" | "custom"
export const OUSIA_CHAT_CONTENT_WIDTHS = [
  "standard",
  "wide",
  "extraWide",
] as const
export type OusiaChatContentWidth = (typeof OUSIA_CHAT_CONTENT_WIDTHS)[number]
export type OusiaAgentToolName =
  | "read"
  | "write"
  | "edit"
  | "bash"
  | "grep"
  | "find"
  | "ls"
export type OusiaLanguage = "zh" | "en"
export const OUSIA_FONT_FAMILIES = [
  "system",
  "lxgwWenkai",
  "zhuqueFangsong",
] as const
export type OusiaFontFamily = (typeof OUSIA_FONT_FAMILIES)[number]

export type OusiaSessionRecord = {
  agentProvider: OusiaAgentProvider
  agentThreadId?: string
  id: string
  projectId?: string
  title: string
  time: string
}

export type OusiaProjectRecord = {
  id: string
  name: string
  path: string
}

export type OusiaAppSettings = {
  defaultAgentProvider: OusiaAgentProvider
  codexModelId: string
  codexReasoningEffort: OusiaCodexReasoningEffort | null
  appearanceColorScale: OusiaAppearanceColorScale
  theme: OusiaThemePreference
  appFontFamily: OusiaFontFamily
  chatFontFamily: OusiaFontFamily
  chatContentWidth: OusiaChatContentWidth
  language: OusiaLanguage
  defaultWorkDir: string
  sendDuringRunMode: OusiaSendDuringRunMode
  agentMode: OusiaAgentMode
  customAgentTools: OusiaAgentToolName[]
  autoCompactContext: boolean
  autoRetryOnFailure: boolean
  showContextUsage: boolean
  continueQueuedMessagesAfterInterrupt: boolean
  thinkingLevel: OusiaPiThinkingLevel
  modelProvider: string
  modelId: string
  modelProviders: OusiaModelProviderConfig[]
  disabledModelProviderIds: string[]
}

export type OusiaModelProviderConfig = {
  id: string
  apiKey: string
}

export type OusiaAvailableModel = {
  provider: string
  providerName: string
  modelId: string
  name: string
  label: string
  input: ("text" | "image")[]
  thinkingLevels: OusiaReasoningEffort[]
  defaultThinkingLevel?: OusiaReasoningEffort
  thinkingLevelDescriptions?: Record<string, string>
}

export type OusiaAvailableModelProvider = {
  id: string
  name: string
  models: OusiaAvailableModel[]
}

export type OusiaModelProviderAuthSource =
  | "stored"
  | "runtime"
  | "environment"
  | "fallback"
  | "models_json_key"
  | "models_json_command"

export type OusiaConfiguredModelProvider = {
  id: string
  authLabel?: string
  authSource?: OusiaModelProviderAuthSource
}

export type OusiaModelRegistryResult = {
  configuredProviders: OusiaConfiguredModelProvider[]
  configuredProviderIds: string[]
  providers: OusiaAvailableModelProvider[]
  error?: string
}

export type OusiaPiEnvironmentStatus = {
  agentDir: string
  authJsonExists: boolean
  configDirExists: boolean
  configuredProviderIds: string[]
  hasConfiguredCredential: boolean
  modelCount: number
  modelsJsonExists: boolean
  runtime: "bundled"
}

export type OusiaCodexAccount =
  | {
      type: "apiKey"
    }
  | {
      type: "chatgpt"
      email?: string
      planType?: string
    }

export type OusiaCodexEnvironmentStatus = {
  account: OusiaCodexAccount | null
  available: boolean
  binaryPath?: string
  codexHome?: string
  defaultModelId?: string
  error?: string
  models: OusiaAvailableModel[]
  requiresOpenaiAuth: boolean
  runtime: "bundled"
  version?: string
}

export type OusiaCodexAuthResult =
  | {
      ok: true
      status: OusiaCodexEnvironmentStatus
    }
  | {
      ok: false
      error: string
      status?: OusiaCodexEnvironmentStatus
    }

export type OusiaPiProviderCredentialPayload = {
  apiKey: string
  provider: string
}

export type OusiaPiProviderCredentialRemovalPayload = {
  provider: string
}

export type OusiaPiProviderCredentialResult = {
  error?: string
  ok: boolean
  status?: OusiaPiEnvironmentStatus
}

export type OusiaPiRetrySettingsPayload = {
  autoRetryOnFailure: boolean
}

export type OusiaPiRetrySettingsResult = {
  autoRetryOnFailure?: boolean
  error?: string
  ok: boolean
}

export type OusiaAppSelectionState = {
  expandedProjectIds: string[]
  selectedSessionId: string
}

export type OusiaSidebarSectionId = "sessions" | "projects"

export type OusiaShellLayoutState = {
  sidebarWidth: number
  isSidebarCollapsed: boolean
  sidebarSectionOrder: OusiaSidebarSectionId[]
}

export type OusiaWindowState = {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

export type OusiaWindowThemePayload = {
  theme: OusiaThemePreference
  resolvedTheme: OusiaResolvedTheme
}

export type OusiaAppState = {
  schemaVersion: OusiaAppStateSchemaVersion
  settings: OusiaAppSettings
  sessions: OusiaSessionRecord[]
  projects: OusiaProjectRecord[]
  shellLayout: OusiaShellLayoutState
  windowState: OusiaWindowState
} & OusiaAppSelectionState

export type OusiaAppStateSaveResult = {
  ok: boolean
}

export type OusiaAppStateTransactionResult =
  | {
      ok: true
      state: OusiaAppState
      session?: OusiaSessionRecord
      project?: OusiaProjectRecord
      removedSessions?: OusiaSessionRecord[]
    }
  | {
      ok: false
      error: string
      state?: OusiaAppState
    }

export type OusiaAppStateSettingsPayload = {
  settings: OusiaAppSettings
}

export type OusiaAppStateShellLayoutPayload = {
  shellLayout: OusiaShellLayoutState
}

export type OusiaAppStateSelectionPayload = Partial<OusiaAppSelectionState>

export type OusiaAppStateCreateSessionPayload = {
  agentProvider?: OusiaAgentProvider
  projectId?: string
  select?: boolean
  title?: string
}

export type OusiaAppStateBindSessionAgentThreadPayload = {
  agentThreadId: string
  sessionId: string
}

export type OusiaAppStateBindSessionAgentThreadResult =
  OusiaAppStateTransactionResult

export type OusiaAppStateDeleteSessionPayload = {
  sessionId: string
}

export type OusiaAppStateRenameSessionPayload = {
  sessionId: string
  title: string
}

export type OusiaAppStateMoveSessionPayload = {
  sessionId: string
  targetProjectId?: string
  targetSessionId?: string
}

export type OusiaAppStateReorderSessionsPayload = {
  sourceSessionId: string
  targetSessionId: string
}

export type OusiaAppStateTouchSessionPayload = {
  sessionId: string
  time: string
}

export type OusiaAppStateCreateProjectPayload = {
  name?: string
  path: string
  selectOrCreateSession?: boolean
  sessionTitle?: string
}

export type OusiaAppStateDeleteProjectPayload = {
  projectId: string
}

export type OusiaAppStateReorderProjectsPayload = {
  sourceProjectId: string
  targetProjectId: string
}

export const OUSIA_APP_STATE_SCHEMA_VERSION = 2
export const OUSIA_DEFAULT_WORK_DIR = "~/Documents/Ousia"
export const OUSIA_LEGACY_DEFAULT_WORK_DIR = "~/.ousia/chat"

export const defaultOusiaAppSettings: OusiaAppSettings = {
  defaultAgentProvider: "pi",
  codexModelId: "",
  codexReasoningEffort: null,
  appearanceColorScale: "paper",
  theme: "light",
  appFontFamily: "system",
  chatFontFamily: "system",
  chatContentWidth: "standard",
  language: "zh",
  defaultWorkDir: OUSIA_DEFAULT_WORK_DIR,
  sendDuringRunMode: "steer",
  agentMode: "standard",
  customAgentTools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
  autoCompactContext: true,
  autoRetryOnFailure: true,
  showContextUsage: false,
  continueQueuedMessagesAfterInterrupt: true,
  thinkingLevel: "medium",
  modelProvider: "deepseek",
  modelId: "deepseek-v4-flash",
  modelProviders: [],
  disabledModelProviderIds: [],
}

export function normalizeOusiaModelProviders(
  settings: Partial<OusiaAppSettings>
): OusiaModelProviderConfig[] {
  const providers = new Map<string, OusiaModelProviderConfig>()

  for (const provider of settings.modelProviders ?? []) {
    const id = provider.id.trim()
    if (!id || providers.has(id)) {
      continue
    }
    providers.set(id, {
      id,
      apiKey: "",
    })
  }

  return [...providers.values()]
}

export function normalizeOusiaDisabledModelProviderIds(
  settings: Partial<OusiaAppSettings>
): string[] {
  const providerIds = new Set<string>()

  for (const providerId of settings.disabledModelProviderIds ?? []) {
    const id = providerId.trim()
    if (!id || providerIds.has(id)) {
      continue
    }
    providerIds.add(id)
  }

  return [...providerIds]
}

function normalizeOusiaFontFamily(
  fontFamily: OusiaFontFamily | undefined
): OusiaFontFamily | undefined {
  return fontFamily && OUSIA_FONT_FAMILIES.includes(fontFamily)
    ? fontFamily
    : undefined
}

function normalizeOusiaChatContentWidth(
  chatContentWidth: OusiaChatContentWidth | undefined
): OusiaChatContentWidth | undefined {
  return chatContentWidth &&
    OUSIA_CHAT_CONTENT_WIDTHS.includes(chatContentWidth)
    ? chatContentWidth
    : undefined
}

export function normalizeOusiaAppSettings(
  settings: Partial<OusiaAppSettings> = {}
): OusiaAppSettings {
  const merged = {
    ...defaultOusiaAppSettings,
    ...settings,
  }
  const modelProvider =
    merged.modelProvider.trim() || defaultOusiaAppSettings.modelProvider
  const defaultAgentProvider =
    merged.defaultAgentProvider === "codex" ? "codex" : "pi"
  const codexModelId =
    typeof merged.codexModelId === "string" ? merged.codexModelId.trim() : ""
  const codexReasoningEffort = isOusiaCodexReasoningEffort(
    merged.codexReasoningEffort
  )
    ? merged.codexReasoningEffort.trim()
    : null
  const thinkingLevel = isOusiaPiThinkingLevel(merged.thinkingLevel)
    ? merged.thinkingLevel
    : defaultOusiaAppSettings.thinkingLevel
  const appearanceColorScale = OUSIA_APPEARANCE_COLOR_SCALES.includes(
    merged.appearanceColorScale
  )
    ? merged.appearanceColorScale
    : defaultOusiaAppSettings.appearanceColorScale
  const appFontFamily =
    normalizeOusiaFontFamily(settings.appFontFamily) ??
    defaultOusiaAppSettings.appFontFamily
  const chatFontFamily =
    normalizeOusiaFontFamily(settings.chatFontFamily) ??
    defaultOusiaAppSettings.chatFontFamily
  const chatContentWidth =
    normalizeOusiaChatContentWidth(settings.chatContentWidth) ??
    defaultOusiaAppSettings.chatContentWidth
  const {
    showContextUsage: _showContextUsage,
    ...normalizedBaseSettings
  } = merged
  void _showContextUsage

  const allowedAgentTools = new Set<OusiaAgentToolName>([
    "read",
    "write",
    "edit",
    "bash",
    "grep",
    "find",
    "ls",
  ])
  const customAgentTools = Array.isArray(merged.customAgentTools)
    ? merged.customAgentTools.filter(
        (tool): tool is OusiaAgentToolName => allowedAgentTools.has(tool)
      )
    : defaultOusiaAppSettings.customAgentTools

  const normalizedDefaultWorkDir =
    merged.defaultWorkDir.trim() === OUSIA_LEGACY_DEFAULT_WORK_DIR
      ? OUSIA_DEFAULT_WORK_DIR
      : merged.defaultWorkDir.trim()

  return {
    ...normalizedBaseSettings,
    defaultAgentProvider,
    codexModelId,
    codexReasoningEffort,
    appearanceColorScale,
    appFontFamily,
    chatFontFamily,
    chatContentWidth,
    language: merged.language === "en" ? "en" : "zh",
    defaultWorkDir:
      normalizedDefaultWorkDir || defaultOusiaAppSettings.defaultWorkDir,
    sendDuringRunMode:
      merged.sendDuringRunMode === "queue" ? "queue" : "steer",
    agentMode:
      merged.agentMode === "readOnly" ||
      merged.agentMode === "noTerminal" ||
      merged.agentMode === "custom"
        ? merged.agentMode
        : "standard",
    customAgentTools: customAgentTools.length
      ? [...new Set(customAgentTools)]
      : defaultOusiaAppSettings.customAgentTools,
    autoCompactContext:
      typeof merged.autoCompactContext === "boolean"
        ? merged.autoCompactContext
        : defaultOusiaAppSettings.autoCompactContext,
    autoRetryOnFailure:
      typeof merged.autoRetryOnFailure === "boolean"
        ? merged.autoRetryOnFailure
        : defaultOusiaAppSettings.autoRetryOnFailure,
    showContextUsage:
      typeof merged.showContextUsage === "boolean"
        ? merged.showContextUsage
        : defaultOusiaAppSettings.showContextUsage,
    continueQueuedMessagesAfterInterrupt:
      typeof merged.continueQueuedMessagesAfterInterrupt === "boolean"
        ? merged.continueQueuedMessagesAfterInterrupt
        : defaultOusiaAppSettings.continueQueuedMessagesAfterInterrupt,
    thinkingLevel,
    modelProvider,
    modelId: merged.modelId.trim() || defaultOusiaAppSettings.modelId,
    modelProviders: normalizeOusiaModelProviders({
      ...merged,
      modelProvider,
    }),
    disabledModelProviderIds: normalizeOusiaDisabledModelProviderIds(merged),
  }
}

export function resolveOusiaFontFamilyValue(fontFamily: OusiaFontFamily) {
  if (fontFamily === "zhuqueFangsong") {
    return '"Ousia Zhuque Fangsong", "Songti SC", serif'
  }
  if (fontFamily === "lxgwWenkai") {
    return '"Ousia LXGW WenKai", "Kaiti SC", serif'
  }
  return '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
}

export function resolveOusiaChatContentWidthValue(
  chatContentWidth: OusiaChatContentWidth
) {
  if (chatContentWidth === "extraWide") {
    return "64rem"
  }
  if (chatContentWidth === "wide") {
    return "56rem"
  }
  return "48rem"
}

export function createOusiaId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createOusiaSession(
  title = "新会话",
  agentProvider: OusiaAgentProvider = "pi"
): OusiaSessionRecord {
  return {
    agentProvider,
    id: createOusiaId("session"),
    title,
    time: new Date().toISOString(),
  }
}

export function createOusiaProject(
  path: string,
  name = ousiaProjectNameFromPath(path)
): OusiaProjectRecord {
  return {
    id: createOusiaId("project"),
    name,
    path,
  }
}

export function ousiaProjectNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export function createDefaultOusiaShellLayout(): OusiaShellLayoutState {
  return {
    sidebarWidth: 256,
    isSidebarCollapsed: false,
    sidebarSectionOrder: ["sessions", "projects"],
  }
}

export function createDefaultOusiaWindowState(): OusiaWindowState {
  return {
    width: 1440,
    height: 900,
    isMaximized: false,
  }
}

export function createDefaultOusiaProject(
  settings = defaultOusiaAppSettings
): OusiaProjectRecord {
  return {
    id: "default-workdir",
    name: ousiaProjectNameFromPath(settings.defaultWorkDir),
    path: settings.defaultWorkDir,
  }
}

export function createDefaultOusiaAppState(): OusiaAppState {
  const sessions = [createOusiaSession()]

  return {
    schemaVersion: OUSIA_APP_STATE_SCHEMA_VERSION,
    settings: defaultOusiaAppSettings,
    sessions,
    projects: [],
    shellLayout: createDefaultOusiaShellLayout(),
    windowState: createDefaultOusiaWindowState(),
    expandedProjectIds: [],
    selectedSessionId: sessions[0].id,
  }
}

export type OusiaModelSettings = {
  provider: string
  modelId: string
  apiKey?: string
}

export type OusiaChatAttachment = {
  id: string
  name: string
  mediaType: string
  size: number
} & (
  | {
      kind: "image"
      dataBase64: string
    }
  | {
      kind: "text"
      text: string
    }
  | {
      kind: "file"
    }
)

export type OusiaChatAttachmentSummary = Pick<
  OusiaChatAttachment,
  "id" | "kind" | "mediaType" | "name" | "size"
> & {
  dataBase64?: string
}

export type OusiaTextChatItem = {
  id: string
  role: "user" | "assistant" | "thinking" | "system" | "error"
  text: string
  timestamp?: string
  attachments?: OusiaChatAttachmentSummary[]
  status?: "streaming" | "finished"
}

export type OusiaChatToolFilePreview =
  | {
      kind: "diff"
      path: string
      oldContent: string
      newContent: string
      source: "input" | "result"
    }
  | {
      kind: "file"
      path: string
      content: string
      source: "input" | "result"
    }
  | {
      kind: "patch"
      patch: string
      path?: string
      source: "result"
    }
  | {
      kind: "error"
      message: string
      path?: string
      source: "input" | "result"
    }

export type OusiaChatHistoryItem =
  | OusiaTextChatItem
  | {
      id: string
      role: "tool"
      name: string
      text: string
      input?: string
      output?: string
      errorText?: string
      filePreview?: OusiaChatToolFilePreview
      payloadOmitted?: boolean
      status: "running" | "finished" | "failed"
    }

export type OusiaChatEvent = {
  context?: OusiaChatContext
} & (
  | {
      type: "user_message"
      id: string
      text: string
      attachments?: OusiaChatAttachmentSummary[]
      timestamp: string
    }
  | {
      type: "assistant_text_start"
      id: string
      timestamp: string
    }
  | {
      type: "assistant_text_delta"
      id: string
      delta: string
      timestamp: string
    }
  | {
      type: "assistant_text_end"
      id: string
      text?: string
      timestamp: string
    }
  | {
      type: "thinking_start"
      id: string
      timestamp: string
    }
  | {
      type: "thinking_delta"
      id: string
      delta: string
      timestamp: string
    }
  | {
      type: "thinking_end"
      id: string
      text?: string
      timestamp: string
    }
  | {
      type: "tool_start"
      id: string
      name: string
      args?: unknown
      filePreview?: OusiaChatToolFilePreview
      timestamp: string
    }
  | {
      type: "tool_update"
      id: string
      name?: string
      filePreview?: OusiaChatToolFilePreview
      value?: unknown
      phase?: "input" | "output"
      timestamp: string
    }
  | {
      type: "tool_end"
      id: string
      name?: string
      filePreview?: OusiaChatToolFilePreview
      result?: unknown
      isError?: boolean
      timestamp: string
    }
  | {
      type: "run_status"
      status: "starting" | "running" | "finished" | "error"
      text?: string
      timestamp: string
    }
  | {
      type: "status_message"
      id: string
      role?: "system" | "error"
      status: "streaming" | "finished"
      text: string
      timestamp: string
    }
  | {
      type: "context_usage"
      tokens: number | null
      contextWindow: number
      percent: number | null
      timestamp: string
    }
  | {
      type: "queue_update"
      steering: string[]
      followUp: string[]
      timestamp: string
    }
  | {
      type: "error"
      id: string
      text: string
      timestamp: string
    }
)

export type OusiaChatSendResult = {
  error?: string
  ok: boolean
}

export type OusiaChatGenerateTitlePayload = {
  agentProvider: OusiaAgentProvider
  prompt: string
  projectPath: string
  sessionId: string
  model: OusiaModelSettings
}

export type OusiaChatGenerateTitleResult =
  | {
      ok: true
      title: string
    }
  | {
      ok: false
      error: string
    }

export type OusiaChatInterruptPayload = OusiaChatContext & {
  continueQueuedMessages?: boolean
}

export type OusiaChatInterruptResult = {
  ok: boolean
}

export type OusiaChatClearQueueResult = {
  ok: boolean
  error?: string
}

export type OusiaChatCompactPayload = OusiaChatContext & {
  agentMode?: OusiaAgentMode
  customAgentTools?: OusiaAgentToolName[]
  autoCompactContext?: boolean
  autoRetryOnFailure?: boolean
  thinkingLevel: OusiaReasoningEffort
  model: OusiaModelSettings
}

export type OusiaChatCompactResult = {
  ok: boolean
  error?: string
}

export type OusiaChatSendPayload = OusiaChatContext & {
  prompt: string
  attachments?: OusiaChatAttachment[]
  sendBehavior?: "normal" | "steer" | "followUp"
  agentMode?: OusiaAgentMode
  customAgentTools?: OusiaAgentToolName[]
  autoCompactContext?: boolean
  autoRetryOnFailure?: boolean
  thinkingLevel: OusiaReasoningEffort
  model: OusiaModelSettings
}

export type OusiaChatHistoryPayload = OusiaChatContext & {
  beforeItemId?: string
  includeToolPayloads?: boolean
  limit?: number
}

export type OusiaChatHistoryResult = {
  hasMore?: boolean
  isPartial?: boolean
  items: OusiaChatHistoryItem[]
  nextCursor?: string
  totalItems?: number
}

export type OusiaChatToolPayloadPayload = OusiaChatContext & {
  itemId: string
}

export type OusiaChatToolPayloadResult =
  | {
      ok: true
      item: Extract<OusiaChatHistoryItem, { role: "tool" }>
    }
  | {
      ok: false
      error: string
    }

export type OusiaChatBranchPayload = OusiaChatContext & {
  messageId: string
  messageText?: string
  targetSessionId: string
}

export type OusiaChatBranchResult =
  | {
      ok: true
      items: OusiaChatHistoryItem[]
    }
  | {
      ok: false
      error: string
    }

export type OusiaChatMovePayload = {
  sessionId: string
  sourceProjectPath: string
  targetProjectId?: string
  targetProjectPath: string
}

export type OusiaChatMoveResult =
  | {
      ok: true
      moved: boolean
    }
  | {
      ok: false
      error: string
    }

export type OusiaChatExportFormat = "markdown" | "jsonl"

export type OusiaChatExportPayload = OusiaChatContext & {
  format: OusiaChatExportFormat
  markdown?: string
  agentMode?: OusiaAgentMode
  customAgentTools?: OusiaAgentToolName[]
  autoCompactContext?: boolean
  autoRetryOnFailure?: boolean
  thinkingLevel: OusiaReasoningEffort
  model: OusiaModelSettings
}

export type OusiaChatExportResult =
  | {
      ok: true
      path: string
    }
  | {
      ok: false
      canceled?: boolean
      error?: string
    }

export type OusiaChatContextUsageResult =
  | {
      ok: true
      usage?: {
        tokens: number | null
        contextWindow: number
        percent: number | null
      }
    }
  | {
      ok: false
      error: string
    }

export type OusiaOpenProjectResult =
  | {
      canceled: true
    }
  | {
      canceled: false
      path: string
      name: string
    }

export type OusiaDirectoryPickerOptions = {
  defaultPath?: string
}

export type OusiaSelectDirectoryResult =
  | {
      canceled: true
    }
  | {
      canceled: false
      path: string
    }

export type OusiaOpenDirectoryPayload = {
  path: string
}

export type OusiaOpenDirectoryResult =
  | {
      ok: true
    }
  | {
      ok: false
      error: string
    }

export type OusiaShowFileInFinderPayload = {
  path: string
  projectPath?: string
}

export type OusiaShowFileInFinderResult =
  | {
      ok: true
    }
  | {
      ok: false
      error: string
    }

export type OusiaWindowFullscreenEvent = {
  isFullscreen: boolean
}

export type OusiaWindowFullscreenResult = OusiaWindowFullscreenEvent

export type OusiaWindowZoomEvent = {
  zoomPercent: number
}

export type OusiaWindowZoomResult = OusiaWindowZoomEvent
