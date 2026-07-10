import { defineRuntimeCodec, type RuntimeCodec } from "./codec.js"
import {
  canonicalJsonStringify,
  snapshotJsonValue,
  type JsonObject,
  type JsonValue,
} from "./json.js"

export type AgentToolExecutionMode = "parallel" | "sequential"

export type AgentToolOutputContent =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "image"; imageUrl: string }>

export interface AgentToolExecutionResult {
  readonly content: readonly AgentToolOutputContent[]
  readonly details?: JsonValue
}

export interface AgentToolExecutionContext {
  readonly callId: string
  readonly cwd: string
  readonly projectPath: string
  readonly sessionId: string
  readonly signal: AbortSignal
  emitProductEvent(event: JsonValue): void
  reportProgress(update: JsonValue): void
}

export interface AgentToolDefinition<Input = unknown> {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly inputSchema: JsonObject
  readonly inputCodec: RuntimeCodec<Input>
  readonly executionMode: AgentToolExecutionMode
  readonly promptSnippet?: string
  readonly promptGuidelines?: readonly string[]
  execute(
    input: Input,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult>
}

export interface AgentToolRegistry {
  readonly definitions: readonly AgentToolDefinition<unknown>[]
  get(name: string): AgentToolDefinition<unknown>
  execute(
    name: string,
    input: unknown,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult>
}

export interface AgentToolManifest {
  readonly revision: string
  readonly registry: AgentToolRegistry
}

export interface AgentToolProtocolSpec {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonObject
}

const toolNamePattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const definedAgentTools = new WeakSet<object>()
const agentToolKeys = [
  "name",
  "label",
  "description",
  "inputSchema",
  "inputCodec",
  "executionMode",
  "promptSnippet",
  "promptGuidelines",
  "execute",
] as const

function isJsonObjectValue(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function assertNonEmptyString(
  value: unknown,
  field: string
): asserts value is string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new TypeError(`${field} must be a non-empty, trimmed string.`)
  }
}

function assertFunction(value: unknown, field: string) {
  if (typeof value !== "function") {
    throw new TypeError(`${field} must be a function.`)
  }
}

function assertNonEmptyPathString(
  value: unknown,
  field: string
): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${field} must be a non-empty path string.`)
  }
}

function assertAbortSignal(
  value: unknown,
  field: string
): asserts value is AbortSignal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an AbortSignal.`)
  }
  const candidate = value as Partial<AbortSignal>
  if (
    typeof candidate.aborted !== "boolean" ||
    typeof candidate.addEventListener !== "function" ||
    typeof candidate.removeEventListener !== "function" ||
    typeof candidate.throwIfAborted !== "function"
  ) {
    throw new TypeError(`${field} must be an AbortSignal.`)
  }
}

function assertExactKeys(
  value: object,
  expectedKeys: readonly string[],
  field: string
) {
  const expected = new Set(expectedKeys)
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new TypeError(`${field}.${key} is not supported.`)
    }
  }
}

function snapshotStringArray(value: readonly string[], field: string) {
  return Object.freeze(
    Array.from(value, (entry, index) => {
      assertNonEmptyString(entry, `${field}[${index}]`)
      return entry
    })
  )
}

function snapshotToolResult(
  value: AgentToolExecutionResult,
  toolName: string
): Readonly<AgentToolExecutionResult> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Agent tool ${toolName} returned an invalid result.`)
  }
  assertExactKeys(
    value,
    ["content", "details"],
    `Agent tool ${toolName} result`
  )
  if (!Array.isArray(value.content) || value.content.length === 0) {
    throw new TypeError(
      `Agent tool ${toolName} result.content must be a non-empty array.`
    )
  }
  const content = Object.freeze(
    Array.from(value.content, (item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new TypeError(
          `Agent tool ${toolName} result.content[${index}] must be an object.`
        )
      }
      if (item.type === "text") {
        assertExactKeys(
          item,
          ["type", "text"],
          `Agent tool ${toolName} result.content[${index}]`
        )
        assertNonEmptyString(
          item.text,
          `Agent tool ${toolName} result.content[${index}].text`
        )
        return Object.freeze({ type: "text" as const, text: item.text })
      }
      if (item.type === "image") {
        assertExactKeys(
          item,
          ["type", "imageUrl"],
          `Agent tool ${toolName} result.content[${index}]`
        )
        assertNonEmptyString(
          item.imageUrl,
          `Agent tool ${toolName} result.content[${index}].imageUrl`
        )
        return Object.freeze({
          type: "image" as const,
          imageUrl: item.imageUrl,
        })
      }
      throw new TypeError(
        `Agent tool ${toolName} result.content[${index}].type is unsupported.`
      )
    })
  )
  return Object.freeze({
    content,
    ...(value.details === undefined
      ? {}
      : {
          details: snapshotJsonValue(value.details, "agentToolResult.details"),
        }),
  })
}

function wrapToolExecutionContext(
  context: AgentToolExecutionContext,
  toolName: string
): Readonly<AgentToolExecutionContext> {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError(
      `Agent tool ${toolName} execution context must be an object.`
    )
  }
  assertExactKeys(
    context,
    [
      "callId",
      "cwd",
      "projectPath",
      "sessionId",
      "signal",
      "emitProductEvent",
      "reportProgress",
    ],
    `Agent tool ${toolName} execution context`
  )
  assertNonEmptyString(
    context.callId,
    `Agent tool ${toolName} execution context.callId`
  )
  assertNonEmptyPathString(
    context.cwd,
    `Agent tool ${toolName} execution context.cwd`
  )
  assertNonEmptyPathString(
    context.projectPath,
    `Agent tool ${toolName} execution context.projectPath`
  )
  assertNonEmptyString(
    context.sessionId,
    `Agent tool ${toolName} execution context.sessionId`
  )
  assertAbortSignal(
    context.signal,
    `Agent tool ${toolName} execution context.signal`
  )
  assertFunction(
    context.emitProductEvent,
    `Agent tool ${toolName} execution context.emitProductEvent`
  )
  assertFunction(
    context.reportProgress,
    `Agent tool ${toolName} execution context.reportProgress`
  )
  const emitProductEvent = context.emitProductEvent
  const reportProgress = context.reportProgress
  return Object.freeze({
    callId: context.callId,
    cwd: context.cwd,
    projectPath: context.projectPath,
    sessionId: context.sessionId,
    signal: context.signal,
    emitProductEvent(event: JsonValue) {
      emitProductEvent.call(
        context,
        snapshotJsonValue(event, `agentTool(${toolName}).productEvent`)
      )
    },
    reportProgress(update: JsonValue) {
      reportProgress.call(
        context,
        snapshotJsonValue(update, `agentTool(${toolName}).progress`)
      )
    },
  })
}

export function defineAgentTool<Input>(
  definition: AgentToolDefinition<Input>
): Readonly<AgentToolDefinition<Input>> {
  if (!definition || typeof definition !== "object") {
    throw new TypeError("agentTool must be an object.")
  }
  if (definedAgentTools.has(definition)) {
    return definition as Readonly<AgentToolDefinition<Input>>
  }
  assertExactKeys(definition, agentToolKeys, "agentTool")
  assertNonEmptyString(definition.name, "agentTool.name")
  if (!toolNamePattern.test(definition.name)) {
    throw new TypeError(
      "agentTool.name must start with a letter and contain only letters, numbers, underscores, or hyphens."
    )
  }
  assertNonEmptyString(definition.label, "agentTool.label")
  assertNonEmptyString(definition.description, "agentTool.description")
  if (
    definition.executionMode !== "parallel" &&
    definition.executionMode !== "sequential"
  ) {
    throw new TypeError(
      "agentTool.executionMode must be parallel or sequential."
    )
  }
  const inputSchema = snapshotJsonValue(
    definition.inputSchema,
    "agentTool.inputSchema"
  )
  if (!isJsonObjectValue(inputSchema) || inputSchema.type !== "object") {
    throw new TypeError(
      "agentTool.inputSchema must be a JSON Schema with type object."
    )
  }
  const inputCodec = defineRuntimeCodec(definition.inputCodec)
  assertFunction(definition.execute, "agentTool.execute")
  if (definition.promptSnippet !== undefined) {
    assertNonEmptyString(definition.promptSnippet, "agentTool.promptSnippet")
  }
  const promptGuidelines = definition.promptGuidelines
    ? snapshotStringArray(
        definition.promptGuidelines,
        "agentTool.promptGuidelines"
      )
    : undefined

  const tool = Object.freeze({
    name: definition.name,
    label: definition.label,
    description: definition.description,
    inputSchema,
    inputCodec,
    executionMode: definition.executionMode,
    ...(definition.promptSnippet === undefined
      ? {}
      : { promptSnippet: definition.promptSnippet }),
    ...(promptGuidelines === undefined ? {} : { promptGuidelines }),
    execute: definition.execute,
  })
  definedAgentTools.add(tool)
  return tool
}

function eraseAgentTool<Input>(
  definition: AgentToolDefinition<Input>
): AgentToolDefinition<unknown> {
  return defineAgentTool(definition) as AgentToolDefinition<unknown>
}

export function createAgentToolRegistry(
  definitions: readonly AgentToolDefinition<unknown>[]
): AgentToolRegistry {
  if (!Array.isArray(definitions)) {
    throw new TypeError("agentTools must be an array.")
  }
  const byName = new Map<string, AgentToolDefinition<unknown>>()
  const ordered: AgentToolDefinition<unknown>[] = []
  for (const value of definitions) {
    const definition = eraseAgentTool(value as AgentToolDefinition<unknown>)
    if (byName.has(definition.name)) {
      throw new Error(`Duplicate Agent tool: ${definition.name}`)
    }
    byName.set(definition.name, definition)
    ordered.push(definition)
  }

  const registry: AgentToolRegistry = {
    definitions: Object.freeze(ordered),
    get(name) {
      assertNonEmptyString(name, "agentToolName")
      const definition = byName.get(name)
      if (!definition) {
        throw new Error(`Unknown Agent tool: ${name}`)
      }
      return definition
    },
    async execute(name, input, context) {
      const definition = registry.get(name)
      const safeContext = wrapToolExecutionContext(context, name)
      const parsed = definition.inputCodec.parse(
        input,
        `agentTool(${name}).input`
      )
      return snapshotToolResult(
        await definition.execute(parsed, safeContext),
        name
      )
    },
  }
  return Object.freeze(registry)
}

export function agentToolProtocolSpecs(
  registry: AgentToolRegistry
): readonly AgentToolProtocolSpec[] {
  return Object.freeze(
    [...registry.definitions]
      .sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0
      )
      .map((definition) =>
        Object.freeze({
          name: definition.name,
          description: definition.description,
          inputSchema: definition.inputSchema,
        })
      )
  )
}

export function defineAgentToolManifest(options: {
  tools: readonly AgentToolDefinition<unknown>[]
  compatibilityVersion?: string
}): AgentToolManifest {
  if (!options || typeof options !== "object") {
    throw new TypeError("agentToolManifest must be an object.")
  }
  assertExactKeys(
    options,
    ["tools", "compatibilityVersion"],
    "agentToolManifest"
  )
  if (options.compatibilityVersion !== undefined) {
    assertNonEmptyString(
      options.compatibilityVersion,
      "agentToolManifest.compatibilityVersion"
    )
  }
  const registry = createAgentToolRegistry(options.tools)
  const protocolSpecs = agentToolProtocolSpecs(registry)
  return Object.freeze({
    revision: `agent-tools-v1:${canonicalJsonStringify({
      compatibilityVersion: options.compatibilityVersion ?? null,
      tools: protocolSpecs,
    })}`,
    registry,
  })
}
