import { BrowserExtension } from "@/extensions/system/BrowserExtension"
import { EditorExtension } from "@/extensions/system/EditorExtension"
import { TerminalExtension } from "@/extensions/system/TerminalExtension"
import type { ExtensionDefinition, ExtensionSlotId } from "@/extensions/types"

export const extensionRegistry: ExtensionDefinition[] = [
  {
    id: "workspace.browser",
    title: "Browser",
    slot: "workspace.tab",
    kind: "bundled",
    distribution: "first-party-bundled",
    trust: "first-party",
    capabilities: ["browser.webview"],
    component: BrowserExtension,
  },
  {
    id: "workspace.editor",
    title: "Editor",
    slot: "workspace.tab",
    kind: "bundled",
    distribution: "first-party-bundled",
    trust: "first-party",
    capabilities: ["project.files"],
    component: EditorExtension,
  },
  {
    id: "workspace.terminal",
    title: "Terminal",
    slot: "workspace.tab",
    kind: "bundled",
    distribution: "first-party-bundled",
    trust: "first-party",
    capabilities: ["project.pty"],
    component: TerminalExtension,
  },
]

export function extensionsBySlot(slot: ExtensionSlotId) {
  return extensionRegistry.filter((extension) => extension.slot === slot)
}
