import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import { getMessages } from "@/app/i18n"
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
}: {
  projects?: ProjectRecord[]
  sessions?: SessionRecord[]
  sessionRunStatusById?: Record<string, "idle" | "working">
} = {}) {
  vi.stubGlobal("document", { body: {} })

  return renderToStaticMarkup(
    <Sidebar
      expandedProjectIds={[]}
      language="en"
      onCreateProjectSession={vi.fn()}
      onCreateSession={vi.fn()}
      onDeleteProject={vi.fn()}
      onDeleteSession={vi.fn()}
      onExpandedProjectIdsChange={vi.fn()}
      onMoveSession={vi.fn()}
      onOpenProject={vi.fn()}
      onOpenSettings={vi.fn()}
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
      unreadCompletedSessionIds={new Set()}
    />
  )
}

describe("Sidebar running actions", () => {
  it("renders only the running indicator for a working session", () => {
    const html = renderSidebar({
      sessionRunStatusById: { [session.id]: "working" },
    })

    expect(html).toContain(
      `aria-label="${session.title} ${t.sidebar.running}"`
    )
    expect(html).not.toContain(
      `aria-label="${t.sidebar.deleteSession(session.title)}"`
    )
  })

  it("renders the delete action when the session is idle", () => {
    const html = renderSidebar()

    expect(html).not.toContain(
      `aria-label="${session.title} ${t.sidebar.running}"`
    )
    expect(html).toContain(
      `aria-label="${t.sidebar.deleteSession(session.title)}"`
    )
  })

  it("replaces project deletion with a running indicator", () => {
    const projectSession: SessionRecord = {
      ...session,
      projectId: project.id,
    }
    const html = renderSidebar({
      projects: [project],
      sessions: [projectSession],
      sessionRunStatusById: { [projectSession.id]: "working" },
    })

    expect(html).toContain(
      `aria-label="${project.name} ${t.sidebar.running}"`
    )
    expect(html).not.toContain(
      `aria-label="${t.sidebar.removeProject(project.name)}"`
    )
  })
})
