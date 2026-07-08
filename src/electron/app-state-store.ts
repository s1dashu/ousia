import { app } from "electron"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
} from "node:fs"
import { readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  createOusiaProject,
  createOusiaSession,
  createDefaultOusiaAppState,
  createDefaultOusiaShellLayout,
  createDefaultOusiaWindowState,
  defaultOusiaAppSettings,
  normalizeOusiaAppSettings,
  OUSIA_LEGACY_DEFAULT_WORK_DIR,
  OUSIA_APP_STATE_SCHEMA_VERSION,
  type OusiaAppStateCreateProjectPayload,
  type OusiaAppStateCreateSessionPayload,
  type OusiaAppStateDeleteProjectPayload,
  type OusiaAppStateDeleteSessionPayload,
  type OusiaAppStateMoveSessionPayload,
  type OusiaAppStateRenameSessionPayload,
  type OusiaAppStateReorderProjectsPayload,
  type OusiaAppStateReorderSessionsPayload,
  type OusiaAppSettings,
  type OusiaAppStateSettingsPayload,
  type OusiaAppState,
  type OusiaAppStateSaveResult,
  type OusiaAppStateSelectionPayload,
  type OusiaAppStateShellLayoutPayload,
  type OusiaAppStateTouchSessionPayload,
  type OusiaAppStateTransactionResult,
  type OusiaProjectRecord,
  type OusiaSessionRecord,
  type OusiaShellLayoutState,
  type OusiaWindowState,
} from "./chat-types.js"
import { expandHomePath } from "./host-paths.js"
import { writeRuntimeLog } from "./runtime-logger.js"
import {
  MAIN_WINDOW_MIN_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
} from "./window-constants.js"
import { readPiAutoRetryOnFailure } from "./pi-environment.js"

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
    sidebarWidth: clampNumber(value.sidebarWidth, fallback.sidebarWidth, 200, 320),
    isSidebarCollapsed:
      typeof value.isSidebarCollapsed === "boolean"
        ? value.isSidebarCollapsed
        : fallback.isSidebarCollapsed,
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
  let nextSettings = normalizeOusiaAppSettings({
    ...defaultOusiaAppSettings,
    ...settings,
  })

  try {
    nextSettings = {
      ...nextSettings,
      autoRetryOnFailure: readPiAutoRetryOnFailure(),
    }
  } catch (error) {
    writeRuntimeLog("app-state", "warn", {
      message: "Failed to read Pi retry setting",
      error: error instanceof Error ? error.message : String(error),
    })
  }

  migrateLegacyDefaultWorkDir()

  if (nextSettings.defaultWorkDir === defaultOusiaAppSettings.defaultWorkDir) {
    mkdirSync(expandHomePath(nextSettings.defaultWorkDir), { recursive: true })
  }

  return nextSettings
}

function migrateLegacyDefaultWorkDir() {
  const legacyDefaultWorkDir = expandHomePath(OUSIA_LEGACY_DEFAULT_WORK_DIR)
  const defaultWorkDir = expandHomePath(defaultOusiaAppSettings.defaultWorkDir)
  if (
    legacyDefaultWorkDir === defaultWorkDir ||
    !existsSync(legacyDefaultWorkDir)
  ) {
    return
  }

  mkdirSync(defaultWorkDir, { recursive: true })
  for (const entry of readdirSync(legacyDefaultWorkDir)) {
    const sourcePath = join(legacyDefaultWorkDir, entry)
    const targetPath = join(defaultWorkDir, entry)
    if (existsSync(targetPath)) {
      writeRuntimeLog("app-state", "warn", {
        message: "Skipped legacy default work dir item because target exists",
        sourcePath,
        targetPath,
      })
      continue
    }
    renameSync(sourcePath, targetPath)
  }

  try {
    rmdirSync(legacyDefaultWorkDir)
    writeRuntimeLog("app-state", "info", {
      message: "Migrated legacy default work dir",
      from: legacyDefaultWorkDir,
      to: defaultWorkDir,
    })
  } catch (error) {
    writeRuntimeLog("app-state", "warn", {
      message: "Legacy default work dir was migrated but not removed",
      error: error instanceof Error ? error.message : String(error),
      path: legacyDefaultWorkDir,
    })
  }
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

function reorderById<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string
) {
  if (sourceId === targetId) {
    return items
  }
  const sourceIndex = items.findIndex((item) => item.id === sourceId)
  const targetIndex = items.findIndex((item) => item.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) {
    return items
  }
  const next = [...items]
  const [source] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, source)
  return next
}

function withSessionProjectId(
  session: OusiaSessionRecord,
  projectId: string | undefined
): OusiaSessionRecord {
  if (!projectId) {
    const { projectId: _projectId, ...defaultSession } = session
    void _projectId
    return defaultSession
  }
  return { ...session, projectId }
}

function reorderSessionsById(
  sessions: OusiaSessionRecord[],
  sourceSessionId: string,
  targetSessionId: string
) {
  const sourceSession = sessions.find((session) => session.id === sourceSessionId)
  const targetSession = sessions.find((session) => session.id === targetSessionId)
  if (
    !sourceSession ||
    !targetSession ||
    sourceSession.projectId !== targetSession.projectId
  ) {
    return sessions
  }
  return reorderById(sessions, sourceSessionId, targetSessionId)
}

function moveSessionToProjectGroup(
  sessions: OusiaSessionRecord[],
  sessionId: string,
  targetProjectId: string | undefined,
  targetSessionId?: string
) {
  const normalizedTargetProjectId = targetProjectId || undefined
  const sourceSession = sessions.find((session) => session.id === sessionId)
  if (!sourceSession) {
    return sessions
  }

  const targetSession = targetSessionId
    ? sessions.find((session) => session.id === targetSessionId)
    : undefined
  const canInsertBeforeTarget =
    Boolean(targetSession) &&
    targetSession?.id !== sessionId &&
    (targetSession?.projectId || undefined) === normalizedTargetProjectId
  if (
    (sourceSession.projectId || undefined) === normalizedTargetProjectId &&
    (!targetSessionId || canInsertBeforeTarget)
  ) {
    return canInsertBeforeTarget
      ? reorderSessionsById(sessions, sessionId, targetSessionId!)
      : sessions
  }

  const movedSession = withSessionProjectId(
    sourceSession,
    normalizedTargetProjectId
  )
  const remainingSessions = sessions.filter((session) => session.id !== sessionId)
  const targetIndex = canInsertBeforeTarget
    ? remainingSessions.findIndex((session) => session.id === targetSessionId)
    : -1
  const groupStartIndex = remainingSessions.findIndex(
    (session) => (session.projectId || undefined) === normalizedTargetProjectId
  )
  const insertIndex =
    targetIndex >= 0
      ? targetIndex
      : groupStartIndex >= 0
        ? groupStartIndex
        : remainingSessions.length
  const next = [...remainingSessions]
  next.splice(insertIndex, 0, movedSession)
  return next
}

function moveSessionToGroupFront(
  sessions: OusiaSessionRecord[],
  sessionId: string,
  time: string
) {
  const targetSession = sessions.find((session) => session.id === sessionId)
  if (!targetSession) {
    return sessions
  }
  const updatedSession = { ...targetSession, time }
  const remainingSessions = sessions.filter((session) => session.id !== sessionId)
  const groupStartIndex = remainingSessions.findIndex(
    (session) => session.projectId === targetSession.projectId
  )
  if (groupStartIndex < 0) {
    return [updatedSession, ...remainingSessions]
  }
  const next = [...remainingSessions]
  next.splice(groupStartIndex, 0, updatedSession)
  return next
}

function includeExpandedProjectId(
  expandedProjectIds: string[],
  projectId: string | undefined
) {
  if (!projectId || expandedProjectIds.includes(projectId)) {
    return expandedProjectIds
  }
  return [...expandedProjectIds, projectId]
}

function createSessionForProject(
  title: string | undefined,
  projectId: string | undefined
) {
  const normalizedTitle = title?.trim() || "新会话"
  const session = createOusiaSession(normalizedTitle)
  return projectId ? { ...session, projectId } : session
}

type AppStateTransactionMetadata = Omit<
  Extract<OusiaAppStateTransactionResult, { ok: true }>,
  "ok" | "state"
>

async function updateAppState(
  mutate: (state: OusiaAppState) => {
    metadata?: AppStateTransactionMetadata
    state: OusiaAppState
  }
): Promise<OusiaAppStateTransactionResult> {
  return enqueueAppStateWrite(async () => {
    const filePath = appStatePath()
    mkdirSync(dirname(filePath), { recursive: true })
    const currentState =
      (await readNormalizedAppStateFromDisk()) ??
      normalizeAppState(createDefaultOusiaAppState())

    try {
      const transaction = mutate(currentState)
      const normalizedState = normalizeAppState(transaction.state)
      await writeNormalizedAppStateFile(filePath, normalizedState)
      return {
        ok: true,
        state: normalizedState,
        ...transaction.metadata,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeRuntimeLog("app-state", "warn", {
        error: message,
        message: "Rejected app state transaction",
      })
      return {
        ok: false,
        error: message,
        state: currentState,
      }
    }
  })
}

async function readNormalizedAppStateFile(
  filePath: string
): Promise<OusiaAppState | null> {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const fileText = await readFile(filePath, "utf8")
    const sanitizedFileText = fileText.includes('"data:image/')
      ? fileText.replace(/("url"\s*:\s*)"data:image\/[^"]*"/g, '$1""')
      : fileText
    return normalizeAppState(JSON.parse(sanitizedFileText))
  } catch (error) {
    writeRuntimeLog("app-state", "warn", "Failed to read app state", {
      error: error instanceof Error ? error.message : String(error),
      filePath,
    })
    return null
  }
}

async function readNormalizedAppStateFromDisk(): Promise<OusiaAppState | null> {
  return readNormalizedAppStateFile(appStatePath())
}

async function writeNormalizedAppStateFile(
  filePath: string,
  state: OusiaAppState
) {
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${Date.now()}.${process.pid}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8")
    await rename(temporaryPath, filePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export async function loadAppState(): Promise<OusiaAppState> {
  return enqueueAppStateWrite(async () => {
    const filePath = appStatePath()
    const state = await readNormalizedAppStateFile(filePath)
    if (state) {
      return state
    }

    const defaultState = normalizeAppState(createDefaultOusiaAppState())
    if (!existsSync(filePath)) {
      await writeNormalizedAppStateFile(filePath, defaultState)
    }
    return defaultState
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
    await writeNormalizedAppStateFile(filePath, normalizedState)
    return { ok: true }
  })
}

export async function saveAppStateSettings(
  payload: OusiaAppStateSettingsPayload
): Promise<OusiaAppStateTransactionResult> {
  return updateAppState((state) => ({
    state: {
      ...state,
      settings: normalizeSettings(payload.settings),
    },
  }))
}

export async function saveAppStateShellLayout(
  payload: OusiaAppStateShellLayoutPayload
): Promise<OusiaAppStateTransactionResult> {
  return updateAppState((state) => ({
    state: {
      ...state,
      shellLayout: normalizeShellLayout(payload.shellLayout),
    },
  }))
}

export async function saveAppStateSelection(
  payload: OusiaAppStateSelectionPayload
): Promise<OusiaAppStateTransactionResult> {
  return updateAppState((state) => ({
    state: {
      ...state,
      expandedProjectIds:
        payload.expandedProjectIds ?? state.expandedProjectIds,
      selectedSessionId: payload.selectedSessionId ?? state.selectedSessionId,
    },
  }))
}

export async function createAppStateSession(
  payload: OusiaAppStateCreateSessionPayload
): Promise<OusiaAppStateTransactionResult> {
  return updateAppState((state) => {
    const projectId = payload.projectId || undefined
    if (projectId && !state.projects.some((project) => project.id === projectId)) {
      throw new Error(`Unknown project: ${projectId}`)
    }

    const session = createSessionForProject(payload.title, projectId)
    return {
      metadata: { session },
      state: {
        ...state,
        expandedProjectIds: includeExpandedProjectId(
          state.expandedProjectIds,
          projectId
        ),
        selectedSessionId:
          payload.select === false ? state.selectedSessionId : session.id,
        sessions: [session, ...state.sessions],
      },
    }
  })
}

export async function deleteAppStateSession(
  payload: OusiaAppStateDeleteSessionPayload
): Promise<OusiaAppStateTransactionResult> {
  return updateAppState((state) => {
    const session = state.sessions.find((item) => item.id === payload.sessionId)
    if (!session) {
      throw new Error(`Unknown session: ${payload.sessionId}`)
    }

    const sessions = state.sessions.filter((item) => item.id !== payload.sessionId)
    return {
      metadata: { removedSessions: [session] },
      state: {
        ...state,
        selectedSessionId:
          state.selectedSessionId === payload.sessionId
            ? (sessions[0]?.id ?? "")
            : state.selectedSessionId,
        sessions,
      },
    }
  })
}

export async function renameAppStateSession(
  payload: OusiaAppStateRenameSessionPayload
): Promise<OusiaAppStateTransactionResult> {
  return updateAppState((state) => {
    const title = payload.title.trim()
    if (!title) {
      throw new Error("Session title cannot be empty.")
    }
    const session = state.sessions.find((item) => item.id === payload.sessionId)
    if (!session) {
      throw new Error(`Unknown session: ${payload.sessionId}`)
    }
    const renamedSession = { ...session, title }

    return {
      metadata: { session: renamedSession },
      state: {
        ...state,
        sessions: state.sessions.map((candidate) =>
          candidate.id === payload.sessionId ? renamedSession : candidate
        ),
      },
    }
  })
}

export async function moveAppStateSession(
  payload: OusiaAppStateMoveSessionPayload
): Promise<OusiaAppStateTransactionResult> {
  return updateAppState((state) => {
    const targetProjectId = payload.targetProjectId || undefined
    if (
      targetProjectId &&
      !state.projects.some((project) => project.id === targetProjectId)
    ) {
      throw new Error(`Unknown project: ${targetProjectId}`)
    }
    if (!state.sessions.some((session) => session.id === payload.sessionId)) {
      throw new Error(`Unknown session: ${payload.sessionId}`)
    }

    const sessions = moveSessionToProjectGroup(
      state.sessions,
      payload.sessionId,
      targetProjectId,
      payload.targetSessionId
    )
    const session = sessions.find((item) => item.id === payload.sessionId)
    return {
      metadata: session ? { session } : undefined,
      state: {
        ...state,
        expandedProjectIds: includeExpandedProjectId(
          state.expandedProjectIds,
          targetProjectId
        ),
        sessions,
      },
    }
  })
}

export async function reorderAppStateSessions(
  payload: OusiaAppStateReorderSessionsPayload
): Promise<OusiaAppStateTransactionResult> {
  return updateAppState((state) => ({
    state: {
      ...state,
      sessions: reorderSessionsById(
        state.sessions,
        payload.sourceSessionId,
        payload.targetSessionId
      ),
    },
  }))
}

export async function touchAppStateSession(
  payload: OusiaAppStateTouchSessionPayload
): Promise<OusiaAppStateTransactionResult> {
  return updateAppState((state) => {
    if (!state.sessions.some((session) => session.id === payload.sessionId)) {
      throw new Error(`Unknown session: ${payload.sessionId}`)
    }
    return {
      state: {
        ...state,
        sessions: moveSessionToGroupFront(
          state.sessions,
          payload.sessionId,
          payload.time
        ),
      },
    }
  })
}

export async function createAppStateProject(
  payload: OusiaAppStateCreateProjectPayload
): Promise<OusiaAppStateTransactionResult> {
  return updateAppState((state) => {
    const path = payload.path.trim()
    if (!path) {
      throw new Error("Project path cannot be empty.")
    }

    const existingProject = state.projects.find((project) => project.path === path)
    const project = existingProject ?? createOusiaProject(path, payload.name)
    const existingSession = state.sessions.find(
      (session) => session.projectId === project.id
    )
    const shouldSelectSession = payload.selectOrCreateSession ?? true
    const createdSession =
      shouldSelectSession && !existingSession
        ? createSessionForProject(payload.sessionTitle, project.id)
        : undefined
    const targetSession = existingSession ?? createdSession

    return {
      metadata: {
        project,
        ...(targetSession ? { session: targetSession } : {}),
      },
      state: {
        ...state,
        expandedProjectIds: includeExpandedProjectId(
          state.expandedProjectIds,
          project.id
        ),
        projects: existingProject ? state.projects : [...state.projects, project],
        selectedSessionId:
          shouldSelectSession && targetSession
            ? targetSession.id
            : state.selectedSessionId,
        sessions: createdSession
          ? [createdSession, ...state.sessions]
          : state.sessions,
      },
    }
  })
}

export async function deleteAppStateProject(
  payload: OusiaAppStateDeleteProjectPayload
): Promise<OusiaAppStateTransactionResult> {
  return updateAppState((state) => {
    const project = state.projects.find((item) => item.id === payload.projectId)
    if (!project) {
      throw new Error(`Unknown project: ${payload.projectId}`)
    }

    const removedSessions = state.sessions.filter(
      (session) => session.projectId === payload.projectId
    )
    const sessions = state.sessions.filter(
      (session) => session.projectId !== payload.projectId
    )
    const selectedSessionWasRemoved = removedSessions.some(
      (session) => session.id === state.selectedSessionId
    )

    return {
      metadata: { project, removedSessions },
      state: {
        ...state,
        expandedProjectIds: state.expandedProjectIds.filter(
          (projectId) => projectId !== payload.projectId
        ),
        projects: state.projects.filter((item) => item.id !== payload.projectId),
        selectedSessionId: selectedSessionWasRemoved
          ? (sessions[0]?.id ?? "")
          : state.selectedSessionId,
        sessions,
      },
    }
  })
}

export async function reorderAppStateProjects(
  payload: OusiaAppStateReorderProjectsPayload
): Promise<OusiaAppStateTransactionResult> {
  return updateAppState((state) => ({
    state: {
      ...state,
      projects: reorderById(
        state.projects,
        payload.sourceProjectId,
        payload.targetProjectId
      ),
    },
  }))
}
