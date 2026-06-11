import {
  app,
  BrowserWindow,
  Menu,
  nativeTheme,
  screen,
  shell,
} from "electron"
import { existsSync } from "node:fs"
import { env, platform } from "node:process"
import { join } from "node:path"

import type {
  OusiaEnsureWindowWidthPayload,
  OusiaThemePreference,
  OusiaWindowState,
} from "./chat-types.js"
import { loadAppState, saveWindowState } from "./app-state-store.js"
import { writeRuntimeLog } from "./runtime-logger.js"

const MAIN_WINDOW_MIN_WIDTH = 340

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

function resolveInitialWindowBackground(theme: OusiaThemePreference) {
  const resolvedTheme =
    theme === "system"
      ? nativeTheme.shouldUseDarkColors
        ? "dark"
        : "light"
      : theme

  return resolvedTheme === "dark" ? "#111111" : "#fdfbf9"
}

function resolveInitialWindowBounds(windowState: OusiaWindowState) {
  const width = Math.max(MAIN_WINDOW_MIN_WIDTH, Math.round(windowState.width))
  const height = Math.max(600, Math.round(windowState.height))
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

function installApplicationMenu() {
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
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
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

function getWebAuthnKeychainAccessGroup() {
  const configuredGroup = env.OUSIA_WEBAUTHN_KEYCHAIN_ACCESS_GROUP?.trim()
  if (configuredGroup) {
    return configuredGroup
  }

  const teamId = env.OUSIA_APPLE_TEAM_ID?.trim() || env.APPLE_TEAM_ID?.trim()
  if (!teamId) {
    return undefined
  }

  return `${teamId}.com.ousia.desktop.webauthn`
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

  function ensureWindowWidth(payload: OusiaEnsureWindowWidthPayload) {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, width: 0 }
    }

    const bounds = mainWindow.getBounds()
    const minWidth = Math.max(MAIN_WINDOW_MIN_WIDTH, Math.ceil(payload.minWidth))
    if (bounds.width >= minWidth || mainWindow.isFullScreen()) {
      return { ok: true, width: bounds.width }
    }

    const delta = minWidth - bounds.width
    const x = payload.anchor === "right" ? bounds.x - delta : bounds.x
    mainWindow.setBounds({ ...bounds, x, width: minWidth }, true)
    scheduleWindowStateSave()
    return { ok: true, width: minWidth }
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

  function configureBrowserWebAuthn() {
    if (platform !== "darwin") {
      return
    }

    const keychainAccessGroup = getWebAuthnKeychainAccessGroup()
    if (!keychainAccessGroup) {
      console.warn(
        "Skipping macOS WebAuthn platform authenticator: set OUSIA_WEBAUTHN_KEYCHAIN_ACCESS_GROUP or OUSIA_APPLE_TEAM_ID."
      )
      return
    }

    app.configureWebAuthn({
      touchID: {
        keychainAccessGroup,
        promptReason: "登录 $1",
      },
    })
  }

  async function createWindow() {
    installApplicationMenu()
    const appState = await loadAppState()
    const initialBounds = resolveInitialWindowBounds(appState.windowState)

    mainWindow = new BrowserWindow({
      ...initialBounds,
      minWidth: MAIN_WINDOW_MIN_WIDTH,
      minHeight: 600,
      title: "Ousia",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 12 },
      backgroundColor: resolveInitialWindowBackground(appState.settings.theme),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(__dirname, "preload.js"),
      },
    })
    if (appState.windowState.isMaximized) {
      mainWindow.maximize()
    }
    onWindowChanged(mainWindow)

    mainWindow.webContents.on(
      "console-message",
      (_event, level, message, line, sourceId) => {
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

    mainWindow.webContents.once("did-finish-load", () =>
      emitWindowFullscreenState()
    )
    mainWindow.on("resize", () => {
      emitInferredWindowFullscreenState()
      scheduleWindowStateSave()
    })
    mainWindow.on("move", () => {
      emitInferredWindowFullscreenState()
      scheduleWindowStateSave()
    })
    mainWindow.on("maximize", scheduleWindowStateSave)
    mainWindow.on("unmaximize", scheduleWindowStateSave)
    mainWindow.on("enter-full-screen", () => emitWindowFullscreenState())
    mainWindow.on("leave-full-screen", () => {
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
    configureBrowserWebAuthn,
    createWindow,
    ensureWindowWidth,
    getWindowFullscreenState,
    getMainWindow,
  }
}
