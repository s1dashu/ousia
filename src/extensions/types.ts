import type {
  OusiaModelSettings,
  OusiaExtensionStateScope,
  OusiaThinkingLevel,
  OusiaWorkspaceAction,
} from "@/electron/chat-types"
import type { ResolvedTheme, Theme } from "@/components/theme-provider"
import type { WorkspaceTabResource } from "@/extensions/workspace-tabs"
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
  | "first-party-preinstalled"
  | "first-party-optional"
  | "community"
  | "user-local"

export type ExtensionTrust = "first-party" | "community" | "local-user"

export type ExtensionContext = {
  extensionId: string
  tabId?: string
  project: {
    id: string
    name: string
    path: string
  }
  conversation: {
    id: string
    title: string
  }
  agent: {
    thinkingLevel: OusiaThinkingLevel
    model: OusiaModelSettings
  }
  theme: {
    preference: Theme
    resolved: ResolvedTheme
  }
  action?: OusiaWorkspaceAction
  resource?: WorkspaceTabResource
  state: {
    get<T = unknown>(scope: OusiaExtensionStateScope, key: string): Promise<T | null>
    set(
      scope: OusiaExtensionStateScope,
      key: string,
      value: unknown
    ): Promise<void>
    delete(scope: OusiaExtensionStateScope, key: string): Promise<void>
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
  component: ComponentType<ExtensionProps>
}
