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
  "olive",
  "tomato",
  "red",
  "ruby",
  "crimson",
  "pink",
  "plum",
  "purple",
  "violet",
  "iris",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "jade",
  "green",
  "grass",
  "brown",
  "orange",
  "amber",
  "yellow",
  "lime",
  "mint",
  "sky",
] as const

export type OusiaAppearanceColorScale =
  (typeof OUSIA_APPEARANCE_COLOR_SCALES)[number]

export type OusiaAppStateSchemaVersion = 2
export type OusiaThemePreference = "dark" | "light" | "system"
export type OusiaSendDuringRunMode = "steer" | "queue"
export type OusiaAgentMode = "standard" | "readOnly" | "noTerminal"
export type OusiaLanguage = "zh" | "en"

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
  language: OusiaLanguage
  defaultWorkDir: string
  sendDuringRunMode: OusiaSendDuringRunMode
  agentMode: OusiaAgentMode
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
  appearanceColorScale: "tea",
  theme: "light",
  language: "zh",
  defaultWorkDir: "~/.ousia/workspace",
  sendDuringRunMode: "steer",
  agentMode: "standard",
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

export function normalizeOusiaAppSettings(
  settings: Partial<OusiaAppSettings> = {}
): OusiaAppSettings {
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

  return {
    ...merged,
    appearanceColorScale,
    language: merged.language === "en" ? "en" : "zh",
    defaultWorkDir:
      merged.defaultWorkDir.trim() || defaultOusiaAppSettings.defaultWorkDir,
    sendDuringRunMode:
      merged.sendDuringRunMode === "queue" ? "queue" : "steer",
    agentMode:
      merged.agentMode === "readOnly" || merged.agentMode === "noTerminal"
        ? merged.agentMode
        : "standard",
    modelProvider,
    modelId: merged.modelId.trim() || defaultOusiaAppSettings.modelId,
    modelProviders: normalizeOusiaModelProviders({
      ...merged,
      modelProvider,
    }),
  }
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

export type OusiaTextChatItem = {
  id: string
  role: "user" | "assistant" | "thinking" | "system" | "error"
  text: string
  attachments?: Pick<
    OusiaChatAttachment,
    "id" | "kind" | "mediaType" | "name" | "size"
  >[]
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
      attachments?: Pick<
        OusiaChatAttachment,
        "id" | "kind" | "mediaType" | "name" | "size"
      >[]
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

export type OusiaChatInterruptResult = {
  ok: boolean
}

export type OusiaChatSendPayload = OusiaChatContext & {
  prompt: string
  attachments?: OusiaChatAttachment[]
  sendBehavior?: "normal" | "steer" | "followUp"
  agentMode?: OusiaAgentMode
  thinkingLevel: OusiaThinkingLevel
  model: OusiaModelSettings
}

export type OusiaChatHistoryResult = {
  items: OusiaChatHistoryItem[]
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
