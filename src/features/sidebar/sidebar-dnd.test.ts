import { describe, expect, it } from "vitest"

import {
  defaultSessionGroupId,
  escapeAttributeSelectorValue,
  getSortableData,
  isSidebarSectionId,
  normalizeSidebarSectionOrder,
  projectIdFromSessionGroup,
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

describe("isSidebarSectionId / normalizeSidebarSectionOrder", () => {
  it("recognizes known section ids", () => {
    expect(isSidebarSectionId("sessions")).toBe(true)
    expect(isSidebarSectionId("projects")).toBe(true)
    expect(isSidebarSectionId("archived")).toBe(false)
  })

  it("dedupes, filters unknown ids, and always includes both sections", () => {
    expect(
      normalizeSidebarSectionOrder(["projects", "projects"] as never)
    ).toEqual(["projects", "sessions"])
    expect(normalizeSidebarSectionOrder([])).toEqual(["sessions", "projects"])
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
