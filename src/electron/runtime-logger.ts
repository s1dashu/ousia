import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { inspect } from "node:util"

import {
  snapshotDesktopPathPolicy,
  snapshotProductIdentity,
  type DesktopPathPolicy,
  type ProductIdentity,
} from "@ousia/extension-api"

type LogLevel = "debug" | "info" | "warn" | "error"

const originalConsole = {
  debug: console.debug.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
}

let isInstalled = false
let configuration:
  | Readonly<{
      identity: ProductIdentity
      logDirectoryPath: string
      logFilePath: string
    }>
  | undefined

function requireConfiguration() {
  if (!configuration) {
    throw new Error(
      "Runtime logger has not been configured with a product identity and path policy."
    )
  }
  return configuration
}

export function configureRuntimeLogger(
  identity: ProductIdentity,
  pathPolicy: DesktopPathPolicy
) {
  if (configuration) {
    throw new Error("Runtime logger is already configured.")
  }
  const identitySnapshot = snapshotProductIdentity(identity)
  const pathPolicySnapshot = snapshotDesktopPathPolicy(pathPolicy)
  const logDirectoryPath = join(
    homedir(),
    pathPolicySnapshot.runtimeLog.homeDirectoryName,
    pathPolicySnapshot.runtimeLog.directoryName
  )
  configuration = Object.freeze({
    identity: identitySnapshot,
    logDirectoryPath,
    logFilePath: join(
      logDirectoryPath,
      pathPolicySnapshot.runtimeLog.fileName
    ),
  })
}

export function getRuntimeLogDirectoryPath() {
  return requireConfiguration().logDirectoryPath
}

export function getDesktopRuntimeLogPath() {
  return requireConfiguration().logFilePath
}

function ensureLogDir() {
  mkdirSync(getRuntimeLogDirectoryPath(), { recursive: true })
}

function formatLogValue(value: unknown) {
  if (typeof value === "string") {
    return value
  }
  if (value instanceof Error) {
    return value.stack || value.message
  }
  return inspect(value, {
    breakLength: 140,
    depth: 6,
    maxArrayLength: 80,
  })
}

function appendLine(line: string) {
  ensureLogDir()
  writeFileSync(getDesktopRuntimeLogPath(), `${line}\n`, {
    encoding: "utf8",
    flag: "a",
  })
}

export function writeRuntimeLog(
  source: string,
  level: LogLevel,
  ...values: unknown[]
) {
  const message = values.map(formatLogValue).join(" ")
  appendLine(`${new Date().toISOString()} [${level}] [${source}] ${message}`)
}

export function installRuntimeLogger() {
  const { identity } = requireConfiguration()
  if (isInstalled) {
    return
  }
  isInstalled = true
  ensureLogDir()
  appendLine(
    `${new Date().toISOString()} [info] [main] ${identity.displayName} desktop starting`
  )

  console.debug = (...values: unknown[]) => {
    writeRuntimeLog("main.console", "debug", ...values)
    originalConsole.debug(...values)
  }
  console.info = (...values: unknown[]) => {
    writeRuntimeLog("main.console", "info", ...values)
    originalConsole.info(...values)
  }
  console.log = (...values: unknown[]) => {
    writeRuntimeLog("main.console", "info", ...values)
    originalConsole.log(...values)
  }
  console.warn = (...values: unknown[]) => {
    writeRuntimeLog("main.console", "warn", ...values)
    originalConsole.warn(...values)
  }
  console.error = (...values: unknown[]) => {
    writeRuntimeLog("main.console", "error", ...values)
    originalConsole.error(...values)
  }

  process.on("uncaughtExceptionMonitor", (error) => {
    writeRuntimeLog("main.uncaughtException", "error", error)
  })
  process.on("unhandledRejection", (reason) => {
    writeRuntimeLog("main.unhandledRejection", "error", reason)
    originalConsole.error(reason)
  })
}
