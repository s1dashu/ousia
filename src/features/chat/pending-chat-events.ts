import type { OusiaChatEvent } from "@/electron/chat-types"
import { applyChatEvent, type ChatItem } from "@/features/chat/chat-events"

export type TextDeltaChatEvent = Extract<
  OusiaChatEvent,
  { type: "assistant_text_delta" | "thinking_delta" }
>

export function isTextDeltaEvent(
  event: OusiaChatEvent | undefined
): event is TextDeltaChatEvent {
  return (
    event?.type === "assistant_text_delta" || event?.type === "thinking_delta"
  )
}

export function canMergeTextDeltaEvents(
  previousEvent: OusiaChatEvent | undefined,
  nextEvent: TextDeltaChatEvent
): previousEvent is TextDeltaChatEvent {
  return (
    isTextDeltaEvent(previousEvent) &&
    previousEvent.type === nextEvent.type &&
    previousEvent.id === nextEvent.id
  )
}

/**
 * Buffers a chat event for the given target key, coalescing consecutive
 * text deltas for the same message so a flush applies far fewer events.
 */
export function queuePendingChatEvent(
  pendingEvents: Map<string, OusiaChatEvent[]>,
  targetKey: string,
  event: OusiaChatEvent
) {
  const targetEvents = pendingEvents.get(targetKey)
  if (!targetEvents) {
    pendingEvents.set(targetKey, [event])
    return
  }
  const previousEvent = targetEvents[targetEvents.length - 1]
  if (isTextDeltaEvent(event) && canMergeTextDeltaEvents(previousEvent, event)) {
    targetEvents[targetEvents.length - 1] = {
      ...event,
      delta: previousEvent.delta + event.delta,
    } as TextDeltaChatEvent
    return
  }
  targetEvents.push(event)
}

/**
 * Applies every buffered event to the current items-by-session map and
 * returns the next map. Sessions whose items did not change keep their
 * previous array reference so memoized lists are not re-rendered.
 */
export function applyPendingChatEvents(
  current: Record<string, ChatItem[]>,
  pendingEvents: Map<string, OusiaChatEvent[]>
) {
  let nextBySession = current
  for (const [targetKey, events] of pendingEvents) {
    let nextItems = current[targetKey] ?? []
    for (const event of events) {
      nextItems = applyChatEvent(nextItems, event)
    }
    if (nextItems !== current[targetKey]) {
      if (nextBySession === current) {
        nextBySession = { ...current }
      }
      nextBySession[targetKey] = nextItems
    }
  }
  return nextBySession
}
