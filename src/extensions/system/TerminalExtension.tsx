import { useEffect, useMemo, useRef } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal, type ITheme } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"

import type { ResolvedTheme } from "@/components/theme-provider"
import type { ExtensionProps } from "@/extensions/types"

const TERMINAL_FONT_FAMILY =
  '"Ousia Terminal Mono", "Symbols Nerd Font Mono", ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
const TERMINAL_FONT_SIZE = 14
const TERMINAL_FONT_WEIGHT = "400"
const TERMINAL_LINE_HEIGHT = 16 / 14
const TERMINAL_STYLE_REAPPLY_DELAY_MS = 80

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

function applyOusiaTerminalStyle(terminal: Terminal, theme: ResolvedTheme) {
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

export function TerminalExtension({ context }: ExtensionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const resolvedThemeRef = useRef<ResolvedTheme>(context.theme.resolved)
  const projectPath = context.project.path
  const sessionId = context.conversation.id
  const terminalId = useMemo(
    () => createTerminalId(projectPath, sessionId),
    [projectPath, sessionId]
  )
  const resolvedTheme = context.theme.resolved

  useEffect(() => {
    resolvedThemeRef.current = resolvedTheme
    if (terminalRef.current) {
      applyOusiaTerminalStyle(terminalRef.current, resolvedTheme)
    }
  }, [resolvedTheme])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !projectPath || !sessionId || !window.ousia) {
      return
    }

    const ousia = window.ousia
    let isDisposed = false
    let resizeFrame = 0
    let styleReapplyTimer = 0
    let terminal: Terminal | null = null
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
      const activeTerminal = new Terminal({
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
            `[进程已退出：${event.exitCode ?? event.signal ?? "未知"}]`
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
          const message =
            error instanceof Error ? error.message : "终端启动失败"
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
  }, [projectPath, sessionId, terminalId])

  const shellThemeClass =
    resolvedTheme === "light"
      ? "bg-[#ffffff] text-[#24292f]"
      : "bg-[#111111] text-white"

  return (
    <div className={`h-full min-h-0 overflow-hidden ${shellThemeClass}`}>
      <div
        ref={containerRef}
        className="h-full min-h-0 overflow-hidden p-3"
        onMouseDown={() => terminalRef.current?.focus()}
      />
    </div>
  )
}
