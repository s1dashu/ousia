export type ParsedEditReplacement = {
  newText?: string
  newTextComplete: boolean
  oldText?: string
  oldTextComplete: boolean
}

export type EditReplacement = {
  newText: string
  oldText: string
}

export type ParsedEditToolInput = {
  edits: ParsedEditReplacement[]
  isPartial: boolean
  path?: string
  pathComplete: boolean
}

type JsonStringField = {
  closed: boolean
  key: string
  value: string
}

const editStringKeys = new Set([
  "filePath",
  "file_path",
  "newText",
  "new_text",
  "oldText",
  "old_text",
  "path",
])

export function parseEditToolInput(
  args: unknown
): ParsedEditToolInput | undefined {
  const record = objectRecord(args)
  if (record) {
    return completeEditInput(record)
  }
  if (typeof args !== "string" || !args.trimStart().startsWith("{")) {
    return undefined
  }
  return partialEditInput(args)
}

export function editToolInputDraft(
  input: ParsedEditToolInput
): { newContent: string; oldContent: string } | undefined {
  const visibleEdits = input.edits.filter(
    (edit) => edit.newText !== undefined || edit.oldText !== undefined
  )
  if (!visibleEdits.length) {
    return undefined
  }
  return {
    newContent: visibleEdits.map((edit) => edit.newText ?? "").join("\n"),
    oldContent: visibleEdits.map((edit) => edit.oldText ?? "").join("\n"),
  }
}

export function editReplacementsForFilePreview(
  input: ParsedEditToolInput
): EditReplacement[] | undefined {
  if (!input.edits.length) {
    return undefined
  }
  const replacements: EditReplacement[] = []
  for (const edit of input.edits) {
    if (
      edit.newText === undefined ||
      edit.oldText === undefined ||
      !edit.oldTextComplete
    ) {
      return undefined
    }
    replacements.push({ newText: edit.newText, oldText: edit.oldText })
  }
  return replacements
}

function completeEditInput(
  record: Record<string, unknown>
): ParsedEditToolInput {
  const editsValue = record.edits
  const parsedEdits =
    typeof editsValue === "string" ? parseJson(editsValue) : editsValue
  const edits = Array.isArray(parsedEdits)
    ? parsedEdits.flatMap((edit) => {
        const editRecord = objectRecord(edit)
        if (!editRecord) {
          return []
        }
        const oldText = stringField(editRecord, "oldText", "old_text")
        const newText = stringField(editRecord, "newText", "new_text")
        return oldText !== undefined && newText !== undefined
          ? [
              {
                newText,
                newTextComplete: true,
                oldText,
                oldTextComplete: true,
              },
            ]
          : []
      })
    : []

  const oldText = stringField(record, "oldText", "old_text")
  const newText = stringField(record, "newText", "new_text")
  if (oldText !== undefined && newText !== undefined) {
    edits.push({
      newText,
      newTextComplete: true,
      oldText,
      oldTextComplete: true,
    })
  }

  const path = stringField(record, "path", "file_path", "filePath")
  return {
    edits,
    isPartial: false,
    path,
    pathComplete: path !== undefined,
  }
}

function partialEditInput(source: string): ParsedEditToolInput {
  const fields = scanJsonStringFields(source)
  const edits: ParsedEditReplacement[] = []
  let currentEdit: ParsedEditReplacement | undefined
  let path: string | undefined
  let pathComplete = false

  for (const field of fields) {
    if (isPathKey(field.key)) {
      path = field.value
      pathComplete = field.closed
      continue
    }

    const property = isOldTextKey(field.key) ? "oldText" : "newText"
    const completionProperty =
      property === "oldText" ? "oldTextComplete" : "newTextComplete"
    if (currentEdit?.[property] !== undefined) {
      edits.push(currentEdit)
      currentEdit = undefined
    }
    currentEdit ??= {
      newTextComplete: false,
      oldTextComplete: false,
    }
    currentEdit[property] = field.value
    currentEdit[completionProperty] = field.closed

    if (
      currentEdit.oldText !== undefined &&
      currentEdit.newText !== undefined &&
      currentEdit.oldTextComplete &&
      currentEdit.newTextComplete
    ) {
      edits.push(currentEdit)
      currentEdit = undefined
    }
  }

  if (currentEdit) {
    edits.push(currentEdit)
  }

  return {
    edits,
    isPartial: true,
    path,
    pathComplete,
  }
}

function scanJsonStringFields(source: string) {
  const fields: JsonStringField[] = []
  let index = 0

  while (index < source.length) {
    const keyStart = source.indexOf('"', index)
    if (keyStart === -1) {
      break
    }

    const key = readJsonString(source, keyStart, false)
    if (!key?.closed) {
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
    if (editStringKeys.has(key.value)) {
      fields.push({
        closed: value.closed,
        key: key.value,
        value: value.value,
      })
    }
    index = value.endIndex
  }

  return fields
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    return objectRecord(parseJson(value))
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

function isPathKey(key: string) {
  return key === "path" || key === "file_path" || key === "filePath"
}

function isOldTextKey(key: string) {
  return key === "oldText" || key === "old_text"
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
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
