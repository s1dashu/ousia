import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
} from "electron"
import { basename } from "node:path"
import { env } from "node:process"

import { createAgentConversationModule } from "./agent-conversations.js"
import { loadAppState, saveAppState } from "./app-state-store.js"
import { createBrowserHost } from "./browser-host.js"
import { generateChatTitleWithUtilityModel } from "./chat-title-generator.js"
import { ousiaCliBinDir, startCliBridge } from "./cli-bridge.js"
import {
  deleteExtensionState,
  getExtensionState,
  setExtensionState,
} from "./extension-state-store.js"
import type {
  OusiaAppState,
  OusiaBrowserAuthResponsePayload,
  OusiaBrowserBoundsPayload,
  OusiaBrowserCreatePayload,
  OusiaBrowserFindPayload,
  OusiaBrowserNavigatePayload,
  OusiaBrowserStopFindPayload,
  OusiaBrowserTabPayload,
  OusiaBrowserZoomPayload,
  OusiaChatContext,
  OusiaChatEvent,
  OusiaChatGenerateTitlePayload,
  OusiaChatSendPayload,
  OusiaEditorListFilesPayload,
  OusiaEditorReadFilePayload,
  OusiaEditorSaveFilePayload,
  OusiaEnsureWindowWidthPayload,
  OusiaExtensionStateDeletePayload,
  OusiaExtensionStateGetPayload,
  OusiaExtensionStateSetPayload,
  OusiaPdfListFilesPayload,
  OusiaPdfReadFilePayload,
  OusiaPdfSaveFilePayload,
  OusiaRuntimeExtensionDeletePayload,
  OusiaRuntimeExtensionsChangedEvent,
  OusiaSelectDirectoryResult,
  OusiaTerminalCreatePayload,
  OusiaTerminalDisposePayload,
  OusiaTerminalResizePayload,
  OusiaTerminalWritePayload,
} from "./chat-types.js"
import { expandHomePath, isPathInside } from "./host-paths.js"
import { listPiModels } from "./model-registry.js"
import { createProjectFilesModule } from "./project-files.js"
import { createProjectTerminalModule } from "./project-terminal.js"
import {
  installRuntimeLogger,
  OUSIA_DESKTOP_LOG_PATH,
  writeRuntimeLog,
} from "./runtime-logger.js"
import { createRuntimeExtensionModule } from "./runtime-extensions.js"
import { createWindowHost } from "./window-host.js"

installRuntimeLogger()

const enabledTools = ["read", "write", "edit", "bash", "grep", "find", "ls"]

let mainWindow: BrowserWindow | undefined
let cliBridgeServer: Awaited<ReturnType<typeof startCliBridge>> | undefined

function installOusiaCliPath() {
  const binDir = ousiaCliBinDir()
  const currentPath = env.PATH ?? ""
  if (!currentPath.split(":").includes(binDir)) {
    env.PATH = `${binDir}:${currentPath}`
  }
}

async function ensureCliBridge() {
  if (cliBridgeServer) {
    return
  }
  cliBridgeServer = await startCliBridge({
    getMainWindow: () => mainWindow,
    expandHomePath,
    isPathInside,
  })
}

function emitChatEvent(event: OusiaChatEvent, context?: OusiaChatContext) {
  if (event.type === "error") {
    writeRuntimeLog("chat.event", "error", { context, text: event.text })
  } else if (event.type === "run_status" && event.status === "error") {
    writeRuntimeLog("chat.event", "error", { context, text: event.text })
  }
  mainWindow?.webContents.send(
    "ousia:chat:event",
    context ? { ...event, context } : event
  )
}

function emitTerminalEvent(event: unknown) {
  mainWindow?.webContents.send("ousia:terminal:event", event)
}

const agentConversations = createAgentConversationModule({
  enabledTools,
  emitChatEvent,
})

const runtimeExtensions = createRuntimeExtensionModule({
  emitRuntimeExtensionsChanged(event: OusiaRuntimeExtensionsChangedEvent) {
    mainWindow?.webContents.send("ousia:extensions:changed", event)
  },
})

const projectFiles = createProjectFilesModule()
const projectTerminal = createProjectTerminalModule({ emitTerminalEvent })
const browserHost = createBrowserHost({
  getMainWindow: () => mainWindow,
})
const windowHost = createWindowHost({
  onClosed() {
    browserHost.destroyAll()
    runtimeExtensions.closeRuntimeExtensionWatchers()
  },
  onWindowChanged(window) {
    mainWindow = window
  },
})

ipcMain.handle("ousia:chat:send", (_event, payload: OusiaChatSendPayload) =>
  agentConversations.sendChatMessage(payload)
)

ipcMain.handle(
  "ousia:chat:generate-title",
  (_event, payload: OusiaChatGenerateTitlePayload) =>
    generateChatTitleWithUtilityModel(payload, app.getPath("userData"))
)

ipcMain.handle("ousia:chat:history", (_event, payload: OusiaChatContext) =>
  agentConversations.getChatHistory(payload)
)

ipcMain.handle("ousia:chat:interrupt", (_event, payload: OusiaChatContext) =>
  agentConversations.interruptChat(payload)
)

ipcMain.handle("ousia:models:list", () => listPiModels(app.getPath("userData")))

async function selectDirectory(): Promise<OusiaSelectDirectoryResult> {
  const options: OpenDialogOptions = {
    properties: ["openDirectory", "createDirectory"],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true }
  }
  return {
    canceled: false,
    path: result.filePaths[0],
  }
}

ipcMain.handle("ousia:directory:select", () => selectDirectory())

ipcMain.handle("ousia:project:open", async () => {
  const result = await selectDirectory()
  if (result.canceled) {
    return result
  }
  const path = result.path
  return {
    canceled: false,
    path,
    name: basename(path),
  }
})

ipcMain.handle(
  "ousia:window:ensure-width",
  (_event, payload: OusiaEnsureWindowWidthPayload) =>
    windowHost.ensureWindowWidth(payload)
)

ipcMain.handle("ousia:window:fullscreen-state", () =>
  windowHost.getWindowFullscreenState()
)

ipcMain.handle("ousia:app-state:load", () => loadAppState())

ipcMain.handle("ousia:app-state:save", (_event, payload: OusiaAppState) =>
  saveAppState(payload)
)

ipcMain.handle(
  "ousia:extension-state:get",
  (_event, payload: OusiaExtensionStateGetPayload) => getExtensionState(payload)
)

ipcMain.handle(
  "ousia:extension-state:set",
  (_event, payload: OusiaExtensionStateSetPayload) => setExtensionState(payload)
)

ipcMain.handle(
  "ousia:extension-state:delete",
  (_event, payload: OusiaExtensionStateDeletePayload) =>
    deleteExtensionState(payload)
)

ipcMain.handle(
  "ousia:host:project-files:list",
  (_event, payload: OusiaEditorListFilesPayload) =>
    projectFiles.listEditorFiles(payload)
)

ipcMain.handle(
  "ousia:host:project-files:read",
  (_event, payload: OusiaEditorReadFilePayload) =>
    projectFiles.readEditorFile(payload)
)

ipcMain.handle(
  "ousia:host:project-files:save",
  (_event, payload: OusiaEditorSaveFilePayload) =>
    projectFiles.saveEditorFile(payload)
)

ipcMain.handle(
  "ousia:host:project-pdfs:list",
  (_event, payload: OusiaPdfListFilesPayload) => projectFiles.listPdfFiles(payload)
)

ipcMain.handle(
  "ousia:host:project-pdfs:read",
  (_event, payload: OusiaPdfReadFilePayload) => projectFiles.readPdfFile(payload)
)

ipcMain.handle(
  "ousia:host:project-pdfs:save",
  (_event, payload: OusiaPdfSaveFilePayload) => projectFiles.savePdfFile(payload)
)

ipcMain.handle(
  "ousia:extensions:list",
  () => runtimeExtensions.listRuntimeExtensions()
)

ipcMain.handle(
  "ousia:extensions:watch",
  () => runtimeExtensions.watchRuntimeExtensions()
)

ipcMain.handle("ousia:extensions:unwatch", () => {
  runtimeExtensions.closeRuntimeExtensionWatchers()
})

ipcMain.handle(
  "ousia:extensions:delete",
  (_event, payload: OusiaRuntimeExtensionDeletePayload) =>
    runtimeExtensions.deleteRuntimeExtension(payload)
)

ipcMain.handle(
  "ousia:host:project-pty:create",
  (_event, payload: OusiaTerminalCreatePayload) =>
    projectTerminal.createTerminal(payload)
)

ipcMain.handle(
  "ousia:host:project-pty:write",
  (_event, payload: OusiaTerminalWritePayload) =>
    projectTerminal.writeTerminal(payload)
)

ipcMain.handle(
  "ousia:host:project-pty:resize",
  (_event, payload: OusiaTerminalResizePayload) =>
    projectTerminal.resizeTerminal(payload)
)

ipcMain.handle(
  "ousia:host:project-pty:dispose",
  (_event, payload: OusiaTerminalDisposePayload) =>
    projectTerminal.disposeTerminal(payload)
)

ipcMain.handle(
  "ousia:browser:create",
  (_event, payload: OusiaBrowserCreatePayload) => browserHost.create(payload)
)

ipcMain.handle(
  "ousia:browser:set-bounds",
  (_event, payload: OusiaBrowserBoundsPayload) => browserHost.setBounds(payload)
)

ipcMain.handle("ousia:browser:destroy", (_event, payload: OusiaBrowserTabPayload) =>
  browserHost.destroy(payload)
)

ipcMain.handle(
  "ousia:browser:navigate",
  (_event, payload: OusiaBrowserNavigatePayload) => browserHost.navigate(payload)
)

ipcMain.handle("ousia:browser:back", (_event, payload: OusiaBrowserTabPayload) =>
  browserHost.goBack(payload)
)

ipcMain.handle(
  "ousia:browser:forward",
  (_event, payload: OusiaBrowserTabPayload) => browserHost.goForward(payload)
)

ipcMain.handle("ousia:browser:reload", (_event, payload: OusiaBrowserTabPayload) =>
  browserHost.reload(payload)
)

ipcMain.handle("ousia:browser:stop", (_event, payload: OusiaBrowserTabPayload) =>
  browserHost.stop(payload)
)

ipcMain.handle("ousia:browser:focus", (_event, payload: OusiaBrowserTabPayload) =>
  browserHost.focus(payload)
)

ipcMain.handle(
  "ousia:browser:open-external",
  (_event, payload: OusiaBrowserTabPayload) => browserHost.openExternal(payload)
)

ipcMain.handle(
  "ousia:browser:read-selection",
  (_event, payload: OusiaBrowserTabPayload) => browserHost.readSelection(payload)
)

ipcMain.handle("ousia:browser:find", (_event, payload: OusiaBrowserFindPayload) =>
  browserHost.find(payload)
)

ipcMain.handle(
  "ousia:browser:stop-find",
  (_event, payload: OusiaBrowserStopFindPayload) => browserHost.stopFind(payload)
)

ipcMain.handle("ousia:browser:zoom", (_event, payload: OusiaBrowserZoomPayload) =>
  browserHost.setZoom(payload)
)

ipcMain.handle(
  "ousia:browser:auth-response",
  (_event, payload: OusiaBrowserAuthResponsePayload) =>
    browserHost.respondToAuth(payload)
)

ipcMain.on("ousia:log:renderer-error", (_event, payload: unknown) => {
  writeRuntimeLog("renderer.error", "error", payload)
})

app.whenReady().then(async () => {
  writeRuntimeLog("main", "info", `Runtime log path: ${OUSIA_DESKTOP_LOG_PATH}`)
  installOusiaCliPath()
  windowHost.configureBrowserWebAuthn()
  await windowHost.createWindow()
  await ensureCliBridge()
})

app.on("window-all-closed", () => {
  writeRuntimeLog("main", "info", "All windows closed")
  cliBridgeServer?.close()
  cliBridgeServer = undefined
  projectTerminal.disposeAllTerminals()
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    writeRuntimeLog("main", "info", "Recreating main window after activate")
    void windowHost.createWindow().then(() => ensureCliBridge())
  }
})
