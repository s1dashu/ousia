import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(
  path.resolve(process.cwd(), "src/index.css"),
  "utf8"
)

function readSource(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8")
}

describe("design token boundaries", () => {
  it("keeps the root shadcn tokens aligned with bbVKEbY Maia", () => {
    expect(css).toContain("--background: oklch(1 0 0)")
    expect(css).toContain("--card: oklch(1 0 0)")
    expect(css).toContain("--popover: oklch(1 0 0)")
    expect(css).toContain("--muted: oklch(0.97 0 0)")
    expect(css).toContain("--border: oklch(0.922 0 0)")
    expect(css).toContain("--sidebar: oklch(0.985 0 0)")
    expect(css).toContain("--background: oklch(0.145 0 0)")
    expect(css).toContain("--card: oklch(0.205 0 0)")
  })

  it("keeps appearance palettes behind Ousia-prefixed tokens", () => {
    const appearanceBlocks = Array.from(
      css.matchAll(/[^{}]*data-radix-color-scale[^{}]*\{([^{}]*)\}/g),
      (match) => match[1]
    )

    expect(appearanceBlocks.length).toBeGreaterThan(0)
    for (const block of appearanceBlocks) {
      expect(block).not.toMatch(
        /--(?:background|foreground|card|popover|primary|secondary|muted|accent|border|input|ring|sidebar)(?:-[a-z]+)*\s*:/
      )
    }
    expect(css).toContain("--ousia-app-background")
    expect(css).toContain("--ousia-app-sidebar-accent")
  })

  it("applies the product palette only at the tuned chat and sidebar roots", () => {
    const sidebar = readSource("src/features/sidebar/Sidebar.tsx")
    const chat = readSource("src/features/chat/ChatArea.tsx")
    const settingsSidebar = readSource(
      "src/features/settings/SettingsSidebar.tsx"
    )
    const settingsPage = readSource("src/features/settings/SettingsPage.tsx")

    expect(css).toContain(".ousia-chat-theme")
    expect(css).toContain(".ousia-sidebar-theme")
    expect(sidebar).toContain("ousia-sidebar-theme")
    expect(chat).toContain("ousia-chat-theme")
    expect(settingsSidebar).not.toContain("ousia-sidebar-theme")
    expect(settingsPage).not.toContain("ousia-chat-theme")
    expect(settingsSidebar).toContain("SETTINGS_SIDEBAR_SURFACE_CLASS")
    expect(css).toContain("--ousia-sidebar:")
  })
})
