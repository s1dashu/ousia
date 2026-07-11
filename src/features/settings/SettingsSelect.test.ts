import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  SETTINGS_NAVIGATION_ACTIVE_CLASS,
  SETTINGS_NAVIGATION_IDLE_CLASS,
  SETTINGS_PANEL_SURFACE_CLASS,
  SETTINGS_SIDEBAR_SURFACE_CLASS,
} from "@/features/settings/settings-local-styles"

function readSettingsSource(fileName: string) {
  return readFileSync(
    path.resolve(process.cwd(), "src/features/settings", fileName),
    "utf8"
  )
}

describe("settings Vega primitive styling", () => {
  it("keeps the bIkeymG Vega geometry and surfaces", () => {
    const button = readSettingsSource("SettingsButton.tsx")
    const card = readSettingsSource("SettingsCard.tsx")
    const dialog = readSettingsSource("SettingsDialog.tsx")
    const input = readSettingsSource("SettingsInput.tsx")
    const select = readSettingsSource("SettingsSelect.tsx")
    const switchSource = readSettingsSource("SettingsSwitch.tsx")

    expect(button).toContain("rounded-md")
    expect(button).toContain("active:not-aria-[haspopup]:translate-y-px")
    expect(input).toContain("h-9 w-full min-w-0 rounded-md")
    expect(input).toContain("bg-transparent")
    expect(card).toContain("rounded-xl bg-card")
    expect(card).toContain("shadow-xs ring-1 ring-foreground/10")
    expect(dialog).toContain("gap-6 rounded-xl bg-popover p-6")
    expect(dialog).toContain("ring-1 ring-foreground/10")
    expect(select).toContain("rounded-md border border-input bg-transparent")
    expect(select).toContain("rounded-md bg-popover")
    expect(select).toContain("shadow-md ring-1 ring-foreground/10")
    expect(select).toContain("gap-2 rounded-sm py-1.5 pr-8 pl-2")
    expect(switchSource).toContain("data-checked:bg-primary")
    expect(switchSource).toContain("data-unchecked:bg-input")
  })

  it("does not retain the previous fixed Nova control treatment", () => {
    const sources = [
      "SettingsButton.tsx",
      "SettingsCard.tsx",
      "SettingsDialog.tsx",
      "SettingsInput.tsx",
      "SettingsSelect.tsx",
      "SettingsSwitch.tsx",
    ].map(readSettingsSource)

    for (const source of sources) {
      expect(source).not.toContain("rounded-[10px]")
      expect(source).not.toContain("rounded-[12px]")
      expect(source).not.toContain("border-[#e5e5e5]")
      expect(source).not.toContain("shadow-none")
    }
  })

  it("uses the Vega sidebar menu states and semantic main surface", () => {
    expect(SETTINGS_SIDEBAR_SURFACE_CLASS).toBe(
      "bg-[var(--ousia-sidebar)] text-sidebar-foreground"
    )
    expect(SETTINGS_NAVIGATION_ACTIVE_CLASS).toBe(
      "bg-[var(--ousia-sidebar-accent)] font-medium text-sidebar-accent-foreground"
    )
    expect(SETTINGS_NAVIGATION_IDLE_CLASS).toContain(
      "hover:bg-[var(--ousia-sidebar-accent)]"
    )
    expect(SETTINGS_PANEL_SURFACE_CLASS).toContain("bg-background")
    expect(SETTINGS_PANEL_SURFACE_CLASS).toContain("text-foreground")
    expect(SETTINGS_PANEL_SURFACE_CLASS).not.toContain("bg-white")
  })
})
