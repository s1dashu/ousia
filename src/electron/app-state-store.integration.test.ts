/**
 * Integration tests for the app state store.
 *
 * Unlike app-state-store.test.ts (which spies on fs calls and injects
 * failures), these tests run against the REAL file system in a temporary
 * userData directory. They guard the contract that persistence is atomic
 * and durable: concurrent mutations are serialized through the write queue
 * and every state observable in memory is actually recoverable from disk.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  archiveAppStateSessions,
  createAppStateSession,
  deleteAppStateSessions,
  loadAppState,
  resetAppStateStoreForTests,
  saveAppStateSelection,
  saveAppStateSettings,
} from "./app-state-store"
import { defaultOusiaAppSettings } from "./chat-types"

const mockState = vi.hoisted(() => ({
  userDataPath: "",
}))

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name !== "userData") {
        throw new Error(`Unexpected Electron app path request: ${name}`)
      }
      return mockState.userDataPath
    }),
  },
}))

vi.mock("./runtime-logger.js", () => ({
  writeRuntimeLog: vi.fn(),
}))

vi.mock("./pi-retry-settings.js", () => ({
  readPiAutoRetryOnFailure: vi.fn(() => true),
}))

function readStateFileFromDisk() {
  const filePath = join(mockState.userDataPath, "app-state.json")
  // Throws on corrupted/partial JSON — that is the assertion.
  return JSON.parse(readFileSync(filePath, "utf8")) as {
    selectedSessionId: string
    sessions: { id: string; title?: string; archivedAt?: string }[]
    settings: Record<string, unknown>
  }
}

beforeEach(() => {
  mockState.userDataPath = mkdtempSync(join(tmpdir(), "ousia-store-it-"))
  resetAppStateStoreForTests()
})

afterEach(() => {
  resetAppStateStoreForTests()
  rmSync(mockState.userDataPath, { force: true, recursive: true })
})

describe("app-state-store integration (real file system)", () => {
  it("serializes concurrent mutations and leaves valid JSON on disk", async () => {
    await loadAppState()

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        createAppStateSession({ title: `session-${index}` })
      )
    )
    expect(results.every((result) => result.ok)).toBe(true)

    const disk = readStateFileFromDisk()
    // The default state seeds one starter session.
    expect(disk.sessions).toHaveLength(13)
    const titles = new Set(disk.sessions.map((session) => session.title))
    for (let index = 0; index < 12; index += 1) {
      expect(titles.has(`session-${index}`)).toBe(true)
    }
    // Selection must point at one of the concurrently created sessions.
    expect(disk.sessions.some((s) => s.id === disk.selectedSessionId)).toBe(
      true
    )
  })

  it("persists interleaved reads and writes durably across a reload", async () => {
    await loadAppState()
    const created = await createAppStateSession({ title: "durable" })
    expect(created.ok).toBe(true)

    await Promise.all([
      saveAppStateSettings({
        settings: { ...defaultOusiaAppSettings, language: "en" },
      }),
      loadAppState(),
      createAppStateSession({ title: "second" }),
      loadAppState(),
    ])

    // Drop the in-memory snapshot and rebuild purely from disk.
    resetAppStateStoreForTests()
    const reloaded = await loadAppState()
    const titles = reloaded.sessions.map((session) => session.title)
    expect(titles).toContain("durable")
    expect(titles).toContain("second")
    expect(reloaded.settings.language).toBe("en")
  })

  it("archives then permanently deletes sessions with disk state consistent at every step", async () => {
    await loadAppState()
    const first = await createAppStateSession({ title: "keep" })
    const second = await createAppStateSession({ title: "drop" })
    const keepId = first.ok ? first.session?.id : undefined
    const dropId = second.ok ? second.session?.id : undefined
    expect(keepId).toBeTruthy()
    expect(dropId).toBeTruthy()

    await saveAppStateSelection({ selectedSessionId: keepId! })
    await archiveAppStateSessions({ sessionIds: [dropId!] })

    let disk = readStateFileFromDisk()
    expect(
      disk.sessions.find((session) => session.id === dropId)?.archivedAt
    ).toBeTruthy()

    await deleteAppStateSessions({ sessionIds: [dropId!] })

    disk = readStateFileFromDisk()
    expect(disk.sessions).toHaveLength(2)
    expect(disk.sessions[0]?.id).toBe(keepId)
    expect(disk.selectedSessionId).toBe(keepId)

    // The deletion must be durable, not just an in-memory update.
    resetAppStateStoreForTests()
    const reloaded = await loadAppState()
    expect(reloaded.sessions.map((session) => session.id)).toContain(keepId)
    expect(reloaded.sessions.map((session) => session.id)).not.toContain(
      dropId
    )
    expect(reloaded.sessions).toHaveLength(2)
  })

  it("rejects permanent deletion of active sessions without touching disk state", async () => {
    await loadAppState()
    const created = await createAppStateSession({ title: "active" })
    const sessionId = created.ok ? created.session?.id : undefined
    expect(sessionId).toBeTruthy()

    const before = readStateFileFromDisk()
    const result = await deleteAppStateSessions({ sessionIds: [sessionId!] })
    expect(result.ok).toBe(false)

    const after = readStateFileFromDisk()
    expect(after.sessions.map((session) => session.id)).toEqual(
      before.sessions.map((session) => session.id)
    )
  })
})
