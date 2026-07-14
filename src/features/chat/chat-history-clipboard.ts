import type { getMessages } from "@/app/i18n"
import type { ChatItem } from "@/features/chat/chat-events"
import { formatToolName } from "@/features/chat/chat-tool-format"

export function formatSessionHistoryForClipboard({
  items,
  projectPath,
  sessionTitle,
  t,
}: {
  items: ChatItem[]
  projectPath?: string
  sessionTitle: string
  t: ReturnType<typeof getMessages>
}) {
  const lines = [
    t.chat.historyTitle,
    "",
    t.chat.historySession(sessionTitle),
    projectPath ? t.chat.historyProject(projectPath) : undefined,
    t.chat.historyExportedAt(new Date().toISOString()),
    "",
  ].filter((line): line is string => line !== undefined)

  if (!items.length) {
    lines.push(t.chat.historyEmpty)
    return lines.join("\n")
  }

  items.forEach((item, index) => {
    if (index > 0) {
      lines.push("")
    }
    if (item.role === "tool") {
      lines.push(
        `## Tool Call: ${formatToolName(item.name)}`,
        t.chat.historyStatus(item.status)
      )
      appendHistoryBlock(lines, "Input", item.input || item.text || "{}", t)
      if (item.errorText) {
        appendHistoryBlock(lines, "Error", item.errorText, t)
      } else if (item.output) {
        appendHistoryBlock(lines, "Output", item.output, t)
      }
      return
    }

    const label = {
      assistant: "Agent",
      error: "Error",
      system: "System",
      thinking: "Agent Thinking",
      user: "User",
    }[item.role]
    lines.push(`## ${label}`)
    appendHistoryText(lines, item.text, t)
  })

  return lines.join("\n")
}

export async function writeTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textArea = document.createElement("textarea")
  textArea.value = text
  textArea.style.position = "fixed"
  textArea.style.opacity = "0"
  document.body.append(textArea)
  textArea.focus()
  textArea.select()
  const ok = document.execCommand("copy")
  textArea.remove()
  if (!ok) {
    throw new Error("Clipboard copy failed")
  }
}

function appendHistoryBlock(
  lines: string[],
  title: string,
  value: string,
  t: ReturnType<typeof getMessages>
) {
  lines.push(`${title}:`)
  appendHistoryText(lines, value, t)
}

function appendHistoryText(
  lines: string[],
  value: string,
  t: ReturnType<typeof getMessages>
) {
  const text = value.trim()
  lines.push(text || t.chat.empty)
}
