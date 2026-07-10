import { execFile, type ExecFileException } from "node:child_process"

import { writeRuntimeLog } from "./runtime-logger.js"

const SHELL_ENV_TIMEOUT_MS = 5_000
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const SENSITIVE_ENV_NAME_PATTERN =
  /(API|AUTH|CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)/i

function parseNullSeparatedEnv(stdout: Buffer) {
  const parsed = new Map<string, string>()
  for (const entry of stdout.toString("utf8").split("\0")) {
    const equalsIndex = entry.indexOf("=")
    if (equalsIndex <= 0) {
      continue
    }
    const name = entry.slice(0, equalsIndex)
    if (!ENV_NAME_PATTERN.test(name)) {
      continue
    }
    parsed.set(name, entry.slice(equalsIndex + 1))
  }
  return parsed
}

function readShellEnvironment(shell: string, args: string[]) {
  return new Promise<Map<string, string> | undefined>((resolve) => {
    execFile(
      shell,
      args,
      {
        encoding: "buffer",
        env: {
          ...process.env,
          TERM: process.env.TERM || "xterm-256color",
        },
        maxBuffer: 1024 * 1024,
        timeout: SHELL_ENV_TIMEOUT_MS,
        windowsHide: true,
      },
      (error: ExecFileException | null, stdout: Buffer, stderr: Buffer) => {
        if (error) {
          writeRuntimeLog("shell-env", "warn", {
            code: error.code,
            error: error.message,
            killed: error.killed,
            signal: error.signal,
            stderr: stderr.toString("utf8").trim().slice(0, 500),
          })
          resolve(undefined)
          return
        }
        resolve(parseNullSeparatedEnv(stdout))
      }
    )
  })
}

function shouldImportShellEnv(name: string) {
  return (
    process.env[name] === undefined ||
    process.env[name] === "" ||
    name === "PATH"
  )
}

let hydrationPromise: Promise<void> | undefined

async function hydrateShellEnvironmentOnce() {
  if (process.platform !== "darwin") {
    return
  }

  const startedAt = performance.now()
  const shell = process.env.SHELL?.trim() || "/bin/zsh"
  const command = "printf '\\0'; /usr/bin/env -0"
  const shellEnv =
    (await readShellEnvironment(shell, ["-ilc", command])) ??
    (await readShellEnvironment(shell, ["-lc", command]))
  if (!shellEnv) {
    return
  }

  const importedNames: string[] = []
  for (const [name, value] of shellEnv) {
    if (!shouldImportShellEnv(name)) {
      continue
    }
    process.env[name] = value
    importedNames.push(name)
  }

  writeRuntimeLog("shell-env", "info", {
    durationMs: Math.round(performance.now() - startedAt),
    importedCount: importedNames.length,
    sensitiveEnvNames: importedNames
      .filter((name) => SENSITIVE_ENV_NAME_PATTERN.test(name))
      .sort(),
    shell,
  })
}

export function hydrateShellEnvironment() {
  hydrationPromise ??= hydrateShellEnvironmentOnce()
  return hydrationPromise
}
