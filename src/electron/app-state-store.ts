import { app } from "electron"
import { existsSync, mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  createDefaultOusiaAppState,
  createDefaultOusiaShellLayout,
  createDefaultOusiaWindowState,
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
} from "./chat-types.js"
import { expandHomePath } from "./host-paths.js"
import {
  MAIN_WINDOW_MIN_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
} from "./window-constants.js"

const appStateFileName = "app-state.json"
let appStateWriteQueue: Promise<void> = Promise.resolve()

function appStatePath() {
  return join(app.getPath("userData"), appStateFileName)
}

function enqueueAppStateWrite<T>(write: () => Promise<T>): Promise<T> {
  const queuedWrite = appStateWriteQueue.then(write, write)
  appStateWriteQueue = queuedWrite.then(
    () => undefined,
    () => undefined
  )
  return queuedWrite
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
    terminalPanelWidth: clampNumber(
      value.terminalPanelWidth,
      fallback.terminalPanelWidth,
      448,
      1600
    ),
    isSidebarCollapsed:
      typeof value.isSidebarCollapsed === "boolean"
        ? value.isSidebarCollapsed
        : fallback.isSidebarCollapsed,
    isTerminalPanelCollapsed:
      typeof value.isTerminalPanelCollapsed === "boolean"
        ? value.isTerminalPanelCollapsed
        : fallback.isTerminalPanelCollapsed,
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
    width: Math.round(
      clampNumber(value.width, fallback.width, MAIN_WINDOW_MIN_WIDTH, 10000)
    ),
    height: Math.round(
      clampNumber(value.height, fallback.height, MAIN_WINDOW_MIN_HEIGHT, 10000)
    ),
    isMaximized:
      typeof value.isMaximized === "boolean"
        ? value.isMaximized
        : fallback.isMaximized,
  }
}

function normalizeSettings(settings: OusiaAppSettings): OusiaAppSettings {
  const nextSettings = normalizeOusiaAppSettings({
    ...defaultOusiaAppSettings,
    ...settings,
  })

  if (nextSettings.defaultWorkDir === defaultOusiaAppSettings.defaultWorkDir) {
    mkdirSync(expandHomePath(nextSettings.defaultWorkDir), { recursive: true })
  }

  return nextSettings
}

function normalizeProjects(projects: unknown): OusiaProjectRecord[] {
  if (!Array.isArray(projects)) {
    return []
  }
  return projects.flatMap((project) =>
    isRecord(project) &&
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.path === "string"
      ? [{ id: project.id, name: project.name, path: project.path }]
      : []
  )
}

function normalizeSessions(sessions: unknown): OusiaSessionRecord[] {
  const fallback = createDefaultOusiaAppState().sessions
  if (!Array.isArray(sessions)) {
    return fallback
  }
  const nextSessions = sessions.flatMap((session) =>
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
  return nextSessions.length ? nextSessions : fallback
}

function normalizeExpandedProjectIds(
  expandedProjectIds: unknown,
  projects: OusiaProjectRecord[]
) {
  const projectIds = new Set(projects.map((project) => project.id))
  return Array.isArray(expandedProjectIds)
    ? [
        ...new Set(
          expandedProjectIds.filter(
            (projectId): projectId is string =>
              typeof projectId === "string" && projectIds.has(projectId)
          )
        ),
      ]
    : []
}

function normalizeDefaultWorkDirProjectReferences(
  settings: OusiaAppSettings,
  projects: OusiaProjectRecord[],
  sessions: OusiaSessionRecord[]
) {
  const defaultWorkDir = expandHomePath(settings.defaultWorkDir)
  const defaultProjectIds = new Set(
    projects
      .filter((project) => expandHomePath(project.path) === defaultWorkDir)
      .map((project) => project.id)
  )
  if (!defaultProjectIds.size) {
    return { projects, sessions }
  }

  return {
    projects: projects.filter((project) => !defaultProjectIds.has(project.id)),
    sessions: sessions.map((session) => {
      if (!session.projectId || !defaultProjectIds.has(session.projectId)) {
        return session
      }
      const { projectId, ...defaultSession } = session
      void projectId
      return defaultSession
    }),
  }
}

function normalizeAppState(value: unknown): OusiaAppState {
  const fallback = createDefaultOusiaAppState()
  if (
    !isRecord(value) ||
    value.schemaVersion !== OUSIA_APP_STATE_SCHEMA_VERSION ||
    !isRecord(value.settings)
  ) {
    return fallback
  }

  const settings = normalizeSettings(value.settings as OusiaAppSettings)
  const normalizedReferences = normalizeDefaultWorkDirProjectReferences(
    settings,
    normalizeProjects(value.projects),
    normalizeSessions(value.sessions)
  )
  const projects = normalizedReferences.projects
  const sessions = normalizedReferences.sessions
  const selectedSessionId =
    typeof value.selectedSessionId === "string" &&
    sessions.some((session) => session.id === value.selectedSessionId)
      ? value.selectedSessionId
      : sessions[0].id

  return {
    schemaVersion: OUSIA_APP_STATE_SCHEMA_VERSION,
    settings,
    sessions,
    projects,
    shellLayout: normalizeShellLayout(value.shellLayout),
    windowState: normalizeWindowState(value.windowState),
    expandedProjectIds: normalizeExpandedProjectIds(
      value.expandedProjectIds,
      projects
    ),
    selectedSessionId,
  }
}

async function readNormalizedAppStateFromDisk(): Promise<OusiaAppState | null> {
  const filePath = appStatePath()
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return normalizeAppState(JSON.parse(await readFile(filePath, "utf8")))
  } catch {
    return null
  }
}

export async function loadAppState(): Promise<OusiaAppState> {
  return (
    (await readNormalizedAppStateFromDisk()) ??
    normalizeAppState(createDefaultOusiaAppState())
  )
}

export async function saveAppState(
  state: OusiaAppState
): Promise<OusiaAppStateSaveResult> {
  return enqueueAppStateWrite(async () => {
    const filePath = appStatePath()
    mkdirSync(dirname(filePath), { recursive: true })
    const currentState = await readNormalizedAppStateFromDisk()
    const normalizedState = normalizeAppState({
      ...state,
      windowState: currentState?.windowState ?? state.windowState,
    })
    await writeFile(
      filePath,
      `${JSON.stringify(normalizedState, null, 2)}\n`,
      "utf8"
    )
    return { ok: true }
  })
}

export async function saveWindowState(
  windowState: OusiaWindowState
): Promise<OusiaAppStateSaveResult> {
  return enqueueAppStateWrite(async () => {
    const filePath = appStatePath()
    mkdirSync(dirname(filePath), { recursive: true })
    const currentState =
      (await readNormalizedAppStateFromDisk()) ??
      normalizeAppState(createDefaultOusiaAppState())
    const normalizedState = normalizeAppState({
      ...currentState,
      windowState: normalizeWindowState(windowState),
    })
    await writeFile(
      filePath,
      `${JSON.stringify(normalizedState, null, 2)}\n`,
      "utf8"
    )
    return { ok: true }
  })
}
