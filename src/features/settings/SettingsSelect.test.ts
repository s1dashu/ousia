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

describe("settings Maia primitive styling", () => {
  it("keeps the bbVKEbY Maia geometry and surfaces", () => {
    const button = readSettingsSource("SettingsButton.tsx")
    const card = readSettingsSource("SettingsCard.tsx")
    const dialog = readSettingsSource("SettingsDialog.tsx")
    const input = readSettingsSource("SettingsInput.tsx")
    const select = readSettingsSource("SettingsSelect.tsx")
    const switchSource = readSettingsSource("SettingsSwitch.tsx")

    expect(button).toContain("rounded-4xl")
    expect(button).toContain("active:not-aria-[haspopup]:translate-y-px")
    expect(input).toContain("h-9 w-full min-w-0 rounded-4xl")
    expect(input).toContain("bg-input/30")
    expect(card).toContain("rounded-2xl bg-card")
    expect(card).toContain("ring-1 ring-foreground/10")
    expect(dialog).toContain("gap-6 rounded-4xl bg-popover p-6")
    expect(dialog).toContain("ring-1 ring-foreground/5")
    expect(select).toContain("rounded-4xl border border-input bg-input/30")
    expect(select).toContain("rounded-2xl bg-popover")
    expect(select).toContain("shadow-2xl ring-1 ring-foreground/5")
    expect(select).toContain("gap-2.5 rounded-xl py-2 pr-8 pl-3")
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

  it("uses the Maia sidebar menu states and semantic main surface", () => {
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
