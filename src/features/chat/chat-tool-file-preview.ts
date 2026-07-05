import type {
  OusiaChatHistoryItem,
  OusiaChatToolFilePreview,
} from "@/electron/chat-types"

type ToolItem = Extract<OusiaChatHistoryItem, { role: "tool" }>

export function toolFilePreviewFromItem(item: ToolItem) {
  return (
    normalizedStoredFilePreview(item) ??
    fallbackWriteFilePreview(item) ??
    pendingToolFilePreview(item)
  )
}

function normalizedStoredFilePreview(
  item: ToolItem
): OusiaChatToolFilePreview | undefined {
  if (!item.filePreview) {
    return undefined
  }
  if (item.filePreview.kind === "patch" && !item.filePreview.path) {
    const fields = writeFieldsFromInput(item.input) ?? writeFieldsFromInput(item.text)
    return fields?.path
      ? {
          ...item.filePreview,
          path: fields.path,
        }
      : item.filePreview
  }
  if (normalizedToolName(item.name) !== "write") {
    return item.filePreview
  }
  if (item.filePreview.kind !== "diff") {
    return item.filePreview
  }
  return {
    ...item.filePreview,
    oldContent: "",
  }
}

function fallbackWriteFilePreview(
  item: ToolItem
): OusiaChatToolFilePreview | undefined {
  if (normalizedToolName(item.name) !== "write") {
    return undefined
  }
  const fields = writeFieldsFromInput(item.input) ?? writeFieldsFromInput(item.text)
  if (!fields) {
    return undefined
  }
  const path = fields.path
  const content = fields.content
  if (!path || content === undefined) {
    return undefined
  }
  return {
    kind: "diff",
    path,
    oldContent: "",
    newContent: content,
    source: "input",
  }
}

function pendingToolFilePreview(
  item: ToolItem
): OusiaChatToolFilePreview | undefined {
  const toolName = normalizedToolName(item.name)
  if (toolName !== "write" && toolName !== "edit") {
    return undefined
  }
  const inputFields = writeFieldsFromInput(item.input) ?? writeFieldsFromInput(item.text)
  const path = inputFields?.path ?? toolName
  return {
    kind: "diff",
    path,
    oldContent: "",
    newContent: "",
    source: "input",
  }
}

function parseToolJson(value: string | undefined) {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function stringField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string") {
      return value
    }
  }
  return undefined
}

function writeFieldsFromInput(input: string | undefined) {
  if (!input) {
    return undefined
  }

  const parsedInput = parseToolJson(input)
  if (!parsedInput) {
    return partialWriteFieldsFromJson(input)
  }
  if (typeof parsedInput !== "object" || Array.isArray(parsedInput)) {
    return partialWriteFieldsFromJson(input)
  }

  const record = parsedInput as Record<string, unknown>
  return {
    content: stringField(record, "content"),
    path: stringField(record, "path", "file_path", "filePath"),
  }
}

function partialWriteFieldsFromJson(input: string) {
  const partialFields = partialJsonStringFields(input, [
    "content",
    "filePath",
    "file_path",
    "path",
  ])
  return {
    content: partialFields.content,
    path:
      partialFields.path ??
      partialFields.file_path ??
      partialFields.filePath,
  }
}

function partialJsonStringFields(source: string, keys: string[]) {
  const wantedKeys = new Set(keys)
  const fields: Record<string, string | undefined> = {}
  let index = 0

  while (index < source.length) {
    const keyStart = source.indexOf('"', index)
    if (keyStart === -1) {
      break
    }

    const key = readJsonString(source, keyStart, false)
    if (!key || !key.closed) {
      break
    }

    let cursor = skipJsonWhitespace(source, key.endIndex)
    if (source[cursor] !== ":") {
      index = key.endIndex
      continue
    }

    cursor = skipJsonWhitespace(source, cursor + 1)
    if (source[cursor] !== '"') {
      index = cursor + 1
      continue
    }

    const value = readJsonString(source, cursor, true)
    if (!value) {
      break
    }
    if (wantedKeys.has(key.value)) {
      fields[key.value] = value.value
    }

    index = value.endIndex
  }

  return fields
}

function skipJsonWhitespace(source: string, index: number) {
  let cursor = index
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1
  }
  return cursor
}

function readJsonString(
  source: string,
  quoteIndex: number,
  allowUnterminated: boolean
) {
  if (source[quoteIndex] !== '"') {
    return undefined
  }

  let value = ""
  let cursor = quoteIndex + 1
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === '"') {
      return { closed: true, endIndex: cursor + 1, value }
    }
    if (char !== "\\") {
      value += char
      cursor += 1
      continue
    }

    if (cursor + 1 >= source.length) {
      break
    }

    const escaped = source[cursor + 1]
    if (escaped === "b") {
      value += "\b"
      cursor += 2
      continue
    }
    if (escaped === "f") {
      value += "\f"
      cursor += 2
      continue
    }
    if (escaped === "n") {
      value += "\n"
      cursor += 2
      continue
    }
    if (escaped === "r") {
      value += "\r"
      cursor += 2
      continue
    }
    if (escaped === "t") {
      value += "\t"
      cursor += 2
      continue
    }
    if (escaped === "u") {
      const hex = source.slice(cursor + 2, cursor + 6)
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        value += String.fromCharCode(Number.parseInt(hex, 16))
        cursor += 6
        continue
      }
      break
    }

    value += escaped
    cursor += 2
  }

  if (!allowUnterminated) {
    return undefined
  }
  return { closed: false, endIndex: source.length, value }
}

function normalizedToolName(name: string) {
  return name
    .trim()
    .replace(/^tool[-_:]/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase()
}
