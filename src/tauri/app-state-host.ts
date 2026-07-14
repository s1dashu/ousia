import { invoke } from "@tauri-apps/api/core"

import {
  createDefaultOusiaAppState,
  createOusiaProject,
  createOusiaSession,
  normalizeOusiaAppSettings,
  OUSIA_APP_STATE_SCHEMA_VERSION,
  type OusiaAppState,
  type OusiaAppStateArchiveProjectPayload,
  type OusiaAppStateCreateProjectPayload,
  type OusiaAppStateCreateSessionPayload,
  type OusiaAppStateDeleteProjectPayload,
  type OusiaAppStateDeleteSessionPayload,
  type OusiaAppStateMoveSessionPayload,
  type OusiaAppStateRenameSessionPayload,
  type OusiaAppStateReorderProjectsPayload,
  type OusiaAppStateReorderSessionsPayload,
  type OusiaAppStateSelectionPayload,
  type OusiaAppStateSessionIdsPayload,
  type OusiaAppStateSettingsPayload,
  type OusiaAppStateShellLayoutPayload,
  type OusiaAppStateTouchSessionPayload,
  type OusiaAppStateTransactionResult,
  type OusiaProjectRecord,
  type OusiaSessionRecord,
} from "@/electron/chat-types"

let cachedState: OusiaAppState | undefined
let transactionQueue = Promise.resolve()

function cloneState(state: OusiaAppState): OusiaAppState {
  return structuredClone(state)
}

function requireLoadedState(value: unknown): OusiaAppState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Persisted app state must be a JSON object.")
  }
  const state = value as Partial<OusiaAppState>
  if (state.schemaVersion !== OUSIA_APP_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported app-state schema: ${String(state.schemaVersion)}. Expected ${OUSIA_APP_STATE_SCHEMA_VERSION}.`
    )
  }
  if (
    !Array.isArray(state.sessions) ||
    !Array.isArray(state.projects) ||
    !state.settings ||
    !state.shellLayout ||
    !state.windowState ||
    !Array.isArray(state.expandedProjectIds) ||
    typeof state.selectedSessionId !== "string"
  ) {
    throw new Error("Persisted app state is missing required fields.")
  }
  const settings = normalizeOusiaAppSettings(state.settings)
  const storedDefaultSessionDir =
    typeof state.settings.defaultSessionDir === "string" &&
    state.settings.defaultSessionDir.trim()
      ? state.settings.defaultSessionDir.trim()
      : settings.defaultSessionDir
  const sessions = state.sessions.map((session) => {
    if (!session || typeof session !== "object" || session.agentProvider !== "pi") {
      throw new Error("Persisted sessions must use the Pi agent provider.")
    }
    if (!session.projectId && !session.workingDirectory) {
      return { ...session, workingDirectory: storedDefaultSessionDir }
    }
    return session
  })
  return {
    ...(state as OusiaAppState),
    settings,
    sessions,
  }
}

async function persistState(state: OusiaAppState) {
  await invoke("save_app_state", { state })
}

export async function loadAppState(): Promise<OusiaAppState> {
  if (cachedState) {
    return cloneState(cachedState)
  }
  const stored = await invoke<unknown>("load_app_state")
  if (stored === null) {
    const initial = createDefaultOusiaAppState()
    await persistState(initial)
    cachedState = initial
    return cloneState(initial)
  }
  const normalized = requireLoadedState(stored)
  if (JSON.stringify(normalized) !== JSON.stringify(stored)) {
    await persistState(normalized)
  }
  cachedState = normalized
  return cloneState(cachedState)
}

type MutationMetadata = {
  session?: OusiaSessionRecord
  project?: OusiaProjectRecord
  removedSessions?: OusiaSessionRecord[]
}

async function mutateState(
  mutation: (state: OusiaAppState) => {
    state: OusiaAppState
    metadata?: MutationMetadata
  }
): Promise<OusiaAppStateTransactionResult> {
  const operation = transactionQueue.then(async () => {
    let current: OusiaAppState | undefined
    try {
      current = await loadAppState()
      const transaction = mutation(current)
      await persistState(transaction.state)
      cachedState = transaction.state
      return {
        ok: true,
        state: cloneState(transaction.state),
        ...structuredClone(transaction.metadata ?? {}),
      } satisfies OusiaAppStateTransactionResult
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        ...(current ? { state: cloneState(current) } : {}),
      } satisfies OusiaAppStateTransactionResult
    }
  })
  transactionQueue = operation.then(() => undefined)
  return operation
}

function requireSession(state: OusiaAppState, sessionId: string) {
  const session = state.sessions.find((candidate) => candidate.id === sessionId)
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`)
  }
  return session
}

function requireDistinctSessions(state: OusiaAppState, sessionIds: string[]) {
  const ids = [...new Set(sessionIds)]
  if (!ids.length) {
    throw new Error("At least one session id is required.")
  }
  return ids.map((id) => requireSession(state, id))
}

function includeExpandedProjectId(ids: string[], projectId?: string) {
  return projectId && !ids.includes(projectId) ? [...ids, projectId] : ids
}

function moveBefore<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string
) {
  if (sourceId === targetId) return items
  const sourceIndex = items.findIndex((item) => item.id === sourceId)
  const targetIndex = items.findIndex((item) => item.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) {
    throw new Error(`Cannot reorder unknown ids: ${sourceId}, ${targetId}`)
  }
  const next = [...items]
  const [source] = next.splice(sourceIndex, 1)
  if (!source) throw new Error(`Unknown source id: ${sourceId}`)
  const insertionIndex = next.findIndex((item) => item.id === targetId)
  next.splice(insertionIndex, 0, source)
  return next
}

function archiveSessionsInState(state: OusiaAppState, sessionIds: string[]) {
  const sessionsToArchive = requireDistinctSessions(state, sessionIds)
  const alreadyArchived = sessionsToArchive.find((session) => session.archivedAt)
  if (alreadyArchived) {
    throw new Error(`Session is already archived: ${alreadyArchived.id}`)
  }
  const ids = new Set(sessionIds)
  const archivedAt = new Date().toISOString()
  let sessions = state.sessions.map((session) =>
    ids.has(session.id) ? { ...session, archivedAt } : session
  )
  let active = sessions.filter((session) => !session.archivedAt)
  if (!active.length) {
    const replacement = createOusiaSession(
      "新会话",
      "pi",
      state.settings.defaultSessionDir,
    )
    sessions = [replacement, ...sessions]
    active = [replacement]
  }
  return {
    ...state,
    selectedSessionId: ids.has(state.selectedSessionId)
      ? (active[0]?.id ?? "")
      : state.selectedSessionId,
    sessions,
  }
}

export const appStateHost = {
  loadAppState,

  saveAppSettings(payload: OusiaAppStateSettingsPayload) {
    return mutateState((state) => ({
      state: { ...state, settings: normalizeOusiaAppSettings(payload.settings) },
    }))
  },

  saveShellLayout(payload: OusiaAppStateShellLayoutPayload) {
    return mutateState((state) => ({
      state: { ...state, shellLayout: payload.shellLayout },
    }))
  },

  saveAppSelection(payload: OusiaAppStateSelectionPayload) {
    return mutateState((state) => ({
      state: {
        ...state,
        expandedProjectIds: payload.expandedProjectIds ?? state.expandedProjectIds,
        selectedSessionId: payload.selectedSessionId ?? state.selectedSessionId,
      },
    }))
  },

  createSession(payload: OusiaAppStateCreateSessionPayload) {
    return mutateState((state) => {
      const projectId = payload.projectId || undefined
      if (projectId && !state.projects.some((project) => project.id === projectId)) {
        throw new Error(`Unknown project: ${projectId}`)
      }
      if (payload.agentProvider && payload.agentProvider !== "pi") {
        throw new Error(`Unsupported agent provider: ${payload.agentProvider}`)
      }
      const session = {
        ...createOusiaSession(
          payload.title,
          "pi",
          projectId ? undefined : state.settings.defaultSessionDir,
        ),
        ...(projectId ? { projectId } : {}),
      }
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
  },

  deleteSession(payload: OusiaAppStateDeleteSessionPayload) {
    return mutateState((state) => {
      const session = requireSession(state, payload.sessionId)
      const sessions = state.sessions.filter((item) => item.id !== payload.sessionId)
      return {
        metadata: { removedSessions: [session] },
        state: {
          ...state,
          selectedSessionId:
            state.selectedSessionId === payload.sessionId
              ? (sessions.find((item) => !item.archivedAt)?.id ?? "")
              : state.selectedSessionId,
          sessions,
        },
      }
    })
  },

  archiveSessions(payload: OusiaAppStateSessionIdsPayload) {
    return mutateState((state) => ({
      state: archiveSessionsInState(state, payload.sessionIds),
    }))
  },

  archiveProjectSessions(payload: OusiaAppStateArchiveProjectPayload) {
    return mutateState((state) => {
      if (!state.projects.some((project) => project.id === payload.projectId)) {
        throw new Error(`Unknown project: ${payload.projectId}`)
      }
      const ids = state.sessions
        .filter(
          (session) => session.projectId === payload.projectId && !session.archivedAt
        )
        .map((session) => session.id)
      return { state: ids.length ? archiveSessionsInState(state, ids) : state }
    })
  },

  restoreSessions(payload: OusiaAppStateSessionIdsPayload) {
    return mutateState((state) => {
      const sessions = requireDistinctSessions(state, payload.sessionIds)
      const active = sessions.find((session) => !session.archivedAt)
      if (active) throw new Error(`Session is not archived: ${active.id}`)
      const ids = new Set(payload.sessionIds)
      return {
        state: {
          ...state,
          sessions: state.sessions.map((session) => {
            if (!ids.has(session.id)) return session
            const { archivedAt: _archivedAt, ...restored } = session
            void _archivedAt
            return restored
          }),
        },
      }
    })
  },

  async deleteSessions(payload: OusiaAppStateSessionIdsPayload) {
    const state = await loadAppState()
    const sessions = requireDistinctSessions(state, payload.sessionIds)
    const active = sessions.find((session) => !session.archivedAt)
    if (active) {
      return {
        ok: false as const,
        error: `Only archived sessions can be permanently deleted: ${active.id}`,
        state,
      }
    }
    await invoke("delete_pi_sessions", { sessionIds: payload.sessionIds })
    return mutateState((current) => {
      const removedSessions = requireDistinctSessions(current, payload.sessionIds)
      const ids = new Set(payload.sessionIds)
      return {
        metadata: { removedSessions },
        state: {
          ...current,
          sessions: current.sessions.filter((session) => !ids.has(session.id)),
        },
      }
    })
  },

  renameSession(payload: OusiaAppStateRenameSessionPayload) {
    return mutateState((state) => {
      const title = payload.title.trim()
      if (!title) throw new Error("Session title cannot be empty.")
      const renamed = { ...requireSession(state, payload.sessionId), title }
      return {
        metadata: { session: renamed },
        state: {
          ...state,
          sessions: state.sessions.map((session) =>
            session.id === renamed.id ? renamed : session
          ),
        },
      }
    })
  },

  moveSession(payload: OusiaAppStateMoveSessionPayload) {
    return mutateState((state) => {
      const targetProjectId = payload.targetProjectId || undefined
      if (
        targetProjectId &&
        !state.projects.some((project) => project.id === targetProjectId)
      ) {
        throw new Error(`Unknown project: ${targetProjectId}`)
      }
      const moving = requireSession(state, payload.sessionId)
      const { projectId: _projectId, workingDirectory: _workingDirectory, ...rest } =
        moving
      void _projectId
      void _workingDirectory
      const moved = targetProjectId
        ? { ...rest, projectId: targetProjectId }
        : { ...rest, workingDirectory: state.settings.defaultSessionDir }
      const without = state.sessions.filter((session) => session.id !== moving.id)
      let index = payload.targetSessionId
        ? without.findIndex((session) => session.id === payload.targetSessionId)
        : without.findIndex((session) => session.projectId === targetProjectId)
      if (index < 0) index = without.length
      without.splice(index, 0, moved)
      return {
        metadata: { session: moved },
        state: {
          ...state,
          expandedProjectIds: includeExpandedProjectId(
            state.expandedProjectIds,
            targetProjectId
          ),
          sessions: without,
        },
      }
    })
  },

  reorderSessions(payload: OusiaAppStateReorderSessionsPayload) {
    return mutateState((state) => ({
      state: {
        ...state,
        sessions: moveBefore(
          state.sessions,
          payload.sourceSessionId,
          payload.targetSessionId
        ),
      },
    }))
  },

  touchSession(payload: OusiaAppStateTouchSessionPayload) {
    return mutateState((state) => {
      const touched = { ...requireSession(state, payload.sessionId), time: payload.time }
      const without = state.sessions.filter((session) => session.id !== touched.id)
      const firstInGroup = without.findIndex(
        (session) => session.projectId === touched.projectId
      )
      without.splice(firstInGroup < 0 ? without.length : firstInGroup, 0, touched)
      return { state: { ...state, sessions: without } }
    })
  },

  createProject(payload: OusiaAppStateCreateProjectPayload) {
    return mutateState((state) => {
      const path = payload.path.trim()
      if (!path) throw new Error("Project path cannot be empty.")
      const existing = state.projects.find((project) => project.path === path)
      const project = existing ?? createOusiaProject(path, payload.name)
      const existingSession = state.sessions.find(
        (session) => session.projectId === project.id && !session.archivedAt
      )
      const shouldSelect = payload.selectOrCreateSession ?? true
      const session =
        shouldSelect && !existingSession
          ? { ...createOusiaSession(payload.sessionTitle), projectId: project.id }
          : existingSession
      return {
        metadata: { project, ...(session ? { session } : {}) },
        state: {
          ...state,
          expandedProjectIds: includeExpandedProjectId(
            state.expandedProjectIds,
            project.id
          ),
          projects: existing ? state.projects : [...state.projects, project],
          selectedSessionId:
            shouldSelect && session ? session.id : state.selectedSessionId,
          sessions:
            session && !existingSession ? [session, ...state.sessions] : state.sessions,
        },
      }
    })
  },

  deleteProject(payload: OusiaAppStateDeleteProjectPayload) {
    return mutateState((state) => {
      const project = state.projects.find((item) => item.id === payload.projectId)
      if (!project) throw new Error(`Unknown project: ${payload.projectId}`)
      const removedSessions = state.sessions.filter(
        (session) => session.projectId === project.id
      )
      const sessions = state.sessions.filter(
        (session) => session.projectId !== project.id
      )
      return {
        metadata: { project, removedSessions },
        state: {
          ...state,
          projects: state.projects.filter((item) => item.id !== project.id),
          expandedProjectIds: state.expandedProjectIds.filter(
            (id) => id !== project.id
          ),
          selectedSessionId: removedSessions.some(
            (session) => session.id === state.selectedSessionId
          )
            ? (sessions.find((session) => !session.archivedAt)?.id ?? "")
            : state.selectedSessionId,
          sessions,
        },
      }
    })
  },

  reorderProjects(payload: OusiaAppStateReorderProjectsPayload) {
    return mutateState((state) => ({
      state: {
        ...state,
        projects: moveBefore(
          state.projects,
          payload.sourceProjectId,
          payload.targetProjectId
        ),
      },
    }))
  },
}
