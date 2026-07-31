import type { ImageContent } from "@earendil-works/pi-ai"
import {
  SessionManager,
  type AgentSession,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent"

import type { OusiaChatAttachment, OusiaChatHistoryItem } from "./chat-types.js"
import {
  createHistoricalToolInputFilePreview,
  createToolResultFilePreview,
} from "./tool-file-preview.js"

export type PiSessionEntry = ReturnType<SessionManager["getEntries"]>[number]

export type HistoryBuildOptions = {
  includeToolPayloads: boolean
  showThinking: boolean
}
export function shouldShowThinkingForLevel(level: string | undefined) {
  return Boolean(level && level !== "off")
}

export function stringifyUnknown(value: unknown) {
  if (value === undefined) {
    return undefined
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
export function previewText(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`
}

export function previewToolInput(value: string) {
  const fallback = previewText(value || "{}")
  if (!value) {
    return fallback
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fallback
    }

    const record = parsed as Record<string, unknown>
    const summary: Record<string, string> = {}
    for (const key of [
      "path",
      "filePath",
      "file_path",
      "target",
      "cwd",
      "command",
      "cmd",
      "shell",
      "pattern",
      "query",
      "search",
    ]) {
      const field = record[key]
      if (typeof field === "string" && field.trim()) {
        summary[key] = previewText(field)
      }
    }

    return Object.keys(summary).length ? JSON.stringify(summary) : fallback
  } catch {
    return fallback
  }
}
export function textFromContent(content: unknown) {
  if (typeof content === "string") {
    return content
  }
  if (!Array.isArray(content)) {
    return ""
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return ""
      }
      const block = part as Record<string, unknown>
      if (block.type === "text") {
        return typeof block.text === "string" ? block.text : ""
      }
      if (block.type === "image") {
        return ""
      }
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function imageExtension(mediaType: string) {
  if (mediaType === "image/jpeg") {
    return "jpg"
  }
  return mediaType.split("/")[1]?.split("+")[0] || "png"
}

function base64ByteLength(data: string) {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding)
}

function attachmentSummaryFromContent(content: unknown) {
  if (!Array.isArray(content)) {
    return []
  }

  return content.flatMap((part, index) => {
    if (!part || typeof part !== "object") {
      return []
    }
    const block = part as Record<string, unknown>
    if (block.type !== "image") {
      return []
    }
    const mediaType =
      typeof block.mimeType === "string" && block.mimeType
        ? block.mimeType
        : "image/png"
    const data = typeof block.data === "string" ? block.data : ""
    return [
      {
        id: `history-image-${index}`,
        kind: "image" as const,
        mediaType,
        name: `image.${imageExtension(mediaType)}`,
        size: base64ByteLength(data),
        dataBase64: data,
      },
    ]
  })
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B"
  }
  const units = ["B", "KB", "MB", "GB"]
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

export function buildPromptWithTextAttachments(
  text: string,
  attachments: OusiaChatAttachment[] | undefined
) {
  const blocks = [text.trim()]
  const textAttachments = attachments?.filter(
    (attachment) => attachment.kind === "text"
  )
  const fileAttachments = attachments?.filter(
    (attachment) => attachment.kind === "file"
  )

  for (const attachment of textAttachments ?? []) {
    blocks.push(
      [
        `<attached_file name="${attachment.name}" mediaType="${attachment.mediaType}" size="${attachment.size}">`,
        attachment.text,
        "</attached_file>",
      ].join("\n")
    )
  }

  if (fileAttachments?.length) {
    blocks.push(
      [
        "用户还附加了以下非文本文件，当前只能看到文件元信息：",
        ...fileAttachments.map(
          (attachment) =>
            `- ${attachment.name} (${attachment.mediaType || "application/octet-stream"}, ${formatBytes(attachment.size)})`
        ),
      ].join("\n")
    )
  }

  return blocks.filter(Boolean).join("\n\n")
}

export function imageContentFromAttachments(
  attachments: OusiaChatAttachment[] | undefined
): ImageContent[] {
  return (attachments ?? [])
    .filter((attachment) => attachment.kind === "image")
    .map((attachment) => ({
      type: "image",
      data: attachment.dataBase64,
      mimeType: attachment.mediaType || "image/png",
    }))
}

export function messageEntryToHistoryItems(
  entry: SessionMessageEntry,
  items: OusiaChatHistoryItem[],
  toolItemIndexById: Map<string, number>,
  options: HistoryBuildOptions = {
    includeToolPayloads: true,
    showThinking: true,
  }
) {
  const message = entry.message as unknown as Record<string, unknown>
  const role = message.role
  if (role === "user") {
    const attachments = attachmentSummaryFromContent(message.content)
    items.push({
      id: entry.id,
      role: "user",
      text: textFromContent(message.content),
      attachments: attachments.length ? attachments : undefined,
      status: "finished",
      timestamp: entry.timestamp,
    })
    return
  }
  if (role === "assistant") {
    const content = Array.isArray(message.content) ? message.content : []
    const stopReason =
      typeof message.stopReason === "string" ? message.stopReason : undefined
    const orphanedToolStatus = stopReason === "aborted" ? "finished" : "running"
    content.forEach((part, index) => {
      if (!part || typeof part !== "object") {
        return
      }
      const block = part as Record<string, unknown>
      if (block.type === "thinking") {
        if (!options.showThinking) {
          return
        }
        const text = typeof block.thinking === "string" ? block.thinking : ""
        if (text) {
          items.push({
            id: `${entry.id}-thinking-${index}`,
            role: "thinking",
            text,
            status: "finished",
            timestamp: entry.timestamp,
          })
        }
      } else if (block.type === "text") {
        const text = typeof block.text === "string" ? block.text : ""
        if (text) {
          items.push({
            id: `${entry.id}-text-${index}`,
            role: "assistant",
            text,
            status: "finished",
            timestamp: entry.timestamp,
          })
        }
      } else if (block.type === "toolCall") {
        const input = stringifyUnknown(block.arguments) ?? ""
        const inputPreview = previewToolInput(input)
        const toolName = typeof block.name === "string" ? block.name : "tool"
        const filePreview = createHistoricalToolInputFilePreview({
          args: block.arguments,
          toolName,
        })
        const id =
          typeof block.id === "string" ? block.id : `${entry.id}-tool-${index}`
        if (!toolItemIndexById.has(id)) {
          toolItemIndexById.set(id, items.length)
        }
        items.push({
          id,
          role: "tool",
          name: toolName,
          text: options.includeToolPayloads ? input : inputPreview,
          input: options.includeToolPayloads ? input : inputPreview,
          filePreview,
          payloadOmitted: options.includeToolPayloads ? undefined : true,
          status: orphanedToolStatus,
        })
      }
    })
    return
  }
  if (role === "toolResult") {
    const toolCallId =
      typeof message.toolCallId === "string" ? message.toolCallId : entry.id
    const index = toolItemIndexById.get(toolCallId) ?? -1
    const existing = index >= 0 ? items[index] : undefined
    const resultText = textFromContent(message.content)
    const toolName =
      typeof message.toolName === "string"
        ? message.toolName
        : existing?.role === "tool"
          ? existing.name
          : "tool"
    const filePreview =
      createToolResultFilePreview({
        result: message,
        toolName,
      }) ?? (existing?.role === "tool" ? existing.filePreview : undefined)
    const text = message.isError
      ? resultText
      : resultText || (existing?.role === "tool" ? existing.text : "")
    const item: OusiaChatHistoryItem = {
      id: toolCallId,
      role: "tool",
      name: toolName,
      text: options.includeToolPayloads ? text : previewText(text),
      input: existing?.role === "tool" ? existing.input : undefined,
      output:
        options.includeToolPayloads && !message.isError
          ? resultText
          : undefined,
      errorText:
        options.includeToolPayloads && message.isError ? resultText : undefined,
      filePreview,
      payloadOmitted: options.includeToolPayloads ? undefined : true,
      status: message.isError ? "failed" : "finished",
    }
    if (index >= 0) {
      items[index] = item
    } else {
      toolItemIndexById.set(toolCallId, items.length)
      items.push(item)
    }
    return
  }
  if (role === "bashExecution") {
    const command = typeof message.command === "string" ? message.command : ""
    const output = typeof message.output === "string" ? message.output : ""
    const text = [command ? `$ ${command}` : "", output]
      .filter(Boolean)
      .join("\n")
    items.push({
      id: entry.id,
      role: "tool",
      name: "bash",
      text: options.includeToolPayloads ? text : previewText(text),
      input: command
        ? options.includeToolPayloads
          ? command
          : previewText(command)
        : undefined,
      output: options.includeToolPayloads ? output : undefined,
      errorText:
        options.includeToolPayloads && message.exitCode !== 0
          ? output
          : undefined,
      payloadOmitted: options.includeToolPayloads ? undefined : true,
      status: message.exitCode === 0 ? "finished" : "failed",
    })
    return
  }
  if (role === "custom" && message.display !== false) {
    const text = textFromContent(message.content)
    if (text) {
      items.push({
        id: entry.id,
        role: "system",
        text,
        status: "finished",
        timestamp: entry.timestamp,
      })
    }
  }
}

export function branchEntriesToHistoryItems(
  entries: PiSessionEntry[],
  items: OusiaChatHistoryItem[],
  includeToolPayloads = true
) {
  let thinkingLevel: string | undefined = "off"
  const toolItemIndexById = new Map<string, number>()
  items.forEach((item, index) => {
    if (item.role === "tool" && !toolItemIndexById.has(item.id)) {
      toolItemIndexById.set(item.id, index)
    }
  })
  entries.forEach((entry) => {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel
      return
    }
    if (entry.type === "message") {
      messageEntryToHistoryItems(entry, items, toolItemIndexById, {
        includeToolPayloads,
        showThinking: shouldShowThinkingForLevel(thinkingLevel),
      })
    }
  })
}

export function historyItemsFromActivePiSession(
  session: Pick<AgentSession, "sessionManager"> | undefined,
  includeToolPayloads: boolean
) {
  if (!session) {
    return undefined
  }
  const items: OusiaChatHistoryItem[] = []
  branchEntriesToHistoryItems(
    session.sessionManager.getBranch(),
    items,
    includeToolPayloads
  )
  return items
}
