import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  screen,
  shell,
} from "electron"
import { existsSync } from "node:fs"
import { platform } from "node:process"
import { join } from "node:path"

import type {
  OusiaLanguage,
  OusiaThemePreference,
  OusiaUpdateStatus,
  OusiaWindowThemePayload,
  OusiaWindowState,
} from "./chat-types.js"
import { loadAppState, saveWindowState } from "./app-state-store.js"
import { getNativeMessages } from "./native-i18n.js"
import { writeRuntimeLog } from "./runtime-logger.js"
import { updateCheckDialogOptions } from "./update-dialog.js"
import {
  isWindowFillingDisplay,
  WINDOW_DRAG_INSPECT_CHANNEL,
  type WindowDragInspectRequest,
} from "./window-drag-diagnostics.js"
import { createWindowResizeDiagnosticTracker } from "./window-resize-diagnostic-session.js"
import {
  MAIN_WINDOW_MIN_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
  resolveMacTrafficLightPosition,
} from "./window-constants.js"

type WindowHostOptions = {
  onCheckForUpdates: () => Promise<OusiaUpdateStatus>
  onClosed: () => void
  onWindowChanged: (window: BrowserWindow | undefined) => void
}

function isExternalUrl(url: string) {
  try {
    const parsed = new URL(url)
    return ["http:", "https:", "mailto:"].includes(parsed.protocol)
  } catch {
    return false
  }
}

function applyNativeThemePreference(theme: OusiaThemePreference) {
  nativeTheme.themeSource = theme
}

function resolveInitialWindowBounds(windowState: OusiaWindowState) {
  const width = Math.max(MAIN_WINDOW_MIN_WIDTH, Math.round(windowState.width))
  const height = Math.max(
    MAIN_WINDOW_MIN_HEIGHT,
    Math.round(windowState.height)
  )
  const bounds =
    typeof windowState.x === "number" && typeof windowState.y === "number"
      ? {
          x: Math.round(windowState.x),
          y: Math.round(windowState.y),
          width,
          height,
        }
      : {
          width,
          height,
        }

  if (typeof bounds.x !== "number" || typeof bounds.y !== "number") {
    return bounds
  }

  const display = screen.getDisplayMatching(bounds)
  const workArea = display.workArea
  const visibleWidth = Math.min(bounds.width, workArea.width)
  const visibleHeight = Math.min(bounds.height, workArea.height)
  return {
    x: Math.min(
      Math.max(bounds.x, workArea.x),
      workArea.x + workArea.width - 80
    ),
    y: Math.min(
      Math.max(bounds.y, workArea.y),
      workArea.y + workArea.height - 80
    ),
    width: visibleWidth,
    height: visibleHeight,
  }
}

function zoomPercentForWindow(window: BrowserWindow | undefined) {
  return Math.round((window?.webContents.getZoomFactor() ?? 1) * 100)
}

function resizeObserverDiagnosticCode(message: string) {
  if (
    message === "ResizeObserver loop completed with undelivered notifications."
  ) {
    return "undelivered-notifications"
  }
  if (message === "ResizeObserver loop limit exceeded") {
    return "loop-limit-exceeded"
  }
  return undefined
}

function applyWindowButtonPosition(window: BrowserWindow | undefined) {
  if (platform !== "darwin" || !window || window.isDestroyed()) {
    return false
  }

  window.setWindowButtonPosition(
    resolveMacTrafficLightPosition(window.webContents.getZoomFactor())
  )
  return true
}

function emitWindowZoomState(window: BrowserWindow | undefined) {
  window?.webContents.send("ousia:window:zoom", {
    zoomPercent: zoomPercentForWindow(window),
  })
}

function setWindowZoomLevel(
  window: BrowserWindow | undefined,
  zoomLevel: number
) {
  if (!window || window.isDestroyed()) {
    return
  }
  window.webContents.setZoomLevel(zoomLevel)
  applyWindowButtonPosition(window)
  emitWindowZoomState(window)
}

function adjustWindowZoomLevel(
  window: BrowserWindow | undefined,
  delta: number
) {
  if (!window || window.isDestroyed()) {
    return
  }
  setWindowZoomLevel(window, window.webContents.getZoomLevel() + delta)
}

function installApplicationMenu(
  getWindow: () => BrowserWindow | undefined,
  onCheckForUpdates: () => Promise<OusiaUpdateStatus>,
  language: OusiaLanguage
) {
  const t = getNativeMessages(language)
  function checkForUpdates() {
    void onCheckForUpdates()
      .then((status) => {
        const window = getWindow()
        const options = updateCheckDialogOptions(status, language)
        return window && !window.isDestroyed()
          ? dialog.showMessageBox(window, options)
          : dialog.showMessageBox(options)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        writeRuntimeLog("update.manual", "error", { message })
        const options: Electron.MessageBoxOptions = {
          type: "error",
          title: t.update.errorTitle,
          message: t.update.errorMessage,
          detail: message,
        }
        const window = getWindow()
        return window && !window.isDestroyed()
          ? dialog.showMessageBox(window, options)
          : dialog.showMessageBox(options)
      })
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { label: t.menu.about, role: "about" as const },
              {
                label: t.menu.checkForUpdates,
                click: checkForUpdates,
              },
              { type: "separator" as const },
              { label: t.menu.services, role: "services" as const },
              { type: "separator" as const },
              { label: t.menu.hide, role: "hide" as const },
              { label: t.menu.hideOthers, role: "hideOthers" as const },
              { label: t.menu.unhide, role: "unhide" as const },
              { type: "separator" as const },
              { label: t.menu.quit, role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: t.menu.edit,
      submenu: [
        { label: t.menu.undo, role: "undo" },
        { label: t.menu.redo, role: "redo" },
        { type: "separator" },
        { label: t.menu.cut, role: "cut" },
        { label: t.menu.copy, role: "copy" },
        { label: t.menu.paste, role: "paste" },
        { label: t.menu.pasteAndMatchStyle, role: "pasteAndMatchStyle" },
        { label: t.menu.delete, role: "delete" },
        { type: "separator" },
        { label: t.menu.selectAll, role: "selectAll" },
      ],
    },
    {
      label: t.menu.view,
      submenu: [
        { label: t.menu.reload, role: "reload" },
        { label: t.menu.forceReload, role: "forceReload" },
        { label: t.menu.toggleDevTools, role: "toggleDevTools" },
        { type: "separator" },
        {
          label: t.menu.actualSize,
          accelerator: "CmdOrCtrl+0",
          click: () => setWindowZoomLevel(getWindow(), 0),
        },
        {
          label: t.menu.zoomIn,
          accelerator: "CmdOrCtrl+Plus",
          click: () => adjustWindowZoomLevel(getWindow(), 0.5),
        },
        {
          label: t.menu.zoomOut,
          accelerator: "CmdOrCtrl+-",
          click: () => adjustWindowZoomLevel(getWindow(), -0.5),
        },
        { type: "separator" },
        { label: t.menu.toggleFullscreen, role: "togglefullscreen" },
      ],
    },
    {
      label: t.menu.window,
      submenu: [
        { label: t.menu.minimize, role: "minimize" },
        { label: t.menu.zoom, role: "zoom" },
        ...(platform === "darwin"
          ? [
              { type: "separator" as const },
              { label: t.menu.front, role: "front" as const },
            ]
          : [{ label: t.menu.close, role: "close" as const }]),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function createWindowHost({
  onCheckForUpdates,
  onClosed,
  onWindowChanged,
}: WindowHostOptions) {
  let mainWindow: BrowserWindow | undefined
  let language: OusiaLanguage = "zh"
  let installedApplicationMenuLanguage: OusiaLanguage | undefined
  let lastEmittedFullscreen: boolean | undefined
  let saveWindowStateTimer: ReturnType<typeof setTimeout> | undefined
  let resizeObserverDiagnosticTimer: ReturnType<typeof setTimeout> | undefined
  const resizeObserverDiagnosticCounts = {
    "loop-limit-exceeded": 0,
    "undelivered-notifications": 0,
  }

  function getMainWindow() {
    return mainWindow
  }

  function setLanguage(nextLanguage: OusiaLanguage) {
    language = nextLanguage
    if (installedApplicationMenuLanguage === nextLanguage) {
      return
    }
    installApplicationMenu(getMainWindow, onCheckForUpdates, language)
    installedApplicationMenuLanguage = nextLanguage
    writeRuntimeLog("window.menu", "info", { language: nextLanguage })
  }

  function windowFullscreenDiagnosticSnapshot() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return null
    }
    const bounds = mainWindow.getBounds()
    const displayBounds = screen.getDisplayMatching(bounds).bounds
    const nativeFullscreen = mainWindow.isFullScreen()
    const fillsDisplay =
      platform === "darwin" && isWindowFillingDisplay(bounds, displayBounds)
    return {
      bounds,
      displayBounds,
      fillsDisplay,
      inferredFullscreen: nativeFullscreen || fillsDisplay,
      nativeFullscreen,
      zoomPercent: zoomPercentForWindow(mainWindow),
    }
  }

  function emitWindowFullscreenState(
    isFullscreen = mainWindow?.isFullScreen(),
    trigger = "native"
  ) {
    const nextFullscreen = Boolean(isFullscreen)
    if (lastEmittedFullscreen === nextFullscreen) {
      return
    }
    const previousFullscreen = lastEmittedFullscreen
    lastEmittedFullscreen = nextFullscreen
    const snapshot = windowFullscreenDiagnosticSnapshot()
    writeRuntimeLog("window.fullscreen", "info", {
      bounds: snapshot?.bounds,
      displayBounds: snapshot?.displayBounds,
      fillsDisplay: snapshot?.fillsDisplay,
      from: previousFullscreen ?? null,
      nativeFullscreen: snapshot?.nativeFullscreen,
      to: nextFullscreen,
      trigger,
    })
    mainWindow?.webContents.send("ousia:window:fullscreen", {
      isFullscreen: nextFullscreen,
    })
  }

  function emitInferredWindowFullscreenState(trigger: "move" | "resize") {
    if (!mainWindow || platform !== "darwin") {
      return
    }
    const snapshot = windowFullscreenDiagnosticSnapshot()
    if (!snapshot) {
      return
    }
    emitWindowFullscreenState(snapshot.inferredFullscreen, trigger)
  }

  function sendWindowDragInspection(request: WindowDragInspectRequest) {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send(WINDOW_DRAG_INSPECT_CHANNEL, request)
  }

  const resizeDiagnosticTracker = createWindowResizeDiagnosticTracker({
    inspect: sendWindowDragInspection,
    readSnapshot: windowFullscreenDiagnosticSnapshot,
    writeFinish: (fields) =>
      writeRuntimeLog("window.resize.finish", "info", fields),
    writeStart: (fields) =>
      writeRuntimeLog("window.resize.start", "info", fields),
  })

  function recordResizeObserverDiagnostic(
    code: keyof typeof resizeObserverDiagnosticCounts
  ) {
    resizeObserverDiagnosticCounts[code] += 1
    if (resizeObserverDiagnosticTimer) {
      return
    }
    resizeObserverDiagnosticTimer = setTimeout(
      flushResizeObserverDiagnostics,
      1_000
    )
  }

  function flushResizeObserverDiagnostics() {
    if (resizeObserverDiagnosticTimer) {
      clearTimeout(resizeObserverDiagnosticTimer)
      resizeObserverDiagnosticTimer = undefined
    }
    const counts = { ...resizeObserverDiagnosticCounts }
    resizeObserverDiagnosticCounts["loop-limit-exceeded"] = 0
    resizeObserverDiagnosticCounts["undelivered-notifications"] = 0
    if (
      counts["loop-limit-exceeded"] === 0 &&
      counts["undelivered-notifications"] === 0
    ) {
      return
    }
    writeRuntimeLog("renderer.resize-observer", "warn", {
      counts,
      windowBounds: mainWindow?.getBounds(),
      zoomPercent: zoomPercentForWindow(mainWindow),
    })
  }

  function getWindowFullscreenState() {
    return {
      isFullscreen: Boolean(mainWindow?.isFullScreen()),
    }
  }

  function getWindowZoomState() {
    return {
      zoomPercent: zoomPercentForWindow(mainWindow),
    }
  }

  function getCurrentWindowState(): OusiaWindowState | null {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) {
      return null
    }
    const bounds = mainWindow.isMaximized()
      ? mainWindow.getNormalBounds()
      : mainWindow.getBounds()
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: mainWindow.isMaximized(),
    }
  }

  function saveCurrentWindowState() {
    if (saveWindowStateTimer) {
      clearTimeout(saveWindowStateTimer)
      saveWindowStateTimer = undefined
    }
    const state = getCurrentWindowState()
    if (!state) {
      return
    }
    void saveWindowState(state).catch((error: unknown) => {
      writeRuntimeLog("window.state", "error", {
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }

  function scheduleWindowStateSave() {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) {
      return
    }
    if (saveWindowStateTimer) {
      clearTimeout(saveWindowStateTimer)
    }
    saveWindowStateTimer = setTimeout(saveCurrentWindowState, 350)
  }

  async function createWindow() {
    const startupStartedAt = performance.now()
    const appStateLoadStartedAt = performance.now()
    const appState = await loadAppState({ synchronizePiRetry: false })
    const appStateReadyAt = performance.now()
    setLanguage(appState.settings.language)
    applyNativeThemePreference(appState.settings.theme)
    const initialBounds = resolveInitialWindowBounds(appState.windowState)

    mainWindow = new BrowserWindow({
      ...initialBounds,
      acceptFirstMouse: true,
      minWidth: MAIN_WINDOW_MIN_WIDTH,
      minHeight: MAIN_WINDOW_MIN_HEIGHT,
      title: "Ousia",
      titleBarStyle: "hiddenInset",
      ...(platform === "darwin"
        ? { trafficLightPosition: resolveMacTrafficLightPosition() }
        : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(__dirname, "preload.js"),
      },
    })
    if (appState.windowState.isMaximized) {
      mainWindow.maximize()
    }
    applyWindowButtonPosition(mainWindow)
    onWindowChanged(mainWindow)
    const browserWindowReadyAt = performance.now()

    mainWindow.webContents.on(
      "console-message",
      (_event, level, message, line, sourceId) => {
        const resizeObserverCode = resizeObserverDiagnosticCode(message)
        if (resizeObserverCode) {
          recordResizeObserverDiagnostic(resizeObserverCode)
          return
        }
        const normalizedLevel =
          level === 2 ? "warn" : level === 3 ? "error" : "info"
        writeRuntimeLog("renderer.console", normalizedLevel, {
          line,
          message,
          sourceId,
        })
      }
    )

    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      writeRuntimeLog("renderer.process", "error", details)
    })

    mainWindow.webContents.on(
      "did-fail-load",
      (_event, code, description, url) => {
        writeRuntimeLog("renderer.load", "error", { code, description, url })
      }
    )
    mainWindow.webContents.on("zoom-changed", () => {
      globalThis.setTimeout(() => {
        applyWindowButtonPosition(mainWindow)
        emitWindowZoomState(mainWindow)
      }, 0)
    })

    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (!input.control && !input.meta) {
        return
      }
      if (input.alt) {
        return
      }
      const key = input.key.toLowerCase()
      if (key === "+" || key === "=") {
        event.preventDefault()
        adjustWindowZoomLevel(mainWindow, 0.5)
      } else if (key === "-" || key === "_") {
        event.preventDefault()
        adjustWindowZoomLevel(mainWindow, -0.5)
      } else if (key === "0") {
        event.preventDefault()
        setWindowZoomLevel(mainWindow, 0)
      }
    })

    mainWindow.on("unresponsive", () => {
      writeRuntimeLog("window", "warn", "Main window became unresponsive")
    })

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternalUrl(url)) {
        void shell.openExternal(url)
      }
      return { action: "deny" }
    })

    mainWindow.webContents.on("context-menu", (_event, params) => {
      const menu = getNativeMessages(language).menu
      const menuTemplate: Electron.MenuItemConstructorOptions[] = []
      if (params.selectionText) {
        menuTemplate.push({ label: menu.copy, role: "copy" })
      }
      if (params.isEditable) {
        if (menuTemplate.length) {
          menuTemplate.push({ type: "separator" })
        }
        menuTemplate.push(
          { label: menu.cut, role: "cut" },
          { label: menu.copy, role: "copy" },
          { label: menu.paste, role: "paste" },
          { type: "separator" },
          { label: menu.selectAll, role: "selectAll" }
        )
      }
      if (!menuTemplate.length) {
        return
      }
      Menu.buildFromTemplate(menuTemplate).popup({ window: mainWindow })
    })

    mainWindow.webContents.once("did-finish-load", () => {
      applyWindowButtonPosition(mainWindow)
      emitWindowFullscreenState(undefined, "did-finish-load")
      sendWindowDragInspection({
        sequence: 0,
        trigger: "initial",
      })
    })
    mainWindow.webContents.once("did-finish-load", () =>
      emitWindowZoomState(mainWindow)
    )
    mainWindow.on("will-resize", (_event, newBounds, details) => {
      resizeDiagnosticTracker.recordWillResize(newBounds, details.edge)
    })
    mainWindow.on("resize", () => {
      // The traffic-light position depends on zoom, not window bounds. Reapplying
      // it during every live resize mutates the native title bar while macOS is
      // also rebuilding draggable regions, which can leave hit testing stale.
      resizeDiagnosticTracker.recordResize(false)
      emitInferredWindowFullscreenState("resize")
      scheduleWindowStateSave()
    })
    mainWindow.on("move", () => {
      emitInferredWindowFullscreenState("move")
      scheduleWindowStateSave()
    })
    mainWindow.on("resized", () => {
      resizeDiagnosticTracker.resized()
    })
    mainWindow.on("maximize", scheduleWindowStateSave)
    mainWindow.on("unmaximize", () => {
      applyWindowButtonPosition(mainWindow)
      scheduleWindowStateSave()
    })
    mainWindow.on("enter-full-screen", () =>
      emitWindowFullscreenState(undefined, "enter-full-screen")
    )
    mainWindow.on("leave-full-screen", () => {
      applyWindowButtonPosition(mainWindow)
      emitWindowFullscreenState(undefined, "leave-full-screen")
      scheduleWindowStateSave()
    })
    mainWindow.on("close", saveCurrentWindowState)
    mainWindow.on("closed", () => {
      if (saveWindowStateTimer) {
        clearTimeout(saveWindowStateTimer)
        saveWindowStateTimer = undefined
      }
      resizeDiagnosticTracker.dispose()
      if (resizeObserverDiagnosticTimer) {
        flushResizeObserverDiagnostics()
      }
      onClosed()
      mainWindow = undefined
      onWindowChanged(undefined)
    })

    const rendererSource = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? "dev-server"
      : "file"
    const rendererLoadStartedAt = performance.now()
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    } else {
      const indexHtml = join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
      )
      if (!existsSync(indexHtml)) {
        throw new Error(`未找到渲染进程构建产物：${indexHtml}`)
      }
      await mainWindow.loadFile(indexHtml)
    }
    const startupFinishedAt = performance.now()
    writeRuntimeLog("window.startup", "info", {
      appStateMs: Number((appStateReadyAt - appStateLoadStartedAt).toFixed(1)),
      browserWindowMs: Number(
        (browserWindowReadyAt - appStateReadyAt).toFixed(1)
      ),
      rendererLoadMs: Number(
        (startupFinishedAt - rendererLoadStartedAt).toFixed(1)
      ),
      source: rendererSource,
      totalMs: Number((startupFinishedAt - startupStartedAt).toFixed(1)),
    })
  }

  return {
    createWindow,
    setWindowTheme({ theme }: OusiaWindowThemePayload) {
      applyNativeThemePreference(theme)
    },
    getWindowFullscreenState,
    getWindowZoomState,
    getMainWindow,
    setLanguage,
  }
}
