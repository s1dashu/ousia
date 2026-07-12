import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { getMessages } from "@/app/i18n"
import { ChatHeader } from "@/features/chat/ChatHeader"
import type { SessionRecord } from "@/app/app-state"

function renderHeader(agentProvider: SessionRecord["agentProvider"]) {
  return renderToStaticMarkup(
    <ChatHeader
      copyStatus="idle"
      currentSession={{
        agentProvider,
        id: `session-${agentProvider}`,
        time: "2026-07-11T00:00:00.000Z",
        title: "Session title",
      }}
      isCompacting={false}
      isSessionMenuOpen={false}
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
})
