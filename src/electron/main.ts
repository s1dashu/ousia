import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
} from "electron"
import { mkdirSync } from "node:fs"
import { basename } from "node:path"

import { createAgentConversationModule } from "./agent-conversations.js"
import { configureOusiaAppPaths } from "./app-paths.js"
import { loadAppState, saveAppState } from "./app-state-store.js"
import { generateChatTitleWithUtilityModel } from "./chat-title-generator.js"
import type {
  OusiaAppState,
  OusiaChatBranchPayload,
  OusiaChatCompactPayload,
  OusiaChatContext,
  OusiaChatEvent,
  OusiaChatExportPayload,
  OusiaChatGenerateTitlePayload,
  OusiaChatHistoryPayload,
  OusiaChatInterruptPayload,
  OusiaChatSendPayload,
  OusiaChatToolPayloadPayload,
  OusiaDirectoryPickerOptions,
  OusiaSelectDirectoryResult,
} from "./chat-types.js"
import { expandHomePath } from "./host-paths.js"
import { listPiModels } from "./model-registry.js"
import {
  installRuntimeLogger,
  OUSIA_DESKTOP_LOG_PATH,
  writeRuntimeLog,
} from "./runtime-logger.js"
import { createWindowHost } from "./window-host.js"

configureOusiaAppPaths()
installRuntimeLogger()

const enabledTools = ["read", "write", "edit", "bash", "grep", "find", "ls"]

let mainWindow: BrowserWindow | undefined

function emitChatEvent(event: OusiaChatEvent, context?: OusiaChatContext) {
  if (event.type === "error") {
    writeRuntimeLog("chat.event", "error", { context, text: event.text })
  }
  mainWindow?.webContents.send(
    "ousia:chat:event",
    context ? { ...event, context } : event
  )
}

const agentConversations = createAgentConversationModule({
  enabledTools,
  emitChatEvent,
})

const windowHost = createWindowHost({
  onClosed() {},
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

ipcMain.handle("ousia:chat:history", (_event, payload: OusiaChatHistoryPayload) =>
  agentConversations.getChatHistory(payload)
)

ipcMain.handle(
  "ousia:chat:tool-payload",
  (_event, payload: OusiaChatToolPayloadPayload) =>
    agentConversations.getChatToolPayload(payload)
)

ipcMain.handle("ousia:chat:branch", (_event, payload: OusiaChatBranchPayload) =>
  agentConversations.branchChat(payload)
)

ipcMain.handle(
  "ousia:chat:context-usage",
  (_event, payload: OusiaChatContext) =>
    agentConversations.getContextUsage(payload)
)

ipcMain.handle(
  "ousia:chat:export",
  async (_event, payload: OusiaChatExportPayload) => {
    const extensions = {
      markdown: ["md"],
      jsonl: ["jsonl"],
    }[payload.format]
    const defaultPath = `${basename(payload.sessionId || "chat")}.${extensions[0]}`
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, {
          defaultPath,
          filters: [{ name: payload.format.toUpperCase(), extensions }],
        })
      : await dialog.showSaveDialog({
          defaultPath,
          filters: [{ name: payload.format.toUpperCase(), extensions }],
        })
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true }
    }
    const exportResult = await agentConversations.exportChat(
      payload,
      result.filePath
    )
    writeRuntimeLog(
      "chat.export",
      exportResult.ok ? "info" : "error",
      {
        format: payload.format,
        requestedPath: result.filePath,
        result: exportResult,
      }
    )
    return exportResult
  }
)

ipcMain.handle("ousia:chat:interrupt", (_event, payload: OusiaChatInterruptPayload) =>
  agentConversations.interruptChat(payload)
)

ipcMain.handle("ousia:chat:clear-queue", (_event, payload: OusiaChatContext) =>
  agentConversations.clearChatQueue(payload)
)

ipcMain.handle("ousia:chat:compact", (_event, payload: OusiaChatCompactPayload) =>
  agentConversations.compactChat(payload)
)

ipcMain.handle("ousia:models:list", () => listPiModels(app.getPath("userData")))

async function selectDirectory(
  pickerOptions: OusiaDirectoryPickerOptions = {}
): Promise<OusiaSelectDirectoryResult> {
  const defaultPath = pickerOptions.defaultPath?.trim()
    ? expandHomePath(pickerOptions.defaultPath)
    : undefined
  if (defaultPath) {
    mkdirSync(defaultPath, { recursive: true })
  }
  const options: OpenDialogOptions = {
    ...(defaultPath ? { defaultPath } : {}),
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

ipcMain.handle(
  "ousia:directory:select",
  (_event, options?: OusiaDirectoryPickerOptions) => selectDirectory(options)
)

ipcMain.handle(
  "ousia:project:open",
  async (_event, options?: OusiaDirectoryPickerOptions) => {
    const result = await selectDirectory(options)
    if (result.canceled) {
      return result
    }
    const path = result.path
    return {
      canceled: false,
      path,
      name: basename(path),
    }
  }
)

ipcMain.handle("ousia:window:fullscreen-state", () =>
  windowHost.getWindowFullscreenState()
)

ipcMain.handle("ousia:window:zoom-state", () => windowHost.getWindowZoomState())

ipcMain.handle("ousia:app-state:load", () => loadAppState())

ipcMain.handle("ousia:app-state:save", (_event, payload: OusiaAppState) =>
  saveAppState(payload)
)

ipcMain.on("ousia:log:renderer-error", (_event, payload: unknown) => {
  writeRuntimeLog("renderer.error", "error", payload)
})

app.whenReady().then(async () => {
  writeRuntimeLog("main", "info", `Runtime log path: ${OUSIA_DESKTOP_LOG_PATH}`)
  writeRuntimeLog("main", "info", {
    appData: app.getPath("appData"),
    userData: app.getPath("userData"),
  })
  await windowHost.createWindow()
})

app.on("window-all-closed", () => {
  writeRuntimeLog("main", "info", "All windows closed")
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    writeRuntimeLog("main", "info", "Recreating main window after activate")
    void windowHost.createWindow()
  }
})
