import type {
  OusiaAppState,
  OusiaAgentConfigurationReloadResult,
  OusiaBuiltinSystemPromptResult,
  OusiaAppStateCreateProjectPayload,
  OusiaAppStateCreateSessionPayload,
  OusiaAppStateDeleteProjectPayload,
  OusiaAppStateDeleteSessionPayload,
  OusiaAppStateSessionIdsPayload,
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
  OusiaChatEventReplaySnapshot,
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
  OusiaChatSearchPayload,
  OusiaChatSearchResult,
  OusiaSequencedChatEvent,
  OusiaCodexAuthResult,
  OusiaCodexEnvironmentStatus,
  OusiaDirectoryPickerOptions,
  OusiaGitBranchMutationPayload,
  OusiaGitBranchResult,
  OusiaGitBranchStatePayload,
  OusiaModelRegistryResult,
  OusiaOpenDirectoryPayload,
  OusiaOpenDirectoryResult,
  OusiaOpenProjectResult,
  OusiaPiEnvironmentStatus,
  OusiaPiPackageActivationResult,
  OusiaPiPackageMutationPayload,
  OusiaPiPackageMutationResult,
  OusiaPiPackageOperationProgress,
  OusiaPiPackageReloadPayload,
  OusiaPiPackageStatus,
  OusiaPiProviderCredentialPayload,
  OusiaPiProviderCredentialRemovalPayload,
  OusiaPiProviderCredentialResult,
  OusiaInstalledSkillsResult,
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
      archiveSessions(
        payload: OusiaAppStateSessionIdsPayload
      ): Promise<OusiaAppStateTransactionResult>
      restoreSessions(
        payload: OusiaAppStateSessionIdsPayload
      ): Promise<OusiaAppStateTransactionResult>
      deleteSessions(
        payload: OusiaAppStateSessionIdsPayload
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
      getGitBranches(
        payload: OusiaGitBranchStatePayload
      ): Promise<OusiaGitBranchResult>
      switchGitBranch(
        payload: OusiaGitBranchMutationPayload
      ): Promise<OusiaGitBranchResult>
      createGitBranch(
        payload: OusiaGitBranchMutationPayload
      ): Promise<OusiaGitBranchResult>
      deleteProject(
        payload: OusiaAppStateDeleteProjectPayload
      ): Promise<OusiaAppStateTransactionResult>
      reorderProjects(
        payload: OusiaAppStateReorderProjectsPayload
      ): Promise<OusiaAppStateTransactionResult>
      sendChatMessage(
        payload: OusiaChatSendPayload
      ): Promise<OusiaChatSendResult>
      reloadAgentConfiguration(): Promise<OusiaAgentConfigurationReloadResult>
      getBuiltinSystemPrompt(): Promise<OusiaBuiltinSystemPromptResult>
      generateChatTitle(
        payload: OusiaChatGenerateTitlePayload
      ): Promise<OusiaChatGenerateTitleResult>
      getChatHistory(
        payload: OusiaChatHistoryPayload
      ): Promise<OusiaChatHistoryResult>
      searchChats(
        payload: OusiaChatSearchPayload
      ): Promise<OusiaChatSearchResult>
      getActiveChatEvents(): Promise<OusiaChatEventReplaySnapshot>
      getChatToolPayload(
        payload: OusiaChatToolPayloadPayload
      ): Promise<OusiaChatToolPayloadResult>
      branchChat(
        payload: OusiaChatBranchPayload
      ): Promise<OusiaChatBranchResult>
      moveChatSession(
        payload: OusiaChatMovePayload
      ): Promise<OusiaChatMoveResult>
      getChatContextUsage(
        payload: OusiaChatContext
      ): Promise<OusiaChatContextUsageResult>
      exportChat(
        payload: OusiaChatExportPayload
      ): Promise<OusiaChatExportResult>
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
      listPiPackages(): Promise<OusiaPiPackageStatus>
      listInstalledSkills(): Promise<OusiaInstalledSkillsResult>
      installPiPackage(
        payload: OusiaPiPackageMutationPayload
      ): Promise<OusiaPiPackageMutationResult>
      removePiPackage(
        payload: OusiaPiPackageMutationPayload
      ): Promise<OusiaPiPackageMutationResult>
      onPiPackageOperationProgress(
        callback: (progress: OusiaPiPackageOperationProgress) => void
      ): () => void
      reloadPiPackages(
        payload: OusiaPiPackageReloadPayload
      ): Promise<OusiaPiPackageActivationResult>
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
      onChatEvent(
        callback: (event: OusiaSequencedChatEvent) => void
      ): () => void
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
