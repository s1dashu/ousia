import { app } from "electron"
import { existsSync, mkdirSync } from "node:fs"
import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  createOusiaSession,
  createDefaultOusiaAppState,
  createDefaultOusiaShellLayout,
  createDefaultOusiaWindowState,
  createDefaultOusiaWorkspaceTabs,
  defaultOusiaAppSettings,
  normalizeOusiaAppSettings,
  OUSIA_APP_STATE_SCHEMA_VERSION,
  type OusiaAppSettings,
  type OusiaAppState,
  type OusiaAppStateSaveResult,
  type OusiaProjectRecord,
  type OusiaSessionRecord,
  type OusiaShellLayoutState,
  type OusiaWindowState,
  ousiaProjectNameFromPath,
} from "./chat-types.js"
import { expandHomePath } from "./host-paths.js"

const appStateFileName = "app-state.json"
const LEGACY_DEFAULT_WORK_DIRS = new Set(["~/Ousia", "~/Desktop"])

function appStatePath() {
  return join(app.getPath("userData"), appStateFileName)
}

function sessionsRootPath() {
  return join(app.getPath("userData"), "sessions")
}

function isAppState(value: unknown): value is OusiaAppState {
  if (!value || typeof value !== "object") {
    return false
  }
  const state = value as OusiaAppState
  return (
    Boolean(state.settings) &&
    state.schemaVersion === OUSIA_APP_STATE_SCHEMA_VERSION &&
    Array.isArray(state.sessions) &&
    Array.isArray(state.projects) &&
    Boolean(state.shellLayout) &&
    Boolean(state.windowState) &&
    (state.expandedProjectIds === undefined ||
      Array.isArray(state.expandedProjectIds)) &&
    typeof state.selectedProjectId === "string" &&
    typeof state.selectedSessionId === "string" &&
    typeof state.selectedWorkspaceExtensionId === "string" &&
    Boolean(state.workspaceTabs) &&
    Array.isArray(state.workspaceTabs.tabs)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, min), max)
    : fallback
}

function normalizeShellLayout(value: unknown): OusiaShellLayoutState {
  const fallback = createDefaultOusiaShellLayout()
  if (!isRecord(value)) {
    return fallback
  }
  const storedSectionOrder = Array.isArray(value.sidebarSectionOrder)
    ? value.sidebarSectionOrder.filter(
        (sectionId): sectionId is OusiaShellLayoutState["sidebarSectionOrder"][number] =>
          sectionId === "sessions" || sectionId === "projects"
      )
    : []
  const sidebarSectionOrder = [
    ...new Set([...storedSectionOrder, ...fallback.sidebarSectionOrder]),
  ]
  return {
    sidebarWidth: clampNumber(value.sidebarWidth, fallback.sidebarWidth, 200, 360),
    chatWidth: clampNumber(value.chatWidth, fallback.chatWidth, 340, 1600),
    isSidebarCollapsed:
      typeof value.isSidebarCollapsed === "boolean"
        ? value.isSidebarCollapsed
        : fallback.isSidebarCollapsed,
    isWorkspaceCollapsed:
      typeof value.isWorkspaceCollapsed === "boolean"
        ? value.isWorkspaceCollapsed
        : fallback.isWorkspaceCollapsed,
    sidebarSectionOrder,
  }
}

function normalizeWindowState(value: unknown): OusiaWindowState {
  const fallback = createDefaultOusiaWindowState()
  if (!isRecord(value)) {
    return fallback
  }
  return {
    ...(typeof value.x === "number" && Number.isFinite(value.x)
      ? { x: Math.round(value.x) }
      : {}),
    ...(typeof value.y === "number" && Number.isFinite(value.y)
      ? { y: Math.round(value.y) }
      : {}),
    width: Math.round(clampNumber(value.width, fallback.width, 340, 10000)),
    height: Math.round(clampNumber(value.height, fallback.height, 600, 10000)),
    isMaximized:
      typeof value.isMaximized === "boolean"
        ? value.isMaximized
        : fallback.isMaximized,
  }
}

function normalizeWorkspaceTabs(value: unknown): OusiaAppState["workspaceTabs"] {
  const fallback = createDefaultOusiaWorkspaceTabs()
  if (!isRecord(value) || !Array.isArray(value.tabs)) {
    return fallback
  }
  const tabs = value.tabs.flatMap((tab) => {
    if (!isRecord(tab) || typeof tab.id !== "string") {
      return []
    }
    return [
      {
        id: tab.id,
        extensionId:
          typeof tab.extensionId === "string" || tab.extensionId === null
            ? tab.extensionId
            : null,
        ...(isRecord(tab.resource) &&
        tab.resource.kind === "file" &&
        typeof tab.resource.path === "string"
          ? {
              resource: {
                kind: "file" as const,
                path: tab.resource.path,
                ...(typeof tab.resource.name === "string"
                  ? { name: tab.resource.name }
                  : {}),
                ...(typeof tab.resource.projectPath === "string"
                  ? { projectPath: tab.resource.projectPath }
                  : {}),
              },
            }
          : {}),
      },
    ]
  })
  if (!tabs.length) {
    return {
      tabs: [],
      activeTabId: "",
    }
  }
  return {
    tabs,
    activeTabId:
      typeof value.activeTabId === "string" &&
      tabs.some((tab) => tab.id === value.activeTabId)
        ? value.activeTabId
        : tabs[0].id,
  }
}

function normalizeExpandedProjectIds(state: OusiaAppState): OusiaAppState {
  const projectIds = new Set(state.projects.map((project) => project.id))
  const storedExpandedProjectIds = Array.isArray(state.expandedProjectIds)
    ? state.expandedProjectIds.filter(
        (projectId): projectId is string =>
          typeof projectId === "string" && projectIds.has(projectId)
      )
    : state.projects.map((project) => project.id)

  return {
    ...state,
    expandedProjectIds: [...new Set(storedExpandedProjectIds)],
  }
}

function normalizeSettings(settings: OusiaAppSettings): OusiaAppSettings {
  const normalized = normalizeOusiaAppSettings({
    ...defaultOusiaAppSettings,
    ...settings,
  })
  const nextSettings = LEGACY_DEFAULT_WORK_DIRS.has(normalized.defaultWorkDir)
    ? {
        ...normalized,
        defaultWorkDir: defaultOusiaAppSettings.defaultWorkDir,
      }
    : normalized

  if (nextSettings.defaultWorkDir === defaultOusiaAppSettings.defaultWorkDir) {
    mkdirSync(expandHomePath(nextSettings.defaultWorkDir), { recursive: true })
  }
  return nextSettings
}

function stableProjectIdForPath(path: string) {
  return `project-${safePathSegment(path)}`
}

function safePathSegment(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "default"
  )
}

function firstUserTextFromJsonl(text: string) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue
    }
    try {
      const entry = JSON.parse(line) as unknown
      if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) {
        continue
      }
      const message = entry.message
      if (message.role !== "user" || !Array.isArray(message.content)) {
        continue
      }
      const firstText = message.content.find(
        (item): item is { type: string; text: string } =>
          isRecord(item) && item.type === "text" && typeof item.text === "string"
      )?.text
      if (firstText?.trim()) {
        return firstText.trim().replace(/\s+/g, " ").slice(0, 40)
      }
    } catch {
      continue
    }
  }
  return undefined
}

async function recoverAppStateFromSessionFiles(
  baseState: OusiaAppState
): Promise<OusiaAppState | null> {
  const looksLikeResetIndex =
    baseState.projects.length === 0 && baseState.sessions.length <= 1
  if (!looksLikeResetIndex) {
    return null
  }

  const root = sessionsRootPath()
  if (!existsSync(root)) {
    return null
  }

  const projectsByPath = new Map<string, OusiaProjectRecord>()
  const sessions: OusiaSessionRecord[] = []
  const defaultWorkDir = expandHomePath(baseState.settings.defaultWorkDir)
  const workspaceDirs = await readdir(root, { withFileTypes: true }).catch(() => [])

  for (const workspaceDir of workspaceDirs) {
    if (!workspaceDir.isDirectory()) {
      continue
    }
    const workspacePath = join(root, workspaceDir.name)
    const sessionDirs = await readdir(workspacePath, { withFileTypes: true }).catch(
      () => []
    )
    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) {
        continue
      }
      const sessionPath = join(workspacePath, sessionDir.name)
      const files = (
        await readdir(sessionPath, { withFileTypes: true }).catch(() => [])
      )
        .filter((file) => file.isFile() && file.name.endsWith(".jsonl"))
        .map((file) => join(sessionPath, file.name))

      for (const filePath of files) {
        const text = await readFile(filePath, "utf8").catch(() => "")
        if (!text) {
          continue
        }
        const firstLine = text.split(/\r?\n/, 1)[0]
        let cwd = ""
        let timestamp = ""
        try {
          const entry = JSON.parse(firstLine) as unknown
          if (isRecord(entry)) {
            cwd = typeof entry.cwd === "string" ? entry.cwd : ""
            timestamp = typeof entry.timestamp === "string" ? entry.timestamp : ""
          }
        } catch {
          continue
        }
        if (!cwd || !timestamp) {
          continue
        }

        let projectId: string | undefined
        if (cwd !== defaultWorkDir) {
          const existingProject =
            projectsByPath.get(cwd) ??
            ({
              id: stableProjectIdForPath(cwd),
              name: ousiaProjectNameFromPath(cwd),
              path: cwd,
            } satisfies OusiaProjectRecord)
          projectsByPath.set(cwd, existingProject)
          projectId = existingProject.id
        }

        const title = firstUserTextFromJsonl(text) ?? "Restored session"
        const modified = await stat(filePath)
          .then((fileStat) => fileStat.mtime.toISOString())
          .catch(() => timestamp)
        sessions.push({
          id: sessionDir.name,
          projectId,
          title,
          time: modified,
        })
      }
    }
  }

  if (sessions.length <= baseState.sessions.length) {
    return null
  }

  const projects = [...projectsByPath.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  )
  const nextSessions = sessions.sort((left, right) =>
    right.time.localeCompare(left.time)
  )
  const selectedSession = nextSessions[0]

  return normalizeAppState({
    ...baseState,
    projects,
    sessions: nextSessions,
    expandedProjectIds: projects.map((project) => project.id),
    selectedProjectId: selectedSession.projectId ?? "",
    selectedSessionId: selectedSession.id,
  })
}

function normalizeAppState(state: OusiaAppState): OusiaAppState {
  return normalizeExpandedProjectIds({
    ...state,
    settings: normalizeSettings(state.settings),
    shellLayout: normalizeShellLayout(state.shellLayout),
    windowState: normalizeWindowState(state.windowState),
    workspaceTabs: normalizeWorkspaceTabs(state.workspaceTabs),
  })
}

type LegacyProjectRecord = OusiaProjectRecord & {
  sessions?: OusiaSessionRecord[]
}

type LegacyAppState = {
  schemaVersion?: number
  settings?: OusiaAppSettings
  projects?: LegacyProjectRecord[]
  selectedProjectId?: string
  selectedSessionId?: string
  selectedWorkspaceExtensionId?: string
  expandedProjectIds?: string[]
  workspaceTabs?: OusiaAppState["workspaceTabs"]
  shellLayout?: Partial<OusiaShellLayoutState>
  windowState?: Partial<OusiaWindowState>
}

function migrateSchema2AppState(value: unknown): OusiaAppState | null {
  if (!isRecord(value) || value.schemaVersion !== OUSIA_APP_STATE_SCHEMA_VERSION) {
    return null
  }

  const fallback = createDefaultOusiaAppState()
  const projects = Array.isArray(value.projects)
    ? value.projects.flatMap((project) =>
        isRecord(project) &&
        typeof project.id === "string" &&
        typeof project.name === "string" &&
        typeof project.path === "string"
          ? [{ id: project.id, name: project.name, path: project.path }]
          : []
      )
    : fallback.projects
  const sessions = Array.isArray(value.sessions)
    ? value.sessions.flatMap((session) =>
        isRecord(session) &&
        typeof session.id === "string" &&
        typeof session.title === "string" &&
        typeof session.time === "string"
          ? [
              {
                id: session.id,
                title: session.title,
                time: session.time,
                ...(typeof session.projectId === "string"
                  ? { projectId: session.projectId }
                  : {}),
              },
            ]
          : []
      )
    : fallback.sessions
  const nextSessions = sessions.length ? sessions : fallback.sessions

  return {
    ...fallback,
    settings: normalizeSettings(
      isRecord(value.settings) ? (value.settings as OusiaAppSettings) : fallback.settings
    ),
    sessions: nextSessions,
    projects,
    shellLayout: normalizeShellLayout(value.shellLayout),
    windowState: normalizeWindowState(value.windowState),
    expandedProjectIds: Array.isArray(value.expandedProjectIds)
      ? value.expandedProjectIds.filter(
          (projectId): projectId is string =>
            typeof projectId === "string" &&
            projects.some((project) => project.id === projectId)
        )
      : fallback.expandedProjectIds,
    selectedProjectId:
      typeof value.selectedProjectId === "string" ? value.selectedProjectId : "",
    selectedSessionId:
      typeof value.selectedSessionId === "string" &&
      nextSessions.some((session) => session.id === value.selectedSessionId)
        ? value.selectedSessionId
        : nextSessions[0].id,
    selectedWorkspaceExtensionId:
      typeof value.selectedWorkspaceExtensionId === "string"
        ? value.selectedWorkspaceExtensionId
        : fallback.selectedWorkspaceExtensionId,
    workspaceTabs: normalizeWorkspaceTabs(value.workspaceTabs),
  }
}

function migrateLegacyAppState(value: unknown): OusiaAppState | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const legacy = value as LegacyAppState
  if (legacy.schemaVersion !== 1 || !Array.isArray(legacy.projects)) {
    return null
  }

  const fallback = createDefaultOusiaAppState()
  const sessions: OusiaSessionRecord[] = []
  const projects: OusiaProjectRecord[] = []

  for (const project of legacy.projects) {
    if (
      !project ||
      typeof project.id !== "string" ||
      typeof project.name !== "string" ||
      typeof project.path !== "string"
    ) {
      continue
    }
    const isDefaultWorkDirProject = project.id === "default-workdir"
    if (!isDefaultWorkDirProject) {
      projects.push({
        id: project.id,
        name: project.name,
        path: project.path,
      })
    }
    for (const session of project.sessions ?? []) {
      if (
        session &&
        typeof session.id === "string" &&
        typeof session.title === "string"
      ) {
        sessions.push({
          ...session,
          projectId: isDefaultWorkDirProject ? undefined : project.id,
        })
      }
    }
  }

  const selectedSession =
    sessions.find((session) => session.id === legacy.selectedSessionId) ??
    sessions[0] ??
    createOusiaSession()
  const nextSessions = sessions.length ? sessions : [selectedSession]

  return {
    ...fallback,
    settings: normalizeSettings(legacy.settings ?? fallback.settings),
    sessions: nextSessions,
    projects,
    expandedProjectIds: Array.isArray(legacy.expandedProjectIds)
      ? legacy.expandedProjectIds.filter((projectId) =>
          projects.some((project) => project.id === projectId)
        )
      : projects.map((project) => project.id),
    selectedProjectId: selectedSession.projectId ?? "",
    selectedSessionId: selectedSession.id,
    selectedWorkspaceExtensionId:
      legacy.selectedWorkspaceExtensionId ??
      fallback.selectedWorkspaceExtensionId,
    shellLayout: normalizeShellLayout(legacy.shellLayout),
    windowState: normalizeWindowState(legacy.windowState),
    workspaceTabs: normalizeWorkspaceTabs(legacy.workspaceTabs),
  }
}

async function readNormalizedAppStateFromDisk(): Promise<OusiaAppState | null> {
  const filePath = appStatePath()
  if (!existsSync(filePath)) {
    return null
  }
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown
    if (isAppState(parsed)) {
      return normalizeAppState(parsed)
    }
    return migrateSchema2AppState(parsed) ?? migrateLegacyAppState(parsed)
  } catch {
    return null
  }
}

export async function loadAppState(): Promise<OusiaAppState> {
  const state =
    (await readNormalizedAppStateFromDisk()) ??
    normalizeAppState(createDefaultOusiaAppState())
  const recovered = await recoverAppStateFromSessionFiles(state)
  return recovered ?? state
}

export async function saveAppState(
  state: OusiaAppState
): Promise<OusiaAppStateSaveResult> {
  const filePath = appStatePath()
  mkdirSync(dirname(filePath), { recursive: true })
  const currentState = await readNormalizedAppStateFromDisk()
  const normalizedState = normalizeAppState({
    ...state,
    windowState: currentState?.windowState ?? state.windowState,
  })
  const recovered = await recoverAppStateFromSessionFiles(normalizedState)
  await writeFile(
    filePath,
    `${JSON.stringify(recovered ?? normalizedState, null, 2)}\n`,
    "utf8"
  )
  return { ok: true }
}

export async function saveWindowState(
  windowState: OusiaWindowState
): Promise<OusiaAppStateSaveResult> {
  const filePath = appStatePath()
  mkdirSync(dirname(filePath), { recursive: true })
  const currentState =
    (await readNormalizedAppStateFromDisk()) ??
    normalizeAppState(createDefaultOusiaAppState())
  const normalizedState = normalizeAppState({
    ...currentState,
    windowState: normalizeWindowState(windowState),
  })
  await writeFile(filePath, `${JSON.stringify(normalizedState, null, 2)}\n`, "utf8")
  return { ok: true }
}
