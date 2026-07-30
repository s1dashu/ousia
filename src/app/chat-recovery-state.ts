import type { OusiaChatEvent } from "@/electron/chat-types"

export type DiscardedPendingChatEvents = {
  eventCount: number
  eventTypes: OusiaChatEvent["type"][]
}

export function discardSupersededPendingChatEvents(
  pendingEventsBySession: Map<string, OusiaChatEvent[]>,
  targetKey: string
): DiscardedPendingChatEvents {
  const pendingEvents = pendingEventsBySession.get(targetKey)
  if (!pendingEvents?.length) {
    return { eventCount: 0, eventTypes: [] }
  }

  pendingEventsBySession.delete(targetKey)
  return {
    eventCount: pendingEvents.length,
    eventTypes: pendingEvents.map((event) => event.type),
  }
}
