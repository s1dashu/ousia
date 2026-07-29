import type {
  OusiaChatContext,
  OusiaChatEvent,
  OusiaChatEventReplaySnapshot,
  OusiaSequencedChatEvent,
} from "./chat-types.js"

type ReplayState = {
  events: OusiaSequencedChatEvent[]
}

function replayKey(context: OusiaChatContext) {
  return JSON.stringify([context.projectPath, context.sessionId])
}

function eventWithContext(
  event: OusiaChatEvent,
  context: OusiaChatContext | undefined
): OusiaChatEvent {
  return context ? { ...event, context } : event
}

function chatItemEventId(event: OusiaChatEvent) {
  return "id" in event ? event.id : undefined
}

function replaceLatestEvent(
  events: OusiaSequencedChatEvent[],
  candidate: OusiaSequencedChatEvent,
  matches: (event: OusiaChatEvent) => boolean
) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (!matches(events[index].event)) {
      continue
    }
    const next = [...events]
    next[index] = candidate
    return next
  }
  return [...events, candidate]
}

function compactReplayEvents(
  events: OusiaSequencedChatEvent[],
  candidate: OusiaSequencedChatEvent
) {
  const event = candidate.event
  if (
    event.type === "assistant_text_delta" ||
    event.type === "thinking_delta"
  ) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const previous = events[index]
      if (
        previous.event.type !== event.type ||
        previous.event.id !== event.id
      ) {
        continue
      }
      const next = [...events]
      next[index] = {
        event: {
          ...event,
          delta: previous.event.delta + event.delta,
        },
        sequence: candidate.sequence,
      }
      return next
    }
  }
  if (event.type === "assistant_text_end" || event.type === "thinking_end") {
    const startType =
      event.type === "assistant_text_end"
        ? "assistant_text_start"
        : "thinking_start"
    const deltaType =
      event.type === "assistant_text_end"
        ? "assistant_text_delta"
        : "thinking_delta"
    return events.filter(
      (entry) =>
        !(
          chatItemEventId(entry.event) === event.id &&
          (entry.event.type === startType ||
            entry.event.type === deltaType ||
            entry.event.type === event.type)
        )
    )
  }
  if (event.type === "tool_end") {
    return events.filter(
      (entry) =>
        !(
          chatItemEventId(entry.event) === event.id &&
          (entry.event.type === "tool_start" ||
            entry.event.type === "tool_update" ||
            entry.event.type === "tool_input_end" ||
            entry.event.type === "tool_end")
        )
    )
  }
  if (
    event.type === "context_usage" ||
    event.type === "queue_update" ||
    event.type === "run_status"
  ) {
    return replaceLatestEvent(
      events,
      candidate,
      (previous) => previous.type === event.type
    )
  }
  if (event.type === "status_message") {
    if (event.status === "removed") {
      return events.filter(
        (entry) =>
          !(
            entry.event.type === "status_message" && entry.event.id === event.id
          )
      )
    }
    return replaceLatestEvent(
      events,
      candidate,
      (previous) =>
        previous.type === "status_message" && previous.id === event.id
    )
  }
  if (event.type === "tool_update") {
    return replaceLatestEvent(
      events,
      candidate,
      (previous) =>
        previous.type === "tool_update" &&
        previous.id === event.id &&
        previous.phase === event.phase
    )
  }
  return [...events, candidate]
}

export function createChatEventReplayStore() {
  const states = new Map<string, ReplayState>()
  let latestSequence = 0

  function record(
    event: OusiaChatEvent,
    context?: OusiaChatContext
  ): OusiaSequencedChatEvent {
    latestSequence += 1
    const entry = {
      event: eventWithContext(event, context),
      sequence: latestSequence,
    }
    if (!context) {
      return entry
    }

    const key = replayKey(context)
    const current = states.get(key)
    if (event.type === "run_status" && event.status === "starting") {
      states.set(key, {
        events: [entry],
      })
      return entry
    }
    if (!current) {
      if (event.type === "run_status" && event.status === "running") {
        states.set(key, {
          events: [entry],
        })
      }
      return entry
    }
    if (event.type === "run_status" && event.status === "finished") {
      states.delete(key)
      return entry
    }

    const events = compactReplayEvents(current.events, entry)
    states.set(key, { events })
    return entry
  }

  function snapshot(): OusiaChatEventReplaySnapshot {
    return {
      events: [...states.values()]
        .flatMap((state) => state.events)
        .sort((left, right) => left.sequence - right.sequence),
      latestSequence,
    }
  }

  function clear(context: OusiaChatContext) {
    states.delete(replayKey(context))
  }

  return {
    clear,
    record,
    snapshot,
  }
}
