import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions,
} from "electron"
import { mkdirSync, statSync } from "node:fs"
import { basename, resolve } from "node:path"

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
  OusiaChatMovePayload,
  OusiaChatSendPayload,
  OusiaChatToolPayloadPayload,
  OusiaDirectoryPickerOptions,
  OusiaOpenDirectoryPayload,
  OusiaOpenDirectoryResult,
  OusiaPiProviderCredentialPayload,
  OusiaPiProviderCredentialRemovalPayload,
  OusiaPiRetrySettingsPayload,
  OusiaSelectDirectoryResult,
  OusiaWindowThemePayload,
} from "./chat-types.js"
import { expandHomePath } from "./host-paths.js"
import { listPiModels } from "./model-registry.js"
import {
  checkPiEnvironment,
  removePiProviderCredential,
  savePiProviderCredential,
  savePiRetrySettings,
} from "./pi-environment.js"
import {
  installRuntimeLogger,
  OUSIA_DESKTOP_LOG_PATH,
  writeRuntimeLog,
} from "./runtime-logger.js"
import { hydrateShellEnvironment } from "./shell-environment.js"
import { createWindowHost } from "./window-host.js"

configureOusiaAppPaths()
installRuntimeLogger()
hydrateShellEnvironment()

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
    generateChatTitleWithUtilityModel(payload)
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

ipcMain.handle("ousia:chat:move", (_event, payload: OusiaChatMovePayload) =>
  agentConversations.moveChatSession(payload)
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

ipcMain.handle("ousia:models:list", () => listPiModels())

ipcMain.handle("ousia:pi:environment", () => checkPiEnvironment())

ipcMain.handle(
  "ousia:pi:provider-credential",
  (_event, payload: OusiaPiProviderCredentialPayload) =>
    savePiProviderCredential(payload)
)

ipcMain.handle(
  "ousia:pi:provider-credential:remove",
  (_event, payload: OusiaPiProviderCredentialRemovalPayload) =>
    removePiProviderCredential(payload)
)

ipcMain.handle(
  "ousia:pi:retry-settings",
  (_event, payload: OusiaPiRetrySettingsPayload) => savePiRetrySettings(payload)
)

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
  "ousia:directory:open-in-finder",
  async (
    _event,
    payload: OusiaOpenDirectoryPayload
  ): Promise<OusiaOpenDirectoryResult> => {
    const requestedPath = payload.path.trim()
    if (!requestedPath) {
      return { ok: false, error: "项目目录为空。" }
    }

    const directoryPath = resolve(expandHomePath(requestedPath))
    try {
      if (!statSync(directoryPath).isDirectory()) {
        return { ok: false, error: `不是目录：${directoryPath}` }
      }
    } catch {
      return { ok: false, error: `目录不存在：${directoryPath}` }
    }

    const error = await shell.openPath(directoryPath)
    if (error) {
      writeRuntimeLog("directory.open-in-finder", "error", {
        directoryPath,
        error,
      })
      return { ok: false, error }
    }
    return { ok: true }
  }
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

ipcMain.on("ousia:window:theme", (_event, payload: OusiaWindowThemePayload) => {
  windowHost.setWindowTheme(payload)
})

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
