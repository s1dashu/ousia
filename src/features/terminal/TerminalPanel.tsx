import { useEffect, useMemo, useRef } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal as XtermTerminal, type ITheme } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { SquareTerminal } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ResolvedTheme } from "@/components/theme-provider"
import { getMessages } from "@/app/i18n"
import type { OusiaLanguage } from "@/electron/chat-types"

const TERMINAL_FONT_FAMILY =
  '"Ousia Terminal Mono", "Symbols Nerd Font Mono", ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
const TERMINAL_FONT_SIZE = 14
const TERMINAL_FONT_WEIGHT = "400"
const TERMINAL_LINE_HEIGHT = 16 / 14
const TERMINAL_STYLE_REAPPLY_DELAY_MS = 80

type TerminalPanelProps = {
  projectPath: string
  sessionId: string
  isVisible: boolean
  language: OusiaLanguage
  resolvedTheme: ResolvedTheme
  onCollapse: () => void
}

function createTerminalId(projectPath: string, sessionId: string) {
  const scope =
    `${projectPath}-${sessionId}`
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-48) || "default"
  return `terminal-${scope}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

function createTerminalTheme(theme: ResolvedTheme): ITheme {
  if (theme === "light") {
    return {
      background: "#ffffff",
      black: "#24292f",
      blue: "#0969da",
      brightBlack: "#6e7781",
      brightBlue: "#218bff",
      brightCyan: "#1b7c83",
      brightGreen: "#1a7f37",
      brightMagenta: "#8250df",
      brightRed: "#cf222e",
      brightWhite: "#0f172a",
      brightYellow: "#9a6700",
      cursor: "#24292f",
      cyan: "#1b7c83",
      foreground: "#24292f",
      green: "#1a7f37",
      magenta: "#8250df",
      red: "#cf222e",
      selectionBackground: "#add6ff",
      white: "#57606a",
      yellow: "#9a6700",
    }
  }

  return {
    background: "#111111",
    black: "#222222",
    blue: "#7aa2f7",
    brightBlack: "#6f6f6f",
    brightBlue: "#9ab9ff",
    brightCyan: "#7dcfff",
    brightGreen: "#b9f27c",
    brightMagenta: "#d8a4ff",
    brightRed: "#ff8c8c",
    brightWhite: "#ffffff",
    brightYellow: "#ffe28a",
    cursor: "#f5f5f5",
    cyan: "#56cfe1",
    foreground: "#eeeeee",
    green: "#9ece6a",
    magenta: "#bb9af7",
    red: "#f7768e",
    selectionBackground: "#4a4a4a",
    white: "#dddddd",
    yellow: "#e0af68",
  }
}

async function loadTerminalFont() {
  await document.fonts.load(`${TERMINAL_FONT_SIZE}px "Ousia Terminal Mono"`)
}

function applyOusiaTerminalStyle(terminal: XtermTerminal, theme: ResolvedTheme) {
  terminal.options.fontFamily = TERMINAL_FONT_FAMILY
  terminal.options.fontSize = TERMINAL_FONT_SIZE
  terminal.options.fontWeight = TERMINAL_FONT_WEIGHT
  terminal.options.fontWeightBold = TERMINAL_FONT_WEIGHT
  terminal.options.cursorInactiveStyle = "none"
  terminal.options.letterSpacing = 0
  terminal.options.lineHeight = TERMINAL_LINE_HEIGHT
  terminal.options.theme = createTerminalTheme(theme)
  terminal.clearTextureAtlas()
  terminal.refresh(0, terminal.rows - 1)
}

export function TerminalPanel({
  projectPath,
  sessionId,
  isVisible,
  language,
  resolvedTheme,
  onCollapse,
}: TerminalPanelProps) {
  const t = getMessages(language)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<XtermTerminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const resolvedThemeRef = useRef<ResolvedTheme>(resolvedTheme)
  const terminalId = useMemo(
    () => createTerminalId(projectPath, sessionId),
    [projectPath, sessionId]
  )

  useEffect(() => {
    resolvedThemeRef.current = resolvedTheme
    if (terminalRef.current) {
      applyOusiaTerminalStyle(terminalRef.current, resolvedTheme)
    }
  }, [resolvedTheme])

  useEffect(() => {
    if (!isVisible) {
      return
    }
    const frameId = requestAnimationFrame(() => {
      fitAddonRef.current?.fit()
      terminalRef.current?.focus()
    })
    return () => cancelAnimationFrame(frameId)
  }, [isVisible])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !projectPath || !sessionId || !window.ousia) {
      return
    }

    const ousia = window.ousia
    let isDisposed = false
    let resizeFrame = 0
    let styleReapplyTimer = 0
    let terminal: XtermTerminal | null = null
    let resizeObserver: ResizeObserver | null = null
    let removeTerminalListener: (() => void) | null = null
    let dataSubscription: { dispose: () => void } | null = null
    let resizeSubscription: { dispose: () => void } | null = null

    const scheduleStyleReapply = () => {
      window.clearTimeout(styleReapplyTimer)
      styleReapplyTimer = window.setTimeout(() => {
        if (!isDisposed && terminal) {
          applyOusiaTerminalStyle(terminal, resolvedThemeRef.current)
        }
      }, TERMINAL_STYLE_REAPPLY_DELAY_MS)
    }

    const startTerminal = async () => {
      await loadTerminalFont()
      if (isDisposed) {
        return
      }

      const fitAddon = new FitAddon()
      const activeTerminal = new XtermTerminal({
        allowProposedApi: false,
        cursorBlink: true,
        cursorInactiveStyle: "none",
        cursorStyle: "bar",
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: TERMINAL_FONT_SIZE,
        fontWeight: TERMINAL_FONT_WEIGHT,
        fontWeightBold: TERMINAL_FONT_WEIGHT,
        letterSpacing: 0,
        lineHeight: TERMINAL_LINE_HEIGHT,
        macOptionIsMeta: true,
        scrollback: 6000,
        theme: createTerminalTheme(resolvedThemeRef.current),
      })

      activeTerminal.loadAddon(fitAddon)
      activeTerminal.loadAddon(new WebLinksAddon())
      activeTerminal.open(container)
      applyOusiaTerminalStyle(activeTerminal, resolvedThemeRef.current)
      fitAddon.fit()
      activeTerminal.focus()
      terminal = activeTerminal
      terminalRef.current = activeTerminal
      fitAddonRef.current = fitAddon

      dataSubscription = activeTerminal.onData((data) => {
        void window.ousia?.writeTerminal({
          projectPath,
          sessionId,
          terminalId,
          data,
        })
      })
      resizeSubscription = activeTerminal.onResize(({ cols, rows }) => {
        void window.ousia?.resizeTerminal({
          projectPath,
          sessionId,
          terminalId,
          cols,
          rows,
        })
      })
      removeTerminalListener = ousia.onTerminalEvent((event) => {
        if (event.terminalId !== terminalId || isDisposed) {
          return
        }
        if (event.type === "data") {
          activeTerminal.write(event.data)
          scheduleStyleReapply()
        } else if (event.type === "exit") {
          activeTerminal.writeln("")
          activeTerminal.writeln(
            t.terminal.exited(event.exitCode ?? event.signal ?? t.terminal.unknown)
          )
        } else {
          activeTerminal.writeln(`\r\n${event.message}`)
        }
      })
      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame)
        resizeFrame = requestAnimationFrame(() => {
          if (!isDisposed) {
            fitAddon.fit()
          }
        })
      })

      resizeObserver.observe(container)
      void ousia
        .createTerminal({
          projectPath,
          sessionId,
          terminalId,
          cols: activeTerminal.cols,
          rows: activeTerminal.rows,
        })
        .then(scheduleStyleReapply)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : t.terminal.startFailed
          activeTerminal.writeln(message)
        })
    }

    void startTerminal()

    return () => {
      isDisposed = true
      cancelAnimationFrame(resizeFrame)
      window.clearTimeout(styleReapplyTimer)
      resizeObserver?.disconnect()
      removeTerminalListener?.()
      dataSubscription?.dispose()
      resizeSubscription?.dispose()
      terminal?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      void window.ousia?.disposeTerminal({
        projectPath,
        sessionId,
        terminalId,
      })
    }
  }, [projectPath, sessionId, t.terminal, terminalId])

  const shellThemeClass =
    resolvedTheme === "light"
      ? "bg-[#ffffff] text-[#24292f]"
      : "bg-[#111111] text-white"

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden ${shellThemeClass}`}
    >
      <header className="window-drag flex h-10 shrink-0 items-center justify-between border-b border-border pr-4 pl-3 text-foreground">
        <div className="window-drag flex min-w-0 items-center text-sm font-medium">
          <span className="window-drag truncate">{t.terminal.title}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="window-no-drag size-7 rounded-md"
          aria-label={t.terminal.collapse}
          onClick={onCollapse}
        >
          <SquareTerminal size={18} />
        </Button>
      </header>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden p-3"
        onMouseDown={() => terminalRef.current?.focus()}
      />
    </div>
  )
}
