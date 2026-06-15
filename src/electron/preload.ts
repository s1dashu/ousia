import type {
  OusiaAppState,
  OusiaAppStateSaveResult,
  OusiaChatBranchPayload,
  OusiaChatBranchResult,
  OusiaChatContext,
  OusiaChatEvent,
  OusiaChatContextUsageResult,
  OusiaChatExportPayload,
  OusiaChatExportResult,
  OusiaChatGenerateTitlePayload,
  OusiaChatGenerateTitleResult,
  OusiaChatHistoryResult,
  OusiaChatInterruptPayload,
  OusiaChatInterruptResult,
  OusiaChatSendPayload,
  OusiaChatSendResult,
  OusiaModelRegistryResult,
  OusiaOpenProjectResult,
  OusiaSelectDirectoryResult,
  OusiaTerminalCreatePayload,
  OusiaTerminalCreateResult,
  OusiaTerminalDisposePayload,
  OusiaTerminalEvent,
  OusiaTerminalOperationResult,
  OusiaTerminalResizePayload,
  OusiaTerminalWritePayload,
  OusiaWindowFullscreenEvent,
  OusiaWindowFullscreenResult,
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
  getChatHistory(payload: OusiaChatContext): Promise<OusiaChatHistoryResult> {
    return ipcRenderer.invoke("ousia:chat:history", payload)
  },
  branchChat(payload: OusiaChatBranchPayload): Promise<OusiaChatBranchResult> {
    return ipcRenderer.invoke("ousia:chat:branch", payload)
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
  listModels(): Promise<OusiaModelRegistryResult> {
    return ipcRenderer.invoke("ousia:models:list")
  },
  openProjectDirectory(): Promise<OusiaOpenProjectResult> {
    return ipcRenderer.invoke("ousia:project:open")
  },
  selectDirectory(): Promise<OusiaSelectDirectoryResult> {
    return ipcRenderer.invoke("ousia:directory:select")
  },
  getWindowFullscreenState(): Promise<OusiaWindowFullscreenResult> {
    return ipcRenderer.invoke("ousia:window:fullscreen-state")
  },
  getWindowZoomState(): Promise<OusiaWindowZoomResult> {
    return ipcRenderer.invoke("ousia:window:zoom-state")
  },
  createTerminal(
    payload: OusiaTerminalCreatePayload
  ): Promise<OusiaTerminalCreateResult> {
    return ipcRenderer.invoke("ousia:host:project-pty:create", payload)
  },
  writeTerminal(
    payload: OusiaTerminalWritePayload
  ): Promise<OusiaTerminalOperationResult> {
    return ipcRenderer.invoke("ousia:host:project-pty:write", payload)
  },
  resizeTerminal(
    payload: OusiaTerminalResizePayload
  ): Promise<OusiaTerminalOperationResult> {
    return ipcRenderer.invoke("ousia:host:project-pty:resize", payload)
  },
  disposeTerminal(
    payload: OusiaTerminalDisposePayload
  ): Promise<OusiaTerminalOperationResult> {
    return ipcRenderer.invoke("ousia:host:project-pty:dispose", payload)
  },
  onTerminalEvent(callback: (event: OusiaTerminalEvent) => void): () => void {
    const listener = (_event: IpcRendererEvent, payload: OusiaTerminalEvent) =>
      callback(payload)
    ipcRenderer.on("ousia:terminal:event", listener)
    return () => {
      ipcRenderer.off("ousia:terminal:event", listener)
    }
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
