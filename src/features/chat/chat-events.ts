import type {
  OusiaChatEvent,
  OusiaChatHistoryItem,
  OusiaTextChatItem,
} from "@/electron/chat-types"

export type ChatItem = OusiaChatHistoryItem
type TextChatItem = OusiaTextChatItem

export function applyChatEvent(items: ChatItem[], event: OusiaChatEvent): ChatItem[] {
  const next = [...items]
  const upsertText = (
    id: string,
    role: "assistant" | "thinking",
    update: (item: TextChatItem) => void
  ) => {
    const index = next.findIndex((item) => item.id === id)
    if (index >= 0) {
      const item = next[index]
      if (item.role === "assistant" || item.role === "thinking") {
        const updated: TextChatItem = { ...item }
        update(updated)
        next[index] = updated
      }
      return
    }
    const created: TextChatItem = {
      id,
      role,
      text: "",
      status: "streaming",
    }
    update(created)
    next.push(created)
  }

  if (event.type === "user_message") {
    next.push({
      id: event.id,
      role: "user",
      text: event.text,
      attachments: event.attachments,
    })
  } else if (event.type === "assistant_text_start") {
    upsertText(event.id, "assistant", (item) => {
      item.status = "streaming"
    })
  } else if (event.type === "assistant_text_delta") {
    upsertText(event.id, "assistant", (item) => {
      item.text += event.delta
      item.status = "streaming"
    })
  } else if (event.type === "assistant_text_end") {
    upsertText(event.id, "assistant", (item) => {
      item.text = event.text ?? item.text
      item.status = "finished"
    })
  } else if (event.type === "thinking_start") {
    upsertText(event.id, "thinking", (item) => {
      item.status = "streaming"
    })
  } else if (event.type === "thinking_delta") {
    upsertText(event.id, "thinking", (item) => {
      item.text += event.delta
      item.status = "streaming"
    })
  } else if (event.type === "thinking_end") {
    upsertText(event.id, "thinking", (item) => {
      item.text = event.text ?? item.text
      item.status = "finished"
    })
  } else if (event.type === "tool_start") {
    next.push({
      id: event.id,
      role: "tool",
      name: event.name,
      text: formatToolPayload(event.args),
      input: formatToolPayload(event.args),
      status: "running",
    })
  } else if (event.type === "tool_update") {
    const index = next.findIndex((item) => item.id === event.id)
    if (index >= 0 && next[index].role === "tool") {
      next[index] = {
        ...next[index],
        text: formatToolPayload(event.value) || next[index].text,
        output: formatToolPayload(event.value) || next[index].output,
      }
    }
  } else if (event.type === "tool_end") {
    const index = next.findIndex((item) => item.id === event.id)
    if (index >= 0 && next[index].role === "tool") {
      const result = formatToolPayload(event.result)
      next[index] = {
        ...next[index],
        name: event.name ?? next[index].name,
        text: result || next[index].text,
        output: event.isError ? next[index].output : result || next[index].output,
        errorText: event.isError ? result || next[index].errorText : undefined,
        status: event.isError ? "failed" : "finished",
      }
    }
  } else if (event.type === "run_status") {
    if (event.text) {
      next.push({
        id: `status-${event.timestamp}`,
        role: "system",
        text: event.text,
      })
    }
  } else if (event.type === "error") {
    next.push({ id: event.id, role: "error", text: event.text })
  }

  return next
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
