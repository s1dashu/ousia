import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { inspect } from "node:util"

export const OUSIA_LOG_DIR = join(homedir(), ".ousia", "logs")
export const OUSIA_DESKTOP_LOG_PATH = join(OUSIA_LOG_DIR, "ousia-desktop.log")
const OUSIA_DESKTOP_LOG_BACKUP_PATH = `${OUSIA_DESKTOP_LOG_PATH}.1`
const MAX_RUNTIME_LOG_BYTES = 8 * 1024 * 1024

type LogLevel = "debug" | "info" | "warn" | "error"

const originalConsole = {
  debug: console.debug.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
}

let isInstalled = false
let logDirectoryReady = false
let logFileDescriptor: number | undefined

function ensureLogDir() {
  if (logDirectoryReady) {
    return
  }
  mkdirSync(OUSIA_LOG_DIR, { recursive: true })
  logDirectoryReady = true
}

function openRuntimeLog() {
  if (logFileDescriptor !== undefined) {
    return logFileDescriptor
  }
  ensureLogDir()
  if (
    existsSync(OUSIA_DESKTOP_LOG_PATH) &&
    statSync(OUSIA_DESKTOP_LOG_PATH).size >= MAX_RUNTIME_LOG_BYTES
  ) {
    rmSync(OUSIA_DESKTOP_LOG_BACKUP_PATH, { force: true })
    renameSync(OUSIA_DESKTOP_LOG_PATH, OUSIA_DESKTOP_LOG_BACKUP_PATH)
  }
  logFileDescriptor = openSync(OUSIA_DESKTOP_LOG_PATH, "a")
  return logFileDescriptor
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
  writeSync(openRuntimeLog(), `${line}\n`, undefined, "utf8")
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
  if (isInstalled) {
    return
  }
  isInstalled = true
  ensureLogDir()
  appendLine(`${new Date().toISOString()} [info] [main] Ousia desktop starting`)

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
  process.once("exit", () => {
    if (logFileDescriptor !== undefined) {
      closeSync(logFileDescriptor)
      logFileDescriptor = undefined
    }
  })
}
