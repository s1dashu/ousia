import { defineRuntimeCodec, type RuntimeCodec } from "./codec.js"
import type { JsonValue } from "./json.js"

export type WorkspaceEventOrigin = "history" | "live"

export type WorkspaceScopeContext =
  | Readonly<{
      kind: "project"
      scopeKey: string
      projectId: string
    }>
  | Readonly<{
      kind: "session"
      scopeKey: string
      sessionId: string
    }>

export interface WorkspaceIngress<Event> {
  readonly origin: WorkspaceEventOrigin
  readonly event: Event
}

export interface WorkspaceReduceContext {
  readonly instanceId: string
  readonly scope: WorkspaceScopeContext
}

export interface WorkspaceReduction<State, Effect> {
  readonly state: State
  readonly effects: readonly Effect[]
}

export interface WorkspaceAppDefinition<State, Event, Effect> {
  readonly appId: string
  readonly stateVersion: number
  readonly stateCodec: RuntimeCodec<State>
  readonly eventCodec: RuntimeCodec<Event>
  createState(scope: WorkspaceScopeContext): State
  reduce(
    state: State,
    ingress: readonly WorkspaceIngress<Event>[],
    context: WorkspaceReduceContext
  ): WorkspaceReduction<State, Effect>
}

export interface ErasedWorkspaceAppDefinition {
  readonly appId: string
  readonly stateVersion: number
  readonly stateCodec: RuntimeCodec<unknown>
  readonly eventCodec: RuntimeCodec<unknown>
  createState(scope: WorkspaceScopeContext): unknown
  reduce(
    state: unknown,
    ingress: readonly WorkspaceIngress<unknown>[],
    context: WorkspaceReduceContext
  ): WorkspaceReduction<unknown, unknown>
}

export interface WorkspaceAppRegistry {
  readonly definitions: readonly ErasedWorkspaceAppDefinition[]
  get(appId: string): ErasedWorkspaceAppDefinition
}

export interface StoredWorkspaceApp {
  readonly instanceId: string
  readonly appId: string
  readonly stateVersion: number
  readonly state: JsonValue
}

export interface DecodedWorkspaceApp {
  readonly instanceId: string
  readonly definition: ErasedWorkspaceAppDefinition
  readonly state: unknown
}

export interface WorkspaceAppRendererHandle<State> {
  /** Synchronously settles renderer-local edits and returns one canonical state. */
  captureCommittedState(): State
}

const appIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const instanceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const definedWorkspaceApps = new WeakSet<object>()
const storedWorkspaceKeys = [
  "instanceId",
  "appId",
  "stateVersion",
  "state",
] as const
const workspaceAppDefinitionKeys = [
  "appId",
  "stateVersion",
  "stateCodec",
  "eventCodec",
  "createState",
  "reduce",
] as const

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

function assertPositiveInteger(
  value: unknown,
  field: string
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${field} must be a positive safe integer.`)
  }
}

function assertInstanceId(value: unknown, field: string): asserts value is string {
  assertNonEmptyString(value, field)
  if (!instanceIdPattern.test(value)) {
    throw new TypeError(`${field} contains unsupported characters.`)
  }
}

function assertScope(scope: WorkspaceScopeContext) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new TypeError("workspaceScope must be an object.")
  }
  assertNonEmptyString(scope.scopeKey, "workspaceScope.scopeKey")
  if (scope.kind === "project") {
    assertNonEmptyString(scope.projectId, "workspaceScope.projectId")
    for (const key of Object.keys(scope)) {
      if (key !== "kind" && key !== "scopeKey" && key !== "projectId") {
        throw new TypeError(`workspaceScope.${key} is not supported.`)
      }
    }
    return
  }
  if (scope.kind === "session") {
    assertNonEmptyString(scope.sessionId, "workspaceScope.sessionId")
    for (const key of Object.keys(scope)) {
      if (key !== "kind" && key !== "scopeKey" && key !== "sessionId") {
        throw new TypeError(`workspaceScope.${key} is not supported.`)
      }
    }
    return
  }
  throw new TypeError("workspaceScope.kind must be project or session.")
}

function snapshotScope(scope: WorkspaceScopeContext): WorkspaceScopeContext {
  assertScope(scope)
  return scope.kind === "project"
    ? Object.freeze({
        kind: "project",
        scopeKey: scope.scopeKey,
        projectId: scope.projectId,
      })
    : Object.freeze({
        kind: "session",
        scopeKey: scope.scopeKey,
        sessionId: scope.sessionId,
      })
}

export function defineWorkspaceApp<State, Event, Effect>(
  definition: WorkspaceAppDefinition<State, Event, Effect>
): Readonly<WorkspaceAppDefinition<State, Event, Effect>> {
  if (!definition || typeof definition !== "object") {
    throw new TypeError("workspaceApp must be an object.")
  }
  if (definedWorkspaceApps.has(definition)) {
    return definition as Readonly<WorkspaceAppDefinition<State, Event, Effect>>
  }
  assertExactKeys(definition, workspaceAppDefinitionKeys, "workspaceApp")
  assertNonEmptyString(definition.appId, "workspaceApp.appId")
  if (!appIdPattern.test(definition.appId)) {
    throw new TypeError(
      "workspaceApp.appId must be a lowercase dot- or hyphen-separated identifier."
    )
  }
  assertPositiveInteger(definition.stateVersion, "workspaceApp.stateVersion")
  assertFunction(definition.createState, "workspaceApp.createState")
  assertFunction(definition.reduce, "workspaceApp.reduce")
  const workspaceApp = Object.freeze({
    appId: definition.appId,
    stateVersion: definition.stateVersion,
    stateCodec: defineRuntimeCodec(definition.stateCodec),
    eventCodec: defineRuntimeCodec(definition.eventCodec),
    createState: definition.createState,
    reduce: definition.reduce,
  })
  definedWorkspaceApps.add(workspaceApp)
  return workspaceApp
}

function eraseWorkspaceApp<State, Event, Effect>(
  value: WorkspaceAppDefinition<State, Event, Effect>
): ErasedWorkspaceAppDefinition {
  return defineWorkspaceApp(value) as ErasedWorkspaceAppDefinition
}

export function createWorkspaceAppRegistry(
  definitions: readonly WorkspaceAppDefinition<unknown, unknown, unknown>[]
): WorkspaceAppRegistry {
  if (!Array.isArray(definitions)) {
    throw new TypeError("workspaceApps must be an array.")
  }
  const byId = new Map<string, ErasedWorkspaceAppDefinition>()
  const ordered: ErasedWorkspaceAppDefinition[] = []
  for (const value of definitions) {
    const definition = eraseWorkspaceApp(
      value as WorkspaceAppDefinition<unknown, unknown, unknown>
    )
    if (byId.has(definition.appId)) {
      throw new Error(`Duplicate Workspace App: ${definition.appId}`)
    }
    byId.set(definition.appId, definition)
    ordered.push(definition)
  }

  const registry: WorkspaceAppRegistry = {
    definitions: Object.freeze(ordered),
    get(appId) {
      assertNonEmptyString(appId, "workspaceAppId")
      const definition = byId.get(appId)
      if (!definition) {
        throw new Error(`Unknown Workspace App: ${appId}`)
      }
      return definition
    },
  }
  return Object.freeze(registry)
}

export function createWorkspaceAppState(
  definition: ErasedWorkspaceAppDefinition,
  scope: WorkspaceScopeContext
) {
  const state = definition.createState(snapshotScope(scope))
  definition.stateCodec.encode(state, `workspaceApp(${definition.appId}).state`)
  return state
}

export function reduceWorkspaceIngress(
  definition: ErasedWorkspaceAppDefinition,
  state: unknown,
  ingress: readonly Readonly<{
    origin: WorkspaceEventOrigin
    event: unknown
  }>[],
  context: WorkspaceReduceContext
): WorkspaceReduction<unknown, unknown> {
  if (!Array.isArray(ingress)) {
    throw new TypeError("workspaceIngress must be an array.")
  }
  assertInstanceId(context.instanceId, "workspaceReduceContext.instanceId")
  assertExactKeys(
    context,
    ["instanceId", "scope"],
    "workspaceReduceContext"
  )
  const safeContext = Object.freeze({
    instanceId: context.instanceId,
    scope: snapshotScope(context.scope),
  })
  const parsedIngress = Object.freeze(
    Array.from(ingress, (entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError(`workspaceIngress[${index}] must be an object.`)
      }
      assertExactKeys(
        entry,
        ["origin", "event"],
        `workspaceIngress[${index}]`
      )
      if (entry.origin !== "live" && entry.origin !== "history") {
        throw new TypeError(
          `workspaceIngress[${index}].origin must be live or history.`
        )
      }
      return Object.freeze({
        origin: entry.origin,
        event: definition.eventCodec.parse(
          entry.event,
          `workspaceIngress[${index}].event`
        ),
      })
    })
  )
  const result = definition.reduce(state, parsedIngress, safeContext)
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError(
      `Workspace App ${definition.appId} returned an invalid reduction.`
    )
  }
  assertExactKeys(
    result,
    ["state", "effects"],
    `Workspace App ${definition.appId} reduction`
  )
  if (!Array.isArray(result.effects)) {
    throw new TypeError(
      `Workspace App ${definition.appId} reduction.effects must be an array.`
    )
  }
  if (
    parsedIngress.length > 0 &&
    parsedIngress.every((entry) => entry.origin === "history") &&
    result.effects.length > 0
  ) {
    throw new Error(
      `Workspace App ${definition.appId} must not return effects for history-only ingress.`
    )
  }
  return Object.freeze({
    state: result.state,
    effects: Object.freeze([...result.effects]),
  })
}

function storedWorkspaceRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("storedWorkspaceApp must be an object.")
  }
  const record = value as Record<string, unknown>
  const expected = new Set(storedWorkspaceKeys)
  for (const key of storedWorkspaceKeys) {
    if (!Object.hasOwn(record, key)) {
      throw new TypeError(`storedWorkspaceApp.${key} is required.`)
    }
  }
  for (const key of Object.keys(record)) {
    if (!expected.has(key as (typeof storedWorkspaceKeys)[number])) {
      throw new TypeError(`storedWorkspaceApp.${key} is not supported.`)
    }
  }
  return record
}

export function decodeStoredWorkspaceApp(
  value: unknown,
  registry: WorkspaceAppRegistry
): DecodedWorkspaceApp {
  const record = storedWorkspaceRecord(value)
  assertInstanceId(record.instanceId, "storedWorkspaceApp.instanceId")
  assertNonEmptyString(record.appId, "storedWorkspaceApp.appId")
  assertPositiveInteger(record.stateVersion, "storedWorkspaceApp.stateVersion")
  const definition = registry.get(record.appId)
  if (record.stateVersion !== definition.stateVersion) {
    throw new Error(
      `Unsupported state version ${record.stateVersion} for Workspace App ${record.appId}; expected ${definition.stateVersion}.`
    )
  }
  return Object.freeze({
    instanceId: record.instanceId,
    definition,
    state: definition.stateCodec.parse(
      record.state,
      `storedWorkspaceApp(${record.instanceId}).state`
    ),
  })
}

export function encodeStoredWorkspaceApp(
  value: DecodedWorkspaceApp
): StoredWorkspaceApp {
  assertInstanceId(value.instanceId, "workspaceApp.instanceId")
  const state = value.definition.stateCodec.encode(
    value.state,
    `workspaceApp(${value.instanceId}).state`
  )
  return Object.freeze({
    instanceId: value.instanceId,
    appId: value.definition.appId,
    stateVersion: value.definition.stateVersion,
    state,
  })
}
