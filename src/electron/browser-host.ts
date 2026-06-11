import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  session as electronSession,
  shell,
  WebContentsView,
  type Certificate,
  type HandlerDetails,
  type PermissionRequest,
  type Rectangle,
  type Session,
  type WebAuthnAccount,
  type WebContents,
} from "electron"
import { join } from "node:path"

import type {
  OusiaBrowserAuthResponsePayload,
  OusiaBrowserBoundsPayload,
  OusiaBrowserCreatePayload,
  OusiaBrowserDownloadState,
  OusiaBrowserEvent,
  OusiaBrowserFindPayload,
  OusiaBrowserFindState,
  OusiaBrowserNavigatePayload,
  OusiaBrowserOperationResult,
  OusiaBrowserProfileMode,
  OusiaBrowserSelectionResult,
  OusiaBrowserSecurityState,
  OusiaBrowserState,
  OusiaBrowserStopFindPayload,
  OusiaBrowserTabPayload,
  OusiaBrowserZoomPayload,
} from "./chat-types.js"
import { writeRuntimeLog } from "./runtime-logger.js"

const DEFAULT_BROWSER_PARTITION = "persist:ousia-browser"
const READ_SELECTION_SCRIPT = `(() => {
  const selection = window.getSelection();
  const text = selection?.toString() ?? "";
  let html = "";
  if (selection && selection.rangeCount) {
    const container = document.createElement("div");
    for (let index = 0; index < selection.rangeCount; index += 1) {
      container.append(selection.getRangeAt(index).cloneContents());
    }
    html = container.innerHTML;
  }
  return {
    text,
    html,
    title: document.title,
    url: window.location.href,
  };
})()`

type BrowserTab = {
  certificateError?: string
  faviconUrl?: string
  profileMode: OusiaBrowserProfileMode
  tabId: string
  view: WebContentsView
}

type AuthRequest = {
  callback: (username?: string, password?: string) => void
  tabId: string
}

type BrowserHostOptions = {
  getMainWindow: () => BrowserWindow | undefined
}

function isAllowedNavigationUrl(url: string) {
  try {
    const parsed = new URL(url)
    return ["about:", "blob:", "data:", "file:", "http:", "https:"].includes(
      parsed.protocol
    )
  } catch {
    return false
  }
}

function isExternalUrl(url: string) {
  try {
    const parsed = new URL(url)
    return ["http:", "https:", "mailto:"].includes(parsed.protocol)
  } catch {
    return false
  }
}

function stableKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function partitionFor(payload: OusiaBrowserCreatePayload) {
  if (payload.profileMode === "global") {
    return DEFAULT_BROWSER_PARTITION
  }
  if (payload.profileMode === "project") {
    const key = stableKey(payload.projectId || payload.projectPath || "default")
    return `persist:ousia-browser-project-${key || "default"}`
  }
  return `ousia-browser-temp-${stableKey(payload.tabId) || "tab"}`
}

function originFor(url: string) {
  try {
    const parsed = new URL(url)
    if (["http:", "https:"].includes(parsed.protocol)) {
      return parsed.origin
    }
    return parsed.protocol
  } catch {
    return "unknown"
  }
}

function securityStateFor(url: string, certificateError?: string) {
  if (certificateError) {
    return "error" satisfies OusiaBrowserSecurityState
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:") {
      return "secure" satisfies OusiaBrowserSecurityState
    }
    if (parsed.protocol === "http:") {
      if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
        return "local" satisfies OusiaBrowserSecurityState
      }
      return "insecure" satisfies OusiaBrowserSecurityState
    }
    if (["file:", "about:"].includes(parsed.protocol)) {
      return "local" satisfies OusiaBrowserSecurityState
    }
    return "internal" satisfies OusiaBrowserSecurityState
  } catch {
    return "unknown" satisfies OusiaBrowserSecurityState
  }
}

function downloadState(
  id: string,
  item: Electron.DownloadItem,
  state: OusiaBrowserDownloadState["state"]
): OusiaBrowserDownloadState {
  return {
    id,
    filename: item.getFilename(),
    receivedBytes: item.getReceivedBytes(),
    savePath: item.getSavePath(),
    state,
    totalBytes: item.getTotalBytes(),
    url: item.getURL(),
  }
}

function permissionLabel(permission: string, details: PermissionRequest) {
  if (permission === "media" && "mediaTypes" in details) {
    const mediaTypes = Array.isArray(details.mediaTypes)
      ? details.mediaTypes.join("、")
      : ""
    return `使用${mediaTypes || "摄像头/麦克风"}`
  }
  const labels: Record<string, string> = {
    "clipboard-read": "读取剪贴板",
    "clipboard-sanitized-write": "写入剪贴板",
    "display-capture": "共享屏幕",
    fileSystem: "访问文件系统",
    fullscreen: "进入全屏",
    geolocation: "访问位置",
    media: "使用摄像头/麦克风",
    mediaKeySystem: "播放受保护媒体",
    notifications: "发送通知",
    openExternal: "打开外部应用",
    pointerLock: "锁定鼠标指针",
    "speaker-selection": "选择音频输出设备",
    "storage-access": "访问第三方存储",
    "top-level-storage-access": "访问顶层存储",
    "window-management": "管理窗口",
  }
  return labels[permission] ?? permission
}

function certificateLabel(certificate: Certificate) {
  const subject = certificate.subjectName || certificate.issuerName
  return subject || certificate.fingerprint || "未知证书"
}

function describeWebAuthnAccount(account: WebAuthnAccount) {
  return (
    account.displayName ||
    account.name ||
    account.userHandle ||
    account.credentialId
  )
}

export function createBrowserHost({ getMainWindow }: BrowserHostOptions) {
  const tabs = new Map<string, BrowserTab>()
  const configuredPartitions = new Set<string>()
  const authRequests = new Map<string, AuthRequest>()
  const permissionGrants = new Map<string, boolean>()
  let downloadCounter = 0
  let authCounter = 0

  function emit(event: OusiaBrowserEvent) {
    getMainWindow()?.webContents.send("ousia:browser:event", event)
  }

  function stateFor(tab: BrowserTab): OusiaBrowserState {
    const contents = tab.view.webContents
    const url = contents.getURL()
    const zoomLevel = contents.getZoomLevel()
    return {
      canGoBack: contents.canGoBack(),
      canGoForward: contents.canGoForward(),
      certificateError: tab.certificateError,
      error: tab.certificateError ?? "",
      faviconUrl: tab.faviconUrl,
      isCrashed: contents.isCrashed(),
      isLoading: contents.isLoading(),
      profileMode: tab.profileMode,
      securityState: securityStateFor(url, tab.certificateError),
      title: contents.getTitle(),
      url,
      zoomLevel,
      zoomPercent: Math.round(contents.getZoomFactor() * 100),
    }
  }

  function emitState(tab: BrowserTab) {
    if (tab.view.webContents.isDestroyed()) {
      return
    }
    emit({
      type: "state",
      tabId: tab.tabId,
      state: stateFor(tab),
    })
  }

  function configureSession(partition: string) {
    if (configuredPartitions.has(partition)) {
      return
    }
    configuredPartitions.add(partition)
    const ses = electronSession.fromPartition(partition)

    ses.on(
      "select-webauthn-account",
      async (_event, details, callback) => {
        try {
          if (details.accounts.length === 0) {
            callback()
            return
          }

          if (details.accounts.length === 1) {
            callback(details.accounts[0].credentialId)
            return
          }

          const mainWindow = getMainWindow()
          const buttons = details.accounts.map(describeWebAuthnAccount)
          const cancelId = buttons.length
          const result = mainWindow
            ? await dialog.showMessageBox(mainWindow, {
                buttons: [...buttons, "取消"],
                cancelId,
                defaultId: 0,
                message: `为 ${details.relyingPartyId} 选择一个通行密钥`,
                noLink: true,
                title: "选择通行密钥",
                type: "question",
              })
            : { response: cancelId }

          callback(
            result.response === cancelId
              ? undefined
              : details.accounts[result.response]?.credentialId
          )
        } catch {
          callback()
        }
      }
    )

    ses.on("will-download", (_event, item) => {
      const id = `download-${Date.now()}-${++downloadCounter}`
      const savePath = join(app.getPath("downloads"), item.getFilename())
      item.setSavePath(savePath)
      emit({ type: "download", download: downloadState(id, item, "started") })
      item.on("updated", (_updatedEvent, state) => {
        emit({
          type: "download",
          download: downloadState(
            id,
            item,
            state === "interrupted" ? "interrupted" : "progressing"
          ),
        })
      })
      item.once("done", (_doneEvent, state) => {
        emit({
          type: "download",
          download: downloadState(id, item, state),
        })
      })
    })

    ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
      if (permission === "fullscreen") {
        return true
      }
      const key = `${requestingOrigin || "unknown"}:${permission}`
      return permissionGrants.get(key) === true
    })

    ses.setPermissionRequestHandler(
      async (webContents, permission, callback, details) => {
        if (permission === "fullscreen") {
          callback(true)
          return
        }

        const requestingUrl =
          "requestingUrl" in details && details.requestingUrl
            ? details.requestingUrl
            : webContents.getURL()
        const origin = originFor(requestingUrl)
        const key = `${origin}:${permission}`
        if (permissionGrants.get(key)) {
          callback(true)
          return
        }

        const mainWindow = getMainWindow()
        const result = mainWindow
          ? await dialog.showMessageBox(mainWindow, {
              buttons: ["允许", "拒绝"],
              cancelId: 1,
              defaultId: 0,
              message: `${origin} 请求${permissionLabel(permission, details)}`,
              noLink: true,
              title: "网站权限请求",
              type: "question",
            })
          : { response: 1 }
        const granted = result.response === 0
        if (granted) {
          permissionGrants.set(key, true)
        }
        callback(granted)
      }
    )

    return ses
  }

  function configurePopup(contents: WebContents, ses: Session) {
    contents.setWindowOpenHandler((details) =>
      windowOpenResponse(details, ses, contents.getURL())
    )
    contents.on("context-menu", (_event, params) => {
      const popupWindow = BrowserWindow.fromWebContents(contents)
      showContextMenu(contents, popupWindow ?? getMainWindow(), params)
    })
  }

  function windowOpenResponse(
    details: HandlerDetails,
    ses: Session,
    openerUrl: string,
    tabId?: string
  ): Electron.WindowOpenHandlerResponse {
    if (!isAllowedNavigationUrl(details.url)) {
      if (isExternalUrl(details.url)) {
        void shell.openExternal(details.url)
      }
      return { action: "deny" }
    }

    writeRuntimeLog("browser.window-open", "info", {
      disposition: details.disposition,
      openerUrl,
      url: details.url,
    })

    if (tabId) {
      emit({ type: "open-tab", tabId, url: details.url })
      return { action: "deny" }
    }

    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        backgroundColor: "#111111",
        height: 720,
        show: true,
        title: "Ousia Browser",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          safeDialogs: true,
          sandbox: true,
          session: ses,
        },
        width: 1024,
      },
    }
  }

  function showContextMenu(
    contents: WebContents,
    window: BrowserWindow | undefined,
    params: Electron.ContextMenuParams,
    tabId?: string
  ) {
    const template: Electron.MenuItemConstructorOptions[] = []

    if (params.linkURL) {
      template.push(
        ...(tabId
          ? [
              {
                label: "在新标签页打开链接",
                click: () =>
                  emit({ type: "open-tab", tabId, url: params.linkURL }),
              } satisfies Electron.MenuItemConstructorOptions,
            ]
          : []),
        {
          label: "在外部浏览器打开链接",
          click: () => void shell.openExternal(params.linkURL),
        },
        {
          label: "复制链接",
          click: () => clipboard.writeText(params.linkURL),
        }
      )
    }

    if (params.srcURL) {
      if (template.length) {
        template.push({ type: "separator" })
      }
      template.push(
        {
          label: "在外部浏览器打开资源",
          click: () => void shell.openExternal(params.srcURL),
        },
        {
          label: "复制资源地址",
          click: () => clipboard.writeText(params.srcURL),
        }
      )
    }

    if (params.selectionText) {
      if (template.length) {
        template.push({ type: "separator" })
      }
      if (tabId) {
        template.push({
          label: "引用到输入区",
          click: () => emit({ type: "quote-selection", tabId }),
        })
      }
      template.push({ role: "copy" })
    }

    if (params.isEditable) {
      if (template.length) {
        template.push({ type: "separator" })
      }
      template.push(
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        { role: "selectAll" }
      )
    }

    if (template.length) {
      template.push({ type: "separator" })
    }
    template.push(
      {
        enabled: contents.canGoBack(),
        label: "后退",
        click: () => contents.goBack(),
      },
      {
        enabled: contents.canGoForward(),
        label: "前进",
        click: () => contents.goForward(),
      },
      {
        label: "重新加载",
        click: () => contents.reload(),
      },
      { type: "separator" },
      {
        label: "检查元素",
        click: () => contents.inspectElement(params.x, params.y),
      }
    )

    Menu.buildFromTemplate(template).popup({ window })
  }

  function attachTabEvents(tab: BrowserTab, ses: Session) {
    const contents = tab.view.webContents

    contents.setWindowOpenHandler((details) =>
      windowOpenResponse(details, ses, contents.getURL(), tab.tabId)
    )
    contents.on("did-create-window", (window) => {
      configurePopup(window.webContents, ses)
    })
    contents.on("did-start-loading", () => {
      tab.certificateError = undefined
      emitState(tab)
    })
    contents.on("did-stop-loading", () => emitState(tab))
    contents.on("did-navigate", () => {
      tab.certificateError = undefined
      emitState(tab)
    })
    contents.on("did-navigate-in-page", () => emitState(tab))
    contents.on("page-title-updated", () => emitState(tab))
    contents.on("page-favicon-updated", (_event, favicons) => {
      tab.faviconUrl = favicons[0]
      emitState(tab)
    })
    contents.on(
      "did-fail-load",
      (_event, code, description, url, isMainFrame) => {
        if (!isMainFrame || code === -3) {
          return
        }
        writeRuntimeLog("browser.load", "warn", { code, description, url })
        tab.certificateError = description
        emitState(tab)
      }
    )
    contents.on("certificate-error", (event, url, error, certificate, callback) => {
      event.preventDefault()
      tab.certificateError = `${error}: ${certificateLabel(certificate)}`
      writeRuntimeLog("browser.certificate", "warn", { error, url })
      emitState(tab)
      callback(false)
    })
    contents.on("select-client-certificate", async (event, url, certificates, callback) => {
      event.preventDefault()
      const mainWindow = getMainWindow()
      if (!mainWindow || certificates.length === 0) {
        callback(undefined as unknown as Certificate)
        return
      }
      const buttons = certificates.map(certificateLabel)
      const cancelId = buttons.length
      const result = await dialog.showMessageBox(mainWindow, {
        buttons: [...buttons, "取消"],
        cancelId,
        defaultId: 0,
        message: `为 ${originFor(url)} 选择客户端证书`,
        noLink: true,
        title: "客户端证书",
        type: "question",
      })
      callback(
        result.response === cancelId
          ? (undefined as unknown as Certificate)
          : certificates[result.response]
      )
    })
    contents.on("login", (event, _details, authInfo, callback) => {
      event.preventDefault()
      const requestId = `auth-${Date.now()}-${++authCounter}`
      authRequests.set(requestId, { callback, tabId: tab.tabId })
      emit({
        type: "auth",
        request: {
          host: authInfo.host,
          isProxy: authInfo.isProxy,
          realm: authInfo.realm,
          requestId,
          tabId: tab.tabId,
        },
      })
    })
    contents.on("context-menu", (_event, params) => {
      showContextMenu(contents, getMainWindow(), params, tab.tabId)
    })
    contents.on("render-process-gone", (_event, details) => {
      writeRuntimeLog("browser.process", "error", {
        details,
        tabId: tab.tabId,
        url: contents.getURL(),
      })
      emitState(tab)
    })
    contents.on("unresponsive", () => {
      writeRuntimeLog("browser.process", "warn", {
        tabId: tab.tabId,
        url: contents.getURL(),
      })
      emitState(tab)
    })
    contents.on("responsive", () => emitState(tab))
    contents.on("found-in-page", (_event, result) => {
      const find: OusiaBrowserFindState = {
        activeMatchOrdinal: result.activeMatchOrdinal,
        finalUpdate: result.finalUpdate,
        matches: result.matches,
        requestId: result.requestId,
        selectionArea: result.selectionArea,
      }
      emit({ type: "find", tabId: tab.tabId, find })
    })
    contents.on("zoom-changed", (_event, direction) => {
      const delta = direction === "in" ? 1 : -1
      setZoom({ tabId: tab.tabId, delta })
    })
  }

  function getTab(tabId: string) {
    return tabs.get(tabId)
  }

  function create(payload: OusiaBrowserCreatePayload): OusiaBrowserOperationResult {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false }
    }

    destroy({ tabId: payload.tabId })

    const partition = partitionFor(payload)
    const ses = configureSession(partition) ?? electronSession.fromPartition(partition)
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition,
        safeDialogs: true,
        sandbox: true,
      },
    })
    view.setBackgroundColor("#ffffff")
    view.setVisible(false)
    mainWindow.contentView.addChildView(view)

    const tab: BrowserTab = {
      profileMode: payload.profileMode,
      tabId: payload.tabId,
      view,
    }
    tabs.set(payload.tabId, tab)
    attachTabEvents(tab, ses)

    if (isAllowedNavigationUrl(payload.initialUrl)) {
      void view.webContents.loadURL(payload.initialUrl)
    }
    emitState(tab)
    return { ok: true, state: stateFor(tab) }
  }

  function setBounds(payload: OusiaBrowserBoundsPayload): OusiaBrowserOperationResult {
    const tab = getTab(payload.tabId)
    if (!tab) {
      return { ok: false }
    }
    const bounds: Rectangle = {
      x: Math.max(0, Math.round(payload.bounds.x)),
      y: Math.max(0, Math.round(payload.bounds.y)),
      width: Math.max(0, Math.round(payload.bounds.width)),
      height: Math.max(0, Math.round(payload.bounds.height)),
    }
    tab.view.setBounds(bounds)
    tab.view.setVisible(payload.visible && bounds.width > 0 && bounds.height > 0)
    return { ok: true, state: stateFor(tab) }
  }

  function navigate(payload: OusiaBrowserNavigatePayload) {
    const tab = getTab(payload.tabId)
    if (!tab || !isAllowedNavigationUrl(payload.url)) {
      return { ok: false }
    }
    void tab.view.webContents.loadURL(payload.url)
    emitState(tab)
    return { ok: true, state: stateFor(tab) }
  }

  function goBack(payload: OusiaBrowserTabPayload) {
    const tab = getTab(payload.tabId)
    if (!tab || !tab.view.webContents.canGoBack()) {
      return { ok: false }
    }
    tab.view.webContents.goBack()
    return { ok: true, state: stateFor(tab) }
  }

  function goForward(payload: OusiaBrowserTabPayload) {
    const tab = getTab(payload.tabId)
    if (!tab || !tab.view.webContents.canGoForward()) {
      return { ok: false }
    }
    tab.view.webContents.goForward()
    return { ok: true, state: stateFor(tab) }
  }

  function reload(payload: OusiaBrowserTabPayload) {
    const tab = getTab(payload.tabId)
    if (!tab) {
      return { ok: false }
    }
    if (tab.view.webContents.isCrashed()) {
      tab.view.webContents.reload()
    } else {
      tab.view.webContents.reload()
    }
    return { ok: true, state: stateFor(tab) }
  }

  function stop(payload: OusiaBrowserTabPayload) {
    const tab = getTab(payload.tabId)
    if (!tab) {
      return { ok: false }
    }
    tab.view.webContents.stop()
    return { ok: true, state: stateFor(tab) }
  }

  function focus(payload: OusiaBrowserTabPayload) {
    const tab = getTab(payload.tabId)
    if (!tab) {
      return { ok: false }
    }
    tab.view.webContents.focus()
    return { ok: true, state: stateFor(tab) }
  }

  async function readSelection(
    payload: OusiaBrowserTabPayload
  ): Promise<OusiaBrowserSelectionResult | null> {
    const tab = getTab(payload.tabId)
    if (!tab) {
      return null
    }
    const result = await tab.view.webContents.executeJavaScript(
      READ_SELECTION_SCRIPT
    )
    if (!result || typeof result !== "object") {
      return null
    }
    return {
      html: typeof result.html === "string" ? result.html : "",
      text: typeof result.text === "string" ? result.text : "",
      title: typeof result.title === "string" ? result.title : "",
      url: typeof result.url === "string" ? result.url : "",
    }
  }

  function find(payload: OusiaBrowserFindPayload) {
    const tab = getTab(payload.tabId)
    if (!tab) {
      return { ok: false }
    }
    if (!payload.text) {
      tab.view.webContents.stopFindInPage("clearSelection")
      return { ok: true, state: stateFor(tab) }
    }
    tab.view.webContents.findInPage(payload.text, {
      findNext: payload.findNext,
      forward: payload.forward,
      matchCase: payload.matchCase,
    })
    return { ok: true, state: stateFor(tab) }
  }

  function stopFind(payload: OusiaBrowserStopFindPayload) {
    const tab = getTab(payload.tabId)
    if (!tab) {
      return { ok: false }
    }
    tab.view.webContents.stopFindInPage(payload.action ?? "clearSelection")
    return { ok: true, state: stateFor(tab) }
  }

  function setZoom(payload: OusiaBrowserZoomPayload) {
    const tab = getTab(payload.tabId)
    if (!tab) {
      return { ok: false }
    }
    const current = tab.view.webContents.getZoomLevel()
    const next = payload.level ?? current + (payload.delta ?? 0)
    const clamped = Math.max(-6, Math.min(6, next))
    tab.view.webContents.setZoomLevel(clamped)
    emitState(tab)
    return { ok: true, state: stateFor(tab) }
  }

  function openExternal(payload: OusiaBrowserTabPayload) {
    const tab = getTab(payload.tabId)
    if (!tab) {
      return { ok: false }
    }
    const url = tab.view.webContents.getURL()
    if (isExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { ok: true, state: stateFor(tab) }
  }

  function respondToAuth(payload: OusiaBrowserAuthResponsePayload) {
    const request = authRequests.get(payload.requestId)
    if (!request) {
      return { ok: false }
    }
    authRequests.delete(payload.requestId)
    if (payload.canceled) {
      request.callback()
    } else {
      request.callback(payload.username ?? "", payload.password ?? "")
    }
    const tab = tabs.get(request.tabId)
    return { ok: true, state: tab ? stateFor(tab) : undefined }
  }

  function destroy(payload: OusiaBrowserTabPayload) {
    const tab = tabs.get(payload.tabId)
    if (!tab) {
      return { ok: true }
    }
    tabs.delete(payload.tabId)
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.contentView.removeChildView(tab.view)
    }
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close({ waitForBeforeUnload: false })
    }
    return { ok: true }
  }

  function destroyAll() {
    for (const tabId of [...tabs.keys()]) {
      destroy({ tabId })
    }
  }

  return {
    create,
    destroy,
    destroyAll,
    find,
    focus,
    goBack,
    goForward,
    navigate,
    openExternal,
    readSelection,
    reload,
    respondToAuth,
    setBounds,
    setZoom,
    stop,
    stopFind,
  }
}
