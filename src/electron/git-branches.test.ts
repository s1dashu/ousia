import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

import {
  checkoutGitBranch,
  createAndCheckoutGitBranch,
  readGitBranchState,
} from "./git-branches.js"

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "ousia-git-branches-"))
  temporaryDirectories.push(path)
  return path
}

async function git(path: string, args: string[]) {
  await execFileAsync("git", ["-C", path, ...args])
}

async function initializedRepository() {
  const path = await temporaryDirectory()
  await git(path, ["init", "-b", "main"])
  await git(path, ["config", "user.name", "Ousia Test"])
  await git(path, ["config", "user.email", "ousia@example.invalid"])
  await writeFile(join(path, "README.md"), "# test\n")
  await git(path, ["add", "README.md"])
  await git(path, ["commit", "-m", "Initial commit"])
  return path
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true })
    )
  )
})

describe("Git branch operations", () => {
  it("distinguishes a regular directory from a Git repository", async () => {
    const path = await temporaryDirectory()

    await expect(readGitBranchState(path)).resolves.toEqual({
      branches: [],
      dirtyFileCount: 0,
      isRepository: false,
    })
  })

  it("reads branches and reports uncommitted files", async () => {
    const path = await initializedRepository()
    await writeFile(join(path, "draft.txt"), "draft\n")

    await expect(readGitBranchState(path)).resolves.toMatchObject({
      branches: [{ name: "main" }],
      currentBranch: "main",
      dirtyFileCount: 1,
      isRepository: true,
    })
  })

  it("creates, checks out, and switches local branches", async () => {
    const path = await initializedRepository()

    const created = await createAndCheckoutGitBranch(path, "codex/new-task")
    expect(created.currentBranch).toBe("codex/new-task")
    expect(created.branches.map((branch) => branch.name)).toEqual([
      "codex/new-task",
      "main",
    ])

    const switched = await checkoutGitBranch(path, "main")
    expect(switched.currentBranch).toBe("main")
  })

  it("rejects invalid branch names before mutation", async () => {
    const path = await initializedRepository()

    await expect(
      createAndCheckoutGitBranch(path, "codex/")
    ).rejects.toThrow()
    expect((await readGitBranchState(path)).currentBranch).toBe("main")
  })
})
