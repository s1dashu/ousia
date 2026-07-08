import { mkdirSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  expandHomePath,
  isPathInside,
  resolveProjectFilePath,
  resolveProjectRoot,
} from "./host-paths"

describe("host path helpers", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = join(tmpdir(), `ousia-host-paths-${Date.now()}`)
    mkdirSync(join(projectRoot, "nested"), { recursive: true })
  })

  afterEach(() => {
    rmSync(projectRoot, { force: true, recursive: true })
  })

  it("expands only home-relative paths", () => {
    expect(expandHomePath("~")).toBe(homedir())
    expect(expandHomePath("~/Documents/Ousia")).toBe(
      join(homedir(), "Documents/Ousia")
    )
    expect(expandHomePath("/tmp/project")).toBe("/tmp/project")
  })

  it("resolves an existing project root", () => {
    expect(resolveProjectRoot(projectRoot)).toBe(resolve(projectRoot))
  })

  it("fails fast for missing or blank project roots", () => {
    expect(() => resolveProjectRoot("  ")).toThrow(
      "请先选择项目，再打开项目资源。"
    )
    expect(() => resolveProjectRoot(join(projectRoot, "missing"))).toThrow(
      "请先选择项目，再打开项目资源。"
    )
  })

  it("allows project-relative file paths inside the project", () => {
    expect(resolveProjectFilePath(projectRoot, "nested/file.txt")).toEqual({
      absoluteFilePath: join(projectRoot, "nested/file.txt"),
      projectRoot: resolve(projectRoot),
    })
  })

  it("rejects relative and absolute paths outside the project", () => {
    expect(() => resolveProjectFilePath(projectRoot, "../outside.txt")).toThrow(
      "项目文件路径必须位于项目目录内。"
    )
    expect(() => resolveProjectFilePath(projectRoot, "/etc/passwd")).toThrow(
      "项目文件路径必须位于项目目录内。"
    )
  })

  it("identifies child paths without treating sibling prefixes as inside", () => {
    expect(isPathInside(projectRoot, projectRoot)).toBe(true)
    expect(isPathInside(projectRoot, join(projectRoot, "nested/file.txt"))).toBe(
      true
    )
    expect(isPathInside(projectRoot, `${projectRoot}-sibling/file.txt`)).toBe(
      false
    )
  })
})
