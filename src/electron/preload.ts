import type {
  OusiaChatContext,
  OusiaChatEvent,
  OusiaChatHistoryResult,
  OusiaChatInterruptResult,
  OusiaChatSendPayload,
  OusiaChatSendResult,
  OusiaEditorListFilesPayload,
  OusiaEditorListFilesResult,
  OusiaEditorReadFilePayload,
  OusiaEditorReadFileResult,
  OusiaEditorSaveFilePayload,
  OusiaEditorSaveFileResult,
  OusiaOpenProjectResult,
  OusiaRuntimeExtensionDeletePayload,
  OusiaRuntimeExtensionDeleteResult,
  OusiaRuntimeExtensionsChangedEvent,
  OusiaRuntimeExtensionsResult,
  OusiaTerminalCreatePayload,
  OusiaTerminalCreateResult,
  OusiaTerminalDisposePayload,
  OusiaTerminalEvent,
  OusiaTerminalOperationResult,
  OusiaTerminalResizePayload,
  OusiaTerminalWritePayload,
  OusiaWindowFullscreenEvent,
} from "./chat-types.js"

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

const api = {
  sendChatMessage(payload: OusiaChatSendPayload): Promise<OusiaChatSendResult> {
    return ipcRenderer.invoke("ousia:chat:send", payload)
  },
  getChatHistory(payload: OusiaChatContext): Promise<OusiaChatHistoryResult> {
    return ipcRenderer.invoke("ousia:chat:history", payload)
  },
  interruptChat(payload: OusiaChatContext): Promise<OusiaChatInterruptResult> {
    return ipcRenderer.invoke("ousia:chat:interrupt", payload)
  },
  openProjectDirectory(): Promise<OusiaOpenProjectResult> {
    return ipcRenderer.invoke("ousia:project:open")
  },
  listEditorFiles(
    payload: OusiaEditorListFilesPayload
  ): Promise<OusiaEditorListFilesResult> {
    return ipcRenderer.invoke("ousia:editor:list-files", payload)
  },
  readEditorFile(
    payload: OusiaEditorReadFilePayload
  ): Promise<OusiaEditorReadFileResult> {
    return ipcRenderer.invoke("ousia:editor:read-file", payload)
  },
  saveEditorFile(
    payload: OusiaEditorSaveFilePayload
  ): Promise<OusiaEditorSaveFileResult> {
    return ipcRenderer.invoke("ousia:editor:save-file", payload)
  },
  listRuntimeExtensions(): Promise<OusiaRuntimeExtensionsResult> {
    return ipcRenderer.invoke("ousia:extensions:list")
  },
  watchRuntimeExtensions(): Promise<OusiaRuntimeExtensionsResult> {
    return ipcRenderer.invoke("ousia:extensions:watch")
  },
  unwatchRuntimeExtensions(): Promise<void> {
    return ipcRenderer.invoke("ousia:extensions:unwatch")
  },
  deleteRuntimeExtension(
    payload: OusiaRuntimeExtensionDeletePayload
  ): Promise<OusiaRuntimeExtensionDeleteResult> {
    return ipcRenderer.invoke("ousia:extensions:delete", payload)
  },
  onRuntimeExtensionsChanged(
    callback: (event: OusiaRuntimeExtensionsChangedEvent) => void
  ): () => void {
    const listener = (
      _event: IpcRendererEvent,
      payload: OusiaRuntimeExtensionsChangedEvent
    ) => callback(payload)
    ipcRenderer.on("ousia:extensions:changed", listener)
    return () => {
      ipcRenderer.off("ousia:extensions:changed", listener)
    }
  },
  createTerminal(
    payload: OusiaTerminalCreatePayload
  ): Promise<OusiaTerminalCreateResult> {
    return ipcRenderer.invoke("ousia:terminal:create", payload)
  },
  writeTerminal(
    payload: OusiaTerminalWritePayload
  ): Promise<OusiaTerminalOperationResult> {
    return ipcRenderer.invoke("ousia:terminal:write", payload)
  },
  resizeTerminal(
    payload: OusiaTerminalResizePayload
  ): Promise<OusiaTerminalOperationResult> {
    return ipcRenderer.invoke("ousia:terminal:resize", payload)
  },
  disposeTerminal(
    payload: OusiaTerminalDisposePayload
  ): Promise<OusiaTerminalOperationResult> {
    return ipcRenderer.invoke("ousia:terminal:dispose", payload)
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
}

contextBridge.exposeInMainWorld("ousia", api)

export type OusiaRendererApi = typeof api
