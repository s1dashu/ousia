import type {
  OusiaAppState,
  OusiaAppStateSaveResult,
  OusiaBrowserAuthResponsePayload,
  OusiaBrowserBoundsPayload,
  OusiaBrowserCreatePayload,
  OusiaBrowserEvent,
  OusiaBrowserFindPayload,
  OusiaBrowserNavigatePayload,
  OusiaBrowserOperationResult,
  OusiaBrowserSelectionResult,
  OusiaBrowserStopFindPayload,
  OusiaBrowserTabPayload,
  OusiaBrowserZoomPayload,
  OusiaChatContext,
  OusiaChatEvent,
  OusiaChatGenerateTitlePayload,
  OusiaChatGenerateTitleResult,
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
  OusiaEnsureWindowWidthPayload,
  OusiaEnsureWindowWidthResult,
  OusiaExtensionStateDeletePayload,
  OusiaExtensionStateGetPayload,
  OusiaExtensionStateResult,
  OusiaExtensionStateSaveResult,
  OusiaExtensionStateSetPayload,
  OusiaModelRegistryResult,
  OusiaOpenProjectResult,
  OusiaPdfListFilesPayload,
  OusiaPdfListFilesResult,
  OusiaPdfReadFilePayload,
  OusiaPdfReadFileResult,
  OusiaPdfSaveFilePayload,
  OusiaPdfSaveFileResult,
  OusiaRuntimeExtensionDeletePayload,
  OusiaRuntimeExtensionDeleteResult,
  OusiaRuntimeExtensionsChangedEvent,
  OusiaRuntimeExtensionsResult,
  OusiaSelectDirectoryResult,
  OusiaTerminalCreatePayload,
  OusiaTerminalCreateResult,
  OusiaTerminalDisposePayload,
  OusiaTerminalEvent,
  OusiaTerminalOperationResult,
  OusiaTerminalResizePayload,
  OusiaTerminalWritePayload,
  OusiaWorkspaceAction,
  OusiaWindowFullscreenEvent,
} from "../electron/chat-types"

declare global {
  interface Window {
    ousia?: {
      loadAppState(): Promise<OusiaAppState>
      saveAppState(payload: OusiaAppState): Promise<OusiaAppStateSaveResult>
      getExtensionState(
        payload: OusiaExtensionStateGetPayload
      ): Promise<OusiaExtensionStateResult>
      setExtensionState(
        payload: OusiaExtensionStateSetPayload
      ): Promise<OusiaExtensionStateSaveResult>
      deleteExtensionState(
        payload: OusiaExtensionStateDeletePayload
      ): Promise<OusiaExtensionStateSaveResult>
      sendChatMessage(
        payload: OusiaChatSendPayload
      ): Promise<OusiaChatSendResult>
      generateChatTitle(
        payload: OusiaChatGenerateTitlePayload
      ): Promise<OusiaChatGenerateTitleResult>
      getChatHistory(payload: OusiaChatContext): Promise<OusiaChatHistoryResult>
      interruptChat(
        payload: OusiaChatContext
      ): Promise<OusiaChatInterruptResult>
      listModels(): Promise<OusiaModelRegistryResult>
      openProjectDirectory(): Promise<OusiaOpenProjectResult>
      selectDirectory(): Promise<OusiaSelectDirectoryResult>
      ensureWindowWidth(
        payload: OusiaEnsureWindowWidthPayload
      ): Promise<OusiaEnsureWindowWidthResult>
      getWindowFullscreenState(): Promise<OusiaWindowFullscreenEvent>
      listEditorFiles(
        payload: OusiaEditorListFilesPayload
      ): Promise<OusiaEditorListFilesResult>
      readEditorFile(
        payload: OusiaEditorReadFilePayload
      ): Promise<OusiaEditorReadFileResult>
      saveEditorFile(
        payload: OusiaEditorSaveFilePayload
      ): Promise<OusiaEditorSaveFileResult>
      listPdfFiles(
        payload: OusiaPdfListFilesPayload
      ): Promise<OusiaPdfListFilesResult>
      readPdfFile(
        payload: OusiaPdfReadFilePayload
      ): Promise<OusiaPdfReadFileResult>
      savePdfFile(
        payload: OusiaPdfSaveFilePayload
      ): Promise<OusiaPdfSaveFileResult>
      listRuntimeExtensions(): Promise<OusiaRuntimeExtensionsResult>
      watchRuntimeExtensions(): Promise<OusiaRuntimeExtensionsResult>
      unwatchRuntimeExtensions(): Promise<void>
      deleteRuntimeExtension(
        payload: OusiaRuntimeExtensionDeletePayload
      ): Promise<OusiaRuntimeExtensionDeleteResult>
      onRuntimeExtensionsChanged(
        callback: (event: OusiaRuntimeExtensionsChangedEvent) => void
      ): () => void
      onWorkspaceAction(callback: (event: OusiaWorkspaceAction) => void): () => void
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
      createBrowser(
        payload: OusiaBrowserCreatePayload
      ): Promise<OusiaBrowserOperationResult>
      setBrowserBounds(
        payload: OusiaBrowserBoundsPayload
      ): Promise<OusiaBrowserOperationResult>
      destroyBrowser(
        payload: OusiaBrowserTabPayload
      ): Promise<OusiaBrowserOperationResult>
      navigateBrowser(
        payload: OusiaBrowserNavigatePayload
      ): Promise<OusiaBrowserOperationResult>
      browserBack(
        payload: OusiaBrowserTabPayload
      ): Promise<OusiaBrowserOperationResult>
      browserForward(
        payload: OusiaBrowserTabPayload
      ): Promise<OusiaBrowserOperationResult>
      reloadBrowser(
        payload: OusiaBrowserTabPayload
      ): Promise<OusiaBrowserOperationResult>
      stopBrowser(
        payload: OusiaBrowserTabPayload
      ): Promise<OusiaBrowserOperationResult>
      focusBrowser(
        payload: OusiaBrowserTabPayload
      ): Promise<OusiaBrowserOperationResult>
      openBrowserExternal(
        payload: OusiaBrowserTabPayload
      ): Promise<OusiaBrowserOperationResult>
      readBrowserSelection(
        payload: OusiaBrowserTabPayload
      ): Promise<OusiaBrowserSelectionResult | null>
      findInBrowser(
        payload: OusiaBrowserFindPayload
      ): Promise<OusiaBrowserOperationResult>
      stopBrowserFind(
        payload: OusiaBrowserStopFindPayload
      ): Promise<OusiaBrowserOperationResult>
      setBrowserZoom(
        payload: OusiaBrowserZoomPayload
      ): Promise<OusiaBrowserOperationResult>
      respondToBrowserAuth(
        payload: OusiaBrowserAuthResponsePayload
      ): Promise<OusiaBrowserOperationResult>
      onBrowserEvent(callback: (event: OusiaBrowserEvent) => void): () => void
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
