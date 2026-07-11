import { createHash } from "node:crypto"

export function chatMessageIdFingerprint(messageId: string) {
  return createHash("sha256").update(messageId).digest("hex").slice(0, 12)
}

export class ChatMessageReplayGuard {
  private readonly messagesBySession = new Map<string, Map<string, true>>()

  constructor(
    private readonly maxMessagesPerSession = 512,
    private readonly maxSessions = 128
  ) {
    if (
      !Number.isInteger(maxMessagesPerSession) ||
      maxMessagesPerSession <= 0 ||
      !Number.isInteger(maxSessions) ||
      maxSessions <= 0
    ) {
      throw new Error("Chat message replay bounds must be positive integers.")
    }
  }

  claim(sessionId: string, messageId: string) {
    const existing = this.messagesBySession.get(sessionId)
    if (existing?.has(messageId)) {
      throw new Error("Duplicate chat message id.")
    }

    const messages = existing ?? new Map<string, true>()
    messages.set(messageId, true)
    while (messages.size > this.maxMessagesPerSession) {
      const oldestMessageId = messages.keys().next().value
      if (oldestMessageId === undefined) {
        throw new Error("Chat message replay guard lost its oldest message id.")
      }
      messages.delete(oldestMessageId)
    }

    if (existing) {
      this.messagesBySession.delete(sessionId)
    }
    this.messagesBySession.set(sessionId, messages)
    while (this.messagesBySession.size > this.maxSessions) {
      const oldestSessionId = this.messagesBySession.keys().next().value
      if (oldestSessionId === undefined) {
        throw new Error("Chat message replay guard lost its oldest session id.")
      }
      this.messagesBySession.delete(oldestSessionId)
    }
  }
}
