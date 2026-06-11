import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Download,
  ExternalLink,
  Globe2,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  Unlock,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type {
  OusiaBrowserAuthResponsePayload,
  OusiaBrowserDownloadState,
  OusiaBrowserFindState,
  OusiaBrowserSecurityState,
  OusiaBrowserState,
} from "@/electron/chat-types"
import type { ExtensionProps } from "@/extensions/types"

const DEFAULT_URL = "https://start.duckduckgo.com"
const SEARCH_URL = "https://duckduckgo.com/?q="

type StoredBrowserTabState = {
  url?: string
}

type AuthRequest = OusiaBrowserAuthResponsePayload & {
  host: string
  isProxy: boolean
  realm?: string
}

const initialBrowserState: OusiaBrowserState = {
  canGoBack: false,
  canGoForward: false,
  error: "",
  isCrashed: false,
  isLoading: false,
  profileMode: "global",
  securityState: "unknown",
  title: "",
  url: DEFAULT_URL,
  zoomLevel: 0,
  zoomPercent: 100,
}

function normalizeAddress(input: string) {
  const value = input.trim()
  if (!value) {
    return DEFAULT_URL
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) {
    return value
  }

  if (
    /^localhost(?::\d+)?(?:[/#?].*)?$/.test(value) ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/#?].*)?$/.test(value)
  ) {
    return `http://${value}`
  }

  if (!/\s/.test(value) && value.includes(".")) {
    return `https://${value}`
  }

  return `${SEARCH_URL}${encodeURIComponent(value)}`
}

function securityLabel(state: OusiaBrowserSecurityState) {
  switch (state) {
    case "secure":
      return "连接安全"
    case "insecure":
      return "不安全的 HTTP 连接"
    case "local":
      return "本地或内部页面"
    case "error":
      return "证书或连接错误"
    case "internal":
      return "浏览器内部资源"
    default:
      return "连接状态未知"
  }
}

function formatDownload(download: OusiaBrowserDownloadState) {
  if (download.state === "completed") {
    return `${download.filename} 下载完成`
  }
  if (download.state === "cancelled") {
    return `${download.filename} 已取消`
  }
  if (download.state === "interrupted") {
    return `${download.filename} 下载中断`
  }
  if (download.totalBytes <= 0) {
    return `${download.filename} 下载中`
  }
  const percent = Math.round((download.receivedBytes / download.totalBytes) * 100)
  return `${download.filename} ${percent}%`
}

export function BrowserExtension({ context }: ExtensionProps) {
  const tabId = context.tabId ?? "browser-default"
  const contentRef = useRef<HTMLDivElement | null>(null)
  const currentUrlRef = useRef(DEFAULT_URL)
  const isBrowserReadyRef = useRef(false)
  const zoomToastTimerRef = useRef<number | null>(null)
  const [address, setAddress] = useState(DEFAULT_URL)
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_URL)
  const [isStateLoaded, setIsStateLoaded] = useState(false)
  const [isBrowserReady, setIsBrowserReady] = useState(false)
  const [browserState, setBrowserState] =
    useState<OusiaBrowserState>(initialBrowserState)
  const [findText, setFindText] = useState("")
  const [findState, setFindState] = useState<OusiaBrowserFindState | null>(null)
  const [isFindVisible, setIsFindVisible] = useState(false)
  const [lastDownload, setLastDownload] =
    useState<OusiaBrowserDownloadState | null>(null)
  const [authRequest, setAuthRequest] = useState<AuthRequest | null>(null)
  const [authUsername, setAuthUsername] = useState("")
  const [authPassword, setAuthPassword] = useState("")
  const [isZoomToastVisible, setIsZoomToastVisible] = useState(false)

  const hasNativeBrowser = Boolean(window.ousia)
  const visibleError = browserState.isCrashed
    ? "页面进程已崩溃。"
    : browserState.error

  const statusIcon = useMemo(() => {
    if (browserState.isLoading) {
      return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
    }
    if (browserState.securityState === "secure") {
      return <Lock className="size-4 shrink-0 text-emerald-600" />
    }
    if (browserState.securityState === "insecure") {
      return <Unlock className="size-4 shrink-0 text-amber-600" />
    }
    if (browserState.securityState === "error") {
      return <ShieldAlert className="size-4 shrink-0 text-destructive" />
    }
    return <Globe2 className="size-4 shrink-0 text-muted-foreground" />
  }, [browserState.isLoading, browserState.securityState])

  const updateBounds = useCallback(() => {
    const container = contentRef.current
    if (!container || !window.ousia || !isBrowserReadyRef.current) {
      return
    }
    const rect = container.getBoundingClientRect()
    const isVisible =
      context.isActive === true &&
      rect.width > 0 &&
      rect.height > 0 &&
      container.getClientRects().length > 0
    void window.ousia.setBrowserBounds({
      bounds: {
        height: rect.height,
        width: rect.width,
        x: rect.left,
        y: rect.top,
      },
      tabId,
      visible: isVisible,
    })
  }, [context.isActive, tabId])

  useEffect(() => {
    currentUrlRef.current = currentUrl
  }, [currentUrl])

  useEffect(() => {
    isBrowserReadyRef.current = isBrowserReady
  }, [isBrowserReady])

  useEffect(() => {
    updateBounds()
  }, [context.isActive, updateBounds])

  useEffect(() => {
    let isCancelled = false
    const key = context.tabId ?? "default"
    void context.state
      .get<StoredBrowserTabState>("tab", key)
      .then((state) => {
        if (isCancelled) {
          return
        }
        const url = state?.url?.trim() || DEFAULT_URL
        setAddress(url)
        setCurrentUrl(url)
        setBrowserState((current) => ({
          ...current,
          profileMode: "global",
          url,
        }))
      })
      .finally(() => {
        if (!isCancelled) {
          setIsStateLoaded(true)
        }
      })
    return () => {
      isCancelled = true
    }
  }, [context.state, context.tabId])

  useEffect(() => {
    if (!isStateLoaded) {
      return
    }
    const key = context.tabId ?? "default"
    void context.state.set("tab", key, {
      url: currentUrl,
    })
  }, [context.state, context.tabId, currentUrl, isStateLoaded])

  useEffect(() => {
    if (!isStateLoaded || !window.ousia) {
      return
    }
    let isCancelled = false
    isBrowserReadyRef.current = false
    void window.ousia
      .createBrowser({
        initialUrl: currentUrlRef.current,
        profileMode: "global",
        projectId: context.project.id,
        projectPath: context.project.path,
        tabId,
      })
      .then((result) => {
        if (isCancelled) {
          return
        }
        if (result.state) {
          setBrowserState(result.state)
          setAddress(result.state.url || currentUrlRef.current)
          setCurrentUrl(result.state.url || currentUrlRef.current)
        }
        setIsBrowserReady(result.ok)
        isBrowserReadyRef.current = result.ok
        requestAnimationFrame(updateBounds)
      })

    return () => {
      isCancelled = true
      isBrowserReadyRef.current = false
      void window.ousia?.destroyBrowser({ tabId })
    }
  }, [
    context.project.id,
    context.project.path,
    isStateLoaded,
    tabId,
    updateBounds,
  ])

  useLayoutEffect(() => {
    if (!isBrowserReady) {
      return
    }
    updateBounds()
    const container = contentRef.current
    if (!container) {
      return
    }
    const resizeObserver = new ResizeObserver(updateBounds)
    resizeObserver.observe(container)
    window.addEventListener("resize", updateBounds)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", updateBounds)
    }
  }, [isBrowserReady, updateBounds])

  useEffect(() => {
    if (!isBrowserReady) {
      return
    }
    const handleVisibility = () => updateBounds()
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [isBrowserReady, updateBounds])

  const closeFind = useCallback(() => {
    setIsFindVisible(false)
    setFindText("")
    setFindState(null)
    void window.ousia?.stopBrowserFind({ tabId })
  }, [tabId])

  const quoteSelectionToInput = useCallback(async () => {
    if (!context.agent.quoteToInput || !window.ousia) {
      return
    }

    try {
      const result = await window.ousia.readBrowserSelection({ tabId })
      const text = result?.text?.trim()
      if (!result || !text) {
        setBrowserState((state) => ({
          ...state,
          error: "请先在页面中选择要引用的文字。",
        }))
        return
      }
      await context.agent.quoteToInput({
        source: {
          extensionId: context.extensionId,
          tabId: context.tabId,
          title: result.title || currentUrlRef.current,
          url: result.url || currentUrlRef.current,
        },
        quote: {
          html: result.html,
          text,
        },
      })
      setBrowserState((state) => ({ ...state, error: "" }))
    } catch {
      setBrowserState((state) => ({
        ...state,
        error: "读取页面选区失败。",
      }))
    }
  }, [context.agent, context.extensionId, context.tabId, tabId])

  useEffect(() => {
    return window.ousia?.onBrowserEvent((event) => {
      if (event.type === "download") {
        setLastDownload(event.download)
        return
      }
      if (event.tabId !== tabId) {
        return
      }
      if (event.type === "open-tab") {
        void context.app?.openBrowserTab?.(event.url)
        return
      }
      if (event.type === "quote-selection") {
        void quoteSelectionToInput()
        return
      }
      if (event.type === "state") {
        setBrowserState(event.state)
        setAddress(event.state.url || DEFAULT_URL)
        setCurrentUrl(event.state.url || DEFAULT_URL)
      } else if (event.type === "find") {
        setFindState(event.find)
      } else if (event.type === "auth") {
        setAuthRequest({
          canceled: false,
          host: event.request.host,
          isProxy: event.request.isProxy,
          password: "",
          realm: event.request.realm,
          requestId: event.request.requestId,
          username: "",
        })
        setAuthUsername("")
        setAuthPassword("")
      }
    })
  }, [context.app, quoteSelectionToInput, tabId])

  const showZoomToast = useCallback(() => {
    setIsZoomToastVisible(true)
    if (zoomToastTimerRef.current) {
      window.clearTimeout(zoomToastTimerRef.current)
    }
    zoomToastTimerRef.current = window.setTimeout(() => {
      setIsZoomToastVisible(false)
      zoomToastTimerRef.current = null
    }, 1200)
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault()
        setIsFindVisible(true)
        return
      }
      if (event.metaKey || event.ctrlKey) {
        if (event.key === "-" || event.key === "_") {
          event.preventDefault()
          showZoomToast()
          void window.ousia?.setBrowserZoom({ delta: -1, tabId })
          return
        }
        if (event.key === "+" || event.key === "=") {
          event.preventDefault()
          showZoomToast()
          void window.ousia?.setBrowserZoom({ delta: 1, tabId })
          return
        }
        if (event.key === "0") {
          event.preventDefault()
          showZoomToast()
          void window.ousia?.setBrowserZoom({ level: 0, tabId })
          return
        }
      }
      if (event.key === "Escape" && isFindVisible) {
        closeFind()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [closeFind, isFindVisible, showZoomToast, tabId])

  useEffect(() => {
    return () => {
      if (zoomToastTimerRef.current) {
        window.clearTimeout(zoomToastTimerRef.current)
      }
    }
  }, [])

  function navigate(nextAddress = address) {
    const nextUrl = normalizeAddress(nextAddress)
    setAddress(nextUrl)
    setCurrentUrl(nextUrl)
    void window.ousia?.navigateBrowser({ tabId, url: nextUrl })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    navigate()
  }

  function handleFindSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!findText.trim()) {
      void window.ousia?.stopBrowserFind({ tabId })
      return
    }
    void window.ousia?.findInBrowser({
      findNext: true,
      forward: true,
      tabId,
      text: findText,
    })
  }

  function respondToAuth(canceled: boolean) {
    if (!authRequest || !window.ousia) {
      return
    }
    void window.ousia.respondToBrowserAuth({
      canceled,
      password: authPassword,
      requestId: authRequest.requestId,
      username: authUsername,
    })
    setAuthRequest(null)
    setAuthUsername("")
    setAuthPassword("")
  }

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden bg-card text-card-foreground">
      <div className="relative flex shrink-0 flex-col border-b bg-muted/35">
        {isZoomToastVisible ? (
          <div className="pointer-events-none absolute right-12 top-10 z-10 rounded-md border bg-popover px-3 py-1.5 text-sm font-medium text-popover-foreground shadow-sm tabular-nums">
            {browserState.zoomPercent}%
          </div>
        ) : null}
        <div className="flex h-9 items-center gap-1.5 px-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="后退"
            disabled={!browserState.canGoBack}
            onClick={() => void window.ousia?.browserBack({ tabId })}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="前进"
            disabled={!browserState.canGoForward}
            onClick={() => void window.ousia?.browserForward({ tabId })}
          >
            <ArrowRight className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={browserState.isLoading ? "停止加载" : "重新加载"}
            onClick={() =>
              browserState.isLoading
                ? void window.ousia?.stopBrowser({ tabId })
                : void window.ousia?.reloadBrowser({ tabId })
            }
          >
            {browserState.isLoading ? (
              <X className="size-4" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>

          <form
            className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-background px-2 focus-within:ring-[2px] focus-within:ring-ring/50"
            onSubmit={handleSubmit}
          >
            <span title={securityLabel(browserState.securityState)}>
              {statusIcon}
            </span>
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="浏览器地址"
              value={address}
              placeholder="输入网址或搜索内容"
              onChange={(event) => setAddress(event.target.value)}
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon-xs"
              aria-label="打开地址"
            >
              <Search className="size-4" />
            </Button>
          </form>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="在外部浏览器中打开"
            onClick={() => void window.ousia?.openBrowserExternal({ tabId })}
          >
            <ExternalLink className="size-4" />
          </Button>
        </div>

        {isFindVisible ? (
          <form
            className="flex h-9 items-center gap-2 border-t px-2"
            onSubmit={handleFindSubmit}
          >
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none"
              aria-label="页内搜索"
              value={findText}
              placeholder="搜索当前页面"
              onChange={(event) => {
                const text = event.target.value
                setFindText(text)
                void window.ousia?.findInBrowser({ tabId, text })
              }}
            />
            <div className="w-20 text-right text-xs text-muted-foreground tabular-nums">
              {findState?.matches
                ? `${findState.activeMatchOrdinal}/${findState.matches}`
                : "0/0"}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="上一个匹配"
              onClick={() =>
                void window.ousia?.findInBrowser({
                  findNext: true,
                  forward: false,
                  tabId,
                  text: findText,
                })
              }
            >
              <ArrowLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="下一个匹配"
              onClick={() =>
                void window.ousia?.findInBrowser({
                  findNext: true,
                  forward: true,
                  tabId,
                  text: findText,
                })
              }
            >
              <ArrowRight className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="关闭页内搜索"
              onClick={closeFind}
            >
              <X className="size-4" />
            </Button>
          </form>
        ) : null}

        {authRequest ? (
          <form
            className="flex h-10 items-center gap-2 border-t px-2"
            onSubmit={(event) => {
              event.preventDefault()
              respondToAuth(false)
            }}
          >
            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 shrink text-xs text-muted-foreground">
              {authRequest.isProxy ? "代理认证" : "网站认证"} {authRequest.host}
            </div>
            <input
              className="h-7 w-36 rounded-md border bg-background px-2 text-sm outline-none"
              aria-label="用户名"
              value={authUsername}
              placeholder="用户名"
              onChange={(event) => setAuthUsername(event.target.value)}
            />
            <input
              className="h-7 w-36 rounded-md border bg-background px-2 text-sm outline-none"
              aria-label="密码"
              type="password"
              value={authPassword}
              placeholder="密码"
              onChange={(event) => setAuthPassword(event.target.value)}
            />
            <Button type="submit" variant="secondary" size="sm">
              登录
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => respondToAuth(true)}
            >
              取消
            </Button>
          </form>
        ) : null}

        {lastDownload ? (
          <div className="flex h-7 items-center gap-2 border-t px-2 text-xs text-muted-foreground">
            <Download className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{formatDownload(lastDownload)}</span>
          </div>
        ) : null}

        {visibleError ? (
          <div className="flex h-8 items-center gap-2 border-t px-2 text-xs text-destructive">
            <ShieldAlert className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{visibleError}</span>
            {browserState.isCrashed ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void window.ousia?.reloadBrowser({ tabId })}
              >
                重新加载
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 bg-background">
        {!hasNativeBrowser ? (
          <div className="absolute inset-4 z-10 flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
            <span>当前环境不支持 Electron 浏览器宿主。</span>
          </div>
        ) : null}
        <div
          ref={contentRef}
          className="h-full w-full"
          onMouseEnter={() => updateBounds()}
          onFocus={() => void window.ousia?.focusBrowser({ tabId })}
        />
      </div>
    </div>
  )
}
