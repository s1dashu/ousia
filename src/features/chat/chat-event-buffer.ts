import type { OusiaChatEvent } from "@/electron/chat-types"

export const CHAT_TEXT_STREAM_RENDER_INTERVAL_MS = 32
export const CHAT_TOOL_INPUT_RENDER_INTERVAL_MS = 80

type TextDeltaChatEvent = Extract<
  OusiaChatEvent,
  { type: "assistant_text_delta" | "thinking_delta" }
>
type ToolUpdateChatEvent = Extract<OusiaChatEvent, { type: "tool_update" }>

function isTextDeltaEvent(
  event: OusiaChatEvent | undefined,
): event is TextDeltaChatEvent {
  return (
    event?.type === "assistant_text_delta" || event?.type === "thinking_delta"
  )
}

function canMergeTextDeltaEvents(
  previousEvent: OusiaChatEvent | undefined,
  nextEvent: TextDeltaChatEvent,
): previousEvent is TextDeltaChatEvent {
  return (
    isTextDeltaEvent(previousEvent) &&
    previousEvent.type === nextEvent.type &&
    previousEvent.id === nextEvent.id
  )
}

function canReplaceToolInputUpdate(
  previousEvent: OusiaChatEvent | undefined,
  nextEvent: ToolUpdateChatEvent,
): previousEvent is ToolUpdateChatEvent {
  return (
    previousEvent?.type === "tool_update" &&
    previousEvent.phase === "input" &&
    nextEvent.phase === "input" &&
    previousEvent.id === nextEvent.id
  )
}

/**
 * Adds an event to a per-session render buffer. Returns true when the event was
 * folded into the previous entry instead of increasing the buffered work.
 *
 * Text deltas are incremental, so they must be concatenated. Pi tool-input
 * updates contain the complete accumulated input snapshot, so only the newest
 * adjacent snapshot is needed. Protocol boundaries remain separate entries.
 */
export function appendBufferedChatEvent(
  events: OusiaChatEvent[],
  event: OusiaChatEvent,
) {
  const previousEvent = events.at(-1)
  if (
    isTextDeltaEvent(event) &&
    canMergeTextDeltaEvents(previousEvent, event)
  ) {
    events[events.length - 1] = {
      ...event,
      delta: previousEvent.delta + event.delta,
    }
    return true
  }

  if (
    event.type === "tool_update" &&
    canReplaceToolInputUpdate(previousEvent, event)
  ) {
    events[events.length - 1] = {
      ...previousEvent,
      ...event,
      filePreview: event.filePreview ?? previousEvent.filePreview,
      name: event.name ?? previousEvent.name,
      value: event.value === undefined ? previousEvent.value : event.value,
    }
    return true
  }

  events.push(event)
  return false
}

/**
 * Expensive streaming views should not be rebuilt for every provider token.
 * Zero means that a lifecycle/boundary event is committed on the next frame.
 */
export function chatEventRenderInterval(event: OusiaChatEvent) {
  if (
    event.type === "assistant_text_delta" ||
    event.type === "thinking_delta"
  ) {
    return CHAT_TEXT_STREAM_RENDER_INTERVAL_MS
  }
  if (event.type === "tool_update" && event.phase === "input") {
    return CHAT_TOOL_INPUT_RENDER_INTERVAL_MS
  }
  return 0
}

/**
 * Tool-input previews are already bounded to a low visual cadence. Committing
 * those snapshots at transition priority allows a sustained provider stream to
 * interrupt every render and leave the preview stuck on its initial state.
 * Keep text rendering interruptible, but promote the bounded tool-input path
 * and its lifecycle boundaries so visible progress has a hard guarantee.
 */
export function chatEventRequiresNonStarvableCommit(event: OusiaChatEvent) {
  return (
    event.type === "tool_start" ||
    event.type === "tool_input_end" ||
    event.type === "tool_end" ||
    (event.type === "tool_update" && event.phase === "input")
  )
}
