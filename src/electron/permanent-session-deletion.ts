import type { AgentConversationProvider } from "./agent-provider-router.js"
import type {
  OusiaAppState,
  OusiaAppStateSessionIdsPayload,
  OusiaAppStateTransactionResult,
  OusiaSessionRecord,
} from "./chat-types.js"

type PermanentSessionDeletionDependencies = {
  deleteAppStateSessions: (
    payload: OusiaAppStateSessionIdsPayload
  ) => Promise<OusiaAppStateTransactionResult>
  loadAppState: () => Promise<OusiaAppState>
  provider: Pick<AgentConversationProvider, "deleteChatSession">
  writeLog: (
    source: string,
    level: "debug" | "info" | "warn" | "error",
    fields: Record<string, unknown>
  ) => void
}

function projectPathForSession(
  state: OusiaAppState,
  session: OusiaSessionRecord
) {
  if (!session.projectId) {
    return state.settings.defaultSessionDir
  }
  const project = state.projects.find(
    (candidate) => candidate.id === session.projectId
  )
  if (!project) {
    throw new Error(
      `Session references an unknown project: ${session.projectId} (session: ${session.id})`
    )
  }
  return project.path
}

function requireArchivedSessions(state: OusiaAppState, sessionIds: string[]) {
  const distinctIds = [...new Set(sessionIds)]
  if (!distinctIds.length) {
    throw new Error("At least one session id is required.")
  }
  return distinctIds.map((sessionId) => {
    const session = state.sessions.find(
      (candidate) => candidate.id === sessionId
    )
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`)
    }
    if (!session.archivedAt) {
      throw new Error(
        `Only archived sessions can be permanently deleted: ${sessionId}`
      )
    }
    return session
  })
}

export async function permanentlyDeleteArchivedSessions(
  payload: OusiaAppStateSessionIdsPayload,
  dependencies: PermanentSessionDeletionDependencies
): Promise<OusiaAppStateTransactionResult> {
  let state = await dependencies.loadAppState()
  let sessions: OusiaSessionRecord[]
  try {
    sessions = requireArchivedSessions(state, payload.sessionIds)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      state,
    }
  }

  const removedSessions: OusiaSessionRecord[] = []
  for (const session of sessions) {
    try {
      dependencies.writeLog("app-state.permanent-delete", "info", {
        agentProvider: session.agentProvider,
        phase: "provider-delete-started",
        sessionId: session.id,
      })
      await dependencies.provider.deleteChatSession({
        projectPath: projectPathForSession(state, session),
        sessionId: session.id,
      })
      dependencies.writeLog("app-state.permanent-delete", "info", {
        agentProvider: session.agentProvider,
        phase: "provider-delete-finished",
        sessionId: session.id,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      dependencies.writeLog("app-state.permanent-delete", "error", {
        agentProvider: session.agentProvider,
        error: message,
        phase: "provider-delete-failed",
        sessionId: session.id,
      })
      return {
        error: `Failed to permanently delete session ${session.id}: ${message}`,
        ok: false,
        state,
      }
    }

    const stateResult = await dependencies.deleteAppStateSessions({
      sessionIds: [session.id],
    })
    if (!stateResult.ok) {
      dependencies.writeLog("app-state.permanent-delete", "error", {
        error: stateResult.error,
        phase: "state-delete-failed-after-provider-delete",
        sessionId: session.id,
      })
      return stateResult
    }
    state = stateResult.state
    removedSessions.push(session)
  }

  return {
    ok: true,
    removedSessions,
    state,
  }
}
