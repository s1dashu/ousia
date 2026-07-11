function isJsonWhitespace(character: string) {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  )
}

export function isCompletePiToolInputJson(value: string | undefined) {
  if (!value) {
    return false
  }

  let start = 0
  while (start < value.length && isJsonWhitespace(value[start])) {
    start += 1
  }
  let end = value.length - 1
  while (end >= start && isJsonWhitespace(value[end])) {
    end -= 1
  }
  if (value[start] !== "{" || value[end] !== "}") {
    return false
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return Boolean(
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
    )
  } catch {
    return false
  }
}

export type PiToolInputCompletionSource = "json" | "toolcall_end"

type PiToolInputScanState = {
  expectedClosers: string[]
  escaped: boolean
  inString: boolean
  invalid: boolean
  parseAttempted: boolean
  rawArguments: string
  rootClosed: boolean
  rootStarted: boolean
  strictlyComplete: boolean
}

function createScanState(): PiToolInputScanState {
  return {
    expectedClosers: [],
    escaped: false,
    inString: false,
    invalid: false,
    parseAttempted: false,
    rawArguments: "",
    rootClosed: false,
    rootStarted: false,
    strictlyComplete: false,
  }
}

export class PiToolInputTracker {
  private readonly completedIds = new Set<string>()
  private readonly scanStateByContentIndex = new Map<
    number,
    PiToolInputScanState
  >()

  constructor(private readonly parseCompleteJson = isCompletePiToolInputJson) {}

  reset() {
    this.completedIds.clear()
    this.scanStateByContentIndex.clear()
  }

  start(contentIndex: number) {
    this.scanStateByContentIndex.set(contentIndex, createScanState())
  }

  append(contentIndex: number, delta: string) {
    const state =
      this.scanStateByContentIndex.get(contentIndex) ?? createScanState()
    if (!this.scanStateByContentIndex.has(contentIndex)) {
      this.scanStateByContentIndex.set(contentIndex, state)
    }
    state.rawArguments += delta

    for (const character of delta) {
      if (state.invalid) {
        continue
      }
      if (state.rootClosed) {
        if (!isJsonWhitespace(character)) {
          state.invalid = true
          state.strictlyComplete = false
        }
        continue
      }
      if (!state.rootStarted) {
        if (isJsonWhitespace(character)) {
          continue
        }
        if (character !== "{") {
          state.invalid = true
          state.strictlyComplete = false
          continue
        }
        state.rootStarted = true
        state.expectedClosers.push("}")
        continue
      }
      if (state.inString) {
        if (state.escaped) {
          state.escaped = false
        } else if (character === "\\") {
          state.escaped = true
        } else if (character === '"') {
          state.inString = false
        }
        continue
      }
      if (character === '"') {
        state.inString = true
      } else if (character === "{") {
        state.expectedClosers.push("}")
      } else if (character === "[") {
        state.expectedClosers.push("]")
      } else if (character === "}" || character === "]") {
        if (state.expectedClosers.at(-1) !== character) {
          state.invalid = true
          state.strictlyComplete = false
          continue
        }
        state.expectedClosers.pop()
        if (!state.expectedClosers.length) {
          state.rootClosed = true
        }
      }
    }

    if (state.rootClosed && !state.invalid && !state.parseAttempted) {
      state.parseAttempted = true
      state.strictlyComplete = this.parseCompleteJson(state.rawArguments)
    }
  }

  rawArguments(contentIndex: number) {
    return this.scanStateByContentIndex.get(contentIndex)?.rawArguments
  }

  finishIfComplete({
    authoritativeEnd,
    contentIndex,
    toolCallId,
  }: {
    authoritativeEnd: boolean
    contentIndex: number
    toolCallId: string
  }): PiToolInputCompletionSource | undefined {
    if (this.completedIds.has(toolCallId)) {
      return undefined
    }
    const source = this.scanStateByContentIndex.get(contentIndex)
      ?.strictlyComplete
      ? "json"
      : authoritativeEnd
        ? "toolcall_end"
        : undefined
    if (source) {
      this.completedIds.add(toolCallId)
    }
    return source
  }

  isComplete(toolCallId: string | undefined) {
    return Boolean(toolCallId && this.completedIds.has(toolCallId))
  }

  receivedDataAfterCompletion(toolCallId: string | undefined, delta: string) {
    return this.isComplete(toolCallId) && Boolean(delta.trim())
  }
}
