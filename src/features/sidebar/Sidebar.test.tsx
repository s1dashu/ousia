import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import { getMessages } from "@/app/i18n"
import type { OusiaUpdateStatus } from "@/electron/chat-types"
import {
  Sidebar,
} from "@/features/sidebar/Sidebar"
import {
  getSidebarDockInlineMetrics,
  getSidebarSectionDockState,
} from "@/features/sidebar/sidebar-section-dock"

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
  activeSidebarUtilityDestination = null,
  expandedProjectIds = [],
  language = "en",
  projects = [],
  sessions = [session],
  sessionRunStatusById = {},
  sidebarSectionOrder = ["sessions", "projects"],
  updateStatus = { phase: "idle", currentVersion: "0.1.21" },
}: {
  activeSidebarUtilityDestination?: React.ComponentProps<
    typeof Sidebar
  >["activeSidebarUtilityDestination"]
  expandedProjectIds?: string[]
  language?: React.ComponentProps<typeof Sidebar>["language"]
  projects?: ProjectRecord[]
  sessions?: SessionRecord[]
  sessionRunStatusById?: Record<string, "idle" | "working">
  sidebarSectionOrder?: React.ComponentProps<
    typeof Sidebar
  >["sidebarSectionOrder"]
  updateStatus?: OusiaUpdateStatus
} = {}) {
  vi.stubGlobal("document", { body: {} })

  return renderToStaticMarkup(
    <Sidebar
      activeSidebarUtilityDestination={activeSidebarUtilityDestination}
      onArchiveProject={vi.fn()}
      expandedProjectIds={expandedProjectIds}
      language={language}
      onCreateProjectSession={vi.fn()}
      onCreateSession={vi.fn()}
      onDeleteProject={vi.fn()}
      onArchiveSession={vi.fn()}
      onExpandedProjectIdsChange={vi.fn()}
      onMoveSession={vi.fn()}
      onOpenProject={vi.fn()}
      onOpenSettings={vi.fn()}
      onSelectSidebarUtilityDestination={vi.fn()}
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
      sidebarSectionOrder={sidebarSectionOrder}
      style={{ width: 256 }}
      updateStatus={updateStatus}
      unreadCompletedSessionIds={new Set()}
    />
  )
}

describe("Sidebar running actions", () => {
  it("aligns docked section actions with the scroll viewport content width", () => {
    expect(
      getSidebarDockInlineMetrics({
        sectionLeft: 7,
        sectionWidth: 238,
        viewportLeft: 0,
      })
    ).toEqual({ left: 7, width: 238 })
  })

  it("docks projects at the top symmetrically with conversations at the bottom", () => {
    expect(
      getSidebarSectionDockState({
        canDockProjectsToTop: true,
        canDockSessionsToBottom: true,
        projectsBottom: 0,
        projectsTop: -200,
        sessionsTop: 900,
        viewportBottom: 800,
        viewportTop: 0,
      })
    ).toEqual({
      projects: true,
      projectsCollapsed: true,
      sessions: true,
    })

    expect(
      getSidebarSectionDockState({
        canDockProjectsToTop: true,
        canDockSessionsToBottom: true,
        projectsBottom: 1,
        projectsTop: 0,
        sessionsTop: 799,
        viewportBottom: 800,
        viewportTop: 0,
      })
    ).toEqual({
      projects: false,
      projectsCollapsed: false,
      sessions: false,
    })

    expect(
      getSidebarSectionDockState({
        canDockProjectsToTop: true,
        canDockSessionsToBottom: true,
        projectsBottom: 400,
        projectsTop: -20,
        sessionsTop: 600,
        viewportBottom: 800,
        viewportTop: 0,
      })
    ).toEqual({
      projects: true,
      projectsCollapsed: false,
      sessions: false,
    })
  })

  it("keeps projects and conversations in the same scroll region", () => {
    const html = renderSidebar({
      sidebarSectionOrder: ["projects", "sessions"],
    })

    expect(html).toContain('data-sidebar-section-id="projects"')
    expect(html).toContain('data-sidebar-section-id="sessions"')
    expect(html.match(/overflow-y-auto/g)).toHaveLength(1)
    expect(html).not.toContain(
      "sticky bottom-0 z-10 max-h-full overflow-auto bg-sidebar"
    )
  })

  it("renders the visible utility entries without sidebar branding", () => {
    const html = renderSidebar()

    const primaryLabelIndex = html.indexOf(">Search<")
    expect(primaryLabelIndex).toBeGreaterThan(-1)
    expect(html).not.toContain('aria-label="Ousia"')
    expect(html).not.toContain(">Ousia</span>")
    expect(html).toContain('aria-label="Ousia features"')
    expect(html.match(/pl-\[5px\] pr-\[9px\]/g)).toHaveLength(1)
    expect(html).toContain("pl-[5px] pr-[8px]")
    expect(html).toContain("pl-[4px] pr-[9px]")
    expect(html).not.toContain("utility-new-task-button")
    expect(html).not.toContain("<kbd")
    const buttonForLabel = (label: string) => {
      const labelIndex = html.indexOf(`>${label}<`)
      const buttonStart = html.lastIndexOf("<button", labelIndex)
      return html.slice(buttonStart, html.indexOf(">", buttonStart) + 1)
    }
    const primaryButtonStart = html.lastIndexOf("<button", primaryLabelIndex)
    const primaryButton = buttonForLabel("Search")
    const searchButton = buttonForLabel("Search")
    expect(primaryButtonStart).toBeGreaterThan(-1)
    expect(primaryButton).toContain("ousia-squircle-corners")
    expect(primaryButton.match(/class="([^"]*)"/)?.[1]).toBe(
      searchButton.match(/class="([^"]*)"/)?.[1]
    )
    expect(html).toContain(">New task<")
    expect(html).toContain(">Search<")
    expect(html).toContain(">Extensions<")
    expect(html).not.toContain(">Scheduled tasks<")
    expect(html).not.toContain(">Connect phone<")
    expect(html).not.toContain(">Remote control<")
  })

  it("uses the same stable selected surface for utility entries and conversations", () => {
    const html = renderSidebar({ activeSidebarUtilityDestination: "extensions" })

    expect(html).toContain('aria-current="page"')
    expect(html).toContain("ousia-squircle-corners")
    expect(html).toContain("h-[30px]")
    expect(html).toContain("mr-1")
    expect(html).toContain("border-0")
    expect(html).toContain("bg-clip-border")
    expect(html).toContain("hover:bg-white")
    expect(html).toContain("dark:hover:bg-secondary")
  })

  it("localizes Extensions in Chinese", () => {
    expect(renderSidebar({ language: "zh" })).toContain(">扩展与技能<")
  })

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

  it("shows update failures as a retry action with the concrete error", () => {
    const html = renderSidebar({
      updateStatus: {
        phase: "error",
        currentVersion: "0.1.33",
        message: "Release check failed with HTTP 503",
      },
    })

    expect(html).toContain('data-variant="destructive"')
    expect(html).toContain(
      'title="Update failed. Click to retry. Release check failed with HTTP 503"'
    )
    expect(html).toContain(">Update failed. Click to retry.</button>")
  })

  it("aligns top-level sessions with their section-title axis", () => {
    const html = renderSidebar({
      sessions: [session, { ...session, id: "session-2", title: "Second task" }],
    })

    expect(html).toContain("w-full pl-2 pr-1")
    expect(html.match(/mx-px !w-\[calc\(100%-2px\)\]/g)).toHaveLength(2)
    expect(html).not.toContain("w-full pl-3 pr-1")
  })

  it("aligns section titles, project labels, and project sessions on the compact axis", () => {
    const html = renderSidebar({
      expandedProjectIds: [project.id],
      projects: [project],
      sessions: [{ ...session, projectId: project.id }],
    })

    expect(html).not.toContain("w-full pl-3 pr-1")
    expect(html.match(/w-full pl-2 pr-1/g)).toHaveLength(5)
    expect(html).not.toContain("mr-1 pl-2 pr-1")
    expect(html).toContain(
      "group/section-header grid cursor-pointer items-center gap-1 pt-2 pb-0.5"
    )
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
