import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { defaultSettings } from "@/app/app-state"
import { getMessages } from "@/app/i18n"
import { SettingsPage } from "@/features/settings/SettingsPage"
import { MAIN_PANEL_LEFT_CORNERS_CLASS } from "@/features/shell/main-panel-styles"

vi.mock("@/components/theme-provider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/theme-provider")>()
  return {
    ...actual,
    useTheme: () => ({ setTheme: vi.fn() }),
  }
})

function renderProviderSettings(agentProvider: "pi" | "codex") {
  return renderToStaticMarkup(
    <SettingsPage
      activeSection="provider"
      codexEnvironment={undefined}
      modelRegistry={undefined}
      onRefreshCodexEnvironment={async () => undefined}
      onRefreshModelRegistry={async () => undefined}
      onSettingsChange={vi.fn()}
      settings={{
        ...defaultSettings,
        defaultAgentProvider: agentProvider,
        language: "en",
      }}
    />
  )
}

function renderGeneralSettings() {
  return renderToStaticMarkup(
    <SettingsPage
      activeSection="general"
      codexEnvironment={undefined}
      modelRegistry={undefined}
      onRefreshCodexEnvironment={async () => undefined}
      onRefreshModelRegistry={async () => undefined}
      onSettingsChange={vi.fn()}
      settings={{ ...defaultSettings, language: "zh" }}
    />
  )
}

function renderConversationSettings() {
  return renderToStaticMarkup(
    <SettingsPage
      activeSection="conversation"
      codexEnvironment={undefined}
      modelRegistry={undefined}
      onRefreshCodexEnvironment={async () => undefined}
      onRefreshModelRegistry={async () => undefined}
      onSettingsChange={vi.fn()}
      settings={{ ...defaultSettings, language: "zh" }}
    />
  )
}

describe("SettingsPage provider isolation", () => {
  it("renders the three general-setting groups in the requested order", () => {
    const t = getMessages("zh")
    const html = renderGeneralSettings()

    const agentGroupIndex = html.indexOf(`>${t.settings.agentHarness}<`)
    const languageGroupIndex = html.indexOf(`>${t.settings.languageAndRegion}<`)
    const pathsGroupIndex = html.indexOf(`>${t.settings.defaultCreationPaths}<`)

    expect(agentGroupIndex).toBeGreaterThan(-1)
    expect(languageGroupIndex).toBeGreaterThan(agentGroupIndex)
    expect(pathsGroupIndex).toBeGreaterThan(languageGroupIndex)
    expect(html).toContain(t.settings.defaultAgent)
    expect(html).toContain(t.settings.defaultSessionDir)
    expect(html).toContain(t.settings.defaultProjectCreationDir)
  })

  it("uses the shared left corners and the wider responsive row threshold", () => {
    const html = renderGeneralSettings()

    expect(MAIN_PANEL_LEFT_CORNERS_CLASS).toContain(
      "rounded-tl-[var(--ousia-chat-panel-radius)]"
    )
    expect(MAIN_PANEL_LEFT_CORNERS_CLASS).toContain(
      "rounded-bl-[var(--ousia-chat-panel-radius)]"
    )
    expect(MAIN_PANEL_LEFT_CORNERS_CLASS).not.toContain("rounded-tr-")
    expect(html).toContain("max-w-[52rem]")
    expect(html).toContain("@min-[720px]:grid-cols-")
    expect(html).not.toContain("@min-[620px]")
    expect(html).not.toContain("@min-[880px]")
  })

  it("renders the original Maia component treatment", () => {
    const html = renderGeneralSettings()

    expect(html).toContain("rounded-2xl bg-card")
    expect(html).toContain("ring-1 ring-foreground/10")
    expect(html).toContain("rounded-4xl border border-input bg-input/30")
    expect(html).toContain("bg-background text-foreground")
    expect(html).not.toContain("rounded-[10px]")
    expect(html).not.toContain("border-[#e5e5e5]")
  })

  it("keeps path inputs and browse buttons on the same Maia control height", () => {
    const html = renderGeneralSettings()

    expect(html).toContain('data-slot="settings-input"')
    expect(html).toContain('data-slot="settings-button"')
    expect(html).toContain("h-9 w-full min-w-0 rounded-4xl")
    expect(html).toContain("h-9 gap-1.5 px-3")
    expect(html).not.toContain("h-8 gap-1 px-3")
  })

  it("renders Pi-only settings for the Pi harness", () => {
    const t = getMessages("en")
    const html = renderProviderSettings("pi")

    expect(html).toContain(t.settings.piSettings)
    expect(html).toContain(t.settings.agentMode)
    expect(html).toContain(t.settings.providerKeys)
    expect(html).toContain(t.settings.autoRetryOnFailure)
    expect(html).not.toContain(t.settings.codexAuthentication)
  })

  it("renders Codex-only settings for the Codex harness", () => {
    const t = getMessages("en")
    const html = renderProviderSettings("codex")

    expect(html).toContain(t.settings.codexSettings)
    expect(html).toContain(t.settings.codexAuthentication)
    expect(html).not.toContain(t.settings.agentMode)
    expect(html).not.toContain(t.settings.providerKeys)
    expect(html).not.toContain(t.settings.autoRetryOnFailure)
  })

  it("renders shared chat behavior in its own settings section", () => {
    const t = getMessages("zh")
    const html = renderConversationSettings()

    expect(html).toContain(t.settings.conversationSettings)
    expect(html).toContain(t.settings.appendMessages)
    expect(html).toContain(t.settings.showContextUsage)
    expect(html).toContain(t.settings.continueQueuedAfterInterrupt)
    expect(html).not.toContain(t.settings.agentMode)
    expect(html).not.toContain(t.settings.providerKeys)
  })
})
