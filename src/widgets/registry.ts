import { BrowserWidget } from "@/widgets/system/BrowserWidget"
import { EditorWidget } from "@/widgets/system/EditorWidget"
import { TerminalWidget } from "@/widgets/system/TerminalWidget"
import { WidgetOverview } from "@/widgets/custom/WidgetOverview"
import type { WidgetDefinition, WidgetSlotId } from "@/widgets/types"

export const widgetRegistry: WidgetDefinition[] = [
  {
    id: "workspace.browser",
    title: "Browser",
    slot: "workspace.tab",
    kind: "system",
    component: BrowserWidget,
  },
  {
    id: "workspace.editor",
    title: "Editor",
    slot: "workspace.tab",
    kind: "system",
    component: EditorWidget,
  },
  {
    id: "workspace.terminal",
    title: "Terminal",
    slot: "workspace.tab",
    kind: "system",
    component: TerminalWidget,
  },
  {
    id: "custom.widget-overview",
    title: "Widgets",
    slot: "workspace.tab",
    kind: "custom",
    component: WidgetOverview,
  },
]

export function widgetsBySlot(slot: WidgetSlotId) {
  return widgetRegistry.filter((widget) => widget.slot === slot)
}
