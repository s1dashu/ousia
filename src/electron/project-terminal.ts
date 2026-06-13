import { basename } from "node:path"
import { platform } from "node:process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import * as pty from "node-pty"

import type {
  OusiaTerminalCreatePayload,
  OusiaTerminalCreateResult,
  OusiaTerminalDisposePayload,
  OusiaTerminalOperationResult,
  OusiaTerminalResizePayload,
  OusiaTerminalWritePayload,
} from "./chat-types.js"
import { resolveProjectRoot } from "./host-paths.js"

type TerminalEvent =
  | { type: "data"; terminalId: string; data: string }
  | {
      type: "exit"
      terminalId: string
      exitCode?: number
      signal?: number
    }
  | { type: "error"; terminalId: string; message: string }

type ProjectTerminalModuleOptions = {
  emitTerminalEvent: (event: TerminalEvent) => void
}

type TerminalSession = {
  cleanup: (mode?: TerminalCleanupMode) => void
  process: pty.IPty
}

type TerminalCleanupMode = "defer" | "now"

const deferredTerminalTempDirs = new Set<string>()

function removeTerminalTempDir(tempDir: string) {
  try {
    rmSync(tempDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    })
  } catch {
    // Temporary terminal bootstrap files are best-effort cleanup.
  }
}

function cleanupDeferredTerminalTempDirs() {
  for (const tempDir of deferredTerminalTempDirs) {
    removeTerminalTempDir(tempDir)
  }
  deferredTerminalTempDirs.clear()
}

function terminalKey(context: OusiaTerminalDisposePayload) {
  return `${context.projectPath}::${context.sessionId}::${context.terminalId}`
}

function clampTerminalSize(value: number, fallback: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.min(Math.max(Math.floor(value), 2), max)
}

function defaultShell() {
  if (platform === "win32") {
    return process.env.COMSPEC || "powershell.exe"
  }
  return process.env.SHELL || "/bin/zsh"
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function zshDoubleQuote(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", "\\$")
    .replaceAll("`", "\\`")
}

function terminalResourceRoot() {
  const packagedRoot = join(process.resourcesPath, "terminal")
  if (existsSync(packagedRoot)) {
    return packagedRoot
  }

  return join(process.cwd(), "src/features/terminal/resources")
}

function bundledStarshipBinDir() {
  if (platform === "win32") {
    return null
  }

  const binName = "starship"
  const binDir = join(
    terminalResourceRoot(),
    "vendor/starship",
    `${platform}-${process.arch}`
  )
  const binPath = join(binDir, binName)

  if (!existsSync(binPath)) {
    return null
  }

  try {
    chmodSync(binPath, 0o755)
  } catch {
    // Packaged apps may expose read-only resources; use existing permissions.
  }

  return binDir
}

function createShellLaunch(shellPath: string, cwd: string) {
  if (platform === "win32") {
    return { args: [] as string[], cleanup: () => {}, env: {} }
  }

  const shellName = basename(shellPath)
  const tempDir = mkdtempSync(join(tmpdir(), "ousia-terminal-"))
  const cleanup = (mode: TerminalCleanupMode = "defer") => {
    if (mode === "defer") {
      deferredTerminalTempDirs.add(tempDir)
      return
    }
    removeTerminalTempDir(tempDir)
  }
  const projectName = basename(cwd) || "project"
  const quotedProjectName = shellQuote(projectName)
  const zshProjectName = zshDoubleQuote(projectName)
  const starshipConfigPath = join(tempDir, "starship.toml")
  const starshipPresetPath = join(
    terminalResourceRoot(),
    "presets/plain-text-symbols.toml"
  )
  const starshipBinDir = bundledStarshipBinDir()
  const pathEnv = starshipBinDir
    ? `${starshipBinDir}${delimiter}${process.env.PATH ?? ""}`
    : undefined

  const starshipPresetCommand = [
    `export OUSIA_TERMINAL=1`,
    `export STARSHIP_CONFIG=${shellQuote(starshipConfigPath)}`,
    ...(starshipBinDir
      ? [`export PATH=${shellQuote(starshipBinDir)}:"$PATH"`]
      : []),
  ]

  if (existsSync(starshipPresetPath)) {
    copyFileSync(starshipPresetPath, starshipConfigPath)
  }

  if (shellName === "zsh") {
    writeFileSync(
      join(tempDir, ".zshenv"),
      `[[ -r "$HOME/.zshenv" ]] && source "$HOME/.zshenv"\n`
    )
    writeFileSync(
      join(tempDir, ".zprofile"),
      `[[ -r "$HOME/.zprofile" ]] && source "$HOME/.zprofile"\n`
    )
    writeFileSync(
      join(tempDir, ".zshrc"),
      [
        `[[ -r "$HOME/.zshrc" ]] && source "$HOME/.zshrc"`,
        ``,
      ].join("\n")
    )
    writeFileSync(
      join(tempDir, ".zlogin"),
      [
        `[[ -r "$HOME/.zlogin" ]] && source "$HOME/.zlogin"`,
        ...starshipPresetCommand,
        `precmd_functions=()`,
        `preexec_functions=()`,
        `if command -v starship >/dev/null 2>&1; then`,
        `  eval "$(starship init zsh)"`,
        `else`,
        `  PROMPT="%F{green}${zshProjectName}%f %F{blue}%~%f %# "`,
        `fi`,
        `RPROMPT=""`,
        `RPS1=""`,
        ``,
      ].join("\n")
    )

    return {
      args: ["-l"],
      cleanup,
      env: {
        OUSIA_TERMINAL: "1",
        ...(pathEnv ? { PATH: pathEnv } : {}),
        STARSHIP_CONFIG: starshipConfigPath,
        ZDOTDIR: tempDir,
      },
    }
  }

  if (shellName === "bash") {
    const bashRcPath = join(tempDir, "bashrc")
    writeFileSync(
      bashRcPath,
      [
        `[[ -r "$HOME/.bash_profile" ]] && source "$HOME/.bash_profile"`,
        `[[ -r "$HOME/.bash_login" ]] && source "$HOME/.bash_login"`,
        `[[ -r "$HOME/.profile" ]] && source "$HOME/.profile"`,
        `[[ -r "$HOME/.bashrc" ]] && source "$HOME/.bashrc"`,
        ...starshipPresetCommand,
        `if command -v starship >/dev/null 2>&1; then`,
        `  eval "$(starship init bash)"`,
        `else`,
        `  PROMPT_COMMAND=`,
        `  PS1=${shellQuote(`${projectName} \\w \\$ `)}`,
        `fi`,
        ``,
      ].join("\n")
    )

    return {
      args: ["--rcfile", bashRcPath, "-i"],
      cleanup,
      env: {
        OUSIA_TERMINAL: "1",
        ...(pathEnv ? { PATH: pathEnv } : {}),
        STARSHIP_CONFIG: starshipConfigPath,
      },
    }
  }

  if (shellName === "fish") {
    const fishConfigDir = join(tempDir, "fish")
    const fishConfigPath = join(fishConfigDir, "config.fish")
    mkdirSync(fishConfigDir, { recursive: true })
    writeFileSync(
      fishConfigPath,
      [
        `test -r "$HOME/.config/fish/config.fish"; and source "$HOME/.config/fish/config.fish"`,
        `set -gx OUSIA_TERMINAL 1`,
        `set -gx STARSHIP_CONFIG ${shellQuote(starshipConfigPath)}`,
        ...(starshipBinDir
          ? [`set -gx PATH ${shellQuote(starshipBinDir)} $PATH`]
          : []),
        `if command -v starship >/dev/null 2>&1`,
        `  starship preset plain-text-symbols -o "$STARSHIP_CONFIG" >/dev/null 2>&1`,
        `  starship init fish | source`,
        `else`,
        `  functions -e fish_prompt 2>/dev/null`,
        `  function fish_prompt`,
        `    set_color green`,
        `    echo -n ${quotedProjectName}`,
        `    set_color normal`,
        `    echo -n " "`,
        `    set_color blue`,
        `    echo -n (prompt_pwd)`,
        `    set_color normal`,
        `    echo -n " > "`,
        `  end`,
        `end`,
        ``,
      ].join("\n")
    )

    return {
      args: [],
      cleanup,
      env: {
        OUSIA_TERMINAL: "1",
        ...(pathEnv ? { PATH: pathEnv } : {}),
        STARSHIP_CONFIG: starshipConfigPath,
        XDG_CONFIG_HOME: tempDir,
      },
    }
  }

  cleanup("now")
  return { args: [] as string[], cleanup: () => {}, env: {} }
}

export function createProjectTerminalModule({
  emitTerminalEvent,
}: ProjectTerminalModuleOptions) {
  const terminalSessions = new Map<string, TerminalSession>()

  async function createTerminal(
    payload: OusiaTerminalCreatePayload
  ): Promise<OusiaTerminalCreateResult> {
    const cwd = resolveProjectRoot(payload.projectPath)
    const key = terminalKey(payload)
    const previousSession = terminalSessions.get(key)
    terminalSessions.delete(key)
    previousSession?.process.kill()
    previousSession?.cleanup()

    const cols = clampTerminalSize(payload.cols, 80, 500)
    const rows = clampTerminalSize(payload.rows, 24, 200)
    const shellPath = defaultShell()
    const shellLaunch = createShellLaunch(shellPath, cwd)
    const terminalProcess = pty.spawn(shellPath, shellLaunch.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        COLORTERM: "truecolor",
        TERM: "xterm-256color",
        TERM_PROGRAM: "Ousia",
        TERM_PROGRAM_VERSION: process.env.npm_package_version || "0.0.0",
        ...shellLaunch.env,
      },
    })

    terminalSessions.set(key, {
      cleanup: shellLaunch.cleanup,
      process: terminalProcess,
    })
    terminalProcess.onData((data) => {
      if (terminalSessions.get(key)?.process !== terminalProcess) {
        return
      }
      emitTerminalEvent({
        type: "data",
        terminalId: payload.terminalId,
        data,
      })
    })
    terminalProcess.onExit(({ exitCode, signal }) => {
      const session = terminalSessions.get(key)
      if (session?.process !== terminalProcess) {
        return
      }
      terminalSessions.delete(key)
      session.cleanup()
      emitTerminalEvent({
        type: "exit",
        terminalId: payload.terminalId,
        exitCode,
        signal,
      })
    })

    return { terminalId: payload.terminalId }
  }

  async function writeTerminal(
    payload: OusiaTerminalWritePayload
  ): Promise<OusiaTerminalOperationResult> {
    terminalSessions.get(terminalKey(payload))?.process.write(payload.data)
    return { ok: true }
  }

  async function resizeTerminal(
    payload: OusiaTerminalResizePayload
  ): Promise<OusiaTerminalOperationResult> {
    const terminal = terminalSessions.get(terminalKey(payload))
    if (terminal) {
      terminal.process.resize(
        clampTerminalSize(payload.cols, terminal.process.cols, 500),
        clampTerminalSize(payload.rows, terminal.process.rows, 200)
      )
    }
    return { ok: true }
  }

  async function disposeTerminal(
    payload: OusiaTerminalDisposePayload
  ): Promise<OusiaTerminalOperationResult> {
    const key = terminalKey(payload)
    const terminal = terminalSessions.get(key)
    if (terminal) {
      terminalSessions.delete(key)
      terminal.process.kill()
      terminal.cleanup()
    }
    return { ok: true }
  }

  function disposeAllTerminals() {
    terminalSessions.forEach((terminal) => {
      terminal.process.kill()
      terminal.cleanup("now")
    })
    terminalSessions.clear()
    cleanupDeferredTerminalTempDirs()
  }

  return {
    createTerminal,
    disposeAllTerminals,
    disposeTerminal,
    resizeTerminal,
    writeTerminal,
  }
}
