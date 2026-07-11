import { describe, expect, it } from "vitest"

import { nextBranchSessionTitle } from "./branch-session-title"

describe("branch session title", () => {
  it("adds a numbered suffix to the source title", () => {
    expect(
      nextBranchSessionTitle(
        { title: "设计登录页", projectId: "project-1" },
        [{ title: "设计登录页", projectId: "project-1" }]
      )
    ).toBe("设计登录页（1）")
  })

  it("increments past the highest existing branch number", () => {
    expect(
      nextBranchSessionTitle(
        { title: "设计登录页", projectId: "project-1" },
        [
          { title: "设计登录页（1）", projectId: "project-1" },
          { title: "设计登录页（3）", projectId: "project-1" },
          { title: "设计登录页（手动）", projectId: "project-1" },
        ]
      )
    ).toBe("设计登录页（4）")
  })

  it("counts titles only within the source session project", () => {
    expect(
      nextBranchSessionTitle(
        { title: "设计登录页", projectId: "project-1" },
        [
          { title: "设计登录页（1）", projectId: "project-2" },
          { title: "设计登录页（2）", projectId: undefined },
        ]
      )
    ).toBe("设计登录页（1）")
  })

  it("keeps a forked session title as the base for a nested branch", () => {
    expect(
      nextBranchSessionTitle(
        { title: "设计登录页（1）", projectId: "project-1" },
        [
          { title: "设计登录页（1）（1）", projectId: "project-1" },
          { title: "设计登录页（2）", projectId: "project-1" },
        ]
      )
    ).toBe("设计登录页（1）（2）")
  })
})
