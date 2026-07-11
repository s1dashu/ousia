import { spawn } from "node:child_process"

import { writeRuntimeLog } from "./runtime-logger.js"

const SHELL_ENV_TIMEOUT_MS = 5_000
const SHELL_ENV_MAX_BUFFER_BYTES = 1024 * 1024
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
    // An interactive login shell may enable job control and claim its
    // controlling terminal. A detached process starts a separate session, so
    // Electron dev startup cannot leave npm's foreground process group stale.
    const child = spawn(shell, args, {
      detached: true,
      env: {
        ...process.env,
        TERM: process.env.TERM || "xterm-256color",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stderrBytes = 0
    let stdoutBytes = 0
    let settled = false

    const finish = (result: Map<string, string> | undefined) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    const fail = (details: Record<string, unknown>) => {
      if (settled) {
        return
      }
      writeRuntimeLog("shell-env", "warn", {
        ...details,
        stderr: Buffer.concat(stderrChunks)
          .toString("utf8")
          .trim()
          .slice(0, 500),
      })
      child.kill("SIGTERM")
      finish(undefined)
    }
    const timeout = setTimeout(() => {
      fail({
        error: `Shell environment process timed out after ${SHELL_ENV_TIMEOUT_MS}ms`,
        killed: true,
        signal: "SIGTERM",
      })
    }, SHELL_ENV_TIMEOUT_MS)

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > SHELL_ENV_MAX_BUFFER_BYTES) {
        fail({
          error: `Shell environment output exceeded ${SHELL_ENV_MAX_BUFFER_BYTES} bytes`,
          killed: true,
          signal: "SIGTERM",
        })
        return
      }
      stdoutChunks.push(chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      const remainingBytes = 500 - stderrBytes
      if (remainingBytes > 0) {
        const retainedChunk = chunk.subarray(0, remainingBytes)
        stderrChunks.push(retainedChunk)
        stderrBytes += retainedChunk.length
      }
    })
    child.once("error", (error: NodeJS.ErrnoException) => {
      fail({
        code: error.code,
        error: error.message,
        killed: false,
      })
    })
    child.once("close", (code, signal) => {
      if (settled) {
        return
      }
      if (code !== 0) {
        fail({
          code,
          error: `Shell environment process exited with code ${String(code)}`,
          killed: signal !== null,
          signal,
        })
        return
      }
      finish(parseNullSeparatedEnv(Buffer.concat(stdoutChunks)))
    })
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
    detachedSession: true,
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
