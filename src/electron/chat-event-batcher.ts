import type { OusiaChatContext, OusiaChatEvent } from "./chat-types.js"

type BatchedChatEvent = {
  context?: OusiaChatContext
  event: OusiaChatEvent
}

type ChatEventBatcherOptions<THandle> = {
  cancel: (handle: THandle) => void
  emit: (event: OusiaChatEvent, context?: OusiaChatContext) => void
  schedule: (callback: () => void) => THandle
}

function isTextDeltaEvent(
  event: OusiaChatEvent
): event is Extract<
  OusiaChatEvent,
  { type: "assistant_text_delta" | "thinking_delta" }
> {
  return (
    event.type === "assistant_text_delta" || event.type === "thinking_delta"
  )
}

function hasSameContext(
  left: OusiaChatContext | undefined,
  right: OusiaChatContext | undefined
) {
  return (
    left === right ||
    (left?.projectPath === right?.projectPath &&
      left?.sessionId === right?.sessionId)
  )
}

export function createChatEventBatcher<THandle>({
  cancel,
  emit,
  schedule,
}: ChatEventBatcherOptions<THandle>) {
  let pending: BatchedChatEvent[] = []
  let scheduledFlush: THandle | undefined

  function flush() {
    if (scheduledFlush !== undefined) {
      cancel(scheduledFlush)
      scheduledFlush = undefined
    }
    const events = pending
    pending = []
    for (const item of events) {
      emit(item.event, item.context)
    }
  }

  function enqueue(event: OusiaChatEvent, context?: OusiaChatContext) {
    if (!isTextDeltaEvent(event)) {
      flush()
      emit(event, context)
      return
    }

    const previous = pending.at(-1)
    if (
      previous &&
      isTextDeltaEvent(previous.event) &&
      previous.event.type === event.type &&
      previous.event.id === event.id &&
      hasSameContext(previous.context, context)
    ) {
      previous.event = {
        ...event,
        delta: previous.event.delta + event.delta,
      }
    } else {
      pending.push({ context, event })
    }

    scheduledFlush ??= schedule(() => {
      scheduledFlush = undefined
      flush()
    })
  }

  return {
    dispose: flush,
    enqueue,
    flush,
  }
}
