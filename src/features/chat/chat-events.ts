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
      timestamp: event.timestamp,
    })
  } else if (event.type === "assistant_text_start") {
    upsertText(event.id, "assistant", (item) => {
      item.status = "streaming"
      item.timestamp = event.timestamp
    })
  } else if (event.type === "assistant_text_delta") {
    upsertText(event.id, "assistant", (item) => {
      item.text += event.delta
      item.status = "streaming"
      item.timestamp = event.timestamp
    })
  } else if (event.type === "assistant_text_end") {
    upsertText(event.id, "assistant", (item) => {
      item.text = event.text ?? item.text
      item.status = "finished"
      item.timestamp = event.timestamp
    })
  } else if (event.type === "thinking_start") {
    upsertText(event.id, "thinking", (item) => {
      item.status = "streaming"
      item.timestamp = event.timestamp
    })
  } else if (event.type === "thinking_delta") {
    upsertText(event.id, "thinking", (item) => {
      item.text += event.delta
      item.status = "streaming"
      item.timestamp = event.timestamp
    })
  } else if (event.type === "thinking_end") {
    upsertText(event.id, "thinking", (item) => {
      item.text = event.text ?? item.text
      item.status = "finished"
      item.timestamp = event.timestamp
    })
  } else if (event.type === "tool_start") {
    const input = formatToolPayload(event.args)
    const index = next.findIndex((item) => item.id === event.id)
    if (index >= 0 && next[index].role === "tool") {
      next[index] = {
        ...next[index],
        name: event.name,
        text: input || next[index].text,
        input: input || next[index].input,
        status: "running",
      }
    } else {
      next.push({
        id: event.id,
        role: "tool",
        name: event.name,
        text: input,
        input,
        status: "running",
      })
    }
  } else if (event.type === "tool_update") {
    const index = next.findIndex((item) => item.id === event.id)
    if (index >= 0 && next[index].role === "tool") {
      const value = formatToolPayload(event.value)
      if (event.phase === "input") {
        next[index] = {
          ...next[index],
          name: event.name ?? next[index].name,
          text: value || next[index].text,
          input: value || next[index].input,
        }
        return next
      }
      next[index] = {
        ...next[index],
        name: event.name ?? next[index].name,
        text: value || next[index].text,
        output: value || next[index].output,
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
    if (event.status === "finished") {
      for (let index = 0; index < next.length; index += 1) {
        const item = next[index]
        if (item.role === "tool" && item.status === "running") {
          next[index] = {
            ...item,
            status: "finished",
          }
        }
      }
    }
    if (event.text) {
      next.push({
        id: `status-${event.timestamp}`,
        role: "system",
        text: event.text,
      })
    }
  } else if (event.type === "status_message") {
    const index = next.findIndex((item) => item.id === event.id)
    const role = event.role ?? "system"
    if (index >= 0) {
      const item = next[index]
      if (item.role === "system" || item.role === "error") {
        next[index] = {
          ...item,
          role,
          text: event.text,
          status: event.status,
          timestamp: event.timestamp,
        }
      }
      return next
    }
    next.push({
      id: event.id,
      role,
      text: event.text,
      status: event.status,
      timestamp: event.timestamp,
    })
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
