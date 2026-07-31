import { describe, expect, it } from "vitest"

import type { OusiaSessionRecord } from "./chat-types.js"
import {
  includeExpandedProjectId,
  isOusiaSidebarSectionId,
  moveSessionToGroupFront,
  moveSessionToProjectGroup,
  normalizeOusiaSidebarSectionOrder,
  projectPathForAppStateSession,
  reorderById,
  reorderSessionsById,
  withSessionProjectId,
} from "./app-state-collections.js"

function session(
  id: string,
  projectId?: string,
  time = "2026-01-01T00:00:00.000Z"
): OusiaSessionRecord {
  return {
    agentProvider: "pi",
    id,
    title: id,
    time,
    ...(projectId ? { projectId } : {}),
  }
}

describe("app-state collection transforms", () => {
  it("reorders by id without mutating the source", () => {
    const source = [{ id: "a" }, { id: "b" }, { id: "c" }]
    expect(reorderById(source, "a", "c").map((item) => item.id)).toEqual([
      "b",
      "c",
      "a",
    ])
    expect(source.map((item) => item.id)).toEqual(["a", "b", "c"])
  })

  it("preserves the reference when a reorder cannot be applied", () => {
    const source = [{ id: "a" }, { id: "b" }]
    expect(reorderById(source, "missing", "b")).toBe(source)
    expect(reorderById(source, "a", "a")).toBe(source)
  })

  it("reorders sessions only inside the same project group", () => {
    const source = [session("a", "p1"), session("b", "p1"), session("c", "p2")]
    expect(
      reorderSessionsById(source, "a", "b").map((item) => item.id)
    ).toEqual(["b", "a", "c"])
    expect(reorderSessionsById(source, "a", "c")).toBe(source)
  })

  it("moves a session into a project before the requested target", () => {
    const source = [
      session("default"),
      session("p1-a", "p1"),
      session("p1-b", "p1"),
    ]
    const result = moveSessionToProjectGroup(source, "default", "p1", "p1-b")
    expect(
      result.filter((item) => item.projectId === "p1").map((item) => item.id)
    ).toEqual(["p1-a", "default", "p1-b"])
    expect(result.find((item) => item.id === "default")?.projectId).toBe("p1")
  })

  it("moves a project session back to the default group", () => {
    const result = moveSessionToProjectGroup(
      [session("default"), session("project", "p1")],
      "project",
      undefined
    )
    expect(
      result.filter((item) => !item.projectId).map((item) => item.id)
    ).toEqual(["project", "default"])
    expect(result.find((item) => item.id === "project")).not.toHaveProperty(
      "projectId"
    )
  })

  it("does not move an unknown session", () => {
    const source = [session("a")]
    expect(moveSessionToProjectGroup(source, "missing", "p1")).toBe(source)
  })

  it("touches a session at the front of its own group", () => {
    const result = moveSessionToGroupFront(
      [session("a", "p1"), session("default"), session("b", "p1")],
      "b",
      "2026-02-02T00:00:00.000Z"
    )
    expect(
      result.filter((item) => item.projectId === "p1").map((item) => item.id)
    ).toEqual(["b", "a"])
    expect(result.find((item) => item.id === "b")?.time).toBe(
      "2026-02-02T00:00:00.000Z"
    )
  })

  it("adds and removes the optional project id structurally", () => {
    expect(withSessionProjectId(session("a"), "p1")).toHaveProperty(
      "projectId",
      "p1"
    )
    expect(
      withSessionProjectId(session("a", "p1"), undefined)
    ).not.toHaveProperty("projectId")
  })

  it("adds an expanded project once", () => {
    const ids = ["p1"]
    expect(includeExpandedProjectId(ids, "p1")).toBe(ids)
    expect(includeExpandedProjectId(ids, undefined)).toBe(ids)
    expect(includeExpandedProjectId(ids, "p2")).toEqual(["p1", "p2"])
  })

  it("resolves project and default session paths", () => {
    const state = {
      projects: [{ id: "p1", name: "One", path: "/projects/one" }],
      settings: { defaultSessionDir: "/sessions" },
    }
    expect(projectPathForAppStateSession(state, session("a"))).toBe("/sessions")
    expect(projectPathForAppStateSession(state, session("b", "p1"))).toBe(
      "/projects/one"
    )
    expect(projectPathForAppStateSession(state, session("c", "missing"))).toBe(
      "/sessions"
    )
  })

  it("normalizes sidebar section ids with stable ordering", () => {
    expect(isOusiaSidebarSectionId("sessions")).toBe(true)
    expect(isOusiaSidebarSectionId("archived")).toBe(false)
    expect(
      normalizeOusiaSidebarSectionOrder(["projects", "projects"] as never)
    ).toEqual(["projects", "sessions"])
    expect(normalizeOusiaSidebarSectionOrder([])).toEqual([
      "sessions",
      "projects",
    ])
  })
})
