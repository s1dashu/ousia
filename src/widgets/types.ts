import type { ComponentType } from "react"

export type WidgetSlotId =
  | "app.sidebar"
  | "app.chat"
  | "app.workspace"
  | "workspace.tab"
  | "sidebar.section"
  | "chat.panel"

export type WidgetKind = "system" | "custom"

export type WidgetContext = {
  project: {
    id: string
    name: string
    path: string
  }
  conversation: {
    id: string
    title: string
  }
}

export type WidgetProps = {
  context: WidgetContext
}

export type WidgetDefinition = {
  id: string
  title: string
  slot: WidgetSlotId
  kind: WidgetKind
  component: ComponentType<WidgetProps>
}
