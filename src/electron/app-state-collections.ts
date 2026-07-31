import type {
  OusiaProjectRecord,
  OusiaSessionRecord,
  OusiaSidebarSectionId,
} from "./chat-types.js"

export function reorderById<T extends { id: string }>(
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

export function withSessionProjectId(
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

export function reorderSessionsById(
  sessions: OusiaSessionRecord[],
  sourceSessionId: string,
  targetSessionId: string
) {
  const sourceSession = sessions.find(
    (session) => session.id === sourceSessionId
  )
  const targetSession = sessions.find(
    (session) => session.id === targetSessionId
  )
  if (
    !sourceSession ||
    !targetSession ||
    sourceSession.projectId !== targetSession.projectId
  ) {
    return sessions
  }
  return reorderById(sessions, sourceSessionId, targetSessionId)
}

export function moveSessionToProjectGroup(
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
  const remainingSessions = sessions.filter(
    (session) => session.id !== sessionId
  )
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

export function moveSessionToGroupFront(
  sessions: OusiaSessionRecord[],
  sessionId: string,
  time: string
) {
  const targetSession = sessions.find((session) => session.id === sessionId)
  if (!targetSession) {
    return sessions
  }
  const updatedSession = { ...targetSession, time }
  const remainingSessions = sessions.filter(
    (session) => session.id !== sessionId
  )
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

export function includeExpandedProjectId(
  expandedProjectIds: string[],
  projectId: string | undefined
) {
  if (!projectId || expandedProjectIds.includes(projectId)) {
    return expandedProjectIds
  }
  return [...expandedProjectIds, projectId]
}

export function projectPathForAppStateSession(
  state: {
    projects: OusiaProjectRecord[]
    settings: { defaultSessionDir: string }
  },
  session: OusiaSessionRecord
) {
  if (!session.projectId) {
    return state.settings.defaultSessionDir
  }
  return (
    state.projects.find((project) => project.id === session.projectId)?.path ??
    state.settings.defaultSessionDir
  )
}

export function isOusiaSidebarSectionId(
  value: string
): value is OusiaSidebarSectionId {
  return value === "sessions" || value === "projects"
}

export function normalizeOusiaSidebarSectionOrder(
  sectionOrder: OusiaSidebarSectionId[]
): OusiaSidebarSectionId[] {
  return [
    ...new Set(
      [...sectionOrder, "sessions", "projects"].filter(isOusiaSidebarSectionId)
    ),
  ]
}
