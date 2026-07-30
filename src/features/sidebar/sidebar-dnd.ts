import type { OusiaSidebarSectionId } from "@/electron/chat-types"

export const defaultSessionGroupId = "default"

export type SidebarSortableData = {
  kind: "project" | "section" | "session"
  label: string
  groupId?: string
  projectChild?: boolean
}

export function getSortableData(value: unknown): SidebarSortableData | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const data = value as Partial<SidebarSortableData>
  if (
    data.kind !== "project" &&
    data.kind !== "section" &&
    data.kind !== "session"
  ) {
    return null
  }
  if (typeof data.label !== "string") {
    return null
  }
  return {
    kind: data.kind,
    label: data.label,
    ...(typeof data.groupId === "string" ? { groupId: data.groupId } : {}),
    ...(typeof data.projectChild === "boolean"
      ? { projectChild: data.projectChild }
      : {}),
  }
}

export function isSidebarSectionId(
  value: string
): value is OusiaSidebarSectionId {
  return value === "sessions" || value === "projects"
}

export function normalizeSidebarSectionOrder(
  sectionOrder: OusiaSidebarSectionId[]
): OusiaSidebarSectionId[] {
  return [
    ...new Set(
      [...sectionOrder, "sessions", "projects"].filter(isSidebarSectionId)
    ),
  ]
}

export function escapeAttributeSelectorValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export function projectIdFromSessionGroup(groupId: string | undefined) {
  return groupId && groupId !== defaultSessionGroupId ? groupId : undefined
}
