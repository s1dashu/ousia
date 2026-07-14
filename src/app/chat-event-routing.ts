import type { OusiaChatContext } from "@/electron/chat-types"

export type ChatEventTarget<T extends { id: string }> =
  | {
      kind: "context"
      session: T
      targetKey: string
    }
  | {
      kind: "selected"
      targetKey: string
    }
  | {
      context: OusiaChatContext
      kind: "drop"
      reason: "unknown-context-session"
    }
  | {
      kind: "drop"
      reason: "missing-selected-chat"
    }

export function chatKey(projectPath: string, sessionId: string) {
  return `${projectPath}::${sessionId}`
}

export function findWorkingChatSession<T extends { id: string }>(
  sessions: readonly T[],
  projectPath: string,
  runStatusByChatKey: Readonly<
    Record<string, "idle" | "working" | undefined>
  >
) {
  return sessions.find(
    (session) =>
      runStatusByChatKey[chatKey(projectPath, session.id)] === "working"
  )
}

export function resolveChatEventTarget<T extends { id: string }>(
  sessions: readonly T[],
  context: OusiaChatContext | undefined,
  selectedChatKey: string | null | undefined
): ChatEventTarget<T> {
  if (context) {
    const session = sessions.find(
      (candidate) => candidate.id === context.sessionId
    )
    if (!session) {
      return {
        context,
        kind: "drop",
        reason: "unknown-context-session",
      }
    }
    return {
      kind: "context",
      session,
      targetKey: chatKey(context.projectPath, session.id),
    }
  }

  if (!selectedChatKey) {
    return {
      kind: "drop",
      reason: "missing-selected-chat",
    }
  }

  return {
    kind: "selected",
    targetKey: selectedChatKey,
  }
}
