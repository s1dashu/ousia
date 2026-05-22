import {
  createDefaultWorkspaceTabs,
  type WorkspaceTabsState,
} from "@/extensions/workspace-tabs"
import type { OusiaThinkingLevel } from "@/electron/chat-types"

export type SessionRecord = {
  id: string
  title: string
  time: string
}

export type ProjectRecord = {
  id: string
  name: string
  path: string
  sessions: SessionRecord[]
}

export type AppSettings = {
  defaultWorkDir: string
  thinkingLevel: OusiaThinkingLevel
  modelProvider: string
  modelId: string
  modelApiKey: string
}

export type AppSelectionState = {
  selectedProjectId: string
  selectedSessionId: string
  selectedWorkspaceExtensionId: string
  workspaceTabs: WorkspaceTabsState
}

export type InitialAppState = {
  settings: AppSettings
  projects: ProjectRecord[]
} & AppSelectionState

type StoredSelection = {
  selectedProjectId?: string
  selectedSessionId?: string
  selectedWorkspaceExtensionId?: string
  workspaceTabs?: WorkspaceTabsState
  workspaceTabsBySession?: Record<string, WorkspaceTabsState>
}

const PROJECTS_STORAGE_KEY = "ousia.projects.v1"
const SETTINGS_STORAGE_KEY = "ousia.settings.v1"
const SELECTION_STORAGE_KEY = "ousia.selection.v1"

export const defaultSettings: AppSettings = {
  defaultWorkDir: "~/Desktop",
  thinkingLevel: "medium",
  modelProvider: "deepseek",
  modelId: "deepseek-v4-flash",
  modelApiKey: "",
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createSession(title = "新会话"): SessionRecord {
  return {
    id: createId("session"),
    title,
    time: "now",
  }
}

export function projectNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function createDefaultProject(settings: AppSettings): ProjectRecord {
  return {
    id: "default-workdir",
    name: projectNameFromPath(settings.defaultWorkDir),
    path: settings.defaultWorkDir,
    sessions: [createSession()],
  }
}

function loadSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) {
      return defaultSettings
    }
    return { ...defaultSettings, ...JSON.parse(raw) }
  } catch {
    return defaultSettings
  }
}

function loadProjects(settings: AppSettings) {
  try {
    const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY)
    if (!raw) {
      return [createDefaultProject(settings)]
    }
    const parsed = JSON.parse(raw) as ProjectRecord[]
    return Array.isArray(parsed) ? parsed : [createDefaultProject(settings)]
  } catch {
    return [createDefaultProject(settings)]
  }
}

function loadSelection() {
  try {
    const raw = window.localStorage.getItem(SELECTION_STORAGE_KEY)
    if (!raw) {
      return undefined
    }
    return JSON.parse(raw) as StoredSelection
  } catch {
    return undefined
  }
}

function resolveSelection(
  projects: ProjectRecord[],
  selection?: StoredSelection
): AppSelectionState {
  const selectedProject =
    projects.find((project) => project.id === selection?.selectedProjectId) ??
    projects[0]
  const selectedSession =
    selectedProject?.sessions.find(
      (session) => session.id === selection?.selectedSessionId
    ) ?? selectedProject?.sessions[0]
  const selectedWorkspaceExtensionId =
    selection?.selectedWorkspaceExtensionId ?? "workspace.browser"

  return {
    selectedProjectId: selectedProject?.id ?? "",
    selectedSessionId: selectedSession?.id ?? "",
    selectedWorkspaceExtensionId,
    workspaceTabs:
      selection?.workspaceTabs ??
      selection?.workspaceTabsBySession?.[
        `${selectedProject?.id ?? ""}::${selectedSession?.id ?? ""}`
      ] ??
      createDefaultWorkspaceTabs(selectedWorkspaceExtensionId),
  }
}

export function loadInitialAppState(): InitialAppState {
  const settings = loadSettings()
  const projects = loadProjects(settings)
  const selection = resolveSelection(projects, loadSelection())
  return {
    settings,
    projects,
    ...selection,
  }
}

export function saveProjects(projects: ProjectRecord[]) {
  window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects))
}

export function saveSettings(settings: AppSettings) {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

export function saveSelection(selection: AppSelectionState) {
  window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selection))
}
