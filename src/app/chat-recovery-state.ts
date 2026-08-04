import type { OusiaChatEvent } from "@/electron/chat-types"
import type { ChatItem } from "@/features/chat/chat-events"

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

/**
 * Completed-session history can briefly lag the live stream when Pi aborts a
 * tool: the tool_end event has already made the live item terminal while the
 * in-memory branch still exposes an orphaned toolCall as running. Never let
 * that stale snapshot move a tool backwards out of a terminal state.
 */
export function reconcileCompletedChatItems(
  liveItems: ChatItem[],
  historyItems: ChatItem[]
) {
  const terminalLiveTools = new Map(
    liveItems.flatMap((item) =>
      item.role === "tool" && item.status !== "running"
        ? [[item.id, item] as const]
        : []
    )
  )

  if (!terminalLiveTools.size) {
    return historyItems
  }

  return historyItems.map((item) => {
    if (item.role !== "tool" || item.status !== "running") {
      return item
    }
    const liveItem = terminalLiveTools.get(item.id)
    if (!liveItem) {
      return item
    }
    return {
      ...item,
      status: liveItem.status,
    }
  })
}
