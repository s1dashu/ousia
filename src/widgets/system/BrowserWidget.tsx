import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type { WidgetProps } from "@/widgets/types"

const DEFAULT_URL = "https://www.electronjs.org"
const SEARCH_URL = "https://duckduckgo.com/?q="
const BROWSER_PARTITION = "persist:ousia-browser"

type BrowserState = {
  canGoBack: boolean
  canGoForward: boolean
  error: string
  isLoading: boolean
  title: string
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

function formatLoadError(errorCode?: number, errorDescription?: string) {
  if (errorCode === -3) {
    return ""
  }
  return errorDescription || "Failed to load this page."
}

export function BrowserWidget(_props: WidgetProps) {
  void _props
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const [address, setAddress] = useState(DEFAULT_URL)
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_URL)
  const [browserState, setBrowserState] = useState<BrowserState>({
    canGoBack: false,
    canGoForward: false,
    error: "",
    isLoading: false,
    title: "",
  })
  const readNavigationState = useCallback(
    (webview: Electron.WebviewTag | null) => {
      if (!webview) {
        return {
          canGoBack: false,
          canGoForward: false,
          title: "",
        }
      }

      try {
        return {
          canGoBack: webview.canGoBack(),
          canGoForward: webview.canGoForward(),
          title: webview.getTitle(),
        }
      } catch {
        return {
          canGoBack: false,
          canGoForward: false,
          title: "",
        }
      }
    },
    []
  )

  const updateNavigationState = useCallback(
    (next?: Partial<BrowserState>) => {
      const navigationState = readNavigationState(webviewRef.current)
      setBrowserState((state) => ({
        ...state,
        canGoBack: navigationState.canGoBack,
        canGoForward: navigationState.canGoForward,
        title: navigationState.title || state.title,
        ...next,
      }))
    },
    [readNavigationState]
  )

  function navigate(nextAddress = address) {
    const nextUrl = normalizeAddress(nextAddress)
    setAddress(nextUrl)
    setCurrentUrl(nextUrl)
    setBrowserState((state) => ({ ...state, error: "" }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    navigate()
  }

  function openExternal() {
    let url = currentUrl
    try {
      url = webviewRef.current?.getURL() || currentUrl
    } catch {
      url = currentUrl
    }
    window.open(url, "_blank", "noopener,noreferrer")
  }

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) {
      return
    }

    const handleStartLoading = () => {
      updateNavigationState({ error: "", isLoading: true })
    }
    const handleStopLoading = () => {
      updateNavigationState({ isLoading: false })
    }
    const handleNavigation = () => {
      let nextUrl = currentUrl
      try {
        nextUrl = webview.getURL()
      } catch {
        nextUrl = currentUrl
      }
      setAddress(nextUrl)
      setCurrentUrl(nextUrl)
      updateNavigationState({ error: "" })
    }
    const handleTitle = () => {
      updateNavigationState()
    }
    const handleFail = (event: Electron.DidFailLoadEvent) => {
      if (!event.isMainFrame) {
        return
      }
      updateNavigationState({
        error: formatLoadError(event.errorCode, event.errorDescription),
        isLoading: false,
      })
    }

    webview.addEventListener("did-start-loading", handleStartLoading)
    webview.addEventListener("did-stop-loading", handleStopLoading)
    webview.addEventListener("did-navigate", handleNavigation)
    webview.addEventListener("did-navigate-in-page", handleNavigation)
    webview.addEventListener("page-title-updated", handleTitle)
    webview.addEventListener("did-fail-load", handleFail)

    return () => {
      webview.removeEventListener("did-start-loading", handleStartLoading)
      webview.removeEventListener("did-stop-loading", handleStopLoading)
      webview.removeEventListener("did-navigate", handleNavigation)
      webview.removeEventListener("did-navigate-in-page", handleNavigation)
      webview.removeEventListener("page-title-updated", handleTitle)
      webview.removeEventListener("did-fail-load", handleFail)
    }
  }, [currentUrl, updateNavigationState])

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden bg-card text-card-foreground">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b bg-muted/35 px-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Go back"
          disabled={!browserState.canGoBack}
          onClick={() => webviewRef.current?.goBack()}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Go forward"
          disabled={!browserState.canGoForward}
          onClick={() => webviewRef.current?.goForward()}
        >
          <ArrowRight className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={browserState.isLoading ? "Stop loading" : "Reload"}
          onClick={() =>
            browserState.isLoading
              ? webviewRef.current?.stop()
              : webviewRef.current?.reload()
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
          {browserState.isLoading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Globe2 className="size-4 shrink-0 text-muted-foreground" />
          )}
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Browser address"
            value={address}
            placeholder="Enter a URL or search"
            onChange={(event) => setAddress(event.target.value)}
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon-xs"
            aria-label="Load address"
          >
            <Search className="size-4" />
          </Button>
        </form>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Open in external browser"
          onClick={openExternal}
        >
          <ExternalLink className="size-4" />
        </Button>
      </div>

      {browserState.title ? (
        <div className="truncate border-b px-3 py-1 text-xs text-muted-foreground">
          {browserState.title}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 bg-background">
        {browserState.error ? (
          <div className="absolute inset-x-4 top-4 z-10 flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm shadow-sm">
            <ShieldAlert className="size-4 shrink-0 text-destructive" />
            <span className="min-w-0 truncate">{browserState.error}</span>
          </div>
        ) : null}
        <webview
          ref={webviewRef}
          className="h-full w-full"
          src={currentUrl}
          partition={BROWSER_PARTITION}
          allowpopups
          webpreferences="contextIsolation=yes,nodeIntegration=no"
          style={{ display: "flex" }}
        />
      </div>
    </div>
  )
}
