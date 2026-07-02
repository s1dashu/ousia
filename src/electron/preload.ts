import type {
  OusiaAppState,
  OusiaAppStateSaveResult,
  OusiaChatBranchPayload,
  OusiaChatBranchResult,
  OusiaChatClearQueueResult,
  OusiaChatCompactPayload,
  OusiaChatCompactResult,
  OusiaChatContext,
  OusiaChatEvent,
  OusiaChatContextUsageResult,
  OusiaChatExportPayload,
  OusiaChatExportResult,
  OusiaChatGenerateTitlePayload,
  OusiaChatGenerateTitleResult,
  OusiaChatHistoryPayload,
  OusiaChatHistoryResult,
  OusiaChatInterruptPayload,
  OusiaChatInterruptResult,
  OusiaChatMovePayload,
  OusiaChatMoveResult,
  OusiaChatToolPayloadPayload,
  OusiaChatToolPayloadResult,
  OusiaChatSendPayload,
  OusiaChatSendResult,
  OusiaDirectoryPickerOptions,
  OusiaModelRegistryResult,
  OusiaOpenDirectoryPayload,
  OusiaOpenDirectoryResult,
  OusiaOpenProjectResult,
  OusiaPiEnvironmentStatus,
  OusiaPiProviderCredentialPayload,
  OusiaPiProviderCredentialRemovalPayload,
  OusiaPiProviderCredentialResult,
  OusiaPiRetrySettingsPayload,
  OusiaPiRetrySettingsResult,
  OusiaSelectDirectoryResult,
  OusiaWindowFullscreenEvent,
  OusiaWindowFullscreenResult,
  OusiaWindowThemePayload,
  OusiaWindowZoomEvent,
  OusiaWindowZoomResult,
} from "./chat-types.js"

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

function errorPayload(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    }
  }
  return {
    message: String(error),
  }
}

window.addEventListener("error", (event) => {
  ipcRenderer.send("ousia:log:renderer-error", {
    colno: event.colno,
    error: errorPayload(event.error),
    filename: event.filename,
    lineno: event.lineno,
    message: event.message,
    type: "window.error",
  })
})

window.addEventListener("unhandledrejection", (event) => {
  ipcRenderer.send("ousia:log:renderer-error", {
    reason: errorPayload(event.reason),
    type: "window.unhandledrejection",
  })
})

const api = {
  loadAppState(): Promise<OusiaAppState> {
    return ipcRenderer.invoke("ousia:app-state:load")
  },
  saveAppState(payload: OusiaAppState): Promise<OusiaAppStateSaveResult> {
    return ipcRenderer.invoke("ousia:app-state:save", payload)
  },
  sendChatMessage(payload: OusiaChatSendPayload): Promise<OusiaChatSendResult> {
    return ipcRenderer.invoke("ousia:chat:send", payload)
  },
  generateChatTitle(
    payload: OusiaChatGenerateTitlePayload
  ): Promise<OusiaChatGenerateTitleResult> {
    return ipcRenderer.invoke("ousia:chat:generate-title", payload)
  },
  getChatHistory(
    payload: OusiaChatHistoryPayload
  ): Promise<OusiaChatHistoryResult> {
    return ipcRenderer.invoke("ousia:chat:history", payload)
  },
  getChatToolPayload(
    payload: OusiaChatToolPayloadPayload
  ): Promise<OusiaChatToolPayloadResult> {
    return ipcRenderer.invoke("ousia:chat:tool-payload", payload)
  },
  branchChat(payload: OusiaChatBranchPayload): Promise<OusiaChatBranchResult> {
    return ipcRenderer.invoke("ousia:chat:branch", payload)
  },
  moveChatSession(payload: OusiaChatMovePayload): Promise<OusiaChatMoveResult> {
    return ipcRenderer.invoke("ousia:chat:move", payload)
  },
  getChatContextUsage(
    payload: OusiaChatContext
  ): Promise<OusiaChatContextUsageResult> {
    return ipcRenderer.invoke("ousia:chat:context-usage", payload)
  },
  exportChat(payload: OusiaChatExportPayload): Promise<OusiaChatExportResult> {
    return ipcRenderer.invoke("ousia:chat:export", payload)
  },
  interruptChat(
    payload: OusiaChatInterruptPayload
  ): Promise<OusiaChatInterruptResult> {
    return ipcRenderer.invoke("ousia:chat:interrupt", payload)
  },
  clearChatQueue(payload: OusiaChatContext): Promise<OusiaChatClearQueueResult> {
    return ipcRenderer.invoke("ousia:chat:clear-queue", payload)
  },
  compactChat(
    payload: OusiaChatCompactPayload
  ): Promise<OusiaChatCompactResult> {
    return ipcRenderer.invoke("ousia:chat:compact", payload)
  },
  listModels(): Promise<OusiaModelRegistryResult> {
    return ipcRenderer.invoke("ousia:models:list")
  },
  checkPiEnvironment(): Promise<OusiaPiEnvironmentStatus> {
    return ipcRenderer.invoke("ousia:pi:environment")
  },
  savePiProviderCredential(
    payload: OusiaPiProviderCredentialPayload
  ): Promise<OusiaPiProviderCredentialResult> {
    return ipcRenderer.invoke("ousia:pi:provider-credential", payload)
  },
  removePiProviderCredential(
    payload: OusiaPiProviderCredentialRemovalPayload
  ): Promise<OusiaPiProviderCredentialResult> {
    return ipcRenderer.invoke("ousia:pi:provider-credential:remove", payload)
  },
  savePiRetrySettings(
    payload: OusiaPiRetrySettingsPayload
  ): Promise<OusiaPiRetrySettingsResult> {
    return ipcRenderer.invoke("ousia:pi:retry-settings", payload)
  },
  openProjectDirectory(
    options?: OusiaDirectoryPickerOptions
  ): Promise<OusiaOpenProjectResult> {
    return ipcRenderer.invoke("ousia:project:open", options)
  },
  selectDirectory(
    options?: OusiaDirectoryPickerOptions
  ): Promise<OusiaSelectDirectoryResult> {
    return ipcRenderer.invoke("ousia:directory:select", options)
  },
  openDirectoryInFinder(
    payload: OusiaOpenDirectoryPayload
  ): Promise<OusiaOpenDirectoryResult> {
    return ipcRenderer.invoke("ousia:directory:open-in-finder", payload)
  },
  getWindowFullscreenState(): Promise<OusiaWindowFullscreenResult> {
    return ipcRenderer.invoke("ousia:window:fullscreen-state")
  },
  getWindowZoomState(): Promise<OusiaWindowZoomResult> {
    return ipcRenderer.invoke("ousia:window:zoom-state")
  },
  setWindowTheme(payload: OusiaWindowThemePayload): void {
    ipcRenderer.send("ousia:window:theme", payload)
  },
  onChatEvent(callback: (event: OusiaChatEvent) => void): () => void {
    const listener = (_event: IpcRendererEvent, payload: OusiaChatEvent) =>
      callback(payload)
    ipcRenderer.on("ousia:chat:event", listener)
    return () => {
      ipcRenderer.off("ousia:chat:event", listener)
    }
  },
  onWindowFullscreenChange(
    callback: (event: OusiaWindowFullscreenEvent) => void
  ): () => void {
    const listener = (
      _event: IpcRendererEvent,
      payload: OusiaWindowFullscreenEvent
    ) => callback(payload)
    ipcRenderer.on("ousia:window:fullscreen", listener)
    return () => {
      ipcRenderer.off("ousia:window:fullscreen", listener)
    }
  },
  onWindowZoomChange(
    callback: (event: OusiaWindowZoomEvent) => void
  ): () => void {
    const listener = (_event: IpcRendererEvent, payload: OusiaWindowZoomEvent) =>
      callback(payload)
    ipcRenderer.on("ousia:window:zoom", listener)
    return () => {
      ipcRenderer.off("ousia:window:zoom", listener)
    }
  },
}

contextBridge.exposeInMainWorld("ousia", api)

export type OusiaRendererApi = typeof api
