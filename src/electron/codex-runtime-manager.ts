import { createHash } from "node:crypto"
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { constants, createWriteStream } from "node:fs"
import { join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"

import { extract } from "tar"

import type { CodexNativeBinaryResolution } from "./codex-app-server-client.js"
import { writeRuntimeLog } from "./runtime-logger.js"

export const CODEX_RUNTIME_VERSION = "0.144.0"

export type CodexRuntimeTarget = {
  arch: string
  integrity: `sha512-${string}`
  packageName: string
  platform: NodeJS.Platform
  targetTriple: string
}

const RUNTIME_TARGETS: readonly CodexRuntimeTarget[] = [
  {
    arch: "arm64",
    integrity:
      "sha512-rqFAJdOa2I0VRgepVsSZeLxs96+Y+LXTjccOOvH6894FyaFAYPZ/o+6hgpB1iGHxxdoY/DsGa8jrJC8Leqn9Kg==",
    packageName: "@openai/codex-darwin-arm64",
    platform: "darwin",
    targetTriple: "aarch64-apple-darwin",
  },
  {
    arch: "x64",
    integrity:
      "sha512-4p2jxRbN+Khg5UQzpkzT9upFj+qkEF/abmdvrtflkkWmVKP6Nt+yi8ospdqv9PDqvQ9SotPvX7iXaFaeUTrtmA==",
    packageName: "@openai/codex-darwin-x64",
    platform: "darwin",
    targetTriple: "x86_64-apple-darwin",
  },
  {
    arch: "arm64",
    integrity:
      "sha512-k++xhZrn9P3laO00Q92APG6mdOFDD66nUBo+8ExCa1NXi2pjLEMLC4+UNJTUUtUT1PEflOZ5pDKxPXgzaiFFFg==",
    packageName: "@openai/codex-linux-arm64",
    platform: "linux",
    targetTriple: "aarch64-unknown-linux-musl",
  },
  {
    arch: "x64",
    integrity:
      "sha512-GmKtQeX+cO9lN7mQD1FEVcXYEMLMgMByHwZdvlluH0bj/+c2ind3hwbRtE3eECFDekNhEiB80Ez0FfbkyFQqoA==",
    packageName: "@openai/codex-linux-x64",
    platform: "linux",
    targetTriple: "x86_64-unknown-linux-musl",
  },
  {
    arch: "arm64",
    integrity:
      "sha512-e2yGSgwdzrT1SoJMoOzWD58WBEsIaAMZpEchuV2VGkE2T955SG7dn7EyVQTQcy7/rdpE8aEDktZ/1eQQfjkdtQ==",
    packageName: "@openai/codex-win32-arm64",
    platform: "win32",
    targetTriple: "aarch64-pc-windows-msvc",
  },
  {
    arch: "x64",
    integrity:
      "sha512-QiholLCYqNeYvNM77HOmPtrOFrY0rQc/N9nXt+sQGXO3rEGmcWjpLzujY4Oegl3CLRHoieWqlep3EqEvFBjoIA==",
    packageName: "@openai/codex-win32-x64",
    platform: "win32",
    targetTriple: "x86_64-pc-windows-msvc",
  },
]

type FetchResponse = Pick<Response, "body" | "headers" | "ok" | "status">

export type CodexRuntimeDownloadProgress = {
  downloadedBytes: number
  totalBytes?: number
}

export interface CodexRuntimeManagerOptions {
  arch?: string
  fetchRuntime?: (url: string) => Promise<FetchResponse>
  logger?: typeof writeRuntimeLog
  onDownloadProgress?: (progress: CodexRuntimeDownloadProgress) => void
  platform?: NodeJS.Platform
  runtimeRoot: string
  target?: CodexRuntimeTarget
}

type RuntimeMarker = {
  binarySize: number
  integrity: string
  packageName: string
  version: string
}

function normalizePlatform(platform: NodeJS.Platform) {
  return platform === "android" ? "linux" : platform
}

function resolveTarget(platform: NodeJS.Platform, arch: string) {
  const normalizedPlatform = normalizePlatform(platform)
  const target = RUNTIME_TARGETS.find(
    (candidate) =>
      candidate.platform === normalizedPlatform && candidate.arch === arch
  )
  if (!target) {
    throw new Error(
      `Unsupported Codex platform: ${normalizedPlatform} (${arch})`
    )
  }
  return target
}

function runtimeUrl(target: CodexRuntimeTarget) {
  const suffix = `${target.platform}-${target.arch}`
  return `https://registry.npmjs.org/@openai/codex/-/codex-${CODEX_RUNTIME_VERSION}-${suffix}.tgz`
}

function pathsForTarget(runtimeRoot: string, target: CodexRuntimeTarget) {
  const installRoot = join(
    runtimeRoot,
    CODEX_RUNTIME_VERSION,
    `${target.platform}-${target.arch}`
  )
  const targetRoot = join(installRoot, "vendor", target.targetTriple)
  return {
    binaryPath: join(
      targetRoot,
      "bin",
      target.platform === "win32" ? "codex.exe" : "codex"
    ),
    installRoot,
    markerPath: join(installRoot, ".ousia-runtime.json"),
    pathDirs: [
      join(targetRoot, "codex-path"),
      join(targetRoot, "codex-resources", "zsh", "bin"),
    ],
  }
}

function binaryPathInInstallRoot(
  installRoot: string,
  target: CodexRuntimeTarget
) {
  return join(
    installRoot,
    "vendor",
    target.targetTriple,
    "bin",
    target.platform === "win32" ? "codex.exe" : "codex"
  )
}

async function installedResolution(
  runtimeRoot: string,
  target: CodexRuntimeTarget
): Promise<CodexNativeBinaryResolution | undefined> {
  const paths = pathsForTarget(runtimeRoot, target)
  try {
    const marker = JSON.parse(
      await readFile(paths.markerPath, "utf8")
    ) as RuntimeMarker
    const binary = await stat(paths.binaryPath)
    if (
      marker.version !== CODEX_RUNTIME_VERSION ||
      marker.packageName !== target.packageName ||
      marker.integrity !== target.integrity ||
      marker.binarySize !== binary.size ||
      !binary.isFile() ||
      binary.size <= 0
    ) {
      throw new Error("Codex runtime marker does not match installed files.")
    }
    if (target.platform !== "win32") {
      await access(paths.binaryPath, constants.X_OK)
    }
    const existingPathDirs: string[] = []
    for (const pathDir of paths.pathDirs) {
      try {
        if ((await stat(pathDir)).isDirectory()) {
          existingPathDirs.push(pathDir)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error
        }
      }
    }
    return {
      binaryPath: paths.binaryPath,
      packageName: target.packageName,
      pathDirs: existingPathDirs,
      targetTriple: target.targetTriple,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined
    }
    throw error
  }
}

async function downloadArchive(
  url: string,
  outputPath: string,
  expectedIntegrity: string,
  fetchRuntime: (url: string) => Promise<FetchResponse>,
  onProgress?: (progress: CodexRuntimeDownloadProgress) => void
) {
  const response = await fetchRuntime(url)
  if (!response.ok) {
    throw new Error(
      `Codex runtime download failed with HTTP ${response.status}.`
    )
  }
  if (!response.body) {
    throw new Error("Codex runtime download returned an empty response body.")
  }
  const contentLength = Number(response.headers.get("content-length"))
  const totalBytes =
    Number.isSafeInteger(contentLength) && contentLength > 0
      ? contentLength
      : undefined
  const hash = createHash("sha512")
  let downloadedBytes = 0
  const digestingStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      downloadedBytes += chunk.length
      onProgress?.({ downloadedBytes, ...(totalBytes ? { totalBytes } : {}) })
      callback(null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
    digestingStream,
    createWriteStream(outputPath, { flags: "wx" })
  )
  const actualIntegrity = `sha512-${hash.digest("base64")}`
  if (actualIntegrity !== expectedIntegrity) {
    throw new Error(
      `Codex runtime integrity check failed: expected ${expectedIntegrity}, received ${actualIntegrity}.`
    )
  }
  return downloadedBytes
}

export function createCodexRuntimeManager(options: CodexRuntimeManagerOptions) {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const target = options.target ?? resolveTarget(platform, arch)
  const logger = options.logger ?? writeRuntimeLog
  const fetchRuntime =
    options.fetchRuntime ??
    ((url: string) => fetch(url) as Promise<FetchResponse>)
  let ensurePromise: Promise<CodexNativeBinaryResolution> | undefined

  async function install(): Promise<CodexNativeBinaryResolution> {
    const existing = await installedResolution(options.runtimeRoot, target)
    if (existing) {
      logger("codex.runtime", "info", "Using installed Codex runtime", {
        binaryPath: existing.binaryPath,
        target: target.targetTriple,
        version: CODEX_RUNTIME_VERSION,
      })
      return existing
    }

    const versionRoot = join(options.runtimeRoot, CODEX_RUNTIME_VERSION)
    await mkdir(versionRoot, { recursive: true })
    const staleInstallations = (
      await readdir(versionRoot, { withFileTypes: true })
    )
      .filter(
        (entry) => entry.name.startsWith(".install-") && entry.isDirectory()
      )
      .map((entry) =>
        rm(join(versionRoot, entry.name), { force: true, recursive: true })
      )
    await Promise.all(staleInstallations)
    const stagingRoot = await mkdtemp(join(versionRoot, ".install-"))
    const archivePath = join(stagingRoot, "runtime.tgz")
    const extractedRoot = join(stagingRoot, "package")
    const destination = pathsForTarget(options.runtimeRoot, target).installRoot
    const url = runtimeUrl(target)
    try {
      await mkdir(extractedRoot)
      logger("codex.runtime", "info", "Downloading Codex runtime", {
        target: target.targetTriple,
        url,
        version: CODEX_RUNTIME_VERSION,
      })
      const downloadedBytes = await downloadArchive(
        url,
        archivePath,
        target.integrity,
        fetchRuntime,
        options.onDownloadProgress
      )
      await extract({
        cwd: extractedRoot,
        file: archivePath,
        preservePaths: false,
        strict: true,
        strip: 1,
      })
      const extractedBinaryPath = binaryPathInInstallRoot(extractedRoot, target)
      const binary = await stat(extractedBinaryPath)
      if (!binary.isFile() || binary.size <= 0) {
        throw new Error(
          "Downloaded Codex runtime does not contain its native binary."
        )
      }
      if (target.platform !== "win32") {
        await chmod(extractedBinaryPath, 0o755)
      }
      const marker: RuntimeMarker = {
        binarySize: binary.size,
        integrity: target.integrity,
        packageName: target.packageName,
        version: CODEX_RUNTIME_VERSION,
      }
      await writeFile(
        join(extractedRoot, ".ousia-runtime.json"),
        `${JSON.stringify(marker, null, 2)}\n`,
        "utf8"
      )
      await rm(destination, { force: true, recursive: true })
      await rename(extractedRoot, destination)
      const resolution = await installedResolution(options.runtimeRoot, target)
      if (!resolution) {
        throw new Error(
          "Codex runtime installation completed without a usable binary."
        )
      }
      logger("codex.runtime", "info", "Installed Codex runtime", {
        binaryPath: resolution.binaryPath,
        downloadedBytes,
        target: target.targetTriple,
        version: CODEX_RUNTIME_VERSION,
      })
      return resolution
    } catch (error) {
      logger("codex.runtime", "error", "Codex runtime installation failed", {
        error: error instanceof Error ? error.message : String(error),
        target: target.targetTriple,
        version: CODEX_RUNTIME_VERSION,
      })
      throw error
    } finally {
      await rm(stagingRoot, { force: true, recursive: true })
    }
  }

  return {
    ensureInstalled() {
      if (!ensurePromise) {
        ensurePromise = install().finally(() => {
          ensurePromise = undefined
        })
      }
      return ensurePromise
    },
  }
}
