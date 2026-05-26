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

export type OusiaAppearanceColorScale =
  | "tea"
  | "cloudTea"
  | "sand"
  | "gray"
  | "slate"
  | "mauve"
  | "sage"
  | "olive"

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
  defaultWorkDir: string
  thinkingLevel: OusiaThinkingLevel
  modelProvider: string
  modelId: string
  modelApiKey: string
}

export type OusiaAppSelectionState = {
  expandedProjectIds: string[]
  selectedProjectId: string
  selectedSessionId: string
  selectedWorkspaceExtensionId: string
  workspaceTabs: OusiaWorkspaceTabsState
}

export type OusiaAppState = {
  schemaVersion: OusiaAppStateSchemaVersion
  settings: OusiaAppSettings
  sessions: OusiaSessionRecord[]
  projects: OusiaProjectRecord[]
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

export const OUSIA_APP_STATE_SCHEMA_VERSION = 2
export const OUSIA_DEFAULT_WORKSPACE_EXTENSION_ID =
  "extension.firstParty.browser"

export const defaultOusiaAppSettings: OusiaAppSettings = {
  appearanceColorScale: "tea",
  defaultWorkDir: "~/Ousia",
  thinkingLevel: "medium",
  modelProvider: "deepseek",
  modelId: "deepseek-v4-flash",
  modelApiKey: "",
}

export function createOusiaId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createOusiaSession(title = "新会话"): OusiaSessionRecord {
  return {
    id: createOusiaId("session"),
    title,
    time: "now",
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

export type OusiaTextChatItem = {
  id: string
  role: "user" | "assistant" | "thinking" | "system" | "error"
  text: string
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
