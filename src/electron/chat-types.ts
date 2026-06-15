export type OusiaChatContext = {
  projectPath: string
  sessionId: string
}

export type OusiaThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"

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
export type OusiaSendDuringRunMode = "steer" | "queue"
export type OusiaAgentMode = "standard" | "readOnly" | "noTerminal" | "custom"
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
  "pingfang",
  "microsoftYaHei",
  "sourceHanSans",
  "zhuqueFangsong",
  "lxgwWenkai",
] as const
export type OusiaFontFamily = (typeof OUSIA_FONT_FAMILIES)[number]

export type OusiaSessionRecord = {
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
  appearanceColorScale: OusiaAppearanceColorScale
  theme: OusiaThemePreference
  appFontFamily: OusiaFontFamily
  chatFontFamily: OusiaFontFamily
  language: OusiaLanguage
  defaultWorkDir: string
  sendDuringRunMode: OusiaSendDuringRunMode
  agentMode: OusiaAgentMode
  customAgentTools: OusiaAgentToolName[]
  autoCompactContext: boolean
  showContextUsage: boolean
  continueQueuedMessagesAfterInterrupt: boolean
  thinkingLevel: OusiaThinkingLevel
  modelProvider: string
  modelId: string
  modelProviders: OusiaModelProviderConfig[]
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
  thinkingLevels: OusiaThinkingLevel[]
}

export type OusiaAvailableModelProvider = {
  id: string
  name: string
  models: OusiaAvailableModel[]
}

export type OusiaModelRegistryResult = {
  providers: OusiaAvailableModelProvider[]
  error?: string
}

export type OusiaAppSelectionState = {
  expandedProjectIds: string[]
  selectedSessionId: string
}

export type OusiaSidebarSectionId = "sessions" | "projects"

export type OusiaShellLayoutState = {
  sidebarWidth: number
  terminalPanelWidth: number
  isSidebarCollapsed: boolean
  isTerminalPanelCollapsed: boolean
  sidebarSectionOrder: OusiaSidebarSectionId[]
}

export type OusiaWindowState = {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
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

export const OUSIA_APP_STATE_SCHEMA_VERSION = 2

export const defaultOusiaAppSettings: OusiaAppSettings = {
  appearanceColorScale: "paper",
  theme: "light",
  appFontFamily: "system",
  chatFontFamily: "system",
  language: "zh",
  defaultWorkDir: "~/.ousia/chat",
  sendDuringRunMode: "steer",
  agentMode: "standard",
  customAgentTools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
  autoCompactContext: true,
  showContextUsage: false,
  continueQueuedMessagesAfterInterrupt: true,
  thinkingLevel: "medium",
  modelProvider: "deepseek",
  modelId: "deepseek-v4-flash",
  modelProviders: [
    {
      id: "deepseek",
      apiKey: "",
    },
  ],
}

export function normalizeOusiaModelProviders(
  settings: Partial<OusiaAppSettings>
): OusiaModelProviderConfig[] {
  const selectedProvider =
    settings.modelProvider?.trim() || defaultOusiaAppSettings.modelProvider
  const providers = new Map<string, OusiaModelProviderConfig>()

  for (const provider of settings.modelProviders ?? []) {
    const id = provider.id.trim()
    if (!id || providers.has(id)) {
      continue
    }
    providers.set(id, {
      id,
      apiKey: provider.apiKey.trim(),
    })
  }

  if (!providers.has(selectedProvider)) {
    providers.set(selectedProvider, {
      id: selectedProvider,
      apiKey: "",
    })
  }

  return [...providers.values()]
}

type LegacyOusiaFontSettings = {
  fontFamily?: OusiaFontFamily
}

type LegacyOusiaSessionInfoSettings = {
  showContextUsage?: boolean
  showSessionInfo?: boolean
}

function normalizeOusiaFontFamily(
  fontFamily: OusiaFontFamily | undefined
): OusiaFontFamily | undefined {
  return fontFamily && OUSIA_FONT_FAMILIES.includes(fontFamily)
    ? fontFamily
    : undefined
}

export function normalizeOusiaAppSettings(
  settings: (
    Partial<OusiaAppSettings> &
      LegacyOusiaFontSettings &
      LegacyOusiaSessionInfoSettings
  ) = {}
): OusiaAppSettings {
  const legacyFontFamily = normalizeOusiaFontFamily(settings.fontFamily)
  const merged = {
    ...defaultOusiaAppSettings,
    ...settings,
  }
  const modelProvider =
    merged.modelProvider.trim() || defaultOusiaAppSettings.modelProvider
  const appearanceColorScale = OUSIA_APPEARANCE_COLOR_SCALES.includes(
    merged.appearanceColorScale
  )
    ? merged.appearanceColorScale
    : defaultOusiaAppSettings.appearanceColorScale
  const appFontFamily =
    normalizeOusiaFontFamily(settings.appFontFamily) ??
    legacyFontFamily ??
    defaultOusiaAppSettings.appFontFamily
  const chatFontFamily =
    normalizeOusiaFontFamily(settings.chatFontFamily) ??
    legacyFontFamily ??
    defaultOusiaAppSettings.chatFontFamily
  const {
    fontFamily: _legacyFontFamily,
    showContextUsage: _legacyShowContextUsage,
    showSessionInfo: _legacyShowSessionInfo,
    ...normalizedBaseSettings
  } = merged
  void _legacyFontFamily
  void _legacyShowContextUsage
  void _legacyShowSessionInfo

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

  return {
    ...normalizedBaseSettings,
    appearanceColorScale,
    appFontFamily,
    chatFontFamily,
    language: merged.language === "en" ? "en" : "zh",
    defaultWorkDir:
      merged.defaultWorkDir.trim() || defaultOusiaAppSettings.defaultWorkDir,
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
    showContextUsage:
      typeof merged.showContextUsage === "boolean"
        ? merged.showContextUsage
        : defaultOusiaAppSettings.showContextUsage,
    continueQueuedMessagesAfterInterrupt:
      typeof merged.continueQueuedMessagesAfterInterrupt === "boolean"
        ? merged.continueQueuedMessagesAfterInterrupt
        : defaultOusiaAppSettings.continueQueuedMessagesAfterInterrupt,
    modelProvider,
    modelId: merged.modelId.trim() || defaultOusiaAppSettings.modelId,
    modelProviders: normalizeOusiaModelProviders({
      ...merged,
      modelProvider,
    }),
  }
}

export function resolveOusiaFontFamilyValue(fontFamily: OusiaFontFamily) {
  if (fontFamily === "pingfang") {
    return '"PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  }
  if (fontFamily === "microsoftYaHei") {
    return '"Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  }
  if (fontFamily === "sourceHanSans") {
    return '"Ousia Source Han Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  }
  if (fontFamily === "zhuqueFangsong") {
    return '"Ousia Zhuque Fangsong", "Songti SC", serif'
  }
  if (fontFamily === "lxgwWenkai") {
    return '"Ousia LXGW WenKai", "Kaiti SC", serif'
  }
  return '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
}

export function getOusiaModelProviderApiKey(
  settings: OusiaAppSettings,
  provider = settings.modelProvider
) {
  return settings.modelProviders.find((item) => item.id === provider)?.apiKey
}

export function createOusiaId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createOusiaSession(title = "新会话"): OusiaSessionRecord {
  return {
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
    terminalPanelWidth: 448,
    isSidebarCollapsed: false,
    isTerminalPanelCollapsed: false,
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
      timestamp: string
    }
  | {
      type: "tool_update"
      id: string
      name?: string
      value?: unknown
      phase?: "input" | "output"
      timestamp: string
    }
  | {
      type: "tool_end"
      id: string
      name?: string
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
  ok: boolean
}

export type OusiaChatGenerateTitlePayload = {
  prompt: string
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

export type OusiaChatSendPayload = OusiaChatContext & {
  prompt: string
  attachments?: OusiaChatAttachment[]
  sendBehavior?: "normal" | "steer" | "followUp"
  agentMode?: OusiaAgentMode
  customAgentTools?: OusiaAgentToolName[]
  autoCompactContext?: boolean
  thinkingLevel: OusiaThinkingLevel
  model: OusiaModelSettings
}

export type OusiaChatHistoryResult = {
  items: OusiaChatHistoryItem[]
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

export type OusiaChatExportFormat = "markdown" | "html" | "jsonl"

export type OusiaChatExportPayload = OusiaChatContext & {
  format: OusiaChatExportFormat
  markdown?: string
  agentMode?: OusiaAgentMode
  customAgentTools?: OusiaAgentToolName[]
  autoCompactContext?: boolean
  thinkingLevel: OusiaThinkingLevel
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

export type OusiaSelectDirectoryResult =
  | {
      canceled: true
    }
  | {
      canceled: false
      path: string
    }

export type OusiaTerminalContext = OusiaChatContext & {
  terminalId: string
}

export type OusiaTerminalCreatePayload = OusiaTerminalContext & {
  cols: number
  rows: number
}

export type OusiaTerminalCreateResult = {
  terminalId: string
}

export type OusiaTerminalWritePayload = OusiaTerminalContext & {
  data: string
}

export type OusiaTerminalResizePayload = OusiaTerminalContext & {
  cols: number
  rows: number
}

export type OusiaTerminalDisposePayload = OusiaTerminalContext

export type OusiaTerminalOperationResult = {
  ok: boolean
}

export type OusiaTerminalEvent =
  | {
      type: "data"
      terminalId: string
      data: string
    }
  | {
      type: "exit"
      terminalId: string
      exitCode?: number
      signal?: number
    }
  | {
      type: "error"
      terminalId: string
      message: string
    }

export type OusiaWindowFullscreenEvent = {
  isFullscreen: boolean
}

export type OusiaWindowFullscreenResult = OusiaWindowFullscreenEvent

export type OusiaWindowZoomEvent = {
  zoomPercent: number
}

export type OusiaWindowZoomResult = OusiaWindowZoomEvent
