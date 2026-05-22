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
      listRuntimeExtensions(): Promise<OusiaRuntimeExtensionsResult>
      watchRuntimeExtensions(): Promise<OusiaRuntimeExtensionsResult>
      unwatchRuntimeExtensions(): Promise<void>
      deleteRuntimeExtension(
        payload: OusiaRuntimeExtensionDeletePayload
      ): Promise<OusiaRuntimeExtensionDeleteResult>
      onRuntimeExtensionsChanged(
        callback: (event: OusiaRuntimeExtensionsChangedEvent) => void
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
