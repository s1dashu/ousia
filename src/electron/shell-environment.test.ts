import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { spawnMock, writeRuntimeLogMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  writeRuntimeLogMock: vi.fn(),
}))

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}))

vi.mock("./runtime-logger.js", () => ({
  writeRuntimeLog: writeRuntimeLogMock,
}))

const originalPlatform = process.platform
const originalShell = process.env.SHELL
const originalTestEnv = process.env.MIKI_SHELL_ENV_TEST

describe("shell environment hydration", () => {
  beforeEach(() => {
    vi.resetModules()
    spawnMock.mockReset()
    writeRuntimeLogMock.mockReset()
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    })
    process.env.SHELL = "/bin/zsh"
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    })
    if (originalShell === undefined) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = originalShell
    }
    if (originalTestEnv === undefined) {
      delete process.env.MIKI_SHELL_ENV_TEST
    } else {
      process.env.MIKI_SHELL_ENV_TEST = originalTestEnv
    }
  })

  it("isolates the interactive login shell from the parent terminal session", async () => {
    const child = new EventEmitter()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    Object.assign(child, { kill: vi.fn(), stderr, stdout })
    spawnMock.mockReturnValue(child)

    const { hydrateShellEnvironment } = await import("./shell-environment.js")
    const hydration = hydrateShellEnvironment()
    stdout.end(Buffer.from("\0MIKI_SHELL_ENV_TEST=loaded\0"))
    stderr.end()
    child.emit("close", 0, null)
    await hydration

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-ilc", "printf '\\0'; /usr/bin/env -0"],
      expect.objectContaining({
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
    )
    expect(process.env.MIKI_SHELL_ENV_TEST).toBe("loaded")
    expect(writeRuntimeLogMock).toHaveBeenCalledWith(
      "shell-env",
      "info",
      expect.objectContaining({ detachedSession: true })
    )
  })
})
