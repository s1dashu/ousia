import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  OUSIA_DEFAULT_WORK_DIR,
  OUSIA_LEGACY_DEFAULT_WORK_DIR,
  type OusiaAppState,
} from "./chat-types"

const mockState = vi.hoisted(() => ({
  homeDir: "",
  readPiAutoRetryOnFailure: vi.fn(() => true),
  userDataPath: "",
  writeRuntimeLog: vi.fn(),
}))

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return {
    ...actual,
    homedir: () => mockState.homeDir,
  }
})

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

vi.mock("./pi-environment.js", () => ({
  readPiAutoRetryOnFailure: mockState.readPiAutoRetryOnFailure,
}))

vi.mock("./runtime-logger.js", () => ({
  writeRuntimeLog: mockState.writeRuntimeLog,
}))

import {
  createAppStateProject,
  createAppStateSession,
  deleteAppStateProject,
  deleteAppStateSession,
  loadAppState,
  moveAppStateSession,
  renameAppStateSession,
  reorderAppStateSessions,
  reorderAppStateProjects,
  saveAppStateSelection,
  saveAppStateSettings,
  saveAppStateShellLayout,
  saveWindowState,
  touchAppStateSession,
} from "./app-state-store"

describe("app state store", () => {
  let testRoot: string

  beforeEach(() => {
    testRoot = join(tmpdir(), `ousia-app-state-${Date.now()}`)
    mockState.homeDir = join(testRoot, "home")
    mockState.userDataPath = join(testRoot, "userData")
    mockState.readPiAutoRetryOnFailure.mockReturnValue(true)
    mockState.writeRuntimeLog.mockClear()
    mkdirSync(mockState.homeDir, { recursive: true })
    mkdirSync(mockState.userDataPath, { recursive: true })
  })

  afterEach(() => {
    rmSync(testRoot, { force: true, recursive: true })
  })

  function appStateFilePath() {
    return join(mockState.userDataPath, "app-state.json")
  }

  function readStoredState() {
    return JSON.parse(readFileSync(appStateFilePath(), "utf8")) as OusiaAppState
  }

  function expectDefined<T>(value: T | undefined): T {
    expect(value).toBeDefined()
    return value as T
  }

  it("loads a valid default state when no persisted state exists", async () => {
    const state = await loadAppState()

    expect(state.schemaVersion).toBe(2)
    expect(state.sessions).toHaveLength(1)
    expect(state.selectedSessionId).toBe(state.sessions[0].id)
    expect(state.settings.autoRetryOnFailure).toBe(true)
    expect(readStoredState().selectedSessionId).toBe(state.selectedSessionId)
  })

  it("falls back to defaults for invalid persisted state", async () => {
    writeFileSync(
      appStateFilePath(),
      JSON.stringify({
        schemaVersion: 1,
        settings: {},
        sessions: [],
      }),
      "utf8"
    )

    const state = await loadAppState()

    expect(state.schemaVersion).toBe(2)
    expect(state.sessions).toHaveLength(1)
    expect(state.projects).toEqual([])
  })

  it("logs malformed persisted state and returns defaults", async () => {
    writeFileSync(appStateFilePath(), "{ not-json", "utf8")

    const state = await loadAppState()

    expect(state.schemaVersion).toBe(2)
    expect(state.sessions).toHaveLength(1)
    expect(mockState.writeRuntimeLog).toHaveBeenCalledWith(
      "app-state",
      "warn",
      "Failed to read app state",
      expect.objectContaining({
        error: expect.stringContaining("Expected property name"),
        filePath: appStateFilePath(),
      })
    )
  })

  it("normalizes malformed current-schema records from disk", async () => {
    writeFileSync(
      appStateFilePath(),
      JSON.stringify({
        expandedProjectIds: ["project-valid", "missing", 7],
        projects: [
          { id: "project-valid", name: "Valid", path: "/tmp/valid" },
          { id: "project-invalid", name: "Invalid" },
          "not-a-project",
        ],
        schemaVersion: 2,
        selectedSessionId: "missing-session",
        sessions: [
          {
            id: "session-valid",
            projectId: "project-valid",
            time: "2026-07-07T00:00:00.000Z",
            title: "Valid",
          },
          { id: "bad-session", title: "Bad" },
          "not-a-session",
        ],
        settings: {
          appearanceColorScale: "paper",
          defaultWorkDir: "/tmp/custom-workdir",
          language: "en",
          modelId: "deepseek-v4-flash",
          modelProvider: "deepseek",
          theme: "light",
        },
        shellLayout: {
          isSidebarCollapsed: "no",
          sidebarSectionOrder: ["projects", "bad", "sessions"],
          sidebarWidth: 10,
        },
        windowState: {
          height: Number.NaN,
          isMaximized: "yes",
          width: "wide",
          x: Number.POSITIVE_INFINITY,
          y: 20.2,
        },
      }),
      "utf8"
    )

    const state = await loadAppState()

    expect(state.projects).toEqual([
      { id: "project-valid", name: "Valid", path: "/tmp/valid" },
    ])
    expect(state.sessions).toEqual([
      {
        id: "session-valid",
        projectId: "project-valid",
        time: "2026-07-07T00:00:00.000Z",
        title: "Valid",
      },
    ])
    expect(state.expandedProjectIds).toEqual(["project-valid"])
    expect(state.selectedSessionId).toBe("session-valid")
    expect(state.shellLayout).toEqual({
      isSidebarCollapsed: false,
      sidebarSectionOrder: ["projects", "sessions"],
      sidebarWidth: 200,
    })
    expect(state.windowState).toEqual({
      height: 900,
      isMaximized: false,
      width: 1440,
      y: 20,
    })
  })

  it("removes explicit projects that point at the default work dir", async () => {
    writeFileSync(
      appStateFilePath(),
      JSON.stringify({
        expandedProjectIds: ["default-project"],
        projects: [
          {
            id: "default-project",
            name: "Ousia",
            path: OUSIA_DEFAULT_WORK_DIR,
          },
        ],
        schemaVersion: 2,
        selectedSessionId: "session-default",
        sessions: [
          {
            id: "session-default",
            projectId: "default-project",
            time: "2026-07-07T00:00:00.000Z",
            title: "Default workdir session",
          },
        ],
        settings: {
          appearanceColorScale: "paper",
          defaultWorkDir: OUSIA_DEFAULT_WORK_DIR,
          language: "en",
          modelId: "deepseek-v4-flash",
          modelProvider: "deepseek",
          theme: "light",
        },
      }),
      "utf8"
    )

    const state = await loadAppState()

    expect(state.projects).toEqual([])
    expect(state.expandedProjectIds).toEqual([])
    expect(state.sessions).toEqual([
      {
        id: "session-default",
        time: "2026-07-07T00:00:00.000Z",
        title: "Default workdir session",
      },
    ])
    expect(state.selectedSessionId).toBe("session-default")
  })

  it("migrates legacy default work dir items and reports conflicts", async () => {
    const legacyWorkDir = join(
      mockState.homeDir,
      OUSIA_LEGACY_DEFAULT_WORK_DIR.slice(2)
    )
    const defaultWorkDir = join(mockState.homeDir, OUSIA_DEFAULT_WORK_DIR.slice(2))
    mkdirSync(legacyWorkDir, { recursive: true })
    mkdirSync(defaultWorkDir, { recursive: true })
    writeFileSync(join(legacyWorkDir, "move-me.txt"), "legacy", "utf8")
    writeFileSync(join(legacyWorkDir, "conflict.txt"), "legacy", "utf8")
    writeFileSync(join(defaultWorkDir, "conflict.txt"), "current", "utf8")

    await loadAppState()

    expect(readFileSync(join(defaultWorkDir, "move-me.txt"), "utf8")).toBe(
      "legacy"
    )
    expect(readFileSync(join(defaultWorkDir, "conflict.txt"), "utf8")).toBe(
      "current"
    )
    expect(existsSync(join(legacyWorkDir, "conflict.txt"))).toBe(true)
    expect(mockState.writeRuntimeLog).toHaveBeenCalledWith(
      "app-state",
      "warn",
      expect.objectContaining({
        message: "Skipped legacy default work dir item because target exists",
        sourcePath: join(legacyWorkDir, "conflict.txt"),
        targetPath: join(defaultWorkDir, "conflict.txt"),
      })
    )
    expect(mockState.writeRuntimeLog).toHaveBeenCalledWith(
      "app-state",
      "warn",
      expect.objectContaining({
        message: "Legacy default work dir was migrated but not removed",
        path: legacyWorkDir,
      })
    )
  })

  it("normalizes shell layout before saving", async () => {
    const result = await saveAppStateShellLayout({
      shellLayout: {
        isSidebarCollapsed: true,
        sidebarSectionOrder: ["projects", "sessions", "projects"],
        sidebarWidth: 999,
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.state.shellLayout).toEqual({
      isSidebarCollapsed: true,
      sidebarSectionOrder: ["projects", "sessions"],
      sidebarWidth: 320,
    })
    expect(readStoredState().shellLayout.sidebarWidth).toBe(320)
  })

  it("normalizes window state before saving", async () => {
    const result = await saveWindowState({
      height: 1,
      isMaximized: true,
      width: 99999,
      x: 10.7,
      y: 20.2,
    })

    expect(result).toEqual({ ok: true })
    expect(readStoredState().windowState).toEqual({
      height: 400,
      isMaximized: true,
      width: 10000,
      x: 11,
      y: 20,
    })
  })

  it("logs Pi retry read failures without hiding the settings save", async () => {
    const baseSettings = (await loadAppState()).settings
    mockState.readPiAutoRetryOnFailure.mockImplementation(() => {
      throw new Error("Pi settings unavailable")
    })

    const result = await saveAppStateSettings({
      settings: {
        ...baseSettings,
        autoRetryOnFailure: false,
        language: "en",
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.state.settings.language).toBe("en")
    expect(result.state.settings.autoRetryOnFailure).toBe(false)
    expect(mockState.writeRuntimeLog).toHaveBeenCalledWith(
      "app-state",
      "warn",
      {
        error: "Pi settings unavailable",
        message: "Failed to read Pi retry setting",
      }
    )
  })

  it("filters selection state through known sessions and projects", async () => {
    const projectResult = await createAppStateProject({
      name: "Project",
      path: "/tmp/project",
    })
    expect(projectResult.ok).toBe(true)
    if (!projectResult.ok) {
      return
    }
    const project = expectDefined(projectResult.project)

    const result = await saveAppStateSelection({
      expandedProjectIds: [project.id, "missing-project"],
      selectedSessionId: "missing-session",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.state.expandedProjectIds).toEqual([project.id])
    expect(result.state.selectedSessionId).toBe(result.state.sessions[0].id)
  })

  it("serializes concurrent session creation without dropping writes", async () => {
    const [first, second] = await Promise.all([
      createAppStateSession({ title: "First queued write" }),
      createAppStateSession({ title: "Second queued write" }),
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)

    const titles = (await loadAppState()).sessions.map((session) => session.title)
    expect(titles).toEqual(
      expect.arrayContaining(["First queued write", "Second queued write"])
    )
  })

  it("creates projects with a selected project session", async () => {
    const result = await createAppStateProject({
      name: "Desktop",
      path: "/tmp/ousia/Desktop",
      sessionTitle: "Project kickoff",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const project = expectDefined(result.project)
    const session = expectDefined(result.session)
    expect(project).toMatchObject({
      name: "Desktop",
      path: "/tmp/ousia/Desktop",
    })
    expect(session).toMatchObject({
      projectId: project.id,
      title: "Project kickoff",
    })
    expect(result.state.selectedSessionId).toBe(session.id)
    expect(result.state.expandedProjectIds).toContain(project.id)
  })

  it("reuses existing projects without duplicating project sessions", async () => {
    const first = await createAppStateProject({
      name: "Desktop",
      path: "/tmp/ousia/Desktop",
      sessionTitle: "First",
    })
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }
    const firstProject = expectDefined(first.project)
    const firstSession = expectDefined(first.session)

    const second = await createAppStateProject({
      name: "Different name ignored",
      path: "/tmp/ousia/Desktop",
      sessionTitle: "Second",
    })

    expect(second.ok).toBe(true)
    if (!second.ok) {
      return
    }
    expect(second.project).toEqual(firstProject)
    expect(second.session).toEqual(firstSession)
    expect(second.state.projects).toHaveLength(1)
    expect(
      second.state.sessions.filter(
        (session) => session.projectId === firstProject.id
      )
    ).toHaveLength(1)
  })

  it("rejects transactions that reference unknown projects", async () => {
    const result = await createAppStateSession({
      projectId: "missing-project",
      title: "Should fail",
    })

    expect(result).toMatchObject({
      error: "Unknown project: missing-project",
      ok: false,
    })
  })

  it("rejects empty project paths and empty session titles", async () => {
    await expect(createAppStateProject({ path: "   " })).resolves.toMatchObject({
      error: "Project path cannot be empty.",
      ok: false,
    })

    const sessionId = (await loadAppState()).selectedSessionId
    await expect(
      renameAppStateSession({ sessionId, title: "   " })
    ).resolves.toMatchObject({
      error: "Session title cannot be empty.",
      ok: false,
    })
  })

  it("deletes the last session and normalizes back to a valid default session", async () => {
    const state = await loadAppState()
    const deletedSessionId = state.selectedSessionId

    const result = await deleteAppStateSession({ sessionId: deletedSessionId })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.removedSessions).toEqual([state.sessions[0]])
    expect(result.state.sessions).toHaveLength(1)
    expect(result.state.sessions[0].id).not.toBe(deletedSessionId)
    expect(result.state.selectedSessionId).toBe(result.state.sessions[0].id)
  })

  it("renames, moves, reorders, and touches sessions inside their groups", async () => {
    const projectResult = await createAppStateProject({
      name: "Project",
      path: "/tmp/project",
      sessionTitle: "Project session",
    })
    expect(projectResult.ok).toBe(true)
    if (!projectResult.ok) {
      return
    }
    const project = expectDefined(projectResult.project)
    const projectSession = expectDefined(projectResult.session)
    const projectId = project.id
    const projectSessionId = projectSession.id

    const defaultSession = projectResult.state.sessions.find(
      (session) => !session.projectId
    )
    expect(defaultSession).toBeTruthy()
    const renameResult = await renameAppStateSession({
      sessionId: defaultSession!.id,
      title: "Default session renamed",
    })
    expect(renameResult).toMatchObject({
      ok: true,
      session: { title: "Default session renamed" },
    })

    const secondProjectSession = await createAppStateSession({
      projectId,
      title: "Second project session",
    })
    expect(secondProjectSession.ok).toBe(true)
    if (!secondProjectSession.ok) {
      return
    }

    const reorderResult = await reorderAppStateSessions({
      sourceSessionId: projectSessionId!,
      targetSessionId: secondProjectSession.session!.id,
    })
    expect(reorderResult.ok).toBe(true)
    if (!reorderResult.ok) {
      return
    }
    const projectGroup = reorderResult.state.sessions.filter(
      (session) => session.projectId === projectId
    )
    expect(projectGroup.map((session) => session.id)).toEqual([
      projectSessionId,
      secondProjectSession.session!.id,
    ])

    const moveResult = await moveAppStateSession({
      sessionId: defaultSession!.id,
      targetProjectId: projectId,
    })
    expect(moveResult).toMatchObject({
      ok: true,
      session: { projectId },
    })

    const touchResult = await touchAppStateSession({
      sessionId: secondProjectSession.session!.id,
      time: "2026-07-07T00:00:00.000Z",
    })
    expect(touchResult.ok).toBe(true)
    if (!touchResult.ok) {
      return
    }
    const touchedGroup = touchResult.state.sessions.filter(
      (session) => session.projectId === projectId
    )
    expect(touchedGroup[0]).toMatchObject({
      id: secondProjectSession.session!.id,
      time: "2026-07-07T00:00:00.000Z",
    })
  })

  it("moves sessions before target sessions and back to the default group", async () => {
    const projectResult = await createAppStateProject({
      name: "Project",
      path: "/tmp/project",
      sessionTitle: "First project session",
    })
    expect(projectResult.ok).toBe(true)
    if (!projectResult.ok) {
      return
    }
    const project = expectDefined(projectResult.project)
    const firstProjectSession = expectDefined(projectResult.session)
    const secondProjectSession = await createAppStateSession({
      projectId: project.id,
      title: "Second project session",
    })
    expect(secondProjectSession.ok).toBe(true)
    if (!secondProjectSession.ok) {
      return
    }
    const defaultSession = expectDefined(
      secondProjectSession.state.sessions.find((session) => !session.projectId)
    )

    const movedIntoProject = await moveAppStateSession({
      sessionId: defaultSession.id,
      targetProjectId: project.id,
      targetSessionId: firstProjectSession.id,
    })

    expect(movedIntoProject.ok).toBe(true)
    if (!movedIntoProject.ok) {
      return
    }
    expect(
      movedIntoProject.state.sessions
        .filter((session) => session.projectId === project.id)
        .map((session) => session.id)
    ).toEqual([
      secondProjectSession.session!.id,
      defaultSession.id,
      firstProjectSession.id,
    ])

    const movedBackToDefault = await moveAppStateSession({
      sessionId: defaultSession.id,
    })

    expect(movedBackToDefault.ok).toBe(true)
    if (!movedBackToDefault.ok) {
      return
    }
    expect(
      movedBackToDefault.state.sessions.find(
        (session) => session.id === defaultSession.id
      )
    ).not.toHaveProperty("projectId")
  })

  it("rejects unknown sessions for move and touch transactions", async () => {
    await expect(
      moveAppStateSession({
        sessionId: "missing-session",
      })
    ).resolves.toMatchObject({
      error: "Unknown session: missing-session",
      ok: false,
    })

    await expect(
      touchAppStateSession({
        sessionId: "missing-session",
        time: "2026-07-07T00:00:00.000Z",
      })
    ).resolves.toMatchObject({
      error: "Unknown session: missing-session",
      ok: false,
    })
  })

  it("deletes projects with their sessions and repairs selection", async () => {
    const projectResult = await createAppStateProject({
      name: "Project",
      path: "/tmp/project",
      sessionTitle: "Project session",
    })
    expect(projectResult.ok).toBe(true)
    if (!projectResult.ok) {
      return
    }
    const project = expectDefined(projectResult.project)
    const session = expectDefined(projectResult.session)

    const result = await deleteAppStateProject({
      projectId: project.id,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.removedSessions).toEqual([session])
    expect(result.state.projects).toEqual([])
    expect(result.state.sessions.every((session) => !session.projectId)).toBe(
      true
    )
    expect(result.state.selectedSessionId).toBe(result.state.sessions[0].id)
  })

  it("reorders projects by id", async () => {
    const first = await createAppStateProject({
      name: "First",
      path: "/tmp/first",
      selectOrCreateSession: false,
    })
    const second = await createAppStateProject({
      name: "Second",
      path: "/tmp/second",
      selectOrCreateSession: false,
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) {
      return
    }
    const firstProject = expectDefined(first.project)
    const secondProject = expectDefined(second.project)

    const result = await reorderAppStateProjects({
      sourceProjectId: secondProject.id,
      targetProjectId: firstProject.id,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.state.projects.map((project) => project.id)).toEqual([
      secondProject.id,
      firstProject.id,
    ])
  })
})
