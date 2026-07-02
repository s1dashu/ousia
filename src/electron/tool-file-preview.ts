import { existsSync, statSync, readFileSync } from "node:fs"

import type { OusiaChatToolFilePreview } from "./chat-types.js"
import { resolveProjectFilePath } from "./host-paths.js"

const MAX_FILE_PREVIEW_BYTES = 1024 * 1024

type EditReplacement = {
  oldText: string
  newText: string
}

export function createToolFilePreview({
  args,
  previousPreview,
  projectPath,
  toolName,
}: {
  args: unknown
  previousPreview?: OusiaChatToolFilePreview
  projectPath: string
  toolName?: string
}): OusiaChatToolFilePreview | undefined {
  const normalizedName = toolName?.toLowerCase()
  if (normalizedName === "write") {
    return createWritePreview(projectPath, args, previousPreview)
  }
  if (normalizedName === "edit") {
    return createEditPreview(projectPath, args)
  }
  return undefined
}

export function createHistoricalToolInputFilePreview({
  args,
  toolName,
}: {
  args: unknown
  toolName?: string
}): OusiaChatToolFilePreview | undefined {
  const normalizedName = toolName?.toLowerCase()
  if (normalizedName !== "write") {
    return undefined
  }

  const fields = writeFieldsFromArgs(args)
  const path = fields?.path
  const content = fields?.content
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

export function createToolResultFilePreview({
  result,
  toolName,
}: {
  result: unknown
  toolName?: string
}): OusiaChatToolFilePreview | undefined {
  const normalizedName = toolName?.toLowerCase()
  if (normalizedName !== "edit") {
    return undefined
  }

  const record = objectRecord(result)
  const details = record ? objectRecord(record.details) : null
  const patch = details ? stringField(details, "patch") : undefined
  if (!patch) {
    return undefined
  }

  return {
    kind: "patch",
    patch,
    source: "result",
  }
}

function createWritePreview(
  projectPath: string,
  args: unknown,
  previousPreview: OusiaChatToolFilePreview | undefined
): OusiaChatToolFilePreview | undefined {
  const fields = writeFieldsFromArgs(args)
  if (!fields) {
    return undefined
  }
  const path = fields.path
  const content = fields.content
  if (!path || content === undefined) {
    return undefined
  }

  const previousForPath =
    previousPreview &&
    "path" in previousPreview &&
    previousPreview.path === path
      ? previousPreview
      : undefined

  if (previousForPath?.kind === "diff") {
    return {
      kind: "diff",
      path,
      oldContent: previousForPath.oldContent,
      newContent: content,
      source: "input",
    }
  }

  if (previousForPath?.kind === "file") {
    return {
      kind: "file",
      path,
      content,
      source: "input",
    }
  }

  try {
    const { absoluteFilePath } = resolveProjectFilePath(projectPath, path)
    const oldContent = readExistingTextFile(absoluteFilePath)
    return {
      kind: "diff",
      path,
      oldContent: oldContent ?? "",
      newContent: content,
      source: "input",
    }
  } catch {
    return {
      kind: "file",
      path,
      content,
      source: "input",
    }
  }
}

function createEditPreview(
  projectPath: string,
  args: unknown
): OusiaChatToolFilePreview | undefined {
  const record = objectRecord(args)
  if (!record) {
    return undefined
  }
  const path = stringField(record, "path", "file_path", "filePath")
  const edits = normalizedEditReplacements(record)
  if (!path || !edits.length) {
    return undefined
  }

  try {
    const { absoluteFilePath } = resolveProjectFilePath(projectPath, path)
    const existingContent = readTextFile(absoluteFilePath)
    const { text } = stripBom(existingContent)
    const normalizedContent = normalizeToLF(text)
    const { baseContent, newContent } = applyEditsToNormalizedContent(
      normalizedContent,
      edits,
      path
    )

    return {
      kind: "diff",
      path,
      oldContent: baseContent,
      newContent,
      source: "input",
    }
  } catch (error) {
    return {
      kind: "error",
      path,
      message:
        error instanceof Error
          ? error.message
          : "Unable to create file diff preview.",
      source: "input",
    }
  }
}

function objectRecord(value: unknown) {
  if (typeof value === "string") {
    const parsed = parseJson(value)
    return objectRecord(parsed)
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
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

function writeFieldsFromArgs(args: unknown) {
  const record = objectRecord(args)
  if (record) {
    return {
      content: stringField(record, "content"),
      path: stringField(record, "path", "file_path", "filePath"),
    }
  }
  if (typeof args === "string") {
    const partialFields = partialJsonStringFields(args, [
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
  return undefined
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

function normalizedEditReplacements(
  record: Record<string, unknown>
): EditReplacement[] {
  const editsValue = record.edits
  const parsedEdits =
    typeof editsValue === "string" ? parseJson(editsValue) : editsValue
  const edits = Array.isArray(parsedEdits)
    ? parsedEdits.flatMap((edit) => {
        const editRecord = objectRecord(edit)
        if (!editRecord) {
          return []
        }
        const oldText = stringField(editRecord, "oldText")
        const newText = stringField(editRecord, "newText")
        return oldText !== undefined && newText !== undefined
          ? [{ oldText, newText }]
          : []
      })
    : []

  const oldText = stringField(record, "oldText")
  const newText = stringField(record, "newText")
  if (oldText !== undefined && newText !== undefined) {
    edits.push({ oldText, newText })
  }

  return edits
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function readExistingTextFile(filePath: string) {
  if (!existsSync(filePath)) {
    return undefined
  }
  return readTextFile(filePath)
}

function readTextFile(filePath: string) {
  const fileStat = statSync(filePath)
  if (!fileStat.isFile()) {
    throw new Error("Preview target is not a file.")
  }
  if (fileStat.size > MAX_FILE_PREVIEW_BYTES) {
    throw new Error("Preview target is too large.")
  }
  return readFileSync(filePath, "utf8")
}

function normalizeToLF(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function normalizeForFuzzyMatch(text: string) {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
}

function fuzzyFindText(content: string, oldText: string) {
  const exactIndex = content.indexOf(oldText)
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
    }
  }

  const fuzzyContent = normalizeForFuzzyMatch(content)
  const fuzzyOldText = normalizeForFuzzyMatch(oldText)
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText)
  if (fuzzyIndex === -1) {
    return {
      found: false,
      index: -1,
      matchLength: 0,
      usedFuzzyMatch: false,
    }
  }

  return {
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
  }
}

function stripBom(content: string) {
  return content.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: content.slice(1) }
    : { bom: "", text: content }
}

function countOccurrences(content: string, oldText: string) {
  const fuzzyContent = normalizeForFuzzyMatch(content)
  const fuzzyOldText = normalizeForFuzzyMatch(oldText)
  return fuzzyContent.split(fuzzyOldText).length - 1
}

function applyEditsToNormalizedContent(
  normalizedContent: string,
  edits: EditReplacement[],
  path: string
) {
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }))

  normalizedEdits.forEach((edit, index) => {
    if (!edit.oldText.length) {
      throw new Error(
        normalizedEdits.length === 1
          ? `oldText must not be empty in ${path}.`
          : `edits[${index}].oldText must not be empty in ${path}.`
      )
    }
  })

  const initialMatches = normalizedEdits.map((edit) =>
    fuzzyFindText(normalizedContent, edit.oldText)
  )
  const baseContent = initialMatches.some((match) => match.usedFuzzyMatch)
    ? normalizeForFuzzyMatch(normalizedContent)
    : normalizedContent
  const matchedEdits: Array<{
    editIndex: number
    matchIndex: number
    matchLength: number
    newText: string
  }> = []

  normalizedEdits.forEach((edit, index) => {
    const match = fuzzyFindText(baseContent, edit.oldText)
    if (!match.found) {
      throw new Error(
        normalizedEdits.length === 1
          ? `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`
          : `Could not find edits[${index}] in ${path}. The oldText must match exactly including all whitespace and newlines.`
      )
    }
    const occurrences = countOccurrences(baseContent, edit.oldText)
    if (occurrences > 1) {
      throw new Error(
        normalizedEdits.length === 1
          ? `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`
          : `Found ${occurrences} occurrences of edits[${index}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`
      )
    }
    matchedEdits.push({
      editIndex: index,
      matchIndex: match.index,
      matchLength: match.matchLength,
      newText: edit.newText,
    })
  })

  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex)
  for (let index = 1; index < matchedEdits.length; index += 1) {
    const previous = matchedEdits[index - 1]
    const current = matchedEdits[index]
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`
      )
    }
  }

  let newContent = baseContent
  for (let index = matchedEdits.length - 1; index >= 0; index -= 1) {
    const edit = matchedEdits[index]
    newContent =
      newContent.substring(0, edit.matchIndex) +
      edit.newText +
      newContent.substring(edit.matchIndex + edit.matchLength)
  }

  if (baseContent === newContent) {
    throw new Error(
      normalizedEdits.length === 1
        ? `No changes made to ${path}. The replacement produced identical content.`
        : `No changes made to ${path}. The replacements produced identical content.`
    )
  }

  return { baseContent, newContent }
}
