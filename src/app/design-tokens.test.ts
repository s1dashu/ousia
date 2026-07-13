import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  defaultOusiaAppSettings,
  OUSIA_APPEARANCE_COLOR_SCALES,
} from "@/electron/chat-types"

const css = readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8")

function readSource(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8")
}

describe("design token boundaries", () => {
  it("keeps the root shadcn tokens aligned with bIkeymG Vega", () => {
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
      expect(block).not.toMatch(/--ousia-(?:message|inline-code|code-block)-/)
    }
    expect(css).toContain("--ousia-app-background")
    expect(css).toContain("--ousia-app-sidebar-accent")
  })

  it("includes Mist as the default sidebar-only palette", () => {
    const settingsPage = readSource("src/features/settings/SettingsPage.tsx")

    expect(OUSIA_APPEARANCE_COLOR_SCALES).toContain("mist")
    expect(defaultOusiaAppSettings.appearanceColorScale).toBe("mist")
    expect(settingsPage).toContain('label: "Mist"')
    expect(settingsPage).toContain('value: "mist"')
    expect(settingsPage).toContain("near-white sidebar")
    expect(css).toContain(':root[data-radix-color-scale="mist"]')
    expect(css).toContain('.dark[data-radix-color-scale="mist"]')
    expect(css).toContain("--ousia-app-background: #fdfefe")
    expect(css).toContain("--ousia-app-sidebar: #f7f9fa")
    expect(css).toContain("--ousia-app-sidebar-accent: #edf1f4")
    expect(css).toContain("--ousia-app-sidebar: #15191c")
  })

  it("applies the product palette only to the session sidebar", () => {
    const sidebar = readSource("src/features/sidebar/Sidebar.tsx")
    const chat = readSource("src/features/chat/ChatArea.tsx")
    const settingsSidebar = readSource(
      "src/features/settings/SettingsSidebar.tsx"
    )
    const settingsPage = readSource("src/features/settings/SettingsPage.tsx")

    expect(css).not.toContain(".ousia-chat-theme")
    expect(css).toContain(".ousia-sidebar-theme")
    expect(sidebar).toContain("ousia-sidebar-theme")
    expect(chat).not.toContain("ousia-chat-theme")
    expect(chat).toContain("ousia-main-panel")
    expect(settingsSidebar).not.toContain("ousia-sidebar-theme")
    expect(settingsPage).not.toContain("ousia-chat-theme")
    expect(settingsSidebar).toContain("SETTINGS_SIDEBAR_SURFACE_CLASS")
    expect(css).toContain("--ousia-sidebar:")
  })

  it("gives the Composer an explicit surface instead of inheriting Sidebar color", () => {
    const chat = readSource("src/features/chat/ChatArea.tsx")

    expect(css).toContain("--ousia-composer-surface: #fff")
    expect(css).toContain(".dark .ousia-main-panel")
    expect(css).toContain("--ousia-composer-surface: oklch(0.205 0 0)")
    expect(chat).toContain("bg-[var(--ousia-composer-surface)]")
    expect(chat).not.toContain(
      "ousia-chat-composer-ring ousia-squircle-corners relative z-10 rounded-[var(--ousia-chat-composer-radius)] border-[0.5px] border-[color:var(--ousia-chat-composer-border)] bg-[var(--ousia-sidebar)]"
    )
  })

  it("keeps chat message and Markdown code surfaces on fixed gray steps", () => {
    const chatMessages = readSource("src/features/chat/ChatMessageList.tsx")

    expect(css).toContain("--ousia-message-user-surface: oklch(0.955 0 0)")
    expect(css).toContain("--ousia-inline-code-surface: oklch(0.975 0 0)")
    expect(css).toContain("--ousia-code-block-surface: oklch(0.985 0 0)")
    expect(css).toContain(
      '.ousia-chat-markdown [data-streamdown="code-block-body"]'
    )
    expect(chatMessages).toContain("ousia-chat-user-message")
    expect(css.match(/--ousia-message-user-surface:/g)).toHaveLength(2)
    expect(css.match(/--ousia-inline-code-surface:/g)).toHaveLength(2)
    expect(css.match(/--ousia-code-block-surface:/g)).toHaveLength(2)
  })
})
