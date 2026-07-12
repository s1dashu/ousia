import type {
  OusiaAppState,
  OusiaAppStateCreateProjectPayload,
  OusiaAppStateCreateSessionPayload,
  OusiaAppStateDeleteProjectPayload,
  OusiaAppStateDeleteSessionPayload,
  OusiaAppStateMoveSessionPayload,
  OusiaAppStateRenameSessionPayload,
  OusiaAppStateReorderProjectsPayload,
  OusiaAppStateReorderSessionsPayload,
  OusiaAppStateSelectionPayload,
  OusiaAppStateSettingsPayload,
  OusiaAppStateShellLayoutPayload,
  OusiaAppStateTouchSessionPayload,
  OusiaAppStateTransactionResult,
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
  OusiaCodexAuthResult,
  OusiaCodexEnvironmentStatus,
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
  OusiaShowFileInFinderPayload,
  OusiaShowFileInFinderResult,
  OusiaUpdateActionResult,
  OusiaUpdateStatus,
  OusiaWindowFullscreenEvent,
  OusiaWindowFullscreenResult,
  OusiaWindowThemePayload,
  OusiaWindowZoomEvent,
  OusiaWindowZoomResult,
} from "./chat-types.js"

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import { initializeDesktopSentryRenderer } from "./sentry-renderer.js"
import { requireDesktopSentryConfig } from "./sentry-config.js"

initializeDesktopSentryRenderer(
  requireDesktopSentryConfig(__DESKTOP_SENTRY_CONFIG__),
  "preload"
)

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

let lastActivitySentAt = 0
function reportActivity() {
  const now = Date.now()
  if (now - lastActivitySentAt < 30_000) return
  lastActivitySentAt = now
  ipcRenderer.send("ousia:update:activity")
}
window.addEventListener("focus", reportActivity)
window.addEventListener("keydown", reportActivity, { capture: true })
window.addEventListener("pointerdown", reportActivity, { capture: true })

const api = {
  loadAppState(): Promise<OusiaAppState> {
    return ipcRenderer.invoke("ousia:app-state:load")
  },
  saveAppSettings(
    payload: OusiaAppStateSettingsPayload
  ): Promise<OusiaAppStateTransactionResult> {
    return ipcRenderer.invoke("ousia:app-state:settings:save", payload)
  },
  saveShellLayout(
    payload: OusiaAppStateShellLayoutPayload
  ): Promise<OusiaAppStateTransactionResult> {
    return ipcRenderer.invoke("ousia:app-state:shell-layout:save", payload)
  },
  saveAppSelection(
    payload: OusiaAppStateSelectionPayload
  ): Promise<OusiaAppStateTransactionResult> {
    return ipcRenderer.invoke("ousia:app-state:selection:save", payload)
  },
  createSession(
    payload: OusiaAppStateCreateSessionPayload
  ): Promise<OusiaAppStateTransactionResult> {
    return ipcRenderer.invoke("ousia:app-state:session:create", payload)
  },
  deleteSession(
    payload: OusiaAppStateDeleteSessionPayload
  ): Promise<OusiaAppStateTransactionResult> {
    return ipcRenderer.invoke("ousia:app-state:session:delete", payload)
  },
  renameSession(
    payload: OusiaAppStateRenameSessionPayload
  ): Promise<OusiaAppStateTransactionResult> {
    return ipcRenderer.invoke("ousia:app-state:session:rename", payload)
  },
  moveSession(
    payload: OusiaAppStateMoveSessionPayload
  ): Promise<OusiaAppStateTransactionResult> {
    return ipcRenderer.invoke("ousia:app-state:session:move", payload)
  },
  reorderSessions(
    payload: OusiaAppStateReorderSessionsPayload
  ): Promise<OusiaAppStateTransactionResult> {
    return ipcRenderer.invoke("ousia:app-state:sessions:reorder", payload)
  },
  touchSession(
    payload: OusiaAppStateTouchSessionPayload
  ): Promise<OusiaAppStateTransactionResult> {
    return ipcRenderer.invoke("ousia:app-state:session:touch", payload)
  },
  createProject(
    payload: OusiaAppStateCreateProjectPayload
  ): Promise<OusiaAppStateTransactionResult> {
    return ipcRenderer.invoke("ousia:app-state:project:create", payload)
  },
  deleteProject(
    payload: OusiaAppStateDeleteProjectPayload
  ): Promise<OusiaAppStateTransactionResult> {
    return ipcRenderer.invoke("ousia:app-state:project:delete", payload)
  },
  reorderProjects(
    payload: OusiaAppStateReorderProjectsPayload
  ): Promise<OusiaAppStateTransactionResult> {
    return ipcRenderer.invoke("ousia:app-state:projects:reorder", payload)
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
  checkCodexEnvironment(): Promise<OusiaCodexEnvironmentStatus> {
    return ipcRenderer.invoke("ousia:codex:environment")
  },
  loginCodexWithChatGPT(): Promise<OusiaCodexAuthResult> {
    return ipcRenderer.invoke("ousia:codex:login")
  },
  logoutCodex(): Promise<OusiaCodexAuthResult> {
    return ipcRenderer.invoke("ousia:codex:logout")
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
  showFileInFinder(
    payload: OusiaShowFileInFinderPayload
  ): Promise<OusiaShowFileInFinderResult> {
    return ipcRenderer.invoke("ousia:file:show-in-finder", payload)
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
  getUpdateStatus(): Promise<OusiaUpdateStatus> {
    return ipcRenderer.invoke("ousia:update:status")
  },
  downloadUpdate(): Promise<OusiaUpdateActionResult> {
    return ipcRenderer.invoke("ousia:update:download")
  },
  installUpdate(): Promise<OusiaUpdateActionResult> {
    return ipcRenderer.invoke("ousia:update:install")
  },
  onUpdateStatus(callback: (status: OusiaUpdateStatus) => void): () => void {
    const listener = (_event: IpcRendererEvent, payload: OusiaUpdateStatus) =>
      callback(payload)
    ipcRenderer.on("ousia:update:status", listener)
    return () => ipcRenderer.off("ousia:update:status", listener)
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
