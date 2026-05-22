import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session as electronSession,
  shell,
  type WebAuthnAccount,
} from "electron"
import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs"
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { env, platform } from "node:process"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"
import { build } from "esbuild"
import * as pty from "node-pty"
import { createAgentConversationModule } from "./agent-conversations.js"
import type {
  OusiaChatContext,
  OusiaChatEvent,
  OusiaChatSendPayload,
  OusiaEditorFileEntry,
  OusiaEditorListFilesPayload,
  OusiaEditorListFilesResult,
  OusiaEditorReadFilePayload,
  OusiaEditorReadFileResult,
  OusiaEditorSaveFilePayload,
  OusiaEditorSaveFileResult,
  OusiaRuntimeExtension,
  OusiaRuntimeExtensionDeletePayload,
  OusiaRuntimeExtensionDeleteResult,
  OusiaRuntimeExtensionsChangedEvent,
  OusiaRuntimeExtensionError,
  OusiaRuntimeExtensionSlot,
  OusiaRuntimeExtensionsResult,
  OusiaTerminalCreatePayload,
  OusiaTerminalCreateResult,
  OusiaTerminalDisposePayload,
  OusiaTerminalOperationResult,
  OusiaTerminalResizePayload,
  OusiaTerminalWritePayload,
} from "./chat-types.js"

const enabledTools = ["read", "write", "edit", "bash", "grep", "find", "ls"]
const browserPartition = "persist:ousia-browser"
const editorIgnoredDirs = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  ".ousia",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
])
const editorFileExtensions = new Set([
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".svelte",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
])

let mainWindow: BrowserWindow | undefined
const terminalSessions = new Map<string, pty.IPty>()
let runtimeExtensionWatchers: FSWatcher[] = []
let runtimeExtensionWatchDirs: string[] = []
let runtimeExtensionWatchDebounce: ReturnType<typeof setTimeout> | undefined
let runtimeExtensionWatchGeneration = 0
const runtimeExtensionWatchDebounceMs = 1000

function emitChatEvent(event: OusiaChatEvent, context?: OusiaChatContext) {
  mainWindow?.webContents.send(
    "ousia:chat:event",
    context ? { ...event, context } : event
  )
}

function emitWindowFullscreenState() {
  mainWindow?.webContents.send("ousia:window:fullscreen", {
    isFullscreen: mainWindow.isFullScreen(),
  })
}

const agentConversations = createAgentConversationModule({
  enabledTools,
  emitChatEvent,
})

function expandHomePath(path: string) {
  if (path === "~") {
    return homedir()
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2))
  }
  return path
}

function getRuntimeExtensionsDir() {
  return join(homedir(), ".ousia", "extensions")
}

function isPathInside(parent: string, child: string) {
  const segment = relative(parent, child)
  return segment === "" || (!segment.startsWith("..") && !isAbsolute(segment))
}

function resolveEditorProjectPath(projectPath: string) {
  const projectRoot = resolve(expandHomePath(projectPath))
  if (!projectPath.trim() || !existsSync(projectRoot)) {
    throw new Error("Select a project before opening the editor.")
  }
  return projectRoot
}

function resolveEditorFilePath(projectPath: string, filePath: string) {
  const projectRoot = resolveEditorProjectPath(projectPath)
  const absoluteFilePath = resolve(projectRoot, filePath)
  if (!isPathInside(projectRoot, absoluteFilePath)) {
    throw new Error("Editor file path must stay inside the project.")
  }
  return { absoluteFilePath, projectRoot }
}

function shouldShowEditorFile(name: string) {
  if (name === "AGENTS.md" || name === "README" || name === "Dockerfile") {
    return true
  }
  return editorFileExtensions.has(extname(name).toLowerCase())
}

function isRuntimeExtensionSlot(value: unknown): value is OusiaRuntimeExtensionSlot {
  return value === "workspace.tab"
}

async function listEditorFiles(
  payload: OusiaEditorListFilesPayload
): Promise<OusiaEditorListFilesResult> {
  const projectRoot = resolveEditorProjectPath(payload.projectPath)
  const files: OusiaEditorFileEntry[] = []
  const maxFiles = 700

  async function walk(directory: string, depth: number) {
    if (files.length >= maxFiles) {
      return
    }

    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        return
      }

      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!editorIgnoredDirs.has(entry.name) && depth < 8) {
          await walk(absolutePath, depth + 1)
        }
        continue
      }

      if (!entry.isFile() || !shouldShowEditorFile(entry.name)) {
        continue
      }

      files.push({
        path: relative(projectRoot, absolutePath),
        name: entry.name,
        depth,
        extension: extname(entry.name).slice(1).toLowerCase(),
      })
    }
  }

  await walk(projectRoot, 0)
  return { files }
}

async function readEditorFile(
  payload: OusiaEditorReadFilePayload
): Promise<OusiaEditorReadFileResult> {
  const { absoluteFilePath, projectRoot } = resolveEditorFilePath(
    payload.projectPath,
    payload.path
  )
  const fileStat = await stat(absoluteFilePath)
  if (!fileStat.isFile()) {
    throw new Error("Editor can only open files.")
  }
  if (fileStat.size > 1024 * 1024) {
    throw new Error("Editor file is larger than 1 MB.")
  }
  const content = await readFile(absoluteFilePath, "utf8")
  return {
    content,
    path: relative(projectRoot, absoluteFilePath),
  }
}

async function saveEditorFile(
  payload: OusiaEditorSaveFilePayload
): Promise<OusiaEditorSaveFileResult> {
  const { absoluteFilePath } = resolveEditorFilePath(
    payload.projectPath,
    payload.path
  )
  const fileStat = await stat(absoluteFilePath)
  if (!fileStat.isFile()) {
    throw new Error("Editor can only save files.")
  }
  await writeFile(absoluteFilePath, payload.content, "utf8")
  return { ok: true }
}

function terminalKey(context: OusiaTerminalDisposePayload) {
  return `${context.projectPath}::${context.sessionId}::${context.terminalId}`
}

function emitTerminalEvent(
  event:
    | { type: "data"; terminalId: string; data: string }
    | {
        type: "exit"
        terminalId: string
        exitCode?: number
        signal?: number
      }
    | { type: "error"; terminalId: string; message: string }
) {
  mainWindow?.webContents.send("ousia:terminal:event", event)
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

function defaultShellArgs(shellPath: string) {
  if (platform === "win32") {
    return []
  }
  if (basename(shellPath) === "zsh") {
    return ["-l"]
  }
  if (basename(shellPath) === "bash") {
    return ["-l"]
  }
  return []
}

async function createTerminal(
  payload: OusiaTerminalCreatePayload
): Promise<OusiaTerminalCreateResult> {
  const cwd = resolveEditorProjectPath(payload.projectPath)
  const key = terminalKey(payload)
  const previousTerminal = terminalSessions.get(key)
  terminalSessions.delete(key)
  previousTerminal?.kill()

  const cols = clampTerminalSize(payload.cols, 80, 500)
  const rows = clampTerminalSize(payload.rows, 24, 200)
  const shellPath = defaultShell()
  const terminalProcess = pty.spawn(shellPath, defaultShellArgs(shellPath), {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      COLORTERM: "truecolor",
      TERM: "xterm-256color",
      TERM_PROGRAM: "Ousia",
    },
  })

  terminalSessions.set(key, terminalProcess)
  terminalProcess.onData((data) => {
    if (terminalSessions.get(key) !== terminalProcess) {
      return
    }
    emitTerminalEvent({
      type: "data",
      terminalId: payload.terminalId,
      data,
    })
  })
  terminalProcess.onExit(({ exitCode, signal }) => {
    if (terminalSessions.get(key) !== terminalProcess) {
      return
    }
    terminalSessions.delete(key)
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
  terminalSessions.get(terminalKey(payload))?.write(payload.data)
  return { ok: true }
}

async function resizeTerminal(
  payload: OusiaTerminalResizePayload
): Promise<OusiaTerminalOperationResult> {
  const terminal = terminalSessions.get(terminalKey(payload))
  if (terminal) {
    terminal.resize(
      clampTerminalSize(payload.cols, terminal.cols, 500),
      clampTerminalSize(payload.rows, terminal.rows, 200)
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
    terminal.kill()
  }
  return { ok: true }
}

type RuntimeExtensionAppManifest = {
  id?: unknown
  title?: unknown
  slot?: unknown
  entry?: unknown
}

type RuntimeExtensionPackage = {
  name?: unknown
  version?: unknown
  ousia?: {
    app?: unknown
    backend?: unknown
    permissions?: unknown
  }
}

function normalizeRuntimeExtensionId(
  packageDirname: string,
  packageJson: RuntimeExtensionPackage
) {
  const id =
    typeof packageJson.name === "string" && packageJson.name.trim()
      ? packageJson.name.trim()
      : packageDirname

  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error(
      "Extension package name must contain only letters, numbers, dots, underscores, and dashes."
    )
  }

  return id
}

function normalizeRuntimeExtensionAppManifest(
  extensionId: string,
  manifest: RuntimeExtensionAppManifest
) {
  const title =
    typeof manifest.title === "string" && manifest.title.trim()
      ? manifest.title.trim()
      : extensionId
  const slot = manifest.slot ?? "workspace.tab"
  const entry =
    typeof manifest.entry === "string" && manifest.entry.trim()
      ? manifest.entry.trim()
      : "App.tsx"

  if (!isRuntimeExtensionSlot(slot)) {
    throw new Error("Only the workspace.tab runtime extension slot is supported.")
  }
  if (entry.includes("\0") || entry.startsWith("/")) {
    throw new Error("Runtime extension app entry must be a relative path.")
  }

  return {
    id: `runtime.extension.${extensionId}`,
    title,
    slot,
    entry,
  }
}

async function compileRuntimeExtensionApp(sourcePath: string) {
  const result = await build({
    entryPoints: [sourcePath],
    absWorkingDir: dirname(sourcePath),
    bundle: true,
    platform: "browser",
    external: ["react"],
    format: "cjs",
    target: "es2022",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    sourcemap: "inline",
    write: false,
  })
  const output = result.outputFiles[0]?.text
  if (!output) {
    throw new Error("Extension compilation produced no output.")
  }
  return output
}

async function loadRuntimeExtension(
  extensionsDir: string,
  packageDirname: string
): Promise<
  Array<
    | { extension: OusiaRuntimeExtension; error?: never }
    | { extension?: never; error: OusiaRuntimeExtensionError }
  >
> {
  const extensionDir = resolve(extensionsDir, packageDirname)
  const packagePath = join(extensionDir, "package.json")
  try {
    const packageJson = JSON.parse(
      await readFile(packagePath, "utf8")
    ) as RuntimeExtensionPackage
    const extensionId = normalizeRuntimeExtensionId(packageDirname, packageJson)
    const normalized = normalizeRuntimeExtensionAppManifest(
      extensionId,
      (packageJson.ousia?.app ?? {}) as RuntimeExtensionAppManifest
    )
    const sourcePath = resolve(extensionDir, normalized.entry)
    if (!isPathInside(extensionDir, sourcePath)) {
      throw new Error(
        "Runtime extension app entry must stay inside its extension directory."
      )
    }
    const code = await compileRuntimeExtensionApp(sourcePath)
    return [
      {
        extension: {
          id: normalized.id,
          title: normalized.title,
          slot: normalized.slot,
          distribution: "user-local",
          trust: "local-user",
          extensionDir,
          sourcePath,
          code,
        },
      },
    ]
  } catch (error) {
    return [
      {
        error: {
          id: `runtime.extension.${packageDirname}`,
          title: packageDirname,
          distribution: "user-local",
          trust: "local-user",
          extensionDir,
          sourcePath: existsSync(packagePath) ? packagePath : undefined,
          message: error instanceof Error ? error.message : String(error),
        },
      },
    ]
  }
}

async function loadRuntimeExtensionRoot(extensionsDir: string) {
  mkdirSync(extensionsDir, { recursive: true })
  const entries = await readdir(extensionsDir, { withFileTypes: true })
  return (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => loadRuntimeExtension(extensionsDir, entry.name))
    )
  ).flat()
}

function dedupeRuntimeExtensionResults(
  loaded: Array<
    | { extension: OusiaRuntimeExtension; error?: never }
    | { extension?: never; error: OusiaRuntimeExtensionError }
  >
) {
  const seenIds = new Set<string>()
  return loaded.filter((result) => {
    const id = result.extension?.id ?? result.error?.id
    if (!id || seenIds.has(id)) {
      return false
    }
    seenIds.add(id)
    return true
  })
}

async function listRuntimeExtensions(): Promise<OusiaRuntimeExtensionsResult> {
  const extensionsDir = getRuntimeExtensionsDir()
  const loaded = await loadRuntimeExtensionRoot(extensionsDir)
  const deduped = dedupeRuntimeExtensionResults(loaded)
  return {
    extensionsDir,
    extensionDirs: [extensionsDir],
    extensions: deduped.flatMap((result) =>
      result.extension ? [result.extension] : []
    ),
    errors: deduped.flatMap((result) => (result.error ? [result.error] : [])),
  }
}

async function deleteRuntimeExtension(
  payload: OusiaRuntimeExtensionDeletePayload
): Promise<OusiaRuntimeExtensionDeleteResult> {
  const extensionDir = resolve(payload.extensionDir)
  const extensionsDir = getRuntimeExtensionsDir()
  if (!isPathInside(extensionsDir, extensionDir)) {
    throw new Error(
      "Runtime extension directory is outside the global extension root."
    )
  }
  await rm(extensionDir, { recursive: true, force: true })
  emitRuntimeExtensionsChanged()
  return { ok: true }
}

function closeRuntimeExtensionWatchers(invalidate = true) {
  if (invalidate) {
    runtimeExtensionWatchGeneration += 1
  }
  for (const watcher of runtimeExtensionWatchers) {
    watcher.close()
  }
  runtimeExtensionWatchers = []
  runtimeExtensionWatchDirs = []
  if (runtimeExtensionWatchDebounce) {
    clearTimeout(runtimeExtensionWatchDebounce)
    runtimeExtensionWatchDebounce = undefined
  }
}

function emitRuntimeExtensionsChanged() {
  if (runtimeExtensionWatchDebounce) {
    clearTimeout(runtimeExtensionWatchDebounce)
  }
  runtimeExtensionWatchDebounce = setTimeout(() => {
    runtimeExtensionWatchDebounce = undefined
    const event: OusiaRuntimeExtensionsChangedEvent = {
      extensionDirs: runtimeExtensionWatchDirs,
    }
    mainWindow?.webContents.send("ousia:extensions:changed", event)
  }, runtimeExtensionWatchDebounceMs)
}

async function watchRuntimeExtensions(): Promise<OusiaRuntimeExtensionsResult> {
  const watchGeneration = runtimeExtensionWatchGeneration + 1
  runtimeExtensionWatchGeneration = watchGeneration
  closeRuntimeExtensionWatchers(false)

  const result = await listRuntimeExtensions()
  if (watchGeneration !== runtimeExtensionWatchGeneration) {
    return result
  }
  runtimeExtensionWatchDirs = result.extensionDirs

  for (const dir of runtimeExtensionWatchDirs) {
    if (watchGeneration !== runtimeExtensionWatchGeneration) {
      break
    }
    mkdirSync(dir, { recursive: true })
    try {
      const watcher = watch(dir, { recursive: true }, emitRuntimeExtensionsChanged)
      watcher.on("error", () => {
        watcher.close()
      })
      runtimeExtensionWatchers.push(watcher)
    } catch {
      try {
        const watcher = watch(dir, emitRuntimeExtensionsChanged)
        watcher.on("error", () => {
          watcher.close()
        })
        runtimeExtensionWatchers.push(watcher)
      } catch {
        // Runtime extension refresh stays available through the manual button.
      }
    }
  }

  return result
}

function isExternalUrl(url: string) {
  try {
    const parsed = new URL(url)
    return ["http:", "https:", "mailto:"].includes(parsed.protocol)
  } catch {
    return false
  }
}

function isAllowedWebviewUrl(url: string) {
  try {
    const parsed = new URL(url)
    return ["about:", "file:", "http:", "https:"].includes(parsed.protocol)
  } catch {
    return false
  }
}

function getWebAuthnKeychainAccessGroup() {
  const configuredGroup = env.OUSIA_WEBAUTHN_KEYCHAIN_ACCESS_GROUP?.trim()
  if (configuredGroup) {
    return configuredGroup
  }

  const teamId = env.OUSIA_APPLE_TEAM_ID?.trim() || env.APPLE_TEAM_ID?.trim()
  if (!teamId) {
    return undefined
  }

  return `${teamId}.com.ousia.desktop.webauthn`
}

function describeWebAuthnAccount(account: WebAuthnAccount) {
  return (
    account.displayName ||
    account.name ||
    account.userHandle ||
    account.credentialId
  )
}

function configureBrowserWebAuthn() {
  const browserSession = electronSession.fromPartition(browserPartition)

  browserSession.on(
    "select-webauthn-account",
    async (_event, details, callback) => {
      try {
        if (details.accounts.length === 0) {
          callback()
          return
        }

        if (details.accounts.length === 1) {
          callback(details.accounts[0].credentialId)
          return
        }

        const buttons = details.accounts.map(describeWebAuthnAccount)
        const cancelId = buttons.length
        const result = await dialog.showMessageBox(mainWindow!, {
          type: "question",
          title: "Choose Passkey",
          message: `Choose a passkey for ${details.relyingPartyId}`,
          buttons: [...buttons, "Cancel"],
          cancelId,
          defaultId: 0,
          noLink: true,
        })

        callback(
          result.response === cancelId
            ? undefined
            : details.accounts[result.response]?.credentialId
        )
      } catch {
        callback()
      }
    }
  )

  if (platform !== "darwin") {
    return
  }

  const keychainAccessGroup = getWebAuthnKeychainAccessGroup()
  if (!keychainAccessGroup) {
    console.warn(
      "Skipping macOS WebAuthn platform authenticator: set OUSIA_WEBAUTHN_KEYCHAIN_ACCESS_GROUP or OUSIA_APPLE_TEAM_ID."
    )
    return
  }

  app.configureWebAuthn({
    touchID: {
      keychainAccessGroup,
      promptReason: "sign in to $1",
    },
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Ousia",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: "#111111",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.js"),
      webviewTag: true,
    },
  })

  mainWindow.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      delete webPreferences.preload
      webPreferences.contextIsolation = true
      webPreferences.nodeIntegration = false
      webPreferences.sandbox = true

      if (!isAllowedWebviewUrl(params.src)) {
        event.preventDefault()
      }
    }
  )

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: "deny" }
  })

  mainWindow.webContents.once("did-finish-load", emitWindowFullscreenState)
  mainWindow.on("enter-full-screen", emitWindowFullscreenState)
  mainWindow.on("leave-full-screen", emitWindowFullscreenState)
  mainWindow.on("closed", () => {
    closeRuntimeExtensionWatchers()
    mainWindow = undefined
  })

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    const indexHtml = join(
      __dirname,
      `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
    )
    if (!existsSync(indexHtml)) {
      throw new Error(`Renderer build not found: ${indexHtml}`)
    }
    await mainWindow.loadFile(indexHtml)
  }
}

ipcMain.handle("ousia:chat:send", (_event, payload: OusiaChatSendPayload) =>
  agentConversations.sendChatMessage(payload)
)

ipcMain.handle("ousia:chat:history", (_event, payload: OusiaChatContext) =>
  agentConversations.getChatHistory(payload)
)

ipcMain.handle("ousia:chat:interrupt", (_event, payload: OusiaChatContext) =>
  agentConversations.interruptChat(payload)
)

ipcMain.handle("ousia:project:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
  })
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true }
  }
  const path = result.filePaths[0]
  return {
    canceled: false,
    path,
    name: basename(path),
  }
})

ipcMain.handle(
  "ousia:editor:list-files",
  (_event, payload: OusiaEditorListFilesPayload) => listEditorFiles(payload)
)

ipcMain.handle(
  "ousia:editor:read-file",
  (_event, payload: OusiaEditorReadFilePayload) => readEditorFile(payload)
)

ipcMain.handle(
  "ousia:editor:save-file",
  (_event, payload: OusiaEditorSaveFilePayload) => saveEditorFile(payload)
)

ipcMain.handle(
  "ousia:extensions:list",
  () => listRuntimeExtensions()
)

ipcMain.handle(
  "ousia:extensions:watch",
  () => watchRuntimeExtensions()
)

ipcMain.handle("ousia:extensions:unwatch", () => {
  closeRuntimeExtensionWatchers()
})

ipcMain.handle(
  "ousia:extensions:delete",
  (_event, payload: OusiaRuntimeExtensionDeletePayload) =>
    deleteRuntimeExtension(payload)
)

ipcMain.handle(
  "ousia:terminal:create",
  (_event, payload: OusiaTerminalCreatePayload) => createTerminal(payload)
)

ipcMain.handle(
  "ousia:terminal:write",
  (_event, payload: OusiaTerminalWritePayload) => writeTerminal(payload)
)

ipcMain.handle(
  "ousia:terminal:resize",
  (_event, payload: OusiaTerminalResizePayload) => resizeTerminal(payload)
)

ipcMain.handle(
  "ousia:terminal:dispose",
  (_event, payload: OusiaTerminalDisposePayload) => disposeTerminal(payload)
)

app.whenReady().then(async () => {
  configureBrowserWebAuthn()
  await createWindow()
})

app.on("window-all-closed", () => {
  terminalSessions.forEach((terminal) => terminal.kill())
  terminalSessions.clear()
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow()
  }
})
