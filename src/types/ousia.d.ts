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
  OusiaWindowThemePayload,
  OusiaWindowZoomEvent,
} from "../electron/chat-types"

declare global {
  interface Window {
    ousia?: {
      loadAppState(): Promise<OusiaAppState>
      saveAppSettings(
        payload: OusiaAppStateSettingsPayload
      ): Promise<OusiaAppStateTransactionResult>
      saveShellLayout(
        payload: OusiaAppStateShellLayoutPayload
      ): Promise<OusiaAppStateTransactionResult>
      saveAppSelection(
        payload: OusiaAppStateSelectionPayload
      ): Promise<OusiaAppStateTransactionResult>
      createSession(
        payload: OusiaAppStateCreateSessionPayload
      ): Promise<OusiaAppStateTransactionResult>
      deleteSession(
        payload: OusiaAppStateDeleteSessionPayload
      ): Promise<OusiaAppStateTransactionResult>
      renameSession(
        payload: OusiaAppStateRenameSessionPayload
      ): Promise<OusiaAppStateTransactionResult>
      moveSession(
        payload: OusiaAppStateMoveSessionPayload
      ): Promise<OusiaAppStateTransactionResult>
      reorderSessions(
        payload: OusiaAppStateReorderSessionsPayload
      ): Promise<OusiaAppStateTransactionResult>
      touchSession(
        payload: OusiaAppStateTouchSessionPayload
      ): Promise<OusiaAppStateTransactionResult>
      createProject(
        payload: OusiaAppStateCreateProjectPayload
      ): Promise<OusiaAppStateTransactionResult>
      deleteProject(
        payload: OusiaAppStateDeleteProjectPayload
      ): Promise<OusiaAppStateTransactionResult>
      reorderProjects(
        payload: OusiaAppStateReorderProjectsPayload
      ): Promise<OusiaAppStateTransactionResult>
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
      moveChatSession(
        payload: OusiaChatMovePayload
      ): Promise<OusiaChatMoveResult>
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
      checkPiEnvironment(): Promise<OusiaPiEnvironmentStatus>
      checkCodexEnvironment(): Promise<OusiaCodexEnvironmentStatus>
      loginCodexWithChatGPT(): Promise<OusiaCodexAuthResult>
      logoutCodex(): Promise<OusiaCodexAuthResult>
      savePiProviderCredential(
        payload: OusiaPiProviderCredentialPayload
      ): Promise<OusiaPiProviderCredentialResult>
      removePiProviderCredential(
        payload: OusiaPiProviderCredentialRemovalPayload
      ): Promise<OusiaPiProviderCredentialResult>
      savePiRetrySettings(
        payload: OusiaPiRetrySettingsPayload
      ): Promise<OusiaPiRetrySettingsResult>
      openProjectDirectory(
        options?: OusiaDirectoryPickerOptions
      ): Promise<OusiaOpenProjectResult>
      selectDirectory(
        options?: OusiaDirectoryPickerOptions
      ): Promise<OusiaSelectDirectoryResult>
      openDirectoryInFinder(
        payload: OusiaOpenDirectoryPayload
      ): Promise<OusiaOpenDirectoryResult>
      showFileInFinder(
        payload: OusiaShowFileInFinderPayload
      ): Promise<OusiaShowFileInFinderResult>
      getWindowFullscreenState(): Promise<OusiaWindowFullscreenEvent>
      getWindowZoomState(): Promise<OusiaWindowZoomEvent>
      setWindowTheme(payload: OusiaWindowThemePayload): void
      getUpdateStatus(): Promise<OusiaUpdateStatus>
      downloadUpdate(): Promise<OusiaUpdateActionResult>
      installUpdate(): Promise<OusiaUpdateActionResult>
      onUpdateStatus(callback: (status: OusiaUpdateStatus) => void): () => void
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
