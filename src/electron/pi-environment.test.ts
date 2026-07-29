import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./pi-package-dir.js", () => ({}))

import {
  removePiProviderCredential,
  savePiProviderCredential,
} from "./pi-environment.js"

describe("Pi environment credentials", () => {
  let agentDir: string
  let previousAgentDir: string | undefined
  let previousOffline: string | undefined

  beforeEach(() => {
    previousAgentDir = process.env.PI_CODING_AGENT_DIR
    previousOffline = process.env.PI_OFFLINE
    agentDir = mkdtempSync(join(tmpdir(), "ousia-pi-agent-"))
    process.env.PI_CODING_AGENT_DIR = agentDir
    process.env.PI_OFFLINE = "1"
  })

  afterEach(() => {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir
    }
    if (previousOffline === undefined) {
      delete process.env.PI_OFFLINE
    } else {
      process.env.PI_OFFLINE = previousOffline
    }
    rmSync(agentDir, { force: true, recursive: true })
  })

  it("persists and removes a provider key through Pi ModelRuntime", async () => {
    const saved = await savePiProviderCredential({
      provider: "openai",
      apiKey: "test-openai-key",
    })

    expect(saved).toMatchObject({
      ok: true,
      status: {
        agentDir,
        configuredProviderIds: expect.arrayContaining(["openai"]),
        hasConfiguredCredential: true,
        runtime: "bundled",
      },
    })
    expect(
      JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8"))
    ).toMatchObject({
      openai: {
        type: "api_key",
        key: "test-openai-key",
      },
    })

    await savePiProviderCredential({
      provider: "anthropic",
      apiKey: "test-anthropic-key",
    })
    const removed = await removePiProviderCredential({ provider: "openai" })

    expect(removed).toMatchObject({
      ok: true,
      status: {
        runtime: "bundled",
      },
    })
    if (!removed.ok || !removed.status) {
      throw new Error(removed.error ?? "Pi credential removal returned no status")
    }
    expect(removed.status.configuredProviderIds).toContain("anthropic")
    expect(removed.status.configuredProviderIds).not.toContain("openai")
    const remainingCredentials = JSON.parse(
      readFileSync(join(agentDir, "auth.json"), "utf8")
    )
    expect(remainingCredentials).not.toHaveProperty("openai")
    expect(remainingCredentials).toMatchObject({
      anthropic: {
        type: "api_key",
        key: "test-anthropic-key",
      },
    })
  })
})
