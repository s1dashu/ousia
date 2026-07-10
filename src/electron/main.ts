import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions,
} from "electron"
import { mkdirSync, statSync } from "node:fs"
import { basename, isAbsolute, resolve } from "node:path"

import {
  createAgentProviderRouter,
  resolveCanonicalAgentContext,
  type AgentConversationProvider,
} from "./agent-provider-router.js"
import { configureOusiaAppPaths } from "./app-paths.js"
import {
  createAppStateProject,
  createAppStateSession,
  deleteAppStateProject,
  deleteAppStateSession,
  loadAppState,
  moveAppStateSession,
  renameAppStateSession,
  reorderAppStateProjects,
  reorderAppStateSessions,
  saveAppStateSelection,
  saveAppStateSettings,
  saveAppStateShellLayout,
  touchAppStateSession,
} from "./app-state-store.js"
import { createCodexAgentProvider } from "./codex-agent-provider.js"
import { createChatEventBatcher } from "./chat-event-batcher.js"
import type {
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
  OusiaChatCompactPayload,
  OusiaChatContext,
  OusiaChatEvent,
  OusiaChatExportPayload,
  OusiaChatGenerateTitlePayload,
  OusiaChatHistoryPayload,
  OusiaChatInterruptPayload,
  OusiaChatMovePayload,
  OusiaChatSendPayload,
  OusiaChatToolPayloadPayload,
  OusiaDirectoryPickerOptions,
  OusiaOpenDirectoryPayload,
  OusiaOpenDirectoryResult,
  OusiaPiProviderCredentialPayload,
  OusiaPiProviderCredentialRemovalPayload,
  OusiaPiRetrySettingsPayload,
  OusiaSelectDirectoryResult,
  OusiaShowFileInFinderPayload,
  OusiaShowFileInFinderResult,
  OusiaSessionRecord,
  OusiaWindowThemePayload,
} from "./chat-types.js"
import { expandHomePath, resolveProjectFilePath } from "./host-paths.js"
import {
  installRuntimeLogger,
  OUSIA_DESKTOP_LOG_PATH,
  writeRuntimeLog,
} from "./runtime-logger.js"
import { hydrateShellEnvironment } from "./shell-environment.js"
import { createWindowHost } from "./window-host.js"

configureOusiaAppPaths()
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (hasSingleInstanceLock) {
  installRuntimeLogger()
} else {
  app.quit()
}
const shellEnvironmentReady = hasSingleInstanceLock
  ? hydrateShellEnvironment()
  : Promise.resolve()

const enabledTools = ["read", "write", "edit", "bash", "grep", "find", "ls"]

let mainWindow: BrowserWindow | undefined

const chatEventBatcher = createChatEventBatcher<ReturnType<typeof setTimeout>>({
  cancel: (handle) => globalThis.clearTimeout(handle),
  emit(event, context) {
    mainWindow?.webContents.send(
      "ousia:chat:event",
      context ? { ...event, context } : event
    )
  },
  schedule: (callback) => globalThis.setTimeout(callback, 16),
})

function emitChatEvent(event: OusiaChatEvent, context?: OusiaChatContext) {
  if (event.type === "error") {
    writeRuntimeLog("chat.event", "error", { context, text: event.text })
  }
  chatEventBatcher.enqueue(event, context)
}

const codexAgentProvider = createCodexAgentProvider({
  clientVersion: app.getVersion(),
  emitChatEvent,
  openExternal: (url: string) => shell.openExternal(url),
})

function createDeferredAgentProvider(
  load: () => Promise<AgentConversationProvider>
): AgentConversationProvider {
  let providerPromise: Promise<AgentConversationProvider> | undefined
  const getProvider = () => (providerPromise ??= load())

  return {
    async dispose() {
      if (providerPromise) {
        await (await providerPromise).dispose?.()
      }
    },
    async branchChat(payload) {
      return (await getProvider()).branchChat(payload)
    },
    async clearChatQueue(context) {
      return (await getProvider()).clearChatQueue(context)
    },
    async compactChat(payload) {
      return (await getProvider()).compactChat(payload)
    },
    async exportChat(payload, outputPath) {
      return (await getProvider()).exportChat(payload, outputPath)
    },
    async getContextUsage(context) {
      return (await getProvider()).getContextUsage(context)
    },
    async getChatHistory(payload) {
      return (await getProvider()).getChatHistory(payload)
    },
    async getChatToolPayload(payload) {
      return (await getProvider()).getChatToolPayload(payload)
    },
    async interruptChat(payload) {
      return (await getProvider()).interruptChat(payload)
    },
    async moveChatSession(payload) {
      return (await getProvider()).moveChatSession(payload)
    },
    async releaseChatSession(context) {
      if (providerPromise) {
        await (await providerPromise).releaseChatSession?.(context)
      }
    },
    async sendChatMessage(payload) {
      return (await getProvider()).sendChatMessage(payload)
    },
  }
}

const piAgentConversations = createDeferredAgentProvider(async () => {
  await shellEnvironmentReady
  const { createAgentConversationModule } =
    await import("./agent-conversations.js")
  return createAgentConversationModule({ enabledTools, emitChatEvent })
})
const routedCodexAgentProvider = createDeferredAgentProvider(async () => {
  await shellEnvironmentReady
  return codexAgentProvider
})
const agentConversations = createAgentProviderRouter({
  codex: routedCodexAgentProvider,
  pi: piAgentConversations,
})

function removedSessionProjectPath(
  result: Extract<OusiaAppStateTransactionResult, { ok: true }>,
  session: OusiaSessionRecord
) {
  if (!session.projectId) {
    return result.state.settings.defaultWorkDir
  }
  const retainedProject = result.state.projects.find(
    (project) => project.id === session.projectId
  )
  if (retainedProject) {
    return retainedProject.path
  }
  if (result.project?.id === session.projectId) {
    return result.project.path
  }
  throw new Error(
    `Removed session references an unknown project: ${session.projectId}`
  )
}

async function releaseRemovedAgentSessions(
  result: OusiaAppStateTransactionResult
) {
  if (!result.ok || !result.removedSessions?.length) {
    return result
  }
  await Promise.all(
    result.removedSessions.map(async (session) => {
      try {
        const provider =
          session.agentProvider === "codex"
            ? codexAgentProvider
            : piAgentConversations
        await provider.releaseChatSession?.({
          projectPath: removedSessionProjectPath(result, session),
          sessionId: session.id,
        })
      } catch (error) {
        // The state deletion is already durable, so cleanup failures are
        // observable without misreporting the completed transaction.
        writeRuntimeLog("agent.release", "error", {
          agentProvider: session.agentProvider,
          error: error instanceof Error ? error.message : String(error),
          sessionId: session.id,
        })
      }
    })
  )
  return result
}

let piEnvironmentModulePromise:
  | Promise<typeof import("./pi-environment.js")>
  | undefined
let piModelRegistryModulePromise:
  | Promise<typeof import("./model-registry.js")>
  | undefined
let piTitleGeneratorModulePromise:
  | Promise<typeof import("./chat-title-generator.js")>
  | undefined

async function loadPiEnvironmentModule() {
  await shellEnvironmentReady
  return (piEnvironmentModulePromise ??= import("./pi-environment.js"))
}

async function loadPiModelRegistryModule() {
  await shellEnvironmentReady
  return (piModelRegistryModulePromise ??= import("./model-registry.js"))
}

async function loadPiTitleGeneratorModule() {
  await shellEnvironmentReady
  return (piTitleGeneratorModulePromise ??= import("./chat-title-generator.js"))
}

const windowHost = createWindowHost({
  onClosed() {},
  onWindowChanged(window) {
    mainWindow = window
  },
})

let mainWindowCreationPromise: Promise<void> | undefined

function focusMainWindow() {
  const window = windowHost.getMainWindow()
  if (!window || window.isDestroyed()) {
    return
  }
  if (window.isMinimized()) {
    window.restore()
  }
  window.show()
  window.focus()
}

function ensureMainWindow({ focus = false } = {}) {
  const existingWindow = windowHost.getMainWindow()
  if (existingWindow && !existingWindow.isDestroyed()) {
    if (focus) {
      focusMainWindow()
    }
    return Promise.resolve()
  }

  mainWindowCreationPromise ??= app
    .whenReady()
    .then(() => windowHost.createWindow())
    .finally(() => {
      mainWindowCreationPromise = undefined
    })
  return mainWindowCreationPromise.then(() => {
    if (focus) {
      focusMainWindow()
    }
  })
}

ipcMain.handle("ousia:chat:send", (_event, payload: OusiaChatSendPayload) =>
  agentConversations.sendChatMessage(payload)
)

ipcMain.handle(
  "ousia:chat:generate-title",
  async (_event, payload: OusiaChatGenerateTitlePayload) => {
    const route = await resolveCanonicalAgentContext(payload)
    if (payload.agentProvider !== route.agentProvider) {
      writeRuntimeLog("agent.context", "warn", {
        message: "Rejected title generation provider mismatch",
        canonicalAgentProvider: route.agentProvider,
        requestedAgentProvider: payload.agentProvider,
        sessionId: payload.sessionId,
      })
      throw new Error(
        `Agent provider mismatch for session: ${payload.sessionId}`
      )
    }
    const canonicalPayload = {
      ...payload,
      projectPath: route.context.projectPath,
    }
    if (route.agentProvider === "codex") {
      await shellEnvironmentReady
      return codexAgentProvider.generateTitle(canonicalPayload)
    }
    const { generateChatTitleWithUtilityModel } =
      await loadPiTitleGeneratorModule()
    return generateChatTitleWithUtilityModel(canonicalPayload)
  }
)

ipcMain.handle(
  "ousia:chat:history",
  (_event, payload: OusiaChatHistoryPayload) =>
    agentConversations.getChatHistory(payload)
)

ipcMain.handle(
  "ousia:chat:tool-payload",
  (_event, payload: OusiaChatToolPayloadPayload) =>
    agentConversations.getChatToolPayload(payload)
)

ipcMain.handle("ousia:chat:branch", (_event, payload: OusiaChatBranchPayload) =>
  agentConversations.branchChat(payload)
)

ipcMain.handle("ousia:chat:move", (_event, payload: OusiaChatMovePayload) =>
  agentConversations.moveChatSession(payload)
)

ipcMain.handle(
  "ousia:chat:context-usage",
  (_event, payload: OusiaChatContext) =>
    agentConversations.getContextUsage(payload)
)

ipcMain.handle(
  "ousia:chat:export",
  async (_event, payload: OusiaChatExportPayload) => {
    const extensions = {
      markdown: ["md"],
      jsonl: ["jsonl"],
    }[payload.format]
    const defaultPath = `${basename(payload.sessionId || "chat")}.${extensions[0]}`
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, {
          defaultPath,
          filters: [{ name: payload.format.toUpperCase(), extensions }],
        })
      : await dialog.showSaveDialog({
          defaultPath,
          filters: [{ name: payload.format.toUpperCase(), extensions }],
        })
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true }
    }
    const exportResult = await agentConversations.exportChat(
      payload,
      result.filePath
    )
    writeRuntimeLog("chat.export", exportResult.ok ? "info" : "error", {
      format: payload.format,
      requestedPath: result.filePath,
      result: exportResult,
    })
    return exportResult
  }
)

ipcMain.handle(
  "ousia:chat:interrupt",
  (_event, payload: OusiaChatInterruptPayload) =>
    agentConversations.interruptChat(payload)
)

ipcMain.handle("ousia:chat:clear-queue", (_event, payload: OusiaChatContext) =>
  agentConversations.clearChatQueue(payload)
)

ipcMain.handle(
  "ousia:chat:compact",
  (_event, payload: OusiaChatCompactPayload) =>
    agentConversations.compactChat(payload)
)

ipcMain.handle("ousia:models:list", async () => {
  const { listPiModels } = await loadPiModelRegistryModule()
  return listPiModels()
})

ipcMain.handle("ousia:pi:environment", async () => {
  const { checkPiEnvironment } = await loadPiEnvironmentModule()
  return checkPiEnvironment()
})

ipcMain.handle("ousia:codex:environment", async () => {
  await shellEnvironmentReady
  return codexAgentProvider.checkEnvironment()
})

ipcMain.handle("ousia:codex:login", async () => {
  await shellEnvironmentReady
  return codexAgentProvider.loginWithChatGPT()
})

ipcMain.handle("ousia:codex:logout", async () => {
  await shellEnvironmentReady
  return codexAgentProvider.logout()
})

ipcMain.handle(
  "ousia:pi:provider-credential",
  async (_event, payload: OusiaPiProviderCredentialPayload) => {
    const { savePiProviderCredential } = await loadPiEnvironmentModule()
    return savePiProviderCredential(payload)
  }
)

ipcMain.handle(
  "ousia:pi:provider-credential:remove",
  async (_event, payload: OusiaPiProviderCredentialRemovalPayload) => {
    const { removePiProviderCredential } = await loadPiEnvironmentModule()
    return removePiProviderCredential(payload)
  }
)

ipcMain.handle(
  "ousia:pi:retry-settings",
  async (_event, payload: OusiaPiRetrySettingsPayload) => {
    const { savePiRetrySettings } = await loadPiEnvironmentModule()
    return savePiRetrySettings(payload)
  }
)

async function selectDirectory(
  pickerOptions: OusiaDirectoryPickerOptions = {}
): Promise<OusiaSelectDirectoryResult> {
  const defaultPath = pickerOptions.defaultPath?.trim()
    ? expandHomePath(pickerOptions.defaultPath)
    : undefined
  if (defaultPath) {
    mkdirSync(defaultPath, { recursive: true })
  }
  const options: OpenDialogOptions = {
    ...(defaultPath ? { defaultPath } : {}),
    properties: ["openDirectory", "createDirectory"],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true }
  }
  return {
    canceled: false,
    path: result.filePaths[0],
  }
}

ipcMain.handle(
  "ousia:directory:select",
  (_event, options?: OusiaDirectoryPickerOptions) => selectDirectory(options)
)

ipcMain.handle(
  "ousia:directory:open-in-finder",
  async (
    _event,
    payload: OusiaOpenDirectoryPayload
  ): Promise<OusiaOpenDirectoryResult> => {
    const requestedPath = payload.path.trim()
    if (!requestedPath) {
      return { ok: false, error: "项目目录为空。" }
    }

    const directoryPath = resolve(expandHomePath(requestedPath))
    try {
      if (!statSync(directoryPath).isDirectory()) {
        return { ok: false, error: `不是目录：${directoryPath}` }
      }
    } catch {
      return { ok: false, error: `目录不存在：${directoryPath}` }
    }

    const error = await shell.openPath(directoryPath)
    if (error) {
      writeRuntimeLog("directory.open-in-finder", "error", {
        directoryPath,
        error,
      })
      return { ok: false, error }
    }
    return { ok: true }
  }
)

function resolveFilePathForFinder(
  filePath: string,
  projectPath: string | undefined
) {
  const expandedPath = expandHomePath(filePath)
  if (isAbsolute(expandedPath)) {
    return resolve(expandedPath)
  }
  if (!projectPath?.trim()) {
    throw new Error("缺少项目目录，无法解析相对文件路径。")
  }
  return resolveProjectFilePath(projectPath, expandedPath).absoluteFilePath
}

ipcMain.handle(
  "ousia:file:show-in-finder",
  async (
    _event,
    payload: OusiaShowFileInFinderPayload
  ): Promise<OusiaShowFileInFinderResult> => {
    const requestedPath = payload.path.trim()
    if (!requestedPath) {
      return { ok: false, error: "文件路径为空。" }
    }

    let filePath: string
    try {
      filePath = resolveFilePathForFinder(requestedPath, payload.projectPath)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    try {
      const stats = statSync(filePath)
      if (!stats.isFile()) {
        return { ok: false, error: `不是文件：${filePath}` }
      }
    } catch {
      return { ok: false, error: `文件不存在：${filePath}` }
    }

    try {
      shell.showItemInFolder(filePath)
      return { ok: true }
    } catch (error) {
      writeRuntimeLog("file.show-in-finder", "error", { error, filePath })
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
)

ipcMain.handle(
  "ousia:project:open",
  async (_event, options?: OusiaDirectoryPickerOptions) => {
    const result = await selectDirectory(options)
    if (result.canceled) {
      return result
    }
    const path = result.path
    return {
      canceled: false,
      path,
      name: basename(path),
    }
  }
)

ipcMain.handle("ousia:window:fullscreen-state", () =>
  windowHost.getWindowFullscreenState()
)

ipcMain.handle("ousia:window:zoom-state", () => windowHost.getWindowZoomState())

ipcMain.on("ousia:window:theme", (_event, payload: OusiaWindowThemePayload) => {
  windowHost.setWindowTheme(payload)
})

ipcMain.handle("ousia:app-state:load", async () => {
  await shellEnvironmentReady
  return loadAppState({ synchronizePiRetry: true })
})

ipcMain.handle(
  "ousia:app-state:settings:save",
  (_event, payload: OusiaAppStateSettingsPayload) =>
    saveAppStateSettings(payload)
)

ipcMain.handle(
  "ousia:app-state:shell-layout:save",
  (_event, payload: OusiaAppStateShellLayoutPayload) =>
    saveAppStateShellLayout(payload)
)

ipcMain.handle(
  "ousia:app-state:selection:save",
  (_event, payload: OusiaAppStateSelectionPayload) =>
    saveAppStateSelection(payload)
)

ipcMain.handle(
  "ousia:app-state:session:create",
  (_event, payload: OusiaAppStateCreateSessionPayload) =>
    createAppStateSession(payload)
)

ipcMain.handle(
  "ousia:app-state:session:delete",
  async (_event, payload: OusiaAppStateDeleteSessionPayload) =>
    releaseRemovedAgentSessions(await deleteAppStateSession(payload))
)

ipcMain.handle(
  "ousia:app-state:session:rename",
  (_event, payload: OusiaAppStateRenameSessionPayload) =>
    renameAppStateSession(payload)
)

ipcMain.handle(
  "ousia:app-state:session:move",
  (_event, payload: OusiaAppStateMoveSessionPayload) =>
    moveAppStateSession(payload)
)

ipcMain.handle(
  "ousia:app-state:sessions:reorder",
  (_event, payload: OusiaAppStateReorderSessionsPayload) =>
    reorderAppStateSessions(payload)
)

ipcMain.handle(
  "ousia:app-state:session:touch",
  (_event, payload: OusiaAppStateTouchSessionPayload) =>
    touchAppStateSession(payload)
)

ipcMain.handle(
  "ousia:app-state:project:create",
  (_event, payload: OusiaAppStateCreateProjectPayload) =>
    createAppStateProject(payload)
)

ipcMain.handle(
  "ousia:app-state:project:delete",
  async (_event, payload: OusiaAppStateDeleteProjectPayload) =>
    releaseRemovedAgentSessions(await deleteAppStateProject(payload))
)

ipcMain.handle(
  "ousia:app-state:projects:reorder",
  (_event, payload: OusiaAppStateReorderProjectsPayload) =>
    reorderAppStateProjects(payload)
)

ipcMain.on("ousia:log:renderer-error", (_event, payload: unknown) => {
  writeRuntimeLog("renderer.error", "error", payload)
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return
  }
  writeRuntimeLog("main", "info", `Runtime log path: ${OUSIA_DESKTOP_LOG_PATH}`)
  writeRuntimeLog("main", "info", {
    appData: app.getPath("appData"),
    userData: app.getPath("userData"),
  })
  await ensureMainWindow()
})

app.on("second-instance", () => {
  void ensureMainWindow({ focus: true }).catch((error: unknown) => {
    writeRuntimeLog("main.instance", "error", {
      error: error instanceof Error ? error.message : String(error),
      message: "Failed to restore the main window for a second launch.",
    })
  })
})

app.on("window-all-closed", () => {
  writeRuntimeLog("main", "info", "All windows closed")
  if (process.platform !== "darwin") {
    app.quit()
  }
})

function disposeProviderOnExit(
  provider: string,
  dispose: () => Promise<void> | void
) {
  try {
    void Promise.resolve(dispose()).catch((error: unknown) => {
      writeRuntimeLog("agent.dispose", "error", {
        error: error instanceof Error ? error.message : String(error),
        provider,
      })
    })
  } catch (error) {
    writeRuntimeLog("agent.dispose", "error", {
      error: error instanceof Error ? error.message : String(error),
      provider,
    })
  }
}

app.on("before-quit", () => {
  chatEventBatcher.dispose()
  disposeProviderOnExit("pi", () => piAgentConversations.dispose?.())
  disposeProviderOnExit("codex", () => codexAgentProvider.dispose())
})

app.on("activate", () => {
  if (!hasSingleInstanceLock) {
    return
  }
  if (BrowserWindow.getAllWindows().length === 0) {
    writeRuntimeLog("main", "info", "Recreating main window after activate")
    void ensureMainWindow({ focus: true }).catch((error: unknown) => {
      writeRuntimeLog("main.window", "error", {
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to recreate the main window after activation.",
      })
    })
  }
})
