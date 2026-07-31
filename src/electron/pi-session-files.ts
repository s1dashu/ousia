import { mkdirSync, writeFileSync } from "node:fs"
import { unlink } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import {
  CURRENT_SESSION_VERSION,
  SessionManager,
} from "@earendil-works/pi-coding-agent"

import {
  textFromContent,
  type PiSessionEntry,
} from "./agent-conversation-history.js"
import type { OusiaChatContext } from "./chat-types.js"
import { expandHomePath } from "./host-paths.js"

export function piSessionKey(context: OusiaChatContext) {
  return `${context.projectPath}::${context.sessionId}`
}

export function getDefaultPiSessionDir(cwd: string) {
  return SessionManager.create(cwd).getSessionDir()
}

export async function findPiSessionByExactId(cwd: string, sessionId: string) {
  const sessions = await SessionManager.list(cwd)
  return sessions.find((session) => session.id === sessionId)
}

type DeletePersistedPiSessionFileDependencies = {
  deleteFile?: (path: string) => Promise<void>
  getSessionDir?: (cwd: string) => string
  listSessions?: typeof SessionManager.list
}

export async function deletePersistedPiSessionFile(
  cwd: string,
  sessionId: string,
  dependencies: DeletePersistedPiSessionFileDependencies = {}
) {
  const sessions = await (dependencies.listSessions ?? SessionManager.list)(cwd)
  const persistedSession = sessions.find((session) => session.id === sessionId)
  if (!persistedSession) {
    return null
  }
  const sessionDir = resolve(
    (dependencies.getSessionDir ?? getDefaultPiSessionDir)(cwd)
  )
  const sessionFile = resolve(persistedSession.path)
  if (dirname(sessionFile) !== sessionDir) {
    throw new Error(
      `Refused to delete Pi session outside its canonical directory: ${sessionFile}`
    )
  }
  await (dependencies.deleteFile ?? unlink)(sessionFile)
  return sessionFile
}

export async function openOrCreatePiSessionManager(
  cwd: string,
  sessionId: string
) {
  const existingSession = await findPiSessionByExactId(cwd, sessionId)
  return existingSession
    ? SessionManager.open(existingSession.path)
    : SessionManager.create(cwd, undefined, { id: sessionId })
}

function piEntryIdFromChatItemId(messageId: string) {
  return messageId.replace(/-text-\d+$/, "").replace(/-thinking-\d+$/, "")
}

function assistantTextFromSessionEntry(entry: PiSessionEntry) {
  if (entry.type !== "message") {
    return ""
  }
  const message = entry.message as unknown as Record<string, unknown>
  if (message.role !== "assistant") {
    return ""
  }
  return textFromContent(message.content)
}

export function findBranchLeafId(
  sessionManager: SessionManager,
  messageId: string,
  messageText: string | undefined
) {
  const directId = piEntryIdFromChatItemId(messageId)
  if (sessionManager.getEntry(directId)) {
    return directId
  }

  const normalizedMessageText = messageText?.trim()
  if (!normalizedMessageText) {
    return undefined
  }
  const entries = sessionManager.getEntries()
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (assistantTextFromSessionEntry(entry).trim() === normalizedMessageText) {
      return entry.id
    }
  }
  return undefined
}

export function createBranchedSessionFile({
  cwd,
  parentSessionFile,
  sourceSessionManager,
  targetConversationDir,
  targetSessionId,
  leafId,
  timestamp = new Date().toISOString(),
}: {
  cwd: string
  parentSessionFile: string
  sourceSessionManager: SessionManager
  targetConversationDir: string
  targetSessionId: string
  leafId: string
  timestamp?: string
}) {
  const path = sourceSessionManager.getBranch(leafId)
  if (!path.length) {
    throw new Error(`Entry ${leafId} not found`)
  }

  mkdirSync(targetConversationDir, { recursive: true })
  const fileTimestamp = timestamp.replace(/[:.]/g, "-")
  const targetFile = join(
    targetConversationDir,
    `${fileTimestamp}_${targetSessionId}.jsonl`
  )
  const header = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: targetSessionId,
    timestamp,
    cwd,
    parentSession: parentSessionFile,
  }
  let parentId: string | null = null
  const entries = path
    .filter((entry) => entry.type !== "label")
    .map((entry) => {
      const nextEntry = { ...entry, parentId }
      parentId = entry.id
      return nextEntry
    })

  writeFileSync(
    targetFile,
    [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") +
      "\n",
    { encoding: "utf8", flag: "wx" }
  )
  return targetFile
}

export function createMovedSessionFile({
  sourceSessionManager,
  targetConversationDir,
  targetCwd,
  targetSessionId,
  fallbackTimestamp,
}: {
  sourceSessionManager: SessionManager
  targetConversationDir: string
  targetCwd: string
  targetSessionId: string
  fallbackTimestamp?: string
}) {
  const sourceHeader = sourceSessionManager.getHeader()
  if (!sourceHeader) {
    throw new Error("Cannot move session: source session has no header.")
  }

  mkdirSync(targetConversationDir, { recursive: true })
  const timestamp =
    typeof sourceHeader.timestamp === "string"
      ? sourceHeader.timestamp
      : (fallbackTimestamp ?? new Date().toISOString())
  const fileTimestamp = timestamp.replace(/[:.]/g, "-")
  const targetFile = join(
    targetConversationDir,
    `${fileTimestamp}_${targetSessionId}.jsonl`
  )
  const targetHeader = {
    ...sourceHeader,
    version: CURRENT_SESSION_VERSION,
    id: targetSessionId,
    cwd: targetCwd,
  }
  writeFileSync(
    targetFile,
    [targetHeader, ...sourceSessionManager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
    { encoding: "utf8", flag: "wx" }
  )
  return targetFile
}

export async function findPiSessionFileForHistory(context: OusiaChatContext) {
  const cwd = expandHomePath(context.projectPath)
  const session = await findPiSessionByExactId(cwd, context.sessionId)
  return session ? { cwd, sessionFile: session.path } : undefined
}
