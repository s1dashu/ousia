import { describe, expect, it, vi } from "vitest"

import {
  parsePiAutoRetryOnFailure,
  readPiAutoRetryOnFailure,
  resolvePiAgentDirFromEnvironment,
} from "./pi-retry-settings"

describe("Pi retry settings", () => {
  it("resolves the same default and environment-driven agent directories as Pi", () => {
    expect(
      resolvePiAgentDirFromEnvironment(undefined, "/home/user", "/cwd")
    ).toBe("/home/user/.pi/agent")
    expect(
      resolvePiAgentDirFromEnvironment("~/custom", "/home/user", "/cwd")
    ).toBe("/home/user/custom")
    expect(
      resolvePiAgentDirFromEnvironment("relative", "/home/user", "/cwd")
    ).toBe("/cwd/relative")
  })

  it("parses the retry flag and rejects invalid typed settings", () => {
    expect(parsePiAutoRetryOnFailure('{"retry":{"enabled":false}}')).toBe(false)
    expect(parsePiAutoRetryOnFailure("{}")).toBe(true)
    expect(() =>
      parsePiAutoRetryOnFailure('{"retry":{"enabled":"yes"}}')
    ).toThrow("expected a boolean")
  })

  it("treats a missing file as Pi's enabled-by-default value", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" })
    await expect(
      readPiAutoRetryOnFailure({
        agentDir: "/agent",
        readFile: vi.fn().mockRejectedValue(missing),
      })
    ).resolves.toBe(true)
  })

  it("retries a transient partial JSON read without loading the Pi SDK", async () => {
    const readFile = vi
      .fn<ReadPiRetryFile>()
      .mockResolvedValueOnce('{"retry":')
      .mockResolvedValueOnce('{"retry":{"enabled":false}}')
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(
      readPiAutoRetryOnFailure({ agentDir: "/agent", readFile, wait })
    ).resolves.toBe(false)
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledOnce()
  })
})

type ReadPiRetryFile = (path: string, encoding: "utf8") => Promise<string>
