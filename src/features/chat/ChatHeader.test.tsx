import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { getMessages } from "@/app/i18n"
import { ChatHeader } from "@/features/chat/ChatHeader"
import type { SessionRecord } from "@/app/app-state"

function renderHeader(
  agentProvider: SessionRecord["agentProvider"],
  branchSelector?: ReactNode
) {
  return renderToStaticMarkup(
    <ChatHeader
      branchSelector={branchSelector}
      copyStatus="idle"
      currentSession={{
        agentProvider,
        id: `session-${agentProvider}`,
        time: "2026-07-11T00:00:00.000Z",
        title: "Session title",
      }}
      isCompacting={false}
      isSessionMenuOpen={Boolean(branchSelector)}
      isSidebarCollapsed={false}
      isScrolled={false}
      isWindowFullscreen={false}
      onCopySessionHistory={vi.fn()}
      onExportSession={vi.fn()}
      onManualCompact={vi.fn()}
      onSessionMenuOpenChange={vi.fn()}
      t={getMessages("en")}
    />
  )
}

describe("ChatHeader provider badge", () => {
  it("does not show a badge for the default Pi harness", () => {
    expect(renderHeader("pi")).not.toContain('data-slot="agent-provider-badge"')
  })

  it("shows the Codex badge for Codex sessions", () => {
    const html = renderHeader("codex")

    expect(html).toContain('data-slot="agent-provider-badge"')
    expect(html).toContain(">Codex</span>")
  })

  it("renders the session actions at the end of the header", () => {
    const html = renderHeader(
      "pi",
      <button type="button">Branch selector</button>
    )
    const sessionActionsIndex = html.indexOf(
      getMessages("en").chat.moreSessionActions
    )

    expect(html.indexOf("Session title")).toBeLessThan(sessionActionsIndex)
    expect(html.indexOf("Branch selector")).toBeLessThan(sessionActionsIndex)
  })
})
