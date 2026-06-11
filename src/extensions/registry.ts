import { BrowserExtension } from "@/extensions/system/BrowserExtension"
import { EditorExtension } from "@/extensions/system/EditorExtension"
import { ExcalidrawExtension } from "@/extensions/system/ExcalidrawExtension"
import { PdfEditorExtension } from "@/extensions/system/PdfEditorExtension"
import { TerminalExtension } from "@/extensions/system/TerminalExtension"
import { UniverSheetsExtension } from "@/extensions/system/UniverSheetsExtension"
import type { ExtensionDefinition, ExtensionSlotId } from "@/extensions/types"

export const extensionRegistry: ExtensionDefinition[] = [
  {
    id: "extension.firstParty.browser",
    title: "浏览器",
    slot: "workspace.tab",
    kind: "bundled",
    distribution: "first-party-preinstalled",
    trust: "first-party",
    component: BrowserExtension,
  },
  {
    id: "extension.firstParty.editor",
    title: "编辑器",
    slot: "workspace.tab",
    kind: "bundled",
    distribution: "first-party-preinstalled",
    trust: "first-party",
    component: EditorExtension,
  },
  {
    id: "extension.firstParty.terminal",
    title: "终端",
    slot: "workspace.tab",
    kind: "bundled",
    distribution: "first-party-preinstalled",
    trust: "first-party",
    component: TerminalExtension,
  },
  {
    id: "extension.firstParty.pdfEditor",
    title: "PDF",
    slot: "workspace.tab",
    kind: "bundled",
    distribution: "first-party-optional",
    trust: "first-party",
    component: PdfEditorExtension,
  },
  {
    id: "extension.firstParty.excalidraw",
    title: "Excalidraw",
    slot: "workspace.tab",
    kind: "bundled",
    distribution: "first-party-optional",
    trust: "first-party",
    component: ExcalidrawExtension,
  },
  {
    id: "extension.firstParty.univerSheets",
    title: "表格",
    slot: "workspace.tab",
    kind: "bundled",
    distribution: "first-party-optional",
    trust: "first-party",
    component: UniverSheetsExtension,
  },
]

export function extensionsBySlot(slot: ExtensionSlotId) {
  return extensionRegistry.filter((extension) => extension.slot === slot)
}
