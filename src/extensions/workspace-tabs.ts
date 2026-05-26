import { extensionsBySlot } from "@/extensions/registry"

export type WorkspaceTab = {
  id: string
  extensionId: string | null
  resource?: WorkspaceTabResource
}

export type WorkspaceTabResource = {
  kind: "file"
  path: string
  name?: string
  projectPath?: string
}

export type WorkspaceTabsState = {
  activeTabId: string
  tabs: WorkspaceTab[]
}

const DEFAULT_WORKSPACE_EXTENSION_ID = "extension.firstParty.browser"

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const defaultWorkspaceTabExtensionIds = extensionsBySlot("workspace.tab")
  .filter(
    (extension) => extension.distribution === "first-party-preinstalled"
  )
  .map((extension) => extension.id)

export function normalizeWorkspaceExtensionId(extensionId: string | null) {
  return extensionId
}

export function createWorkspaceTab(
  extensionId: string | null,
  id = createId("workspace-tab"),
  resource?: WorkspaceTabResource
): WorkspaceTab {
  return {
    id,
    extensionId,
    ...(resource ? { resource } : {}),
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

  const tabs = state.tabs.map((tab) =>
    createWorkspaceTab(
      normalizeWorkspaceExtensionId(tab.extensionId),
      tab.id,
      normalizeWorkspaceTabResource(tab.resource)
    )
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

function normalizeWorkspaceTabResource(
  resource: WorkspaceTabResource | undefined
) {
  if (
    resource?.kind !== "file" ||
    typeof resource.path !== "string" ||
    !resource.path.trim()
  ) {
    return undefined
  }
  return {
    kind: "file" as const,
    path: resource.path,
    ...(typeof resource.name === "string" ? { name: resource.name } : {}),
    ...(typeof resource.projectPath === "string"
      ? { projectPath: resource.projectPath }
      : {}),
  }
}
