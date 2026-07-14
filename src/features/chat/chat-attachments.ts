import type { getMessages } from "@/app/i18n"
import type { OusiaChatAttachment } from "@/electron/chat-types"

export function normalizePastedMessageText(text: string) {
  if (!text.includes("\n")) {
    return text
  }
  const normalizedLineEndings = text.replace(/\r\n/g, "\n")
  const trimmed = normalizedLineEndings.replace(/^\n+/, "").replace(/\n+$/, "")
  if (!trimmed) {
    return text
  }

  const leadingBlankLines = normalizedLineEndings.match(/^\n+/)?.[0].length ?? 0
  const trailingBlankLines = normalizedLineEndings.match(/\n+$/)?.[0].length ?? 0
  const looksLikeCopiedSingleMessage =
    (leadingBlankLines > 0 || trailingBlankLines > 0) &&
    !/^\s/.test(trimmed) &&
    !/\n\s*$/.test(trimmed)

  return looksLikeCopiedSingleMessage ? trimmed : text
}

export function filesFromDataTransfer(dataTransfer: DataTransfer) {
  const files = Array.from(dataTransfer.files ?? [])
  if (files.length) {
    return files
  }
  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

export async function chatAttachmentFromFile(
  file: File,
  t: ReturnType<typeof getMessages>
): Promise<OusiaChatAttachment> {
  const mediaType = file.type || mediaTypeFromFileName(file.name)
  const base = {
    id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || t.chat.unnamedFile,
    mediaType,
    size: file.size,
  }

  if (mediaType.startsWith("image/")) {
    return {
      ...base,
      kind: "image",
      dataBase64: await readFileAsBase64(file, t),
    }
  }

  if (isTextLikeFile(file, mediaType)) {
    return {
      ...base,
      kind: "text",
      text: await file.text(),
    }
  }

  return {
    ...base,
    kind: "file",
  }
}

function readFileAsBase64(file: File, t: ReturnType<typeof getMessages>) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      resolve(result.replace(/^data:[^;]+;base64,/, ""))
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error(t.chat.fileReadError))
    }
    reader.readAsDataURL(file)
  })
}

function isTextLikeFile(file: File, mediaType: string) {
  if (mediaType.startsWith("text/")) {
    return true
  }
  return /\.(c|cc|conf|cpp|cs|css|csv|go|h|hpp|html|ini|java|js|json|jsx|log|md|mjs|py|rb|rs|sh|sql|svg|toml|ts|tsx|txt|vue|xml|yaml|yml)$/i.test(
    file.name
  )
}

function mediaTypeFromFileName(name: string) {
  if (/\.png$/i.test(name)) {
    return "image/png"
  }
  if (/\.(jpe?g)$/i.test(name)) {
    return "image/jpeg"
  }
  if (/\.gif$/i.test(name)) {
    return "image/gif"
  }
  if (/\.webp$/i.test(name)) {
    return "image/webp"
  }
  if (/\.svg$/i.test(name)) {
    return "image/svg+xml"
  }
  if (/\.(md|txt|log)$/i.test(name)) {
    return "text/plain"
  }
  if (/\.json$/i.test(name)) {
    return "application/json"
  }
  return "application/octet-stream"
}
