import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  ChevronDown,
  Clock,
  Code,
  Database,
  File,
  FolderOpen,
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

export type ToolChatItem = Extract<ChatItem, { role: "tool" }>

const toolFailureTextClass = "text-[var(--ousia-tool-warning)]"
const toolFailureHoverTextClass = "hover:text-[var(--ousia-tool-warning-strong)]"

export function ToolCallView({
  item,
  projectPath,
  sessionId,
  t,
}: {
  item: ToolChatItem
  projectPath?: string
  sessionId?: string
  t: ReturnType<typeof getMessages>
}) {
  const shouldAutoExpand = item.status === "running" && shouldAutoExpandTool(item.name)
  const [isOpen, setIsOpen] = useState(shouldAutoExpand)
  const [loadedPayload, setLoadedPayload] = useState<{
    key: string
    item: ToolChatItem
  } | null>(null)
  const [payloadError, setPayloadError] = useState<{
    key: string
    message: string
  } | null>(null)
  const [isLoadingPayload, setIsLoadingPayload] = useState(false)
  const hasManualOpenStateRef = useRef(false)
  const inFlightPayloadKeyRef = useRef<string | null>(null)
  const payloadRequestKey = `${projectPath ?? ""}\u0000${sessionId ?? ""}\u0000${item.id}`
  const displayItem =
    loadedPayload?.key === payloadRequestKey ? loadedPayload.item : item
  const input =
    displayItem.input ?? (displayItem.status === "running" ? displayItem.text : "")
  const output =
    displayItem.output ??
    (displayItem.status === "finished" && !displayItem.payloadOmitted
      ? displayItem.text
      : "")
  const errorText =
    displayItem.errorText ??
    (displayItem.status === "failed" && !displayItem.payloadOmitted
      ? displayItem.text
      : "")
  const summary = formatSingleToolSummary(displayItem)

  useEffect(() => {
    queueMicrotask(() => {
      inFlightPayloadKeyRef.current = null
      setLoadedPayload(null)
      setPayloadError(null)
      setIsLoadingPayload(false)
    })
  }, [payloadRequestKey])

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

  useEffect(() => {
    if (
      !isOpen ||
      !item.payloadOmitted ||
      loadedPayload?.key === payloadRequestKey ||
      payloadError?.key === payloadRequestKey ||
      !window.ousia ||
      !projectPath ||
      !sessionId
    ) {
      return
    }
    if (inFlightPayloadKeyRef.current === payloadRequestKey) {
      return
    }
    let isCancelled = false
    queueMicrotask(() => {
      if (isCancelled) {
        return
      }
      inFlightPayloadKeyRef.current = payloadRequestKey
      setIsLoadingPayload(true)
      void window.ousia
        ?.getChatToolPayload({
          itemId: item.id,
          projectPath,
          sessionId,
        })
        .then((result) => {
          if (
            isCancelled ||
            inFlightPayloadKeyRef.current !== payloadRequestKey
          ) {
            return
          }
          if (result.ok) {
            setLoadedPayload({ key: payloadRequestKey, item: result.item })
            setPayloadError(null)
          } else {
            setPayloadError({
              key: payloadRequestKey,
              message: result.error || t.chat.toolPayloadLoadFailed,
            })
          }
        })
        .catch((error: unknown) => {
          if (
            !isCancelled &&
            inFlightPayloadKeyRef.current === payloadRequestKey
          ) {
            setPayloadError({
              key: payloadRequestKey,
              message:
                error instanceof Error
                  ? error.message
                  : t.chat.toolPayloadLoadFailed,
            })
          }
        })
        .finally(() => {
          if (inFlightPayloadKeyRef.current === payloadRequestKey) {
            inFlightPayloadKeyRef.current = null
          }
          if (!isCancelled) {
            setIsLoadingPayload(false)
          }
        })
    })
    return () => {
      isCancelled = true
      if (inFlightPayloadKeyRef.current === payloadRequestKey) {
        inFlightPayloadKeyRef.current = null
      }
    }
  }, [
    isOpen,
    item.id,
    item.payloadOmitted,
    loadedPayload?.key,
    payloadError?.key,
    payloadRequestKey,
    projectPath,
    sessionId,
    t.chat.toolPayloadLoadFailed,
  ])

  return (
    <div className="text-xs text-card-foreground">
      <button
        type="button"
        aria-expanded={isOpen}
        className={cn(
          "group flex min-h-7 max-w-full items-center gap-2 rounded-md px-0.5 text-left outline-none transition-colors hover:text-foreground focus-visible:text-foreground",
          displayItem.status === "failed" &&
            `${toolFailureTextClass} ${toolFailureHoverTextClass}`
        )}
        onClick={() => {
          hasManualOpenStateRef.current = true
          setIsOpen((current) => !current)
        }}
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center text-muted-foreground",
            displayItem.status === "failed" && toolFailureTextClass
          )}
        >
          {renderToolIcon(displayItem.name)}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-normal text-muted-foreground/85",
            displayItem.status === "failed" && toolFailureTextClass
          )}
          title={summary}
        >
          {summary}
        </span>
        {displayItem.status === "running" ? (
          <LoaderCircle
            size={14}
            strokeWidth={1.5}
            className="shrink-0 animate-spin text-muted-foreground"
          />
        ) : null}
        <ChevronDown
          size={15}
          strokeWidth={1.5}
          className={cn(
            "shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-visible:opacity-100",
            isOpen && "rotate-180 opacity-100"
          )}
        />
      </button>

      {isOpen ? (
        <div className="mt-1.5 rounded-md bg-muted/35 px-3 py-2.5">
          <ToolPayloadSection
            title={t.chat.toolArgs}
            value={
              payloadError?.key === payloadRequestKey
                ? payloadError.message
                : isLoadingPayload
                ? t.chat.toolPayloadLoading
                : input || "{}"
            }
            tone={
              payloadError?.key === payloadRequestKey ? "warning" : undefined
            }
          />
          {errorText ? (
            <ToolPayloadSection
              title={t.chat.toolError}
              value={errorText}
              tone="warning"
            />
          ) : output ? (
            <ToolPayloadSection title={t.chat.toolResult} value={output} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function ToolCallGroupView({
  items,
  projectPath,
  sessionId,
  t,
}: {
  items: ToolChatItem[]
  projectPath?: string
  sessionId?: string
  t: ReturnType<typeof getMessages>
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="text-xs text-muted-foreground">
      <button
        type="button"
        aria-expanded={isOpen}
        className="flex h-7 max-w-full items-center gap-2 rounded-md px-0.5 text-left outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          {renderToolGroupIcon(items)}
        </span>
        <span className="min-w-0 truncate text-sm font-normal text-muted-foreground/85">
          {formatToolGroupSummary(items, t)}
        </span>
        {items.some((item) => item.status === "running") ? (
          <LoaderCircle
            size={14}
            strokeWidth={1.5}
            className="shrink-0 animate-spin text-muted-foreground"
          />
        ) : null}
        <ChevronDown
          size={15}
          strokeWidth={1.5}
          className={cn(
            "shrink-0 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen ? (
        <div className="mt-2 space-y-2 pl-7">
          {items.map((item) => (
            <ToolCallView
              item={item}
              key={item.id}
              projectPath={projectPath}
              sessionId={sessionId}
              t={t}
            />
          ))}
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
  tone?: "default" | "warning"
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
    <section className="mt-2 first:mt-0">
      <h4
        className={cn(
          "mb-1 text-[10px] leading-3 font-semibold tracking-wide text-muted-foreground uppercase",
          tone === "warning" && toolFailureTextClass
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
          "ousia-hover-scrollbar max-h-48 overflow-auto rounded-md bg-background/75 px-2.5 py-1.5 font-mono text-[11px] leading-4 whitespace-pre-wrap text-muted-foreground",
          tone === "warning" &&
            "bg-[var(--ousia-tool-warning-bg)] text-[var(--ousia-tool-warning-strong)]"
        )}
      >
        {formatToolPayloadForDisplay(value)}
      </pre>
    </section>
  )
}

function formatSingleToolSummary(item: ToolChatItem) {
  const name = item.name.toLowerCase()
  if (name === "read") {
    return formatToolTargetSummary(item, "read")
  }
  if (name === "bash") {
    return formatBashSummary(item)
  }
  if (name === "grep" || name === "find") {
    return formatSearchSummary(item, name)
  }
  if (name === "ls") {
    return formatToolTargetSummary(item, "ls")
  }
  if (name === "edit" || name === "write") {
    return formatToolTargetSummary(item, name === "edit" ? "edit" : "write")
  }
  return formatToolName(item.name)
}

function formatToolGroupSummary(
  items: ToolChatItem[],
  t: ReturnType<typeof getMessages>
) {
  const buckets = items.reduce(
    (result, item) => {
      const name = item.name.toLowerCase()
      if (name === "read") {
        result.read += 1
      } else if (name === "bash") {
        result.bash += 1
      } else if (name === "grep" || name === "find") {
        result.search += 1
      } else if (name === "ls") {
        result.ls += 1
      } else if (name === "edit" || name === "write") {
        result.edit += 1
      } else {
        result.other += 1
      }
      return result
    },
    { bash: 0, edit: 0, ls: 0, other: 0, read: 0, search: 0 }
  )
  const parts = [
    buckets.read ? t.chat.toolGroupReadFiles(buckets.read) : "",
    buckets.search ? t.chat.toolGroupSearched(buckets.search) : "",
    buckets.ls ? t.chat.toolGroupListed(buckets.ls) : "",
    buckets.bash ? t.chat.toolGroupRanCommands(buckets.bash) : "",
    buckets.edit ? t.chat.toolGroupEdited(buckets.edit) : "",
    buckets.other ? t.chat.toolGroupUsedTools(buckets.other) : "",
  ].filter(Boolean)

  return parts.join(" · ") || t.chat.toolGroupUsedTools(items.length)
}

function formatToolTargetSummary(item: ToolChatItem, verb: string) {
  const target = toolTargetFromInput(item.input || item.text)
  return target ? `${verb} ${target}` : verb
}

function formatBashSummary(item: ToolChatItem) {
  const command = commandFromInput(item.input || item.text)
  return command ? `bash ${command}` : "bash"
}

function formatSearchSummary(item: ToolChatItem, verb: string) {
  const value = parseToolInput(item.input || item.text)
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const query = record.pattern ?? record.query ?? record.search
    const path = record.path ?? record.filePath ?? record.file_path
    const parts = [query, path]
      .filter((part): part is string => typeof part === "string" && !!part.trim())
      .map((part) => part.trim())
    return parts.length ? `${verb} ${parts.join(" ")}` : verb
  }
  return verb
}

function toolTargetFromInput(input: string | undefined) {
  if (!input) {
    return ""
  }
  const value = parseToolInput(input)
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const path =
      record.path ??
      record.filePath ??
      record.file_path ??
      record.target ??
      record.cwd
    if (typeof path === "string" && path.trim()) {
      return path.trim()
    }
  }
  return ""
}

function commandFromInput(input: string | undefined) {
  if (!input) {
    return ""
  }
  const value = parseToolInput(input)
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const command = record.command ?? record.cmd ?? record.shell
    if (typeof command === "string" && command.trim()) {
      return command.trim()
    }
  }
  const trimmed = input.trim()
  if (trimmed.startsWith("$ ")) {
    return trimmed.slice(2).split("\n", 1)[0]?.trim() ?? ""
  }
  return trimmed.includes("\n") ? trimmed.split("\n", 1)[0]?.trim() ?? "" : trimmed
}

function parseToolInput(input: string | undefined) {
  if (!input) {
    return null
  }
  try {
    return JSON.parse(input) as unknown
  } catch {
    return null
  }
}

function renderToolGroupIcon(items: ToolChatItem[]) {
  if (items.some((item) => item.name.toLowerCase() === "bash")) {
    return <Terminal size={15} strokeWidth={1.5} />
  }
  if (
    items.some((item) =>
      ["grep", "find"].includes(item.name.toLowerCase())
    )
  ) {
    return <Search size={15} strokeWidth={1.5} />
  }
  if (items.some((item) => item.name.toLowerCase() === "ls")) {
    return <FolderOpen size={15} strokeWidth={1.5} />
  }
  return <File size={15} strokeWidth={1.5} />
}

function renderToolIcon(name: string) {
  const normalizedName = name.toLowerCase()
  if (normalizedName.includes("bash") || normalizedName.includes("shell")) {
    return <Terminal size={15} strokeWidth={1.5} />
  }
  if (
    normalizedName.includes("code") ||
    normalizedName.includes("edit") ||
    normalizedName.includes("write")
  ) {
    return <Code size={15} strokeWidth={1.5} />
  }
  if (normalizedName.includes("read") || normalizedName.includes("file")) {
    return <File size={15} strokeWidth={1.5} />
  }
  if (normalizedName === "ls" || normalizedName.includes("list")) {
    return <FolderOpen size={15} strokeWidth={1.5} />
  }
  if (normalizedName.includes("grep") || normalizedName.includes("find")) {
    return <Search size={15} strokeWidth={1.5} />
  }
  if (normalizedName.includes("search")) {
    return <Sparkles size={15} strokeWidth={1.5} />
  }
  if (normalizedName.includes("database") || normalizedName.includes("sql")) {
    return <Database size={15} strokeWidth={1.5} />
  }
  return <Clock size={15} strokeWidth={1.5} />
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
