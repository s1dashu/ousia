import { mkdtempSync, readFileSync, rmSync, type PathLike } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SessionManager } from "@earendil-works/pi-coding-agent"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createBranchedSessionFile,
  createMovedSessionFile,
  deletePersistedPiSessionFile,
  findBranchLeafId,
  piSessionKey,
} from "./pi-session-files.js"

const temporaryDirectories: PathLike[] = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "ousia-pi-session-files-"))
  temporaryDirectories.push(directory)
  return directory
}

function readJsonLines(path: string) {
  return readFileSync(path, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe("Pi session file lifecycle", () => {
  it("builds stable runtime keys without normalizing the public context", () => {
    expect(
      piSessionKey({ projectPath: "~/project", sessionId: "session-1" })
    ).toBe("~/project::session-1")
  })

  it("permanently deletes only an exact session in the canonical directory", async () => {
    const deleteFile = vi.fn(async () => undefined)
    const deletedPath = await deletePersistedPiSessionFile(
      "/tmp/project",
      "session-target",
      {
        deleteFile,
        getSessionDir: () => "/tmp/pi-sessions",
        listSessions: vi.fn(async () => [
          {
            id: "session-other",
            path: "/tmp/pi-sessions/other.jsonl",
          },
          {
            id: "session-target",
            path: "/tmp/pi-sessions/target.jsonl",
          },
        ]) as never,
      }
    )

    expect(deletedPath).toBe("/tmp/pi-sessions/target.jsonl")
    expect(deleteFile).toHaveBeenCalledExactlyOnceWith(
      "/tmp/pi-sessions/target.jsonl"
    )
  })

  it("refuses to delete a session outside the canonical directory", async () => {
    await expect(
      deletePersistedPiSessionFile("/tmp/project", "session-target", {
        deleteFile: vi.fn(async () => undefined),
        getSessionDir: () => "/tmp/pi-sessions",
        listSessions: vi.fn(async () => [
          {
            id: "session-target",
            path: "/tmp/untrusted/target.jsonl",
          },
        ]) as never,
      })
    ).rejects.toThrow("outside its canonical directory")
  })

  it("finds branch leaves by direct generated id or latest matching text", () => {
    const entries = [
      {
        type: "message",
        id: "older",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "same response" }],
        },
      },
      {
        type: "message",
        id: "newer",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "same response" }],
        },
      },
    ]
    const manager = {
      getEntries: () => entries,
      getEntry: (id: string) => (id === "direct" ? entries[0] : undefined),
    } as unknown as SessionManager

    expect(findBranchLeafId(manager, "direct-text-0", undefined)).toBe("direct")
    expect(findBranchLeafId(manager, "renderer-only", " same response ")).toBe(
      "newer"
    )
    expect(findBranchLeafId(manager, "missing", "")).toBeUndefined()
  })

  it("creates a linear branch JSONL with a new session header", () => {
    const directory = temporaryDirectory()
    const sourceManager = {
      getBranch: () => [
        {
          type: "message",
          id: "user-1",
          parentId: "source-parent",
          message: { role: "user", content: "hello" },
        },
        {
          type: "label",
          id: "label-1",
          parentId: "user-1",
          label: "checkpoint",
        },
        {
          type: "message",
          id: "assistant-1",
          parentId: "label-1",
          message: { role: "assistant", content: "hi" },
        },
      ],
    } as unknown as SessionManager

    const targetFile = createBranchedSessionFile({
      cwd: "/workspace",
      leafId: "assistant-1",
      parentSessionFile: "/source/session.jsonl",
      sourceSessionManager: sourceManager,
      targetConversationDir: directory,
      targetSessionId: "branch-1",
      timestamp: "2026-07-30T10:20:30.000Z",
    })
    const [header, firstEntry, secondEntry] = readJsonLines(targetFile)

    expect(header).toMatchObject({
      cwd: "/workspace",
      id: "branch-1",
      parentSession: "/source/session.jsonl",
      timestamp: "2026-07-30T10:20:30.000Z",
      type: "session",
    })
    expect(firstEntry).toMatchObject({ id: "user-1", parentId: null })
    expect(secondEntry).toMatchObject({
      id: "assistant-1",
      parentId: "user-1",
    })
  })

  it("creates a moved JSONL with the target id and cwd", () => {
    const directory = temporaryDirectory()
    const sourceManager = {
      getEntries: () => [
        {
          type: "message",
          id: "message-1",
          parentId: null,
          message: { role: "user", content: "hello" },
        },
      ],
      getHeader: () => ({
        type: "session",
        version: 1,
        id: "source",
        cwd: "/old",
        timestamp: "2026-07-30T10:20:30.000Z",
      }),
    } as unknown as SessionManager

    const targetFile = createMovedSessionFile({
      sourceSessionManager: sourceManager,
      targetConversationDir: directory,
      targetCwd: "/new",
      targetSessionId: "target",
    })
    const [header, entry] = readJsonLines(targetFile)

    expect(header).toMatchObject({
      cwd: "/new",
      id: "target",
      timestamp: "2026-07-30T10:20:30.000Z",
      type: "session",
    })
    expect(entry).toMatchObject({ id: "message-1", parentId: null })
  })

  it("fails fast when moving a source without a session header", () => {
    const sourceManager = {
      getHeader: () => null,
    } as unknown as SessionManager

    expect(() =>
      createMovedSessionFile({
        sourceSessionManager: sourceManager,
        targetConversationDir: temporaryDirectory(),
        targetCwd: "/new",
        targetSessionId: "target",
      })
    ).toThrow("source session has no header")
  })
})
