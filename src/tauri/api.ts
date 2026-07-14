import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { open, save } from "@tauri-apps/plugin-dialog"

import type {
  OusiaChatBranchPayload,
  OusiaChatBranchResult,
  OusiaChatClearQueueResult,
  OusiaChatCompactPayload,
  OusiaChatCompactResult,
  OusiaChatContext,
  OusiaChatContextUsageResult,
  OusiaChatEvent,
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
  OusiaChatPreparePayload,
  OusiaChatPrepareResult,
  OusiaChatSendPayload,
  OusiaChatSendResult,
  OusiaChatToolPayloadPayload,
  OusiaChatToolPayloadResult,
  OusiaDirectoryPickerOptions,
  OusiaModelRegistryResult,
  OusiaOpenDirectoryPayload,
  OusiaOpenDirectoryResult,
  OusiaOpenProjectResult,
  OusiaPiEnvironmentStatus,
  OusiaPiRetrySettingsPayload,
  OusiaPiRetrySettingsResult,
  OusiaPiRuntimeActionResult,
  OusiaSelectDirectoryResult,
  OusiaShowFileInFinderPayload,
  OusiaShowFileInFinderResult,
  OusiaUpdateActionResult,
  OusiaUpdateStatus,
  OusiaWindowFullscreenEvent,
  OusiaWindowThemePayload,
  OusiaWindowZoomEvent,
} from "@/electron/chat-types"
import { appStateHost } from "./app-state-host"

function invokeWithPayload<T>(command: string, payload: unknown): Promise<T> {
  return invoke<T>(command, { payload })
}

function eventSubscription<T>(
  eventName: string,
  callback: (payload: T) => void,
) {
  let disposed = false
  let unlisten: UnlistenFn | undefined
  void listen<T>(eventName, (event) => callback(event.payload)).then(
    (unsubscribe) => {
      if (disposed) unsubscribe()
      else unlisten = unsubscribe
    },
  )
  return () => {
    disposed = true
    unlisten?.()
  }
}

async function releaseSessions(sessionIds: string[]) {
  if (!sessionIds.length) return
  await invoke("release_pi_sessions", { sessionIds })
}

const api = {
  ...appStateHost,

  reportFrontendError(payload: {
    data?: unknown
    kind: string
    message: string
    stack?: string
  }): Promise<void> {
    return invokeWithPayload("report_frontend_error", payload)
  },

  reportFrontendLog(payload: {
    data?: unknown
    level: "debug" | "info" | "warn"
    message: string
    scope: string
  }): Promise<void> {
    return invokeWithPayload("report_frontend_log", payload)
  },

  async deleteSession(
    payload: Parameters<typeof appStateHost.deleteSession>[0],
  ) {
    const result = await appStateHost.deleteSession(payload)
    if (result.ok) await releaseSessions([payload.sessionId])
    return result
  },

  async deleteProject(
    payload: Parameters<typeof appStateHost.deleteProject>[0],
  ) {
    const state = await appStateHost.loadAppState()
    const sessionIds = state.sessions
      .filter((session) => session.projectId === payload.projectId)
      .map((session) => session.id)
    const result = await appStateHost.deleteProject(payload)
    if (result.ok) await releaseSessions(sessionIds)
    return result
  },

  sendChatMessage(payload: OusiaChatSendPayload): Promise<OusiaChatSendResult> {
    return invokeWithPayload("send_chat_message", payload)
  },

  prepareChatSession(
    payload: OusiaChatPreparePayload,
  ): Promise<OusiaChatPrepareResult> {
    return invokeWithPayload("prepare_chat_session", payload)
  },

  generateChatTitle(
    payload: OusiaChatGenerateTitlePayload,
  ): Promise<OusiaChatGenerateTitleResult> {
    return invokeWithPayload("generate_chat_title", payload)
  },

  getChatHistory(
    payload: OusiaChatHistoryPayload,
  ): Promise<OusiaChatHistoryResult> {
    return invokeWithPayload("get_chat_history", payload)
  },

  getChatToolPayload(
    payload: OusiaChatToolPayloadPayload,
  ): Promise<OusiaChatToolPayloadResult> {
    return invokeWithPayload("get_chat_tool_payload", payload)
  },

  branchChat(payload: OusiaChatBranchPayload): Promise<OusiaChatBranchResult> {
    return invokeWithPayload("branch_chat", payload)
  },

  moveChatSession(payload: OusiaChatMovePayload): Promise<OusiaChatMoveResult> {
    return invokeWithPayload("move_chat_session", payload)
  },

  getChatContextUsage(
    payload: OusiaChatContext,
  ): Promise<OusiaChatContextUsageResult> {
    return invokeWithPayload("get_chat_context_usage", payload)
  },

  async exportChat(
    payload: OusiaChatExportPayload,
  ): Promise<OusiaChatExportResult> {
    const outputPath = await save({
      defaultPath: `pi-session.${payload.format === "jsonl" ? "jsonl" : "md"}`,
      filters: [
        payload.format === "jsonl"
          ? { name: "Pi session", extensions: ["jsonl"] }
          : { name: "Markdown", extensions: ["md"] },
      ],
    })
    if (!outputPath) return { ok: false, canceled: true }
    return invokeWithPayload("export_chat", { ...payload, outputPath })
  },

  interruptChat(
    payload: OusiaChatInterruptPayload,
  ): Promise<OusiaChatInterruptResult> {
    return invokeWithPayload("interrupt_chat", payload)
  },

  clearChatQueue(
    payload: OusiaChatContext,
  ): Promise<OusiaChatClearQueueResult> {
    return invokeWithPayload("clear_chat_queue", payload)
  },

  compactChat(
    payload: OusiaChatCompactPayload,
  ): Promise<OusiaChatCompactResult> {
    return invokeWithPayload("compact_chat", payload)
  },

  listModels(): Promise<OusiaModelRegistryResult> {
    return invoke("list_models")
  },

  checkPiEnvironment(): Promise<OusiaPiEnvironmentStatus> {
    return invoke("check_pi_environment")
  },

  async selectPiBinary(): Promise<OusiaPiRuntimeActionResult> {
    const path = await open({ directory: false, multiple: false })
    if (!path) return { canceled: true, ok: false }
    if (Array.isArray(path)) {
      throw new Error("Pi executable picker returned multiple paths.")
    }
    return invokeWithPayload("select_pi_binary", { path })
  },

  installPiRuntime(): Promise<OusiaPiRuntimeActionResult> {
    return invoke("install_pi_runtime")
  },

  uninstallPiRuntime(): Promise<OusiaPiRuntimeActionResult> {
    return invoke("uninstall_pi_runtime")
  },

  addPiToShellPath(): Promise<OusiaPiRuntimeActionResult> {
    return invoke("add_pi_to_shell_path")
  },

  removePiFromShellPath(): Promise<OusiaPiRuntimeActionResult> {
    return invoke("remove_pi_from_shell_path")
  },

  savePiRetrySettings(
    payload: OusiaPiRetrySettingsPayload,
  ): Promise<OusiaPiRetrySettingsResult> {
    return invokeWithPayload("save_pi_retry_settings", payload)
  },

  async openProjectDirectory(
    options?: OusiaDirectoryPickerOptions,
  ): Promise<OusiaOpenProjectResult> {
    const path = await open({
      directory: true,
      multiple: false,
      defaultPath: options?.defaultPath,
    })
    if (!path) return { canceled: true }
    const segments = path.split(/[\\/]/).filter(Boolean)
    return {
      canceled: false,
      path,
      name: segments.at(-1) ?? path,
    }
  },

  async selectDirectory(
    options?: OusiaDirectoryPickerOptions,
  ): Promise<OusiaSelectDirectoryResult> {
    const path = await open({
      directory: true,
      multiple: false,
      defaultPath: options?.defaultPath,
    })
    return path ? { canceled: false, path } : { canceled: true }
  },

  openDirectoryInFinder(
    payload: OusiaOpenDirectoryPayload,
  ): Promise<OusiaOpenDirectoryResult> {
    return invokeWithPayload("open_directory_in_finder", payload)
  },

  showFileInFinder(
    payload: OusiaShowFileInFinderPayload,
  ): Promise<OusiaShowFileInFinderResult> {
    return invokeWithPayload("show_file_in_finder", payload)
  },

  async getWindowFullscreenState(): Promise<OusiaWindowFullscreenEvent> {
    return { isFullscreen: await getCurrentWindow().isFullscreen() }
  },

  async getWindowZoomState(): Promise<OusiaWindowZoomEvent> {
    return invoke("get_window_zoom_state")
  },

  setWindowTheme(payload: OusiaWindowThemePayload) {
    void getCurrentWindow().setTheme(payload.resolvedTheme)
  },

  async getUpdateStatus(): Promise<OusiaUpdateStatus> {
    return { phase: "disabled", reason: "Prototype builds do not self-update." }
  },

  async downloadUpdate(): Promise<OusiaUpdateActionResult> {
    return { ok: false, error: "Prototype builds do not self-update." }
  },

  async installUpdate(): Promise<OusiaUpdateActionResult> {
    return { ok: false, error: "Prototype builds do not self-update." }
  },

  onUpdateStatus(callback: (status: OusiaUpdateStatus) => void) {
    void callback
    return () => undefined
  },

  onChatEvent(callback: (event: OusiaChatEvent) => void) {
    return eventSubscription("ousia:chat:event", callback)
  },

  onWindowFullscreenChange(
    callback: (event: OusiaWindowFullscreenEvent) => void,
  ) {
    return eventSubscription("ousia:window:fullscreen", callback)
  },

  onWindowZoomChange(callback: (event: OusiaWindowZoomEvent) => void) {
    return eventSubscription("ousia:window:zoom", callback)
  },
}

declare global {
  interface Window {
    ousia: typeof api
  }
}

window.ousia = api

type WindowZoomAction = "in" | "out" | "reset"

function zoomActionForKeyboardEvent(
  event: globalThis.KeyboardEvent,
): WindowZoomAction | null {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null
  const key = event.key.toLowerCase()
  if (key === "+" || key === "=") return "in"
  if (key === "-" || key === "_") return "out"
  if (key === "0") return "reset"
  return null
}

window.addEventListener(
  "keydown",
  (event) => {
    const action = zoomActionForKeyboardEvent(event)
    if (!action) return
    event.preventDefault()
    void invoke<OusiaWindowZoomEvent>("set_window_zoom", { action }).catch(
      (error: unknown) => {
        queueMicrotask(() => {
          throw new Error(`Failed to change window zoom (${action})`, {
            cause: error,
          })
        })
      },
    )
  },
  true,
)
