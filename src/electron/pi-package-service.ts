import "./pi-package-dir.js"

import { mkdirSync } from "node:fs"
import { homedir } from "node:os"

import {
  DefaultPackageManager,
  SettingsManager,
  type PackageManager,
  type ProgressEvent,
} from "@earendil-works/pi-coding-agent"

import catalogSnapshot from "./pi-packages-top100.json"
import type {
  OusiaPiPackageMutationPayload,
  OusiaPiPackageStatus,
} from "./chat-types.js"
import { resolvePiAgentDir } from "./pi-environment.js"
import { writeRuntimeLog } from "./runtime-logger.js"

const PACKAGE_NAME_SEGMENT = "[a-z0-9](?:[a-z0-9._~-]*[a-z0-9])?"
const NPM_PACKAGE_NAME_PATTERN = new RegExp(
  `^(?:${PACKAGE_NAME_SEGMENT}|@${PACKAGE_NAME_SEGMENT}/${PACKAGE_NAME_SEGMENT})$`
)

type PackageManagerSubset = Pick<
  PackageManager,
  | "installAndPersist"
  | "listConfiguredPackages"
  | "removeAndPersist"
  | "setProgressCallback"
>

type PiPackageRuntime = {
  drainSettingsErrors: () => Array<{ error: Error; scope: string }>
  flushSettings: () => Promise<void>
  packageManager: PackageManagerSubset
}

type PiPackageServiceOptions = {
  allowedPackageNames?: ReadonlySet<string>
  createRuntime?: () => PiPackageRuntime
  log?: (
    level: "error" | "info" | "warn",
    details: Record<string, unknown>
  ) => void
}

function validateCatalogPackageNames() {
  if (
    catalogSnapshot.schemaVersion !== 1 ||
    !Array.isArray(catalogSnapshot.packages) ||
    catalogSnapshot.packages.length !== 100
  ) {
    throw new Error("Pi package catalog must contain exactly 100 packages")
  }
  const names = new Set<string>()
  for (const item of catalogSnapshot.packages) {
    if (
      typeof item.name !== "string" ||
      !NPM_PACKAGE_NAME_PATTERN.test(item.name) ||
      names.has(item.name)
    ) {
      throw new Error(`Invalid Pi package catalog entry: ${String(item.name)}`)
    }
    names.add(item.name)
  }
  return names
}

const CATALOG_PACKAGE_NAMES = validateCatalogPackageNames()

function createDefaultRuntime(): PiPackageRuntime {
  const agentDir = resolvePiAgentDir()
  const cwd = homedir()
  mkdirSync(agentDir, { recursive: true })
  const settingsManager = SettingsManager.create(cwd, agentDir)
  return {
    drainSettingsErrors: () => settingsManager.drainErrors(),
    flushSettings: () => settingsManager.flush(),
    packageManager: new DefaultPackageManager({
      agentDir,
      cwd,
      settingsManager,
    }),
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function packageNameFromNpmSource(source: string) {
  if (!source.startsWith("npm:")) {
    return undefined
  }
  const specifier = source.slice("npm:".length)
  if (specifier.startsWith("@")) {
    const slashIndex = specifier.indexOf("/")
    if (slashIndex < 0) {
      return undefined
    }
    const versionIndex = specifier.indexOf("@", slashIndex)
    return versionIndex < 0 ? specifier : specifier.slice(0, versionIndex)
  }
  const versionIndex = specifier.indexOf("@")
  return versionIndex < 0 ? specifier : specifier.slice(0, versionIndex)
}

function assertSettingsHealthy(runtime: PiPackageRuntime, operation: string) {
  const errors = runtime.drainSettingsErrors()
  if (!errors.length) {
    return
  }
  throw new AggregateError(
    errors.map(({ error }) => error),
    `Pi package settings ${operation} failed: ${errors
      .map(({ error, scope }) => `${scope}: ${error.message}`)
      .join("; ")}`
  )
}

function requireCatalogPackageName(
  payload: OusiaPiPackageMutationPayload,
  allowedPackageNames: ReadonlySet<string>
) {
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.packageName !== "string" ||
    !NPM_PACKAGE_NAME_PATTERN.test(payload.packageName) ||
    !allowedPackageNames.has(payload.packageName)
  ) {
    throw new Error("Pi package is not present in the local catalog")
  }
  return payload.packageName
}

function requireValidPackageName(payload: OusiaPiPackageMutationPayload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.packageName !== "string" ||
    !NPM_PACKAGE_NAME_PATTERN.test(payload.packageName)
  ) {
    throw new Error("Invalid Pi npm package name")
  }
  return payload.packageName
}

function statusFromManager(
  packageManager: PackageManagerSubset,
  allowedPackageNames: ReadonlySet<string>
): OusiaPiPackageStatus {
  const installed = new Set<string>()
  const missing = new Set<string>()
  for (const configured of packageManager.listConfiguredPackages()) {
    if (configured.scope !== "user") {
      continue
    }
    const packageName = packageNameFromNpmSource(configured.source)
    if (!packageName) {
      continue
    }
    if (configured.installedPath) {
      installed.add(packageName)
    } else {
      missing.add(packageName)
    }
  }
  const catalogOrder = [...allowedPackageNames]
  const installedOutsideCatalog = [...installed].filter(
    (name) => !allowedPackageNames.has(name)
  )
  const missingOutsideCatalog = [...missing].filter(
    (name) => !allowedPackageNames.has(name)
  )
  return {
    installedPackageNames: [
      ...catalogOrder.filter((name) => installed.has(name)),
      ...installedOutsideCatalog,
    ],
    missingPackageNames: [
      ...catalogOrder.filter((name) => missing.has(name)),
      ...missingOutsideCatalog,
    ],
  }
}

export function createPiPackageService(options: PiPackageServiceOptions = {}) {
  const allowedPackageNames =
    options.allowedPackageNames ?? CATALOG_PACKAGE_NAMES
  const createRuntime = options.createRuntime ?? createDefaultRuntime
  const log =
    options.log ??
    ((level, details) => writeRuntimeLog("pi.packages", level, details))
  let operationTail = Promise.resolve()

  function serialize<T>(operation: () => Promise<T>) {
    const result = operationTail.then(operation, operation)
    operationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  function attachProgressLogging(
    packageManager: PackageManagerSubset,
    packageName: string
  ) {
    packageManager.setProgressCallback((event: ProgressEvent) => {
      log(event.type === "error" ? "error" : "info", {
        action: event.action,
        event: event.type,
        packageName,
        source: event.source,
      })
    })
  }

  async function listPackages() {
    return serialize(async () => {
      const runtime = createRuntime()
      assertSettingsHealthy(runtime, "load")
      const status = statusFromManager(
        runtime.packageManager,
        allowedPackageNames
      )
      if (status.missingPackageNames.length) {
        log("warn", {
          event: "configured-packages-missing",
          packageNames: status.missingPackageNames,
        })
      }
      return status
    })
  }

  async function installPackage(payload: OusiaPiPackageMutationPayload) {
    const packageName = requireCatalogPackageName(payload, allowedPackageNames)
    return serialize(async () => {
      const runtime = createRuntime()
      assertSettingsHealthy(runtime, "load")
      const initialStatus = statusFromManager(
        runtime.packageManager,
        allowedPackageNames
      )
      if (initialStatus.installedPackageNames.includes(packageName)) {
        throw new Error(`Pi package is already installed: ${packageName}`)
      }
      attachProgressLogging(runtime.packageManager, packageName)
      log("info", { event: "install-requested", packageName })
      try {
        await runtime.packageManager.installAndPersist(`npm:${packageName}`)
        await runtime.flushSettings()
        assertSettingsHealthy(runtime, "write")
        const status = statusFromManager(
          runtime.packageManager,
          allowedPackageNames
        )
        if (!status.installedPackageNames.includes(packageName)) {
          throw new Error(
            `Pi package install completed without an installed package: ${packageName}`
          )
        }
        log("info", { event: "install-completed", packageName })
        return status
      } catch (error) {
        log("error", {
          error: errorMessage(error),
          event: "install-failed",
          packageName,
        })
        throw error
      } finally {
        runtime.packageManager.setProgressCallback(undefined)
      }
    })
  }

  async function removePackage(payload: OusiaPiPackageMutationPayload) {
    const packageName = requireValidPackageName(payload)
    return serialize(async () => {
      const runtime = createRuntime()
      assertSettingsHealthy(runtime, "load")
      const configured = runtime.packageManager
        .listConfiguredPackages()
        .find(
          (entry) =>
            entry.scope === "user" &&
            packageNameFromNpmSource(entry.source) === packageName
        )
      if (!configured) {
        throw new Error(`Pi package is not installed: ${packageName}`)
      }
      attachProgressLogging(runtime.packageManager, packageName)
      log("info", { event: "remove-requested", packageName })
      try {
        const removedFromSettings =
          await runtime.packageManager.removeAndPersist(configured.source)
        if (!removedFromSettings) {
          throw new Error(
            `Pi package was removed from disk but not from settings: ${packageName}`
          )
        }
        await runtime.flushSettings()
        assertSettingsHealthy(runtime, "write")
        const status = statusFromManager(
          runtime.packageManager,
          allowedPackageNames
        )
        if (
          status.installedPackageNames.includes(packageName) ||
          status.missingPackageNames.includes(packageName)
        ) {
          throw new Error(
            `Pi package removal completed but remains configured: ${packageName}`
          )
        }
        log("info", { event: "remove-completed", packageName })
        return status
      } catch (error) {
        log("error", {
          error: errorMessage(error),
          event: "remove-failed",
          packageName,
        })
        throw error
      } finally {
        runtime.packageManager.setProgressCallback(undefined)
      }
    })
  }

  return {
    installPackage,
    listPackages,
    removePackage,
  }
}

export const piPackageService = createPiPackageService()
