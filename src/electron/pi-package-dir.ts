import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { app } from "electron"

import { writeRuntimeLog } from "./runtime-logger.js"

const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent"
const PI_PACKAGE_RELATIVE_DIR = join(
  "node_modules",
  "@earendil-works",
  "pi-coding-agent"
)

let cachedPiPackageDir: string | undefined

function expandHomePath(path: string) {
  if (path === "~") {
    return homedir()
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2))
  }
  return path
}

function normalizeCandidate(path: string | undefined) {
  return path ? resolve(expandHomePath(path)) : undefined
}

function isPiPackageDir(path: string | undefined) {
  if (!path) {
    return false
  }

  try {
    const packageJsonPath = join(path, "package.json")
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown
    }
    return (
      packageJson.name === PI_PACKAGE_NAME &&
      existsSync(join(path, "README.md")) &&
      existsSync(join(path, "docs"))
    )
  } catch {
    return false
  }
}

function piPackageDirCandidates() {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath
  return Array.from(
    new Set(
      [
        normalizeCandidate(process.env.PI_PACKAGE_DIR),
        normalizeCandidate(join(process.cwd(), PI_PACKAGE_RELATIVE_DIR)),
        normalizeCandidate(join(app.getAppPath(), PI_PACKAGE_RELATIVE_DIR)),
        resourcesPath
          ? normalizeCandidate(join(resourcesPath, "app", PI_PACKAGE_RELATIVE_DIR))
          : undefined,
      ].filter((path): path is string => Boolean(path))
    )
  )
}

export function resolvePiPackageDir() {
  const candidates = piPackageDirCandidates()
  return candidates.find(isPiPackageDir)
}

export function ensurePiPackageDir() {
  if (cachedPiPackageDir && process.env.PI_PACKAGE_DIR === cachedPiPackageDir) {
    return cachedPiPackageDir
  }

  const existing = normalizeCandidate(process.env.PI_PACKAGE_DIR)
  if (isPiPackageDir(existing)) {
    cachedPiPackageDir = existing
    process.env.PI_PACKAGE_DIR = existing
    return existing
  }

  const resolved = resolvePiPackageDir()
  if (!resolved) {
    writeRuntimeLog("pi.package-dir", "error", {
      reason: "resolve-failed",
      candidates: piPackageDirCandidates(),
      existing,
    })
    throw new Error(
      `找不到 ${PI_PACKAGE_NAME} 包资源目录，Pi 文档路径无法安全解析。`
    )
  }

  process.env.PI_PACKAGE_DIR = resolved
  cachedPiPackageDir = resolved
  writeRuntimeLog("pi.package-dir", existing ? "warn" : "info", {
    reason: existing ? "override-invalid-env" : "set-env",
    previous: existing,
    resolved,
  })
  return resolved
}
