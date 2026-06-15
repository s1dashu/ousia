import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
} from "electron"
import { basename } from "node:path"

import { createAgentConversationModule } from "./agent-conversations.js"
import { loadAppState, saveAppState } from "./app-state-store.js"
import { generateChatTitleWithUtilityModel } from "./chat-title-generator.js"
import type {
  OusiaAppState,
  OusiaChatBranchPayload,
  OusiaChatContext,
  OusiaChatEvent,
  OusiaChatExportPayload,
  OusiaChatGenerateTitlePayload,
  OusiaChatInterruptPayload,
  OusiaChatSendPayload,
  OusiaSelectDirectoryResult,
  OusiaTerminalCreatePayload,
  OusiaTerminalDisposePayload,
  OusiaTerminalResizePayload,
  OusiaTerminalWritePayload,
} from "./chat-types.js"
import { listPiModels } from "./model-registry.js"
import { createProjectTerminalModule } from "./project-terminal.js"
import {
  installRuntimeLogger,
  OUSIA_DESKTOP_LOG_PATH,
  writeRuntimeLog,
} from "./runtime-logger.js"
import { createWindowHost } from "./window-host.js"

installRuntimeLogger()

const enabledTools = ["read", "write", "edit", "bash", "grep", "find", "ls"]

let mainWindow: BrowserWindow | undefined

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
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  mainWindow?.webContents.send("ousia:terminal:event", event)
}

const agentConversations = createAgentConversationModule({
  enabledTools,
  emitChatEvent,
})

const projectTerminal = createProjectTerminalModule({ emitTerminalEvent })
const windowHost = createWindowHost({
  onClosed() {
    projectTerminal.disposeAllTerminals()
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
      html: ["html"],
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

ipcMain.handle("ousia:window:fullscreen-state", () =>
  windowHost.getWindowFullscreenState()
)

ipcMain.handle("ousia:window:zoom-state", () => windowHost.getWindowZoomState())

ipcMain.handle("ousia:app-state:load", () => loadAppState())

ipcMain.handle("ousia:app-state:save", (_event, payload: OusiaAppState) =>
  saveAppState(payload)
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

ipcMain.on("ousia:log:renderer-error", (_event, payload: unknown) => {
  writeRuntimeLog("renderer.error", "error", payload)
})

app.whenReady().then(async () => {
  writeRuntimeLog("main", "info", `Runtime log path: ${OUSIA_DESKTOP_LOG_PATH}`)
  await windowHost.createWindow()
})

app.on("window-all-closed", () => {
  writeRuntimeLog("main", "info", "All windows closed")
  projectTerminal.disposeAllTerminals()
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
