import { useEffect, useMemo, useRef } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"

import type { ExtensionProps } from "@/extensions/types"

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

export function TerminalExtension({ context }: ExtensionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const projectPath = context.project.path
  const sessionId = context.conversation.id
  const terminalId = useMemo(
    () => createTerminalId(projectPath, sessionId),
    [projectPath, sessionId]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container || !projectPath || !sessionId || !window.ousia) {
      return
    }

    let isDisposed = false
    let resizeFrame = 0
    const fitAddon = new FitAddon()
    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        '"JetBrainsMono Nerd Font Mono", "MesloLGS NF", "Hack Nerd Font Mono", "Symbols Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 14,
      fontWeight: "400",
      fontWeightBold: "600",
      letterSpacing: 0,
      lineHeight: 16 / 14,
      macOptionIsMeta: true,
      scrollback: 6000,
      theme: {
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
      },
    })

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(container)
    fitAddon.fit()
    terminal.focus()
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const dataSubscription = terminal.onData((data) => {
      void window.ousia?.writeTerminal({
        projectPath,
        sessionId,
        terminalId,
        data,
      })
    })
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      void window.ousia?.resizeTerminal({
        projectPath,
        sessionId,
        terminalId,
        cols,
        rows,
      })
    })
    const removeTerminalListener = window.ousia.onTerminalEvent((event) => {
      if (event.terminalId !== terminalId || isDisposed) {
        return
      }
      if (event.type === "data") {
        terminal.write(event.data)
      } else if (event.type === "exit") {
        terminal.writeln("")
        terminal.writeln(
          `[process exited: ${event.exitCode ?? event.signal ?? "unknown"}]`
        )
      } else {
        terminal.writeln(`\r\n${event.message}`)
      }
    })
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        if (!isDisposed) {
          fitAddon.fit()
        }
      })
    })

    resizeObserver.observe(container)
    void window.ousia
      .createTerminal({
        projectPath,
        sessionId,
        terminalId,
        cols: terminal.cols,
        rows: terminal.rows,
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Failed to start terminal"
        terminal.writeln(message)
      })

    return () => {
      isDisposed = true
      cancelAnimationFrame(resizeFrame)
      resizeObserver.disconnect()
      removeTerminalListener()
      dataSubscription.dispose()
      resizeSubscription.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      void window.ousia?.disposeTerminal({
        projectPath,
        sessionId,
        terminalId,
      })
    }
  }, [projectPath, sessionId, terminalId])

  return (
    <div className="h-full min-h-0 overflow-hidden bg-[#111111] text-white">
      <div
        ref={containerRef}
        className="h-full min-h-0 overflow-hidden p-3"
        onMouseDown={() => terminalRef.current?.focus()}
      />
    </div>
  )
}
