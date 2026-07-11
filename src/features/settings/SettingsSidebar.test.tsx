import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { getMessages } from "@/app/i18n"
import { getSettingsNavigationItems } from "@/features/settings/settings-navigation"
import { SettingsSidebar } from "@/features/settings/SettingsSidebar"

describe("SettingsSidebar", () => {
  it("uses a provider-specific final navigation item", () => {
    const t = getMessages("en")

    expect(
      getSettingsNavigationItems("pi", t.settings).map((item) => item.label)
    ).toEqual([
      t.settings.general,
      t.settings.appearance,
      t.settings.conversationSettings,
      t.settings.piSettings,
    ])
    expect(
      getSettingsNavigationItems("codex", t.settings).map((item) => item.label)
    ).toEqual([
      t.settings.general,
      t.settings.appearance,
      t.settings.conversationSettings,
      t.settings.codexSettings,
    ])
  })

  it("renders the back action and current section semantics", () => {
    const t = getMessages("zh")
    const html = renderToStaticMarkup(
      <SettingsSidebar
        activeSection="appearance"
        agentProvider="pi"
        language="zh"
        onBack={vi.fn()}
        onSectionChange={vi.fn()}
        style={{ width: 256 }}
      />
    )

    expect(html).toContain(t.settings.backToHome)
    expect(html).toContain(t.settings.piSettings)
    expect(html).not.toContain(t.settings.codexSettings)
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('class="grid gap-1"')
    expect(html).toContain("flex h-8 w-full")
    expect(html).toContain("rounded-lg px-3 py-2")
    expect(html).toContain("bg-[var(--ousia-sidebar-accent)]")
    expect(html).not.toContain("ousia-squircle-corners")
  })
})
