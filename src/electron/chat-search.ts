import type {
  OusiaAppState,
  OusiaChatHistoryItem,
  OusiaChatSearchResult,
  OusiaTextChatItem,
} from "./chat-types.js"

const SEARCH_QUERY_MAX_LENGTH = 200
const SEARCH_RESULT_LIMIT = 50
const SEARCH_READ_CONCURRENCY = 4

function normalizedSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase()
}

function searchSnippet(text: string, normalizedQuery: string) {
  const singleLine = text.replace(/\s+/g, " ").trim()
  const matchIndex = normalizedSearchText(singleLine).indexOf(normalizedQuery)
  if (matchIndex < 0) return undefined

  const start = Math.max(0, matchIndex - 56)
  const end = Math.min(
    singleLine.length,
    matchIndex + normalizedQuery.length + 96
  )
  return `${start > 0 ? "…" : ""}${singleLine.slice(start, end)}${end < singleLine.length ? "…" : ""}`
}

function searchableMessageText(item: OusiaChatHistoryItem) {
  return item.role === "user" || item.role === "assistant" ? item.text : ""
}

export function requireChatSearchQuery(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("query" in payload)) {
    throw new Error("Chat search payload must contain a query.")
  }
  const query = (payload as { query?: unknown }).query
  if (typeof query !== "string") {
    throw new Error("Chat search query must be a string.")
  }
  const trimmed = query.trim()
  if (trimmed.length > SEARCH_QUERY_MAX_LENGTH) {
    throw new Error(
      `Chat search query must not exceed ${SEARCH_QUERY_MAX_LENGTH} characters.`
    )
  }
  return trimmed
}

export function optionalChatSearchSessionId(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("sessionId" in payload)) {
    return undefined
  }
  const sessionId = (payload as { sessionId?: unknown }).sessionId
  if (sessionId === undefined) return undefined
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new Error("Chat search session id must be a non-empty string.")
  }
  return sessionId
}

type SearchChatHistoriesOptions = {
  getHistory: (context: {
    projectPath: string
    sessionId: string
  }) => Promise<OusiaChatHistoryItem[]>
  query: string
  sessionId?: string
  state: OusiaAppState
}

export async function searchChatHistories({
  getHistory,
  query,
  sessionId,
  state,
}: SearchChatHistoriesOptions): Promise<OusiaChatSearchResult> {
  if (!query) return { items: [] }

  const normalizedQuery = normalizedSearchText(query)
  const activeSessions = state.sessions.filter((session) => !session.archivedAt)
  if (sessionId) {
    const session = activeSessions.find(
      (candidate) => candidate.id === sessionId
    )
    if (!session) {
      throw new Error(
        `Cannot search unknown or archived session: ${sessionId}.`
      )
    }
    const project = session.projectId
      ? state.projects.find((candidate) => candidate.id === session.projectId)
      : undefined
    if (session.projectId && !project) {
      throw new Error(
        `Search encountered session ${session.id} with unknown project ${session.projectId}.`
      )
    }
    const items = await getHistory({
      projectPath: project?.path ?? state.settings.defaultSessionDir,
      sessionId: session.id,
    })
    return {
      items: items
        .filter(
          (item): item is OusiaTextChatItem & { role: "assistant" | "user" } =>
            item.role === "user" || item.role === "assistant"
        )
        .map((item) => ({
          item,
          snippet: searchSnippet(item.text, normalizedQuery),
        }))
        .filter(
          (match): match is { item: typeof match.item; snippet: string } =>
            Boolean(match.snippet)
        )
        .map(({ item, snippet }) => ({
          itemId: item.id,
          match: "content" as const,
          projectName: project?.name,
          role: item.role,
          sessionId: session.id,
          snippet,
          time: item.timestamp ?? session.time,
          title: session.title,
        }))
        .reverse()
        .slice(0, SEARCH_RESULT_LIMIT),
    }
  }
  const titleMatches = activeSessions
    .filter((session) =>
      normalizedSearchText(session.title).includes(normalizedQuery)
    )
    .map((session) => ({
      match: "title" as const,
      projectName: session.projectId
        ? state.projects.find((project) => project.id === session.projectId)
            ?.name
        : undefined,
      sessionId: session.id,
      time: session.time,
      title: session.title,
    }))
  const titleMatchIds = new Set(titleMatches.map((item) => item.sessionId))
  const sessionsToRead = activeSessions.filter(
    (session) => !titleMatchIds.has(session.id)
  )
  const contentMatches: OusiaChatSearchResult["items"] = []
  let nextSessionIndex = 0

  async function searchNextSession() {
    while (nextSessionIndex < sessionsToRead.length) {
      const session = sessionsToRead[nextSessionIndex++]
      const project = session.projectId
        ? state.projects.find((candidate) => candidate.id === session.projectId)
        : undefined
      if (session.projectId && !project) {
        throw new Error(
          `Search encountered session ${session.id} with unknown project ${session.projectId}.`
        )
      }
      const items = await getHistory({
        projectPath: project?.path ?? state.settings.defaultSessionDir,
        sessionId: session.id,
      })
      const snippet = items
        .map(searchableMessageText)
        .filter(Boolean)
        .map((text) => searchSnippet(text, normalizedQuery))
        .find((candidate): candidate is string => Boolean(candidate))
      if (snippet) {
        contentMatches.push({
          match: "content",
          projectName: project?.name,
          sessionId: session.id,
          snippet,
          time: session.time,
          title: session.title,
        })
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(SEARCH_READ_CONCURRENCY, sessionsToRead.length) },
      () => searchNextSession()
    )
  )

  const newestFirst = (left: { time: string }, right: { time: string }) =>
    right.time.localeCompare(left.time)
  return {
    items: [
      ...titleMatches.sort(newestFirst),
      ...contentMatches.sort(newestFirst),
    ].slice(0, SEARCH_RESULT_LIMIT),
  }
}
