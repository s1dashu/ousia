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

  it("uses the global neutral Gray as the default sidebar-only palette", () => {
    const settingsPage = readSource("src/features/settings/SettingsPage.tsx")

    expect(OUSIA_APPEARANCE_COLOR_SCALES).toContain("gray")
    expect(defaultOusiaAppSettings.appearanceColorScale).toBe("gray")
    expect(settingsPage).toContain('label: "Gray"')
    expect(settingsPage).toContain('value: "gray"')
    expect(settingsPage).toContain("near-white sidebar")
    expect(css).toContain(':root[data-radix-color-scale="gray"]')
    expect(css).toContain('.dark[data-radix-color-scale="gray"]')
    expect(css).toContain("--ousia-sidebar: oklch(0.985 0 0)")
    expect(css).toContain("--ousia-sidebar-accent: oklch(0.97 0 0)")
    expect(css).toContain("--ousia-sidebar: oklch(0.205 0 0)")
  })

  it("applies the product palette only to the session sidebar", () => {
    const app = readSource("src/App.tsx")
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
    expect(app).toContain("flex-1 bg-[var(--ousia-sidebar)]")
    expect(app).not.toContain("flex-1 bg-sidebar")
  })

  it("uses the Nucleo icon system throughout the Sidebar", () => {
    const sidebar = readSource("src/features/sidebar/Sidebar.tsx")
    const sidebarItems = readSource("src/features/sidebar/SidebarItems.tsx")
    const nucleoIcons = readSource("src/components/icons/nucleo-icons.ts")

    expect(sidebar).toContain("@/components/icons/nucleo-icons")
    expect(sidebarItems).toContain("@/components/icons/nucleo-icons")
    expect(sidebar).not.toContain("@/components/icons/huge-icons")
    expect(sidebarItems).not.toContain("@/components/icons/huge-icons")
    expect(nucleoIcons).not.toContain("nucleo-ui-essential-outline-18")
    expect(nucleoIcons).toContain("nucleo-ui-outline-18")
    expect(nucleoIcons).not.toContain("nucleo-core-essential-outline-24")
    expect(nucleoIcons).toContain("IconGridOutline18 as ExtensionsGrid")
    expect(sidebar).toContain("icon: ExtensionsGrid")
    expect(sidebar).not.toContain("<Keyboard")
    expect(sidebar).not.toContain("shortcut:")
  })

  it("matches the borderless Composer surface to the Sidebar", () => {
    const chat = readSource("src/features/chat/ChatArea.tsx")

    expect(css).toContain("--ousia-chat-composer-radius: 40px")
    expect(css).toContain(
      "--ousia-composer-surface: var(--ousia-sidebar)"
    )
    expect(css).toContain(".dark .ousia-main-panel")
    expect(chat).toContain("bg-[var(--ousia-composer-surface)]")
    expect(chat).toContain("border-0")
    expect(chat).toContain("shadow-none")
    expect(chat).not.toContain("ousia-chat-composer-ring")
    expect(chat).not.toContain("ousia-composer-send-button")
    expect(chat).toContain("NucleoPlus")
    expect(chat).toContain("NucleoSliders")
    expect(chat).toContain("NucleoChevronDown")
    expect(chat).toContain("SendArrowUp")
    expect(chat).not.toContain("@/components/icons/huge-icons")
  })

  it("slightly lifts only the dark chat panel surface", () => {
    const chat = readSource("src/features/chat/ChatArea.tsx")
    const chatHeader = readSource("src/features/chat/ChatHeader.tsx")
    const chatComposer = readSource("src/features/chat/ChatComposerParts.tsx")

    expect(css).toMatch(
      /\.dark \.ousia-main-panel\s*\{[^}]*--ousia-chat-panel-surface:\s*color-mix\(\s*in srgb,\s*var\(--ousia-app-card\) 98%,\s*white\s*\)/s,
    )
    expect(chat).toContain("bg-white")
    expect(chat).toContain("dark:bg-[var(--ousia-chat-panel-surface)]")
    expect(chat).not.toContain("dark:bg-card")
    expect(chatHeader).toContain(
      "dark:bg-[var(--ousia-chat-panel-surface)]"
    )
    expect(chatComposer).toContain("dark:bg-transparent")
    expect(chatComposer).not.toContain(
      "dark:bg-[var(--ousia-chat-panel-surface)]"
    )
  })

  it("places user messages one color step above the Sidebar while keeping code surfaces fixed", () => {
    const chatMessages = readSource("src/features/chat/ChatMessageList.tsx")

    expect(css).toContain(
      "--ousia-message-user-surface: var(--ousia-sidebar-accent)"
    )
    expect(css).toContain("--ousia-inline-code-surface: oklch(0.975 0 0)")
    expect(css).toContain("--ousia-code-block-surface: oklch(0.985 0 0)")
    expect(css).toContain(
      '.ousia-chat-markdown [data-streamdown="code-block-body"]'
    )
    expect(chatMessages).toContain("ousia-chat-user-message")
    expect(css.match(/--ousia-message-user-surface:/g)).toHaveLength(4)
    expect(css.match(/--ousia-inline-code-surface:/g)).toHaveLength(2)
    expect(css.match(/--ousia-code-block-surface:/g)).toHaveLength(2)
  })
})
