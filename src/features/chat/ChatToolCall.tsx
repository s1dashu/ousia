import { useLayoutEffect, useRef, useState, type ReactElement } from "react"
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock,
  Code,
  Database,
  File,
  LoaderCircle,
  Search,
  Sparkles,
  Terminal,
} from "@/components/icons/huge-icons"

import type { getMessages } from "@/app/i18n"
import type { ChatItem } from "@/features/chat/chat-events"
import {
  formatToolName,
  shouldAutoExpandTool,
} from "@/features/chat/chat-tool-format"
import { cn } from "@/lib/utils"

type ToolChatItem = Extract<ChatItem, { role: "tool" }>
type ToolStatusIcon = (props: {
  className?: string
  size?: number
  strokeWidth?: number
}) => ReactElement

export function ToolCallView({
  item,
  t,
}: {
  item: ToolChatItem
  t: ReturnType<typeof getMessages>
}) {
  const shouldAutoExpand = item.status === "running" && shouldAutoExpandTool(item.name)
  const [isOpen, setIsOpen] = useState(shouldAutoExpand)
  const hasManualOpenStateRef = useRef(false)
  const input = item.input ?? (item.status === "running" ? item.text : "")
  const output = item.output ?? (item.status === "finished" ? item.text : "")
  const errorText = item.errorText ?? (item.status === "failed" ? item.text : "")
  const status = getToolStatus(item.status, t)
  const StatusIcon = status.icon

  useLayoutEffect(() => {
    let timer: number | undefined
    if (item.status !== "running") {
      hasManualOpenStateRef.current = false
      if (shouldAutoExpandTool(item.name)) {
        timer = window.setTimeout(() => setIsOpen(false), 0)
      }
      return () => {
        if (timer !== undefined) {
          window.clearTimeout(timer)
        }
      }
    }
    if (shouldAutoExpand && !hasManualOpenStateRef.current) {
      timer = window.setTimeout(() => setIsOpen(true), 0)
    }
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [item.name, item.status, shouldAutoExpand])

  return (
    <div className="overflow-hidden rounded-lg bg-muted/25 text-xs text-card-foreground">
      <button
        type="button"
        aria-expanded={isOpen}
        className="flex h-9 w-full items-center gap-2 bg-muted/35 px-3 text-left outline-none transition-colors hover:bg-muted/55 focus-visible:bg-muted/65"
        onClick={() => {
          hasManualOpenStateRef.current = true
          setIsOpen((current) => !current)
        }}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background/70 text-muted-foreground">
          {renderToolIcon(item.name)}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">
          {formatToolName(item.name)}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium",
            status.className
          )}
        >
          <StatusIcon
            size={12}
            strokeWidth={1.5}
            className={status.isSpinning ? "animate-spin" : undefined}
          />
          {status.label}
        </span>
        <ChevronDown
          size={18}
          strokeWidth={1.5}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen ? (
        <div className="bg-muted/15 px-3 py-3">
          <ToolPayloadSection title={t.chat.toolArgs} value={input || "{}"} />
          {errorText ? (
            <ToolPayloadSection
              title={t.chat.toolError}
              value={errorText}
              tone="destructive"
            />
          ) : output ? (
            <ToolPayloadSection title={t.chat.toolResult} value={output} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ToolPayloadSection({
  title,
  value,
  tone = "default",
}: {
  title: string
  value: string
  tone?: "default" | "destructive"
}) {
  const preRef = useRef<HTMLPreElement>(null)
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)

  useLayoutEffect(() => {
    if (!isFollowingLatest) {
      return
    }
    const node = preRef.current
    if (!node) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [isFollowingLatest, value])

  return (
    <section className="mt-3 first:mt-0">
      <h4
        className={cn(
          "mb-1.5 text-[11px] leading-4 font-semibold tracking-wide text-muted-foreground uppercase",
          tone === "destructive" && "text-destructive"
        )}
      >
        {title}
      </h4>
      <pre
        ref={preRef}
        onScroll={(event) => {
          const node = event.currentTarget
          setIsFollowingLatest(
            node.scrollHeight - node.scrollTop - node.clientHeight < 8
          )
        }}
        className={cn(
          "ousia-hover-scrollbar max-h-56 overflow-auto rounded-md bg-background/75 px-3 py-2 font-mono text-[11px] leading-5 whitespace-pre-wrap text-muted-foreground",
          tone === "destructive" &&
            "bg-destructive/10 text-destructive dark:bg-destructive/15"
        )}
      >
        {formatToolPayloadForDisplay(value)}
      </pre>
    </section>
  )
}

function getToolStatus(
  status: ToolChatItem["status"],
  t: ReturnType<typeof getMessages>
): {
  label: string
  icon: ToolStatusIcon
  className: string
  isSpinning: boolean
} {
  if (status === "failed") {
    return {
      label: t.chat.toolFailed,
      icon: CircleAlert,
      className:
        "bg-destructive/10 text-destructive dark:bg-destructive/15",
      isSpinning: false,
    }
  }
  if (status === "running") {
    return {
      label: t.chat.toolRunning,
      icon: LoaderCircle,
      className: "bg-background/70 text-muted-foreground",
      isSpinning: true,
    }
  }
  return {
    label: t.chat.toolFinished,
    icon: CircleCheck,
    className: "bg-background/70 text-muted-foreground",
    isSpinning: false,
  }
}

function renderToolIcon(name: string) {
  const normalizedName = name.toLowerCase()
  if (normalizedName.includes("bash") || normalizedName.includes("shell")) {
    return <Terminal size={18} strokeWidth={1.5} />
  }
  if (normalizedName.includes("read") || normalizedName.includes("file")) {
    return <File size={18} strokeWidth={1.5} />
  }
  if (normalizedName.includes("grep") || normalizedName.includes("find")) {
    return <Search size={18} strokeWidth={1.5} />
  }
  if (normalizedName.includes("search")) {
    return <Sparkles size={18} strokeWidth={1.5} />
  }
  if (normalizedName.includes("database") || normalizedName.includes("sql")) {
    return <Database size={18} strokeWidth={1.5} />
  }
  if (normalizedName.includes("code") || normalizedName.includes("edit")) {
    return <Code size={18} strokeWidth={1.5} />
  }
  return <Clock size={18} strokeWidth={1.5} />
}

function formatToolPayloadForDisplay(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return "{}"
  }
  try {
    return prettifyToolJson(JSON.parse(trimmed))
  } catch {
    return unescapeVisibleText(value)
  }
}

function prettifyToolJson(value: unknown) {
  return unescapeVisibleText(JSON.stringify(value, null, 2))
}

function unescapeVisibleText(value: string) {
  return value
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
}
