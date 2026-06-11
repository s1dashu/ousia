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

export type OusiaWorkspaceTab = {
  id: string
  extensionId: string | null
  resource?: OusiaWorkspaceTabResource
}

export type OusiaWorkspaceTabResource = {
  kind: "file"
  path: string
  name?: string
  projectPath?: string
}

export type OusiaWorkspaceTabsState = {
  activeTabId: string
  tabs: OusiaWorkspaceTab[]
}

export type OusiaAppStateSchemaVersion = 2
export type OusiaThemePreference = "dark" | "light" | "system"

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
  defaultWorkDir: string
  thinkingLevel: OusiaThinkingLevel
  modelProvider: string
  modelId: string
  modelProviders: OusiaModelProviderConfig[]
  /**
   * Legacy single-provider key. Kept for app-state migration and older
   * renderer fallbacks; new code should read modelProviders instead.
   */
  modelApiKey: string
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
  selectedProjectId: string
  selectedSessionId: string
  selectedWorkspaceExtensionId: string
  workspaceTabs: OusiaWorkspaceTabsState
}

export type OusiaSidebarSectionId = "sessions" | "projects"

export type OusiaShellLayoutState = {
  sidebarWidth: number
  chatWidth: number
  isSidebarCollapsed: boolean
  isWorkspaceCollapsed: boolean
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

export type OusiaExtensionStateScope =
  | "global"
  | "project"
  | "tab"
  | "resource"

export type OusiaExtensionStatePayload = {
  extensionId: string
  scope: OusiaExtensionStateScope
  key: string
}

export type OusiaExtensionStateGetPayload = OusiaExtensionStatePayload

export type OusiaExtensionStateSetPayload = OusiaExtensionStatePayload & {
  value: unknown
}

export type OusiaExtensionStateDeletePayload = OusiaExtensionStatePayload

export type OusiaExtensionStateResult = {
  value: unknown
}

export type OusiaExtensionStateSaveResult = {
  ok: boolean
}

export type OusiaWindowResizeAnchor = "left" | "right"

export type OusiaEnsureWindowWidthPayload = {
  anchor: OusiaWindowResizeAnchor
  minWidth: number
}

export type OusiaEnsureWindowWidthResult = {
  ok: boolean
  width: number
}

export type OusiaBrowserProfileMode = "global" | "project" | "temporary"

export type OusiaBrowserSecurityState =
  | "secure"
  | "insecure"
  | "local"
  | "internal"
  | "error"
  | "unknown"

export type OusiaBrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type OusiaBrowserCreatePayload = {
  tabId: string
  initialUrl: string
  profileMode: OusiaBrowserProfileMode
  projectId?: string
  projectPath?: string
}

export type OusiaBrowserBoundsPayload = {
  tabId: string
  bounds: OusiaBrowserBounds
  visible: boolean
}

export type OusiaBrowserTabPayload = {
  tabId: string
}

export type OusiaBrowserNavigatePayload = OusiaBrowserTabPayload & {
  url: string
}

export type OusiaBrowserFindPayload = OusiaBrowserTabPayload & {
  text: string
  forward?: boolean
  findNext?: boolean
  matchCase?: boolean
}

export type OusiaBrowserStopFindPayload = OusiaBrowserTabPayload & {
  action?: "clearSelection" | "keepSelection" | "activateSelection"
}

export type OusiaBrowserZoomPayload = OusiaBrowserTabPayload & {
  delta?: number
  level?: number
}

export type OusiaBrowserAuthResponsePayload = {
  requestId: string
  username?: string
  password?: string
  canceled?: boolean
}

export type OusiaBrowserSelectionResult = {
  html: string
  text: string
  title: string
  url: string
}

export type OusiaBrowserFindState = {
  activeMatchOrdinal: number
  finalUpdate: boolean
  matches: number
  requestId: number
  selectionArea?: {
    height: number
    width: number
    x: number
    y: number
  }
}

export type OusiaBrowserDownloadState = {
  id: string
  filename: string
  receivedBytes: number
  savePath: string
  state: "started" | "progressing" | "completed" | "cancelled" | "interrupted"
  totalBytes: number
  url: string
}

export type OusiaBrowserState = {
  canGoBack: boolean
  canGoForward: boolean
  certificateError?: string
  error: string
  faviconUrl?: string
  isCrashed: boolean
  isLoading: boolean
  profileMode: OusiaBrowserProfileMode
  securityState: OusiaBrowserSecurityState
  title: string
  url: string
  zoomLevel: number
  zoomPercent: number
}

export type OusiaBrowserEvent =
  | {
      type: "state"
      tabId: string
      state: OusiaBrowserState
    }
  | {
      type: "find"
      tabId: string
      find: OusiaBrowserFindState
    }
  | {
      type: "download"
      download: OusiaBrowserDownloadState
    }
  | {
      type: "auth"
      request: {
        host: string
        isProxy: boolean
        realm?: string
        requestId: string
        tabId: string
      }
    }
  | {
      type: "open-tab"
      tabId: string
      url: string
    }
  | {
      type: "quote-selection"
      tabId: string
    }

export type OusiaBrowserOperationResult = {
  ok: boolean
  state?: OusiaBrowserState
}

export const OUSIA_APP_STATE_SCHEMA_VERSION = 2
export const OUSIA_DEFAULT_WORKSPACE_EXTENSION_ID =
  "extension.firstParty.browser"

export const defaultOusiaAppSettings: OusiaAppSettings = {
  appearanceColorScale: "tea",
  theme: "light",
  defaultWorkDir: "~/.ousia/workspace",
  thinkingLevel: "medium",
  modelProvider: "deepseek",
  modelId: "deepseek-v4-flash",
  modelProviders: [
    {
      id: "deepseek",
      apiKey: "",
    },
  ],
  modelApiKey: "",
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

  if (settings.modelApiKey?.trim()) {
    const existing = providers.get(selectedProvider)
    providers.set(selectedProvider, {
      id: selectedProvider,
      apiKey: existing?.apiKey || settings.modelApiKey.trim(),
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
    defaultWorkDir:
      merged.defaultWorkDir.trim() || defaultOusiaAppSettings.defaultWorkDir,
    modelProvider,
    modelId: merged.modelId.trim() || defaultOusiaAppSettings.modelId,
    modelApiKey: merged.modelApiKey.trim(),
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

export function createDefaultOusiaWorkspaceTabs(): OusiaWorkspaceTabsState {
  return {
    activeTabId: OUSIA_DEFAULT_WORKSPACE_EXTENSION_ID,
    tabs: [
      {
        id: "extension.firstParty.browser",
        extensionId: "extension.firstParty.browser",
      },
      {
        id: "extension.firstParty.editor",
        extensionId: "extension.firstParty.editor",
      },
      {
        id: "extension.firstParty.terminal",
        extensionId: "extension.firstParty.terminal",
      },
    ],
  }
}

export function createDefaultOusiaShellLayout(): OusiaShellLayoutState {
  return {
    sidebarWidth: 256,
    chatWidth: 520,
    isSidebarCollapsed: false,
    isWorkspaceCollapsed: false,
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
    selectedProjectId: "",
    selectedSessionId: sessions[0].id,
    selectedWorkspaceExtensionId: OUSIA_DEFAULT_WORKSPACE_EXTENSION_ID,
    workspaceTabs: createDefaultOusiaWorkspaceTabs(),
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
      value?: unknown
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

export type OusiaEditorFileEntry = {
  path: string
  name: string
  depth: number
  extension: string
  kind: "directory" | "file"
}

export type OusiaEditorListFilesPayload = {
  projectPath: string
}

export type OusiaEditorListFilesResult = {
  files: OusiaEditorFileEntry[]
}

export type OusiaEditorReadFilePayload = {
  projectPath: string
  path: string
}

export type OusiaEditorReadFileResult = {
  content: string
  path: string
}

export type OusiaEditorSaveFilePayload = {
  projectPath: string
  path: string
  content: string
}

export type OusiaEditorSaveFileResult = {
  ok: boolean
}

export type OusiaPdfFileEntry = {
  path: string
  name: string
  depth: number
  extension: "pdf"
  size: number
  mtimeMs: number
}

export type OusiaPdfListFilesPayload = {
  projectPath: string
}

export type OusiaPdfListFilesResult = {
  files: OusiaPdfFileEntry[]
}

export type OusiaPdfReadFilePayload = {
  projectPath: string
  path: string
}

export type OusiaPdfReadFileResult = {
  contentBase64: string
  path: string
  size: number
  mtimeMs: number
}

export type OusiaPdfSaveFilePayload = {
  projectPath: string
  path: string
  contentBase64: string
}

export type OusiaPdfSaveFileResult = {
  ok: boolean
  path: string
  size: number
  mtimeMs: number
}

export type OusiaExtensionActionName = "openAndFocus" | "openFile" | string

export type OusiaWorkspaceAction = {
  type: "extension.invoke"
  extensionId: string
  action: OusiaExtensionActionName
  args?: unknown
  requestId: string
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

export type OusiaRuntimeExtensionSlot = "workspace.tab"

export type OusiaRuntimeExtension = {
  id: string
  title: string
  slot: OusiaRuntimeExtensionSlot
  distribution: "user-local"
  trust: "local-user"
  extensionDir: string
  sourcePath: string
  code: string
}

export type OusiaRuntimeExtensionError = {
  id: string
  title: string
  distribution: "user-local"
  trust: "local-user"
  extensionDir?: string
  sourcePath?: string
  message: string
}

export type OusiaRuntimeExtensionDeletePayload = {
  extensionDir: string
}

export type OusiaRuntimeExtensionDeleteResult = {
  ok: boolean
}

export type OusiaRuntimeExtensionsChangedEvent = {
  extensionDirs: string[]
}

export type OusiaRuntimeExtensionsResult = {
  extensionsDir: string
  extensionDirs: string[]
  extensions: OusiaRuntimeExtension[]
  errors: OusiaRuntimeExtensionError[]
}

export type OusiaWindowFullscreenEvent = {
  isFullscreen: boolean
}

export type OusiaWindowFullscreenResult = OusiaWindowFullscreenEvent
