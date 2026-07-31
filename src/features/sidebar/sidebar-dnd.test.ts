import { describe, expect, it } from "vitest"
import type { CollisionDetection, UniqueIdentifier } from "@dnd-kit/core"

import {
  defaultSessionGroupId,
  escapeAttributeSelectorValue,
  getSortableData,
  projectIdFromSessionGroup,
  sidebarCollisionDetection,
  type SidebarSortableData,
} from "@/features/sidebar/sidebar-dnd"

describe("getSortableData", () => {
  it("rejects non-objects and unknown kinds", () => {
    expect(getSortableData(null)).toBeNull()
    expect(getSortableData("session")).toBeNull()
    expect(getSortableData({ kind: "column", label: "x" })).toBeNull()
    expect(getSortableData({ kind: "session" })).toBeNull()
  })

  it("normalizes valid sortable payloads", () => {
    expect(getSortableData({ kind: "session", label: "Chat" })).toEqual({
      kind: "session",
      label: "Chat",
    })
    expect(
      getSortableData({
        kind: "project",
        label: "Repo",
        groupId: "g1",
        projectChild: true,
      })
    ).toEqual({
      kind: "project",
      label: "Repo",
      groupId: "g1",
      projectChild: true,
    })
  })

  it("drops optional fields with wrong types", () => {
    expect(
      getSortableData({ kind: "section", label: "s", groupId: 42 })
    ).toEqual({ kind: "section", label: "s" })
  })
})

describe("escapeAttributeSelectorValue", () => {
  it("escapes quotes and backslashes for attribute selectors", () => {
    expect(escapeAttributeSelectorValue('a"b\\c')).toBe('a\\"b\\\\c')
  })
})

describe("projectIdFromSessionGroup", () => {
  it("maps the default group to undefined", () => {
    expect(projectIdFromSessionGroup(defaultSessionGroupId)).toBeUndefined()
    expect(projectIdFromSessionGroup(undefined)).toBeUndefined()
    expect(projectIdFromSessionGroup("project-1")).toBe("project-1")
  })
})

type CollisionArgs = Parameters<CollisionDetection>[0]

function buildCollisionArgs(options: {
  active: SidebarSortableData
  containers: Array<{
    id: UniqueIdentifier
    data: SidebarSortableData
    top: number
    height?: number
  }>
}): CollisionArgs {
  const rects = options.containers.map((container) => ({
    width: 200,
    height: container.height ?? 32,
    top: container.top,
    bottom: container.top + (container.height ?? 32),
    left: 0,
    right: 200,
  }))
  const droppableRects = new Map(
    options.containers.map((container, index) => [container.id, rects[index]])
  )
  return {
    active: {
      id: "active",
      data: { current: options.active },
      rect: { current: null },
    },
    collisionRect: rects[0],
    droppableRects,
    droppableContainers: options.containers.map((container, index) => ({
      id: container.id,
      data: { current: container.data },
      disabled: false,
      node: { current: null },
      rect: { current: rects[index] },
    })),
    pointerCoordinates: null,
    scrollableAncestors: [],
  } as unknown as CollisionArgs
}

describe("sidebarCollisionDetection", () => {
  it("ignores session rows nested inside a dragged expanded project", () => {
    const collisions = sidebarCollisionDetection(
      buildCollisionArgs({
        active: { kind: "project", label: "Dragged" },
        containers: [
          // The dragged project's own session rows travel with the pointer and
          // would otherwise always win closestCenter.
          { id: "session-a", data: { kind: "session", label: "A" }, top: 0 },
          { id: "session-b", data: { kind: "session", label: "B" }, top: 34 },
          { id: "project-1", data: { kind: "project", label: "P1" }, top: 100 },
          { id: "project-2", data: { kind: "project", label: "P2" }, top: 132 },
        ],
      })
    )
    expect(collisions.length).toBeGreaterThan(0)
    expect(collisions[0]?.id).toBe("project-1")
    expect(
      collisions.every(
        (collision) =>
          collision.id === "project-1" || collision.id === "project-2"
      )
    ).toBe(true)
  })

  it("keeps sessions droppable onto projects and session rows", () => {
    const collisions = sidebarCollisionDetection(
      buildCollisionArgs({
        active: { kind: "session", label: "Dragged" },
        containers: [
          { id: "session-a", data: { kind: "session", label: "A" }, top: 0 },
          { id: "project-1", data: { kind: "project", label: "P1" }, top: 100 },
        ],
      })
    )
    expect(collisions.length).toBe(2)
  })
})
