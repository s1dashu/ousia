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
  OusiaRuntimeWidgetsChangedEvent,
  OusiaRuntimeWidgetsPayload,
  OusiaRuntimeWidgetsResult,
  OusiaTerminalCreatePayload,
  OusiaTerminalCreateResult,
  OusiaTerminalDisposePayload,
  OusiaTerminalEvent,
  OusiaTerminalOperationResult,
  OusiaTerminalResizePayload,
  OusiaTerminalWritePayload,
  OusiaWindowFullscreenEvent,
} from "../electron/chat-types"

declare global {
  interface Window {
    ousia?: {
      sendChatMessage(
        payload: OusiaChatSendPayload
      ): Promise<OusiaChatSendResult>
      getChatHistory(payload: OusiaChatContext): Promise<OusiaChatHistoryResult>
      interruptChat(
        payload: OusiaChatContext
      ): Promise<OusiaChatInterruptResult>
      openProjectDirectory(): Promise<OusiaOpenProjectResult>
      listEditorFiles(
        payload: OusiaEditorListFilesPayload
      ): Promise<OusiaEditorListFilesResult>
      readEditorFile(
        payload: OusiaEditorReadFilePayload
      ): Promise<OusiaEditorReadFileResult>
      saveEditorFile(
        payload: OusiaEditorSaveFilePayload
      ): Promise<OusiaEditorSaveFileResult>
      listRuntimeWidgets(
        payload?: OusiaRuntimeWidgetsPayload
      ): Promise<OusiaRuntimeWidgetsResult>
      watchRuntimeWidgets(
        payload?: OusiaRuntimeWidgetsPayload
      ): Promise<OusiaRuntimeWidgetsResult>
      unwatchRuntimeWidgets(): Promise<void>
      onRuntimeWidgetsChanged(
        callback: (event: OusiaRuntimeWidgetsChangedEvent) => void
      ): () => void
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
    }
  }
}

export {}
