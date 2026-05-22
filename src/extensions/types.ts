import type { ComponentType } from "react"

export type ExtensionSlotId =
  | "app.sidebar"
  | "app.chat"
  | "app.workspace"
  | "workspace.tab"
  | "sidebar.section"
  | "chat.panel"

export type ExtensionKind = "bundled" | "runtime"

export type ExtensionDistribution =
  | "first-party-bundled"
  | "first-party-optional"
  | "community"
  | "user-local"

export type ExtensionTrust = "first-party" | "community" | "local-user"

export type ExtensionCapability = "browser.webview" | "project.files" | "project.pty"

export type ExtensionContext = {
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

export type ExtensionProps = {
  context: ExtensionContext
}

export type ExtensionDefinition = {
  id: string
  title: string
  slot: ExtensionSlotId
  kind: ExtensionKind
  distribution: ExtensionDistribution
  trust: ExtensionTrust
  capabilities?: ExtensionCapability[]
  component: ComponentType<ExtensionProps>
}
