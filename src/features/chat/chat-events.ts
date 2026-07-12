import type {
  OusiaChatAttachmentSummary,
  OusiaChatEvent,
  OusiaChatHistoryItem,
  OusiaTextChatItem,
} from "@/electron/chat-types"

export type ChatItem = OusiaChatHistoryItem
type TextChatItem = OusiaTextChatItem

function findItemIndexFromEnd(items: ChatItem[], id: string) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].id === id) {
      return index
    }
  }
  return -1
}

function replaceItem(
  items: ChatItem[],
  index: number,
  item: ChatItem
): ChatItem[] {
  if (items[index] === item) {
    return items
  }
  const next = [...items]
  next[index] = item
  return next
}

function textItemChanged(previous: TextChatItem, next: TextChatItem) {
  return (
    previous.text !== next.text ||
    previous.status !== next.status ||
    previous.timestamp !== next.timestamp
  )
}

function attachmentSummariesEqual(
  left: OusiaChatAttachmentSummary[] | undefined,
  right: OusiaChatAttachmentSummary[] | undefined
) {
  const leftItems = left ?? []
  const rightItems = right ?? []
  return (
    leftItems.length === rightItems.length &&
    leftItems.every((attachment, index) => {
      const candidate = rightItems[index]
      return (
        candidate !== undefined &&
        attachment.id === candidate.id &&
        attachment.kind === candidate.kind &&
        attachment.mediaType === candidate.mediaType &&
        attachment.name === candidate.name &&
        attachment.size === candidate.size &&
        attachment.dataBase64 === candidate.dataBase64
      )
    })
  )
}

function earliestTimestamp(left: string | undefined, right: string) {
  return left && left <= right ? left : right
}

function userMessageStatus(
  current: OusiaTextChatItem["status"] | undefined,
  delivery: Extract<OusiaChatEvent, { type: "user_message" }>["delivery"]
) {
  if (current === "failed" || delivery === "failed") {
    return "failed" as const
  }
  if (delivery === "optimistic") {
    return "finished" as const
  }
  return current
}

function upsertTextItem(
  items: ChatItem[],
  id: string,
  role: "assistant" | "thinking",
  update: (item: TextChatItem) => void
) {
  const index = findItemIndexFromEnd(items, id)
  if (index >= 0) {
    const item = items[index]
    if (item.role !== "assistant" && item.role !== "thinking") {
      return items
    }
    const updated: TextChatItem = { ...item }
    update(updated)
    return textItemChanged(item, updated)
      ? replaceItem(items, index, updated)
      : items
  }

  const created: TextChatItem = {
    id,
    role,
    text: "",
    status: "streaming",
  }
  update(created)
  return [...items, created]
}

export function applyChatEvent(
  items: ChatItem[],
  event: OusiaChatEvent
): ChatItem[] {
  if (event.type === "user_message") {
    const index = findItemIndexFromEnd(items, event.id)
    if (index >= 0) {
      const item = items[index]
      if (item.role !== "user") {
        throw new Error(`Chat event id collision for user message: ${event.id}`)
      }
      if (
        item.text !== event.text ||
        !attachmentSummariesEqual(item.attachments, event.attachments)
      ) {
        throw new Error(`Conflicting user message confirmation: ${event.id}`)
      }
      const timestamp = earliestTimestamp(item.timestamp, event.timestamp)
      const status = userMessageStatus(item.status, event.delivery)
      return timestamp === item.timestamp && status === item.status
        ? items
        : replaceItem(items, index, { ...item, status, timestamp })
    }
    const status = userMessageStatus(undefined, event.delivery)
    return [
      ...items,
      {
        id: event.id,
        role: "user",
        text: event.text,
        attachments: event.attachments,
        ...(status ? { status } : {}),
        timestamp: event.timestamp,
      },
    ]
  } else if (event.type === "user_message_failed") {
    const index = findItemIndexFromEnd(items, event.id)
    if (index < 0) {
      throw new Error(`Failed user message is missing: ${event.id}`)
    }
    const item = items[index]
    if (item.role !== "user") {
      throw new Error(`Chat event id collision for user failure: ${event.id}`)
    }
    return item.status === "failed"
      ? items
      : replaceItem(items, index, { ...item, status: "failed" })
  } else if (event.type === "assistant_text_start") {
    return upsertTextItem(items, event.id, "assistant", (item) => {
      item.status = "streaming"
      item.timestamp = event.timestamp
    })
  } else if (event.type === "assistant_text_delta") {
    return upsertTextItem(items, event.id, "assistant", (item) => {
      item.text += event.delta
      item.status = "streaming"
      item.timestamp = event.timestamp
    })
  } else if (event.type === "assistant_text_end") {
    return upsertTextItem(items, event.id, "assistant", (item) => {
      item.text = event.text ?? item.text
      item.status = "finished"
      item.timestamp = event.timestamp
    })
  } else if (event.type === "thinking_start") {
    return upsertTextItem(items, event.id, "thinking", (item) => {
      item.status = "streaming"
      item.timestamp = event.timestamp
    })
  } else if (event.type === "thinking_delta") {
    return upsertTextItem(items, event.id, "thinking", (item) => {
      item.text += event.delta
      item.status = "streaming"
      item.timestamp = event.timestamp
    })
  } else if (event.type === "thinking_end") {
    return upsertTextItem(items, event.id, "thinking", (item) => {
      item.text = event.text ?? item.text
      item.status = "finished"
      item.timestamp = event.timestamp
    })
  } else if (event.type === "tool_start") {
    const input = formatToolPayload(event.args)
    const index = findItemIndexFromEnd(items, event.id)
    const existingItem = index >= 0 ? items[index] : undefined
    if (existingItem?.role === "tool") {
      const updated = {
        ...existingItem,
        name: event.name,
        text: input || existingItem.text,
        input: input || existingItem.input,
        filePreview: event.filePreview ?? existingItem.filePreview,
        status: "running",
      } satisfies ChatItem
      if (
        updated.name === existingItem.name &&
        updated.text === existingItem.text &&
        updated.input === existingItem.input &&
        updated.filePreview === existingItem.filePreview &&
        updated.status === existingItem.status
      ) {
        return items
      }
      return replaceItem(items, index, updated)
    }
    return [
      ...items,
      {
        id: event.id,
        role: "tool",
        name: event.name,
        text: input,
        input,
        filePreview: event.filePreview,
        status: "running",
      },
    ]
  } else if (event.type === "tool_update") {
    const index = findItemIndexFromEnd(items, event.id)
    const existingItem = index >= 0 ? items[index] : undefined
    if (existingItem?.role === "tool") {
      const value = formatToolPayload(event.value)
      if (event.phase === "input") {
        const updated = {
          ...existingItem,
          name: event.name ?? existingItem.name,
          text: value || existingItem.text,
          input: value || existingItem.input,
          filePreview: event.filePreview ?? existingItem.filePreview,
        }
        if (
          updated.name === existingItem.name &&
          updated.text === existingItem.text &&
          updated.input === existingItem.input &&
          updated.filePreview === existingItem.filePreview
        ) {
          return items
        }
        return replaceItem(items, index, updated)
      }
      const updated = {
        ...existingItem,
        name: event.name ?? existingItem.name,
        text: value || existingItem.text,
        output: value || existingItem.output,
        filePreview: event.filePreview ?? existingItem.filePreview,
      }
      if (
        updated.name === existingItem.name &&
        updated.text === existingItem.text &&
        updated.output === existingItem.output &&
        updated.filePreview === existingItem.filePreview
      ) {
        return items
      }
      return replaceItem(items, index, updated)
    }
    return items
  } else if (event.type === "tool_input_end") {
    const index = findItemIndexFromEnd(items, event.id)
    const existingItem = index >= 0 ? items[index] : undefined
    if (existingItem?.role !== "tool" || existingItem.inputComplete === true) {
      return items
    }
    return replaceItem(items, index, {
      ...existingItem,
      inputComplete: true,
    })
  } else if (event.type === "tool_end") {
    const index = findItemIndexFromEnd(items, event.id)
    const existingItem = index >= 0 ? items[index] : undefined
    if (existingItem?.role === "tool") {
      const result = formatToolPayload(event.result)
      const updated = {
        ...existingItem,
        name: event.name ?? existingItem.name,
        text: result || existingItem.text,
        output: event.isError
          ? existingItem.output
          : result || existingItem.output,
        errorText: event.isError ? result || existingItem.errorText : undefined,
        filePreview: event.filePreview ?? existingItem.filePreview,
        status: event.isError ? "failed" : "finished",
      }
      if (
        updated.name === existingItem.name &&
        updated.text === existingItem.text &&
        updated.output === existingItem.output &&
        updated.errorText === existingItem.errorText &&
        updated.filePreview === existingItem.filePreview &&
        updated.status === existingItem.status
      ) {
        return items
      }
      return replaceItem(items, index, updated)
    }
    return items
  } else if (event.type === "run_status") {
    let next: ChatItem[] | undefined = event.text ? [...items] : undefined
    if (event.status === "finished") {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        if (item.role === "tool" && item.status === "running") {
          next ??= [...items]
          next[index] = {
            ...item,
            status: "finished",
          }
        }
      }
    }
    if (event.text) {
      next!.push({
        id: `status-${event.timestamp}`,
        role: "system",
        text: event.text,
      })
    }
    return next ?? items
  } else if (event.type === "status_message") {
    const index = findItemIndexFromEnd(items, event.id)
    if (event.status === "removed") {
      if (index < 0) {
        return items
      }
      return [...items.slice(0, index), ...items.slice(index + 1)]
    }
    const role = event.role ?? "system"
    if (index >= 0) {
      const item = items[index]
      if (item.role === "system" || item.role === "error") {
        const updated = {
          ...item,
          role,
          text: event.text,
          status: event.status,
          timestamp: event.timestamp,
        }
        if (
          updated.role === item.role &&
          updated.text === item.text &&
          updated.status === item.status &&
          updated.timestamp === item.timestamp
        ) {
          return items
        }
        return replaceItem(items, index, updated)
      }
      return items
    }
    return [
      ...items,
      {
        id: event.id,
        role,
        text: event.text,
        status: event.status,
        timestamp: event.timestamp,
      },
    ]
  } else if (event.type === "error") {
    return [...items, { id: event.id, role: "error", text: event.text }]
  }

  return items
}

function formatToolPayload(value: unknown) {
  if (value === undefined) {
    return ""
  }
  if (typeof value === "string") {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
