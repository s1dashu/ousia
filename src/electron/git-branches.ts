import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { OusiaGitBranchState } from "./chat-types.js"

const execFileAsync = promisify(execFile)

type GitCommandError = Error & {
  code?: number | string
  stderr?: string
  stdout?: string
}

async function runGit(projectPath: string, args: string[]) {
  return execFileAsync("git", ["-C", projectPath, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  })
}

function commandErrorText(error: unknown) {
  const commandError = error as GitCommandError
  return (
    commandError.stderr?.trim() ||
    commandError.stdout?.trim() ||
    commandError.message ||
    "Git command failed."
  )
}

function isNotRepositoryError(error: unknown) {
  return /not a git repository/i.test(commandErrorText(error))
}

export async function readGitBranchState(
  projectPath: string
): Promise<OusiaGitBranchState> {
  try {
    const repository = await runGit(projectPath, [
      "rev-parse",
      "--is-inside-work-tree",
    ])
    if (repository.stdout.trim() !== "true") {
      return { branches: [], dirtyFileCount: 0, isRepository: false }
    }
  } catch (error) {
    if (isNotRepositoryError(error)) {
      return { branches: [], dirtyFileCount: 0, isRepository: false }
    }
    throw new Error(commandErrorText(error))
  }

  const [branchOutput, currentOutput, statusOutput] = await Promise.all([
    runGit(projectPath, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
    ]),
    runGit(projectPath, ["branch", "--show-current"]),
    runGit(projectPath, ["status", "--porcelain=v1"]),
  ])
  const currentBranch = currentOutput.stdout.trim()
  const branches = branchOutput.stdout
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }))
  const dirtyFileCount = statusOutput.stdout
    .split("\n")
    .filter(Boolean).length

  return {
    branches,
    ...(currentBranch ? { currentBranch } : {}),
    dirtyFileCount,
    isRepository: true,
  }
}

async function validateBranchName(projectPath: string, branchName: string) {
  const normalizedBranchName = branchName.trim()
  if (!normalizedBranchName) {
    throw new Error("Branch name cannot be empty.")
  }
  try {
    await runGit(projectPath, [
      "check-ref-format",
      "--branch",
      normalizedBranchName,
    ])
  } catch (error) {
    throw new Error(commandErrorText(error))
  }
  return normalizedBranchName
}

export async function checkoutGitBranch(
  projectPath: string,
  branchName: string
) {
  const normalizedBranchName = await validateBranchName(projectPath, branchName)
  try {
    await runGit(projectPath, ["switch", normalizedBranchName])
  } catch (error) {
    throw new Error(commandErrorText(error))
  }
  return readGitBranchState(projectPath)
}

export async function createAndCheckoutGitBranch(
  projectPath: string,
  branchName: string
) {
  const normalizedBranchName = await validateBranchName(projectPath, branchName)
  try {
    await runGit(projectPath, ["switch", "-c", normalizedBranchName])
  } catch (error) {
    throw new Error(commandErrorText(error))
  }
  return readGitBranchState(projectPath)
}
