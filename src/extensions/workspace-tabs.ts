import { extensionsBySlot } from "@/extensions/registry"

export type WorkspaceTab = {
  id: string
  extensionId: string | null
}

export type WorkspaceTabsState = {
  activeTabId: string
  tabs: WorkspaceTab[]
}

const DEFAULT_WORKSPACE_EXTENSION_ID = "workspace.browser"
const REMOVED_DEFAULT_WORKSPACE_EXTENSION_IDS = new Set(["custom.extension-overview"])

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const defaultWorkspaceTabExtensionIds = extensionsBySlot("workspace.tab")
  .map((extension) => extension.id)
  .filter((extensionId) => !REMOVED_DEFAULT_WORKSPACE_EXTENSION_IDS.has(extensionId))

export function normalizeWorkspaceExtensionId(extensionId: string | null) {
  if (!extensionId) {
    return null
  }
  if (extensionId.startsWith("runtime.project.")) {
    return extensionId.replace("runtime.project.", "runtime.extension.")
  }
  if (extensionId.startsWith("runtime.global.")) {
    return extensionId.replace("runtime.global.", "runtime.extension.")
  }
  if (extensionId.startsWith("runtime.extension.")) {
    const parts = extensionId.split(".")
    if (parts.length > 3) {
      return parts.slice(0, 3).join(".")
    }
  }
  return extensionId
}

export function createWorkspaceTab(
  extensionId: string | null,
  id = createId("workspace-tab")
): WorkspaceTab {
  return {
    id,
    extensionId,
  }
}

export function createDefaultWorkspaceTabs(
  selectedWorkspaceExtensionId = DEFAULT_WORKSPACE_EXTENSION_ID
): WorkspaceTabsState {
  const tabs = defaultWorkspaceTabExtensionIds.map((extensionId) =>
    createWorkspaceTab(extensionId, extensionId)
  )
  const defaultExtensionIds = new Set(defaultWorkspaceTabExtensionIds)
  const normalizedSelectedWorkspaceExtensionId =
    normalizeWorkspaceExtensionId(selectedWorkspaceExtensionId) ??
    DEFAULT_WORKSPACE_EXTENSION_ID

  return {
    tabs,
    activeTabId: defaultExtensionIds.has(normalizedSelectedWorkspaceExtensionId)
      ? normalizedSelectedWorkspaceExtensionId
      : DEFAULT_WORKSPACE_EXTENSION_ID,
  }
}

export function normalizeWorkspaceTabsState(
  state: WorkspaceTabsState | undefined,
  selectedWorkspaceExtensionId: string
): WorkspaceTabsState {
  if (!state?.tabs?.length) {
    return createDefaultWorkspaceTabs(selectedWorkspaceExtensionId)
  }

  const tabs = state.tabs
    .filter(
      (tab) =>
        !tab.extensionId ||
        !REMOVED_DEFAULT_WORKSPACE_EXTENSION_IDS.has(tab.extensionId)
    )
    .map((tab) =>
      createWorkspaceTab(normalizeWorkspaceExtensionId(tab.extensionId), tab.id)
    )

  if (!tabs.length) {
    return createDefaultWorkspaceTabs(selectedWorkspaceExtensionId)
  }

  const activeTabId = tabs.some((tab) => tab.id === state.activeTabId)
    ? state.activeTabId
    : tabs[0]?.id ?? ""

  return { tabs, activeTabId }
}

export const defaultWorkspaceExtensionId = DEFAULT_WORKSPACE_EXTENSION_ID
