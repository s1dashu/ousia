import {
  app,
  BrowserWindow,
  Menu,
  nativeTheme,
  screen,
  shell,
} from "electron"
import { existsSync } from "node:fs"
import { platform } from "node:process"
import { join } from "node:path"

import type {
  OusiaResolvedTheme,
  OusiaThemePreference,
  OusiaWindowThemePayload,
  OusiaWindowState,
} from "./chat-types.js"
import { loadAppState, saveWindowState } from "./app-state-store.js"
import { writeRuntimeLog } from "./runtime-logger.js"
import {
  MAIN_WINDOW_MIN_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
  resolveMacTrafficLightPosition,
} from "./window-constants.js"

type WindowHostOptions = {
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

const WINDOW_BACKGROUND_BY_THEME: Record<OusiaResolvedTheme, string> = {
  dark: "#111110",
  light: "#fffefb",
}

function resolveThemePreference(theme: OusiaThemePreference): OusiaResolvedTheme {
  if (theme === "system") {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light"
  }

  return theme
}

function windowBackgroundForTheme(theme: OusiaResolvedTheme) {
  return WINDOW_BACKGROUND_BY_THEME[theme]
}

function applyNativeThemePreference(theme: OusiaThemePreference) {
  nativeTheme.themeSource = theme
}

function resolveInitialWindowBounds(windowState: OusiaWindowState) {
  const width = Math.max(MAIN_WINDOW_MIN_WIDTH, Math.round(windowState.width))
  const height = Math.max(MAIN_WINDOW_MIN_HEIGHT, Math.round(windowState.height))
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
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - 80),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - 80),
    width: visibleWidth,
    height: visibleHeight,
  }
}

function zoomPercentForWindow(window: BrowserWindow | undefined) {
  return Math.round((window?.webContents.getZoomFactor() ?? 1) * 100)
}

function isIgnorableRendererConsoleMessage(message: string) {
  return (
    message === "ResizeObserver loop completed with undelivered notifications." ||
    message === "ResizeObserver loop limit exceeded"
  )
}

function applyWindowButtonPosition(window: BrowserWindow | undefined) {
  if (platform !== "darwin" || !window || window.isDestroyed()) {
    return
  }

  window.setWindowButtonPosition(
    resolveMacTrafficLightPosition(window.webContents.getZoomFactor())
  )
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

function adjustWindowZoomLevel(window: BrowserWindow | undefined, delta: number) {
  if (!window || window.isDestroyed()) {
    return
  }
  setWindowZoomLevel(window, window.webContents.getZoomLevel() + delta)
}

function installApplicationMenu(getWindow: () => BrowserWindow | undefined) {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          click: () => setWindowZoomLevel(getWindow(), 0),
        },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+Plus",
          click: () => adjustWindowZoomLevel(getWindow(), 0.5),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => adjustWindowZoomLevel(getWindow(), -0.5),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(platform === "darwin"
          ? [
              { type: "separator" as const },
              { role: "front" as const },
            ]
          : [{ role: "close" as const }]),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function createWindowHost({ onClosed, onWindowChanged }: WindowHostOptions) {
  let mainWindow: BrowserWindow | undefined
  let lastEmittedFullscreen: boolean | undefined
  let saveWindowStateTimer: ReturnType<typeof setTimeout> | undefined

  function getMainWindow() {
    return mainWindow
  }

  function emitWindowFullscreenState(isFullscreen = mainWindow?.isFullScreen()) {
    const nextFullscreen = Boolean(isFullscreen)
    if (lastEmittedFullscreen === nextFullscreen) {
      return
    }
    lastEmittedFullscreen = nextFullscreen
    mainWindow?.webContents.send("ousia:window:fullscreen", {
      isFullscreen: nextFullscreen,
    })
  }

  function emitInferredWindowFullscreenState() {
    if (!mainWindow || platform !== "darwin") {
      return
    }
    const bounds = mainWindow.getBounds()
    const displayBounds = screen.getDisplayMatching(bounds).bounds
    const tolerance = 1
    const fillsDisplay =
      Math.abs(bounds.x - displayBounds.x) <= tolerance &&
      Math.abs(bounds.y - displayBounds.y) <= tolerance &&
      Math.abs(bounds.width - displayBounds.width) <= tolerance &&
      Math.abs(bounds.height - displayBounds.height) <= tolerance

    emitWindowFullscreenState(mainWindow.isFullScreen() || fillsDisplay)
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
    installApplicationMenu(getMainWindow)
    const appState = await loadAppState()
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
      backgroundColor: windowBackgroundForTheme(
        resolveThemePreference(appState.settings.theme)
      ),
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

    mainWindow.webContents.on(
      "console-message",
      (_event, level, message, line, sourceId) => {
        if (isIgnorableRendererConsoleMessage(message)) {
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
      const menuTemplate: Electron.MenuItemConstructorOptions[] = []
      if (params.selectionText) {
        menuTemplate.push({ role: "copy" })
      }
      if (params.isEditable) {
        if (menuTemplate.length) {
          menuTemplate.push({ type: "separator" })
        }
        menuTemplate.push(
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { type: "separator" },
          { role: "selectAll" }
        )
      }
      if (!menuTemplate.length) {
        return
      }
      Menu.buildFromTemplate(menuTemplate).popup({ window: mainWindow })
    })

    mainWindow.webContents.once("did-finish-load", () => {
      applyWindowButtonPosition(mainWindow)
      emitWindowFullscreenState()
    })
    mainWindow.webContents.once("did-finish-load", () =>
      emitWindowZoomState(mainWindow)
    )
    mainWindow.on("resize", () => {
      applyWindowButtonPosition(mainWindow)
      emitInferredWindowFullscreenState()
      scheduleWindowStateSave()
    })
    mainWindow.on("move", () => {
      emitInferredWindowFullscreenState()
      scheduleWindowStateSave()
    })
    mainWindow.on("maximize", scheduleWindowStateSave)
    mainWindow.on("unmaximize", () => {
      applyWindowButtonPosition(mainWindow)
      scheduleWindowStateSave()
    })
    mainWindow.on("enter-full-screen", () => emitWindowFullscreenState())
    mainWindow.on("leave-full-screen", () => {
      applyWindowButtonPosition(mainWindow)
      emitWindowFullscreenState()
      scheduleWindowStateSave()
    })
    mainWindow.on("close", saveCurrentWindowState)
    mainWindow.on("closed", () => {
      if (saveWindowStateTimer) {
        clearTimeout(saveWindowStateTimer)
        saveWindowStateTimer = undefined
      }
      onClosed()
      mainWindow = undefined
      onWindowChanged(undefined)
    })

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
  }

  return {
    createWindow,
    setWindowTheme({ theme, resolvedTheme }: OusiaWindowThemePayload) {
      applyNativeThemePreference(theme)
      if (!mainWindow || mainWindow.isDestroyed()) {
        return
      }
      mainWindow.setBackgroundColor(windowBackgroundForTheme(resolvedTheme))
    },
    getWindowFullscreenState,
    getWindowZoomState,
    getMainWindow,
  }
}
