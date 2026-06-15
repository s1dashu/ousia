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
      getChatHistory(payload: OusiaChatContext): Promise<OusiaChatHistoryResult>
      branchChat(payload: OusiaChatBranchPayload): Promise<OusiaChatBranchResult>
      getChatContextUsage(
        payload: OusiaChatContext
      ): Promise<OusiaChatContextUsageResult>
      exportChat(payload: OusiaChatExportPayload): Promise<OusiaChatExportResult>
      interruptChat(
        payload: OusiaChatInterruptPayload
      ): Promise<OusiaChatInterruptResult>
      listModels(): Promise<OusiaModelRegistryResult>
      openProjectDirectory(): Promise<OusiaOpenProjectResult>
      selectDirectory(): Promise<OusiaSelectDirectoryResult>
      getWindowFullscreenState(): Promise<OusiaWindowFullscreenEvent>
      getWindowZoomState(): Promise<OusiaWindowZoomEvent>
      createTerminal(
        payload: OusiaTerminalCreatePayload
      ): Promise<OusiaTerminalCreateResult>
      writeTerminal(
        payload: OusiaTerminalWritePayload
      ): Promise<OusiaTerminalOperationResult>
      resizeTerminal(
        payload: OusiaTerminalResizePayload
      ): Promise<OusiaTerminalOperationResult>
      disposeTerminal(
        payload: OusiaTerminalDisposePayload
      ): Promise<OusiaTerminalOperationResult>
      onTerminalEvent(
        callback: (event: OusiaTerminalEvent) => void
      ): () => void
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
