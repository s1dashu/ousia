import {
  closestCenter,
  type CollisionDetection,
} from "@dnd-kit/core"

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

export function escapeAttributeSelectorValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export function projectIdFromSessionGroup(groupId: string | undefined) {
  return groupId && groupId !== defaultSessionGroupId ? groupId : undefined
}

/**
 * Reorders only apply within the same kind (project -> project,
 * section -> section). Sessions may additionally drop onto projects and the
 * sessions section. Without this filter, an expanded project's own session
 * rows move along with the dragged project and always win `closestCenter`,
 * making expanded projects impossible to reorder.
 */
export const sidebarCollisionDetection: CollisionDetection = (args) => {
  const activeKind = getSortableData(args.active?.data.current)?.kind
  if (activeKind !== "project" && activeKind !== "section") {
    return closestCenter(args)
  }
  const droppableContainers = args.droppableContainers.filter(
    (container) => getSortableData(container.data.current)?.kind === activeKind
  )
  return closestCenter({ ...args, droppableContainers })
}
