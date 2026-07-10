import { readFile as readFileFromDisk } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

type ReadTextFile = (path: string, encoding: "utf8") => Promise<string>

type ReadPiRetryOptions = {
  agentDir?: string
  maxAttempts?: number
  readFile?: ReadTextFile
  retryDelayMs?: number
  wait?: (delayMs: number) => Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function expandHomePath(path: string, homeDir: string) {
  if (path === "~") {
    return homeDir
  }
  if (path.startsWith("~/")) {
    return join(homeDir, path.slice(2))
  }
  return path
}

export function resolvePiAgentDirFromEnvironment(
  configuredDir = process.env.PI_CODING_AGENT_DIR,
  homeDir = homedir(),
  cwd = process.cwd()
) {
  if (!configuredDir?.trim()) {
    return join(homeDir, ".pi", "agent")
  }
  const expanded = expandHomePath(configuredDir.trim(), homeDir)
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded)
}

export function parsePiAutoRetryOnFailure(content: string) {
  const settings: unknown = JSON.parse(content)
  if (!isRecord(settings) || settings.retry === undefined) {
    return true
  }
  if (!isRecord(settings.retry) || settings.retry.enabled === undefined) {
    return true
  }
  if (typeof settings.retry.enabled !== "boolean") {
    throw new Error("Invalid Pi retry.enabled setting: expected a boolean.")
  }
  return settings.retry.enabled
}

function waitForRetry(delayMs: number) {
  return new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, delayMs)
  })
}

export async function readPiAutoRetryOnFailure(
  options: ReadPiRetryOptions = {}
) {
  const settingsPath = join(
    options.agentDir ?? resolvePiAgentDirFromEnvironment(),
    "settings.json"
  )
  const maxAttempts = options.maxAttempts ?? 3
  const readFile = options.readFile ?? readFileFromDisk
  const retryDelayMs = options.retryDelayMs ?? 20
  const wait = options.wait ?? waitForRetry
  let lastParseError: SyntaxError | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let content: string
    try {
      content = await readFile(settingsPath, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true
      }
      throw error
    }

    try {
      return parsePiAutoRetryOnFailure(content)
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error
      }
      lastParseError = error
      if (attempt < maxAttempts) {
        await wait(retryDelayMs)
      }
    }
  }

  throw lastParseError ?? new Error("Failed to parse Pi settings.json.")
}
