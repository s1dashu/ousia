import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import { getMessages } from "@/app/i18n"
import type { OusiaUpdateStatus } from "@/electron/chat-types"
import { Sidebar } from "@/features/sidebar/Sidebar"

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>()
  return {
    ...actual,
    createPortal: (children: ReactNode) => children,
  }
})

const session: SessionRecord = {
  agentProvider: "pi",
  id: "session-1",
  title: "Task",
  time: "2026-07-10T00:00:00.000Z",
}
const project: ProjectRecord = {
  id: "project-1",
  name: "Project",
  path: "/workspace/project",
}
const t = getMessages("en")

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderSidebar({
  projects = [],
  sessions = [session],
  sessionRunStatusById = {},
  updateStatus = { phase: "idle", currentVersion: "0.1.21" },
}: {
  projects?: ProjectRecord[]
  sessions?: SessionRecord[]
  sessionRunStatusById?: Record<string, "idle" | "working">
  updateStatus?: OusiaUpdateStatus
} = {}) {
  vi.stubGlobal("document", { body: {} })

  return renderToStaticMarkup(
    <Sidebar
      onArchiveProject={vi.fn()}
      expandedProjectIds={[]}
      language="en"
      onCreateProjectSession={vi.fn()}
      onCreateSession={vi.fn()}
      onDeleteProject={vi.fn()}
      onArchiveSession={vi.fn()}
      onExpandedProjectIdsChange={vi.fn()}
      onMoveSession={vi.fn()}
      onOpenProject={vi.fn()}
      onOpenSettings={vi.fn()}
      onShowDefaultSessionInFolder={vi.fn()}
      onShowProjectInFolder={vi.fn()}
      onUpdateAction={vi.fn()}
      onRenameSession={vi.fn()}
      onReorderProjects={vi.fn()}
      onReorderSessions={vi.fn()}
      onReorderSidebarSections={vi.fn()}
      onScrollTargetHandled={vi.fn()}
      onSelectSession={vi.fn()}
      projects={projects}
      scrollTargetSessionId=""
      selectedSessionId={session.id}
      sessionRunStatusById={sessionRunStatusById}
      sessions={sessions}
      sidebarSectionOrder={["sessions", "projects"]}
      style={{ width: 256 }}
      updateStatus={updateStatus}
      unreadCompletedSessionIds={new Set()}
    />
  )
}

describe("Sidebar running actions", () => {
  it("shows the default-session folder menu only for a selected non-project chat", () => {
    expect(renderSidebar()).toContain('aria-label="Non-project chat actions"')
    expect(
      renderSidebar({
        projects: [project],
        sessions: [{ ...session, projectId: project.id }],
      })
    ).not.toContain('aria-label="Non-project chat actions"')
  })

  it("shows the update action only when a release is available", () => {
    expect(renderSidebar()).not.toContain(">Update</button>")
    expect(
      renderSidebar({
        updateStatus: {
          phase: "available",
          currentVersion: "0.1.21",
          version: "0.1.22",
          releaseName: "Ousia 0.1.22",
        },
      })
    ).toContain(">Update</button>")
  })

  it("renders a compact filled update action and disables it while checking", () => {
    const available = renderSidebar({
      updateStatus: {
        phase: "available",
        currentVersion: "0.1.21",
        version: "0.1.22",
        releaseName: "Ousia 0.1.22",
      },
    })
    const checking = renderSidebar({
      updateStatus: { phase: "checking", currentVersion: "0.1.21" },
    })

    expect(available).toContain('data-variant="default"')
    expect(available).toContain('data-size="xs"')
    expect(checking).toContain("disabled")
    expect(checking).toContain(">Checking</button>")
  })

  it("insets session surfaces while keeping actions close to the right edge", () => {
    const html = renderSidebar()

    expect(html).toContain("mr-1 pl-2 pr-1")
  })

  it("aligns section and project actions on the same right-hand axis", () => {
    const html = renderSidebar({ projects: [project] })

    expect(html.match(/-ml-1 w-full pl-3 pr-1/g)).toHaveLength(3)
  })

  it("renders only the running indicator for a working session", () => {
    const html = renderSidebar({
      sessionRunStatusById: { [session.id]: "working" },
    })

    expect(html).toContain(`aria-label="${session.title} ${t.sidebar.running}"`)
    expect(html).not.toContain(
      `aria-label="${t.sidebar.archiveSession(session.title)}"`
    )
  })

  it("renders the delete action when the session is idle", () => {
    const html = renderSidebar()

    expect(html).not.toContain(
      `aria-label="${session.title} ${t.sidebar.running}"`
    )
    expect(html).toContain(
      `aria-label="${t.sidebar.archiveSession(session.title)}"`
    )
  })

  it("keeps project actions free of session running indicators", () => {
    const projectSession: SessionRecord = {
      ...session,
      projectId: project.id,
    }
    const html = renderSidebar({
      projects: [project],
      sessions: [projectSession],
      sessionRunStatusById: { [projectSession.id]: "working" },
    })

    expect(html).not.toContain(
      `aria-label="${project.name} ${t.sidebar.running}"`
    )
    expect(html).toContain(
      `aria-label="${t.sidebar.projectActions(project.name)}"`
    )
  })
})
