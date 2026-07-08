import { afterEach, describe, expect, it, vi } from "vitest"

import { createDefaultAppState, loadInitialAppState } from "./app-state"

describe("renderer app state bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns default app state outside Electron", async () => {
    const state = await loadInitialAppState()

    expect(state.schemaVersion).toBe(2)
    expect(state.sessions).toHaveLength(1)
    expect(state.selectedSessionId).toBe(state.sessions[0].id)
  })

  it("applies stored theme preference when Electron API is unavailable", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => "dark"),
      },
    })

    await expect(loadInitialAppState()).resolves.toMatchObject({
      settings: {
        theme: "dark",
      },
    })
  })

  it("loads canonical state through the Electron preload API when available", async () => {
    const state = {
      ...createDefaultAppState(),
      settings: {
        ...createDefaultAppState().settings,
        language: "en",
      },
    }
    const loadAppState = vi.fn().mockResolvedValue(state)
    vi.stubGlobal("window", {
      ousia: {
        loadAppState,
      },
    })

    await expect(loadInitialAppState()).resolves.toBe(state)
    expect(loadAppState).toHaveBeenCalled()
  })
})
