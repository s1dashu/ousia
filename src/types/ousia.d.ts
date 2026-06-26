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
  OusiaChatToolPayloadPayload,
  OusiaChatToolPayloadResult,
  OusiaChatSendPayload,
  OusiaChatSendResult,
  OusiaDirectoryPickerOptions,
  OusiaModelRegistryResult,
  OusiaOpenProjectResult,
  OusiaSelectDirectoryResult,
  OusiaWindowFullscreenEvent,
  OusiaWindowThemePayload,
  OusiaWindowZoomEvent,
} from "../electron/chat-types"

declare global {
  interface Window {
    ousia?: {
      loadAppState(): Promise<OusiaAppState>
      saveAppState(payload: OusiaAppState): Promise<OusiaAppStateSaveResult>
      sendChatMessage(
        payload: OusiaChatSendPayload
      ): Promise<OusiaChatSendResult>
      generateChatTitle(
        payload: OusiaChatGenerateTitlePayload
      ): Promise<OusiaChatGenerateTitleResult>
      getChatHistory(
        payload: OusiaChatHistoryPayload
      ): Promise<OusiaChatHistoryResult>
      getChatToolPayload(
        payload: OusiaChatToolPayloadPayload
      ): Promise<OusiaChatToolPayloadResult>
      branchChat(payload: OusiaChatBranchPayload): Promise<OusiaChatBranchResult>
      getChatContextUsage(
        payload: OusiaChatContext
      ): Promise<OusiaChatContextUsageResult>
      exportChat(payload: OusiaChatExportPayload): Promise<OusiaChatExportResult>
      interruptChat(
        payload: OusiaChatInterruptPayload
      ): Promise<OusiaChatInterruptResult>
      clearChatQueue(
        payload: OusiaChatContext
      ): Promise<OusiaChatClearQueueResult>
      compactChat(
        payload: OusiaChatCompactPayload
      ): Promise<OusiaChatCompactResult>
      listModels(): Promise<OusiaModelRegistryResult>
      openProjectDirectory(
        options?: OusiaDirectoryPickerOptions
      ): Promise<OusiaOpenProjectResult>
      selectDirectory(
        options?: OusiaDirectoryPickerOptions
      ): Promise<OusiaSelectDirectoryResult>
      getWindowFullscreenState(): Promise<OusiaWindowFullscreenEvent>
      getWindowZoomState(): Promise<OusiaWindowZoomEvent>
      setWindowTheme(payload: OusiaWindowThemePayload): void
      onChatEvent(callback: (event: OusiaChatEvent) => void): () => void
      onWindowFullscreenChange(
        callback: (event: OusiaWindowFullscreenEvent) => void
      ): () => void
      onWindowZoomChange(
        callback: (event: OusiaWindowZoomEvent) => void
      ): () => void
    }
  }
}

export {}
