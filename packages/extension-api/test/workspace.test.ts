import { describe, expect, it, vi } from "vitest"

import {
  createWorkspaceAppRegistry,
  createWorkspaceAppState,
  decodeStoredWorkspaceApp,
  defineRuntimeCodec,
  defineWorkspaceApp,
  encodeStoredWorkspaceApp,
  reduceWorkspaceIngress,
  type WorkspaceScopeContext,
} from "../src/index.js"

function countCodec() {
  return defineRuntimeCodec<{ count: number }>({
    parse(value, path = "state") {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !Number.isSafeInteger((value as { count?: unknown }).count)
      ) {
        throw new TypeError(`${path}.count must be an integer.`)
      }
      return { count: (value as { count: number }).count }
    },
    encode(value) {
      return { count: value.count }
    },
  })
}

function eventCodec() {
  return defineRuntimeCodec<{ delta: number }>({
    parse(value, path = "event") {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !Number.isSafeInteger((value as { delta?: unknown }).delta)
      ) {
        throw new TypeError(`${path}.delta must be an integer.`)
      }
      return { delta: (value as { delta: number }).delta }
    },
    encode(value) {
      return { delta: value.delta }
    },
  })
}

function countApp() {
  return defineWorkspaceApp<
    { count: number },
    { delta: number },
    { type: "focus" }
  >({
    appId: "test.counter",
    stateVersion: 1,
    stateCodec: countCodec(),
    eventCodec: eventCodec(),
    createState() {
      return { count: 0 }
    },
    reduce(state, ingress) {
      const count = ingress.reduce(
        (current, entry) => current + entry.event.delta,
        state.count
      )
      return {
        state: count === state.count ? state : { count },
        effects: ingress.some((entry) => entry.origin === "live")
          ? [{ type: "focus" }]
          : [],
      }
    },
  })
}

const scope: WorkspaceScopeContext = {
  kind: "session",
  scopeKey: "session:one",
  sessionId: "one",
}

describe("Workspace App contract", () => {
  it("registers, creates, reduces, and round-trips app state", () => {
    const registry = createWorkspaceAppRegistry([countApp()])
    const definition = registry.get("test.counter")
    const initial = createWorkspaceAppState(definition, scope)
    const reduced = reduceWorkspaceIngress(
      definition,
      initial,
      [{ origin: "live", event: { delta: 2 } }],
      { instanceId: "counter", scope }
    )
    expect(reduced).toEqual({
      state: { count: 2 },
      effects: [{ type: "focus" }],
    })

    const stored = encodeStoredWorkspaceApp({
      instanceId: "counter",
      definition,
      state: reduced.state,
    })
    expect(stored).toEqual({
      instanceId: "counter",
      appId: "test.counter",
      stateVersion: 1,
      state: { count: 2 },
    })
    expect(decodeStoredWorkspaceApp(stored, registry).state).toEqual({
      count: 2,
    })
  })

  it("keeps history effects separate from persisted state", () => {
    const definition = createWorkspaceAppRegistry([countApp()]).get(
      "test.counter"
    )
    const reduced = reduceWorkspaceIngress(
      definition,
      { count: 0 },
      [{ origin: "history", event: { delta: 1 } }],
      { instanceId: "counter", scope }
    )
    expect(reduced.effects).toEqual([])
    expect(reduced.state).toEqual({ count: 1 })
  })

  it("rejects effects from history-only ingress but allows them with live ingress", () => {
    const app = defineWorkspaceApp({
      ...countApp(),
      appId: "test.history-effects",
      reduce(state) {
        return { state, effects: [{ type: "focus" as const }] }
      },
    })
    const definition = createWorkspaceAppRegistry([app]).get(
      "test.history-effects"
    )

    expect(() =>
      reduceWorkspaceIngress(
        definition,
        { count: 0 },
        [{ origin: "history", event: { delta: 1 } }],
        { instanceId: "counter", scope }
      )
    ).toThrow("must not return effects for history-only ingress")

    expect(
      reduceWorkspaceIngress(
        definition,
        { count: 0 },
        [
          { origin: "history", event: { delta: 1 } },
          { origin: "live", event: { delta: 1 } },
        ],
        { instanceId: "counter", scope }
      ).effects
    ).toEqual([{ type: "focus" }])
  })

  it("rejects duplicate, unknown, malformed, and incompatible state", () => {
    expect(() =>
      createWorkspaceAppRegistry([countApp(), countApp()])
    ).toThrow("Duplicate Workspace App: test.counter")
    const registry = createWorkspaceAppRegistry([countApp()])
    expect(() => registry.get("missing.app")).toThrow(
      "Unknown Workspace App: missing.app"
    )
    expect(() =>
      decodeStoredWorkspaceApp(
        {
          instanceId: "counter",
          appId: "test.counter",
          stateVersion: 2,
          state: { count: 0 },
        },
        registry
      )
    ).toThrow("Unsupported state version 2")
    expect(() =>
      decodeStoredWorkspaceApp(
        {
          instanceId: "counter",
          appId: "test.counter",
          stateVersion: 1,
          state: {},
        },
        registry
      )
    ).toThrow("count must be an integer")
  })

  it("preserves state identity for semantic no-op reductions", () => {
    const definition = createWorkspaceAppRegistry([countApp()]).get(
      "test.counter"
    )
    const state = { count: 3 }
    const reduced = reduceWorkspaceIngress(
      definition,
      state,
      [{ origin: "history", event: { delta: 0 } }],
      { instanceId: "counter", scope }
    )
    expect(reduced.state).toBe(state)
  })

  it("rejects sparse ingress before invoking a reducer", () => {
    const definition = createWorkspaceAppRegistry([countApp()]).get(
      "test.counter"
    )
    expect(() =>
      reduceWorkspaceIngress(
        definition,
        { count: 0 },
        new Array(1),
        { instanceId: "counter", scope }
      )
    ).toThrow("workspaceIngress[0] must be an object")
  })

  it("rejects unknown contract fields instead of silently dropping them", () => {
    expect(() =>
      defineWorkspaceApp({
        ...countApp(),
        hiddenFallback: true,
      } as never)
    ).toThrow("workspaceApp.hiddenFallback is not supported")

    const invalidReductionApp = defineWorkspaceApp({
      ...countApp(),
      appId: "test.invalid-reduction",
      reduce(state) {
        return { state, effects: [], persist: false } as never
      },
    })
    const definition = createWorkspaceAppRegistry([invalidReductionApp]).get(
      "test.invalid-reduction"
    )
    expect(() =>
      reduceWorkspaceIngress(definition, { count: 0 }, [], {
        instanceId: "counter",
        scope,
      })
    ).toThrow("reduction.persist is not supported")
  })

  it("does not deep-encode complete state on the ingress hot path", () => {
    const base = countApp()
    const encode = vi.fn((value: { count: number }) => ({ count: value.count }))
    const stateCodec = defineRuntimeCodec({
      parse: base.stateCodec.parse,
      encode,
    })
    const app = defineWorkspaceApp({
      ...base,
      appId: "test.hot-path",
      stateCodec,
    })
    const definition = createWorkspaceAppRegistry([app]).get("test.hot-path")

    expect(defineWorkspaceApp(app)).toBe(app)
    expect(definition).toBe(app)
    expect(definition.stateCodec).toBe(stateCodec)

    const reduced = reduceWorkspaceIngress(
      definition,
      { count: 0 },
      [{ origin: "live", event: { delta: 1 } }],
      { instanceId: "counter", scope }
    )
    expect(encode).not.toHaveBeenCalled()

    encodeStoredWorkspaceApp({
      instanceId: "counter",
      definition,
      state: reduced.state,
    })
    expect(encode).toHaveBeenCalledTimes(1)
  })
})
