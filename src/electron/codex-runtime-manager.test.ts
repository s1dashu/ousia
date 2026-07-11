import { createHash } from "node:crypto"
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { create } from "tar"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CODEX_RUNTIME_VERSION,
  createCodexRuntimeManager,
  type CodexRuntimeTarget,
} from "./codex-runtime-manager.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  )
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ousia-codex-runtime-test-"))
  temporaryDirectories.push(root)
  const source = join(root, "source")
  const binary = join(
    source,
    "package",
    "vendor",
    "test-triple",
    "bin",
    "codex"
  )
  await mkdir(join(source, "package", "vendor", "test-triple", "codex-path"), {
    recursive: true,
  })
  await mkdir(join(source, "package", "vendor", "test-triple", "bin"), {
    recursive: true,
  })
  await writeFile(binary, "fixture-codex-binary")
  await chmod(binary, 0o755)
  const archive = join(root, "runtime.tgz")
  await create({ cwd: source, file: archive, gzip: true }, ["package"])
  const archiveBytes = await readFile(archive)
  const integrity =
    `sha512-${createHash("sha512").update(archiveBytes).digest("base64")}` as const
  const target: CodexRuntimeTarget = {
    arch: "arm64",
    integrity,
    packageName: "@openai/codex-test",
    platform: "darwin",
    targetTriple: "test-triple",
  }
  return { archiveBytes, root, target }
}

describe("createCodexRuntimeManager", () => {
  it("downloads, verifies, atomically installs, and reuses the pinned runtime", async () => {
    const { archiveBytes, root, target } = await fixture()
    const fetchRuntime = vi.fn(async () =>
      Promise.resolve(
        new Response(archiveBytes, {
          headers: { "content-length": String(archiveBytes.length) },
        })
      )
    )
    const onDownloadProgress = vi.fn()
    const runtimeRoot = join(root, "runtime-cache")
    const manager = createCodexRuntimeManager({
      fetchRuntime,
      logger: vi.fn(),
      onDownloadProgress,
      runtimeRoot,
      target,
    })

    const [first, concurrent] = await Promise.all([
      manager.ensureInstalled(),
      manager.ensureInstalled(),
    ])

    expect(fetchRuntime).toHaveBeenCalledTimes(1)
    expect(concurrent).toEqual(first)
    expect(await readFile(first.binaryPath, "utf8")).toBe(
      "fixture-codex-binary"
    )
    expect(onDownloadProgress).toHaveBeenLastCalledWith({
      downloadedBytes: archiveBytes.length,
      totalBytes: archiveBytes.length,
    })
    expect((await stat(first.binaryPath)).mode & 0o111).not.toBe(0)

    const cachedManager = createCodexRuntimeManager({
      fetchRuntime: vi.fn(() => {
        throw new Error("cache miss")
      }),
      logger: vi.fn(),
      runtimeRoot,
      target,
    })
    await expect(cachedManager.ensureInstalled()).resolves.toEqual(first)
    const marker = JSON.parse(
      await readFile(
        join(
          runtimeRoot,
          CODEX_RUNTIME_VERSION,
          "darwin-arm64",
          ".ousia-runtime.json"
        ),
        "utf8"
      )
    )
    expect(marker).toMatchObject({
      integrity: target.integrity,
      packageName: target.packageName,
      version: CODEX_RUNTIME_VERSION,
    })
  })

  it("rejects a download whose SHA-512 integrity does not match", async () => {
    const { archiveBytes, root, target } = await fixture()
    const manager = createCodexRuntimeManager({
      fetchRuntime: async () => new Response(archiveBytes),
      logger: vi.fn(),
      runtimeRoot: join(root, "runtime-cache"),
      target: { ...target, integrity: "sha512-invalid" },
    })

    await expect(manager.ensureInstalled()).rejects.toThrow(
      "Codex runtime integrity check failed"
    )
  })

  it("clears a failed installation promise so an explicit retry can succeed", async () => {
    const { archiveBytes, root, target } = await fixture()
    const fetchRuntime = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(archiveBytes))
    const manager = createCodexRuntimeManager({
      fetchRuntime,
      logger: vi.fn(),
      runtimeRoot: join(root, "runtime-cache"),
      target,
    })

    await expect(manager.ensureInstalled()).rejects.toThrow("HTTP 503")
    await expect(manager.ensureInstalled()).resolves.toMatchObject({
      packageName: target.packageName,
      targetTriple: target.targetTriple,
    })
    expect(fetchRuntime).toHaveBeenCalledTimes(2)
  })
})
