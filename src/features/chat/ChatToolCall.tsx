import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
  Pencil,
  Sparkles,
  Terminal,
} from "@/components/icons/huge-icons"

import type { getMessages } from "@/app/i18n"
import type { ChatItem } from "@/features/chat/chat-events"
import { formatToolName } from "@/features/chat/chat-tool-format"
import {
  shouldAutoCollapseToolDisclosure,
  shouldAutoExpandToolDisclosure,
} from "@/features/chat/chat-tool-disclosure"
import { toolFilePreviewFromItem } from "@/features/chat/chat-tool-file-preview"
import { shouldThrottleToolPreview } from "@/features/chat/chat-tool-preview-scheduler"
import { ToolFilePreviewView } from "@/features/chat/ChatToolFilePreview"
import { cn } from "@/lib/utils"

export type ToolChatItem = Extract<ChatItem, { role: "tool" }>

const toolFailureTextClass = "text-[var(--ousia-tool-warning)]"
const toolFailureHoverTextClass =
  "hover:text-[var(--ousia-tool-warning-strong)]"
const toolDisclosureStorageKey = "ousia.chat.toolDisclosure.v1"
const maxStoredToolDisclosureEntries = 1000
const runningToolSpinnerStyle = {
  transformBox: "fill-box",
  transformOrigin: "center",
  willChange: "transform",
} satisfies CSSProperties

type StoredToolDisclosureEntry = {
  open: boolean
  updatedAt: number
}

type StoredToolDisclosureState = Record<string, StoredToolDisclosureEntry>

function toolDisclosureKey({
  itemId,
  projectPath,
  sessionId,
}: {
  itemId: string
  projectPath?: string
  sessionId?: string
}) {
  if (!projectPath || !sessionId) {
    return undefined
  }
  return `${projectPath}\u0000${sessionId}\u0000${itemId}`
}

function readStoredToolDisclosureState() {
  try {
    const value = window.localStorage.getItem(toolDisclosureStorageKey)
    if (!value) {
      return {}
    }
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    return parsed as StoredToolDisclosureState
  } catch {
    return {}
  }
}

function readToolDisclosureOpen(key: string | undefined) {
  if (!key) {
    return undefined
  }
  const entry = readStoredToolDisclosureState()[key]
  return typeof entry?.open === "boolean" ? entry.open : undefined
}

function writeToolDisclosureOpen(key: string | undefined, open: boolean) {
  if (!key) {
    return
  }
  try {
    const state = readStoredToolDisclosureState()
    state[key] = { open, updatedAt: Date.now() }
    const entries = Object.entries(state)
    if (entries.length > maxStoredToolDisclosureEntries) {
      entries
        .sort(([, left], [, right]) => left.updatedAt - right.updatedAt)
        .slice(0, entries.length - maxStoredToolDisclosureEntries)
        .forEach(([entryKey]) => {
          delete state[entryKey]
        })
    }
    window.localStorage.setItem(toolDisclosureStorageKey, JSON.stringify(state))
  } catch {
    // Local storage is best-effort UI memory.
  }
}

const RunningToolSpinner = memo(function RunningToolSpinner() {
  return (
    <LoaderCircle
      aria-hidden="true"
      size={14}
      strokeWidth={1.5}
      className="text-muted-foreground shrink-0 animate-spin motion-reduce:animate-none"
      style={runningToolSpinnerStyle}
    />
  )
})

export const ToolCallView = memo(function ToolCallView({
  item,
  onPreserveScrollAnchor,
  projectPath,
  sessionId,
  t,
}: {
  item: ToolChatItem
  onPreserveScrollAnchor: (element: HTMLElement) => void
  projectPath?: string
  sessionId?: string
  t: ReturnType<typeof getMessages>
}) {
  const shouldAutoExpand = shouldAutoExpandToolDisclosure(item)
  const disclosureKey = toolDisclosureKey({
    itemId: item.id,
    projectPath,
    sessionId,
  })
  const [initialDisclosure] = useState(() => {
    const storedOpen = readToolDisclosureOpen(disclosureKey)
    return {
      open: storedOpen ?? shouldAutoExpand,
      storedOpen,
    }
  })
  const currentStoredOpenRef = useRef(initialDisclosure.storedOpen)
  const [isOpen, setIsOpen] = useState(initialDisclosure.open)
  const [loadedPayload, setLoadedPayload] = useState<{
    key: string
    item: ToolChatItem
  } | null>(null)
  const [payloadError, setPayloadError] = useState<{
    key: string
    message: string
  } | null>(null)
  const [isLoadingPayload, setIsLoadingPayload] = useState(false)
  const [hasMountedFilePreview, setHasMountedFilePreview] = useState(false)
  const hasManualOpenStateRef = useRef(
    initialDisclosure.storedOpen !== undefined,
  )
  const inFlightPayloadKeyRef = useRef<string | null>(null)
  const hasInitializedDisclosurePersistenceRef = useRef(false)
  const isResettingDisclosureRef = useRef(false)
  const payloadRequestKey = `${projectPath ?? ""}\u0000${sessionId ?? ""}\u0000${item.id}`
  const previousPayloadRequestKeyRef = useRef(payloadRequestKey)
  const previousDisclosureItemRef = useRef({
    inputComplete: item.inputComplete,
    key: payloadRequestKey,
    name: item.name,
    status: item.status,
  })
  const displayItem = useMemo(
    () =>
      loadedPayload?.key === payloadRequestKey
        ? {
            ...loadedPayload.item,
            filePreview: loadedPayload.item.filePreview ?? item.filePreview,
          }
        : item,
    [item, loadedPayload, payloadRequestKey],
  )
  const input =
    displayItem.input ??
    (displayItem.status === "running" ? displayItem.text : "")
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
  const filePreview = useMemo(
    () => toolFilePreviewFromItem(displayItem),
    [displayItem],
  )
  const hasFilePreview = Boolean(filePreview)
  const summary = useMemo(
    () => formatSingleToolSummary(displayItem),
    [displayItem],
  )

  useEffect(() => {
    if (previousPayloadRequestKeyRef.current === payloadRequestKey) {
      return
    }
    previousPayloadRequestKeyRef.current = payloadRequestKey
    isResettingDisclosureRef.current = true
    queueMicrotask(() => {
      inFlightPayloadKeyRef.current = null
      setLoadedPayload(null)
      setPayloadError(null)
      setIsLoadingPayload(false)
      setHasMountedFilePreview(false)
      const storedOpen = readToolDisclosureOpen(disclosureKey)
      currentStoredOpenRef.current = storedOpen
      hasManualOpenStateRef.current = storedOpen !== undefined
      hasInitializedDisclosurePersistenceRef.current = false
      setIsOpen(storedOpen ?? shouldAutoExpand)
      isResettingDisclosureRef.current = false
    })
  }, [disclosureKey, payloadRequestKey, shouldAutoExpand])

  useEffect(() => {
    if (isResettingDisclosureRef.current) {
      return
    }
    if (!disclosureKey) {
      return
    }
    if (!hasInitializedDisclosurePersistenceRef.current) {
      hasInitializedDisclosurePersistenceRef.current = true
      if (!isOpen && currentStoredOpenRef.current === undefined) {
        return
      }
    }
    writeToolDisclosureOpen(disclosureKey, isOpen)
  }, [disclosureKey, isOpen])

  useLayoutEffect(() => {
    let timer: number | undefined
    const currentDisclosureItem = {
      inputComplete: item.inputComplete,
      name: item.name,
      status: item.status,
    }
    const previousDisclosureItem =
      previousDisclosureItemRef.current.key === payloadRequestKey
        ? previousDisclosureItemRef.current
        : currentDisclosureItem
    previousDisclosureItemRef.current = {
      ...currentDisclosureItem,
      key: payloadRequestKey,
    }

    if (
      shouldAutoCollapseToolDisclosure(
        previousDisclosureItem,
        currentDisclosureItem,
      )
    ) {
      timer = window.setTimeout(() => {
        hasManualOpenStateRef.current = false
        setIsOpen(false)
      }, 0)
    } else if (shouldAutoExpand && !hasManualOpenStateRef.current) {
      timer = window.setTimeout(() => setIsOpen(true), 0)
    }
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [
    item.inputComplete,
    item.name,
    item.status,
    payloadRequestKey,
    shouldAutoExpand,
  ])

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
    <div className="text-card-foreground text-xs">
      <button
        type="button"
        aria-expanded={isOpen}
        className={cn(
          "group hover:text-foreground focus-visible:text-foreground flex min-h-6 max-w-full items-center gap-2 rounded-md px-0.5 text-left transition-colors outline-none",
          displayItem.status === "failed" &&
            `${toolFailureTextClass} ${toolFailureHoverTextClass}`,
        )}
        onClick={(event) => {
          onPreserveScrollAnchor(event.currentTarget)
          hasManualOpenStateRef.current = true
          if (hasFilePreview) {
            setHasMountedFilePreview(true)
          }
          setIsOpen((current) => !current)
        }}
      >
        <span
          className={cn(
            "text-muted-foreground flex size-5 shrink-0 items-center justify-center",
            displayItem.status === "failed" && toolFailureTextClass,
          )}
        >
          {renderToolIcon(displayItem.name)}
        </span>
        <span
          className={cn(
            "text-muted-foreground/85 min-w-0 flex-1 truncate text-sm font-normal",
            displayItem.status === "failed" && toolFailureTextClass,
          )}
          title={summary}
        >
          {summary}
        </span>
        {displayItem.status === "running" ? <RunningToolSpinner /> : null}
        <ChevronDown
          size={15}
          strokeWidth={1.5}
          className={cn(
            "text-muted-foreground invisible shrink-0 transition-transform group-hover:visible group-focus-visible:visible",
            isOpen && "visible rotate-180",
          )}
        />
      </button>

      {(isOpen || hasMountedFilePreview) && filePreview ? (
        <div hidden={!isOpen}>
          <ToolFilePreviewView
            isStreaming={shouldThrottleToolPreview(
              displayItem.status,
              displayItem.inputComplete,
            )}
            preview={filePreview}
            projectPath={projectPath}
            t={t}
          />
        </div>
      ) : null}

      {isOpen && !filePreview ? (
        <div className="bg-muted/35 mt-1.5 rounded-lg px-3 py-2.5">
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

      {isOpen && filePreview && errorText ? (
        <div className="bg-muted/35 mt-1.5 rounded-lg px-3 py-2.5">
          <ToolPayloadSection
            title={t.chat.toolError}
            value={errorText}
            tone="warning"
          />
        </div>
      ) : null}
    </div>
  )
})

export const ToolCallGroupView = memo(function ToolCallGroupView({
  items,
  onPreserveScrollAnchor,
  projectPath,
  sessionId,
  t,
}: {
  items: ToolChatItem[]
  onPreserveScrollAnchor: (element: HTMLElement) => void
  projectPath?: string
  sessionId?: string
  t: ReturnType<typeof getMessages>
}) {
  const hasRunningItem = useMemo(
    () => items.some((item) => item.status === "running"),
    [items],
  )
  const groupItemId = `group:${items[0]?.id ?? "empty"}:${items.at(-1)?.id ?? "empty"}`
  const disclosureKey = toolDisclosureKey({
    itemId: groupItemId,
    projectPath,
    sessionId,
  })
  const [initialDisclosure] = useState(() => {
    const storedOpen = readToolDisclosureOpen(disclosureKey)
    return {
      open: storedOpen ?? false,
      storedOpen,
    }
  })
  const currentStoredOpenRef = useRef(initialDisclosure.storedOpen)
  const [isOpen, setIsOpen] = useState(initialDisclosure.open)
  const isResettingDisclosureRef = useRef(false)

  useEffect(() => {
    isResettingDisclosureRef.current = true
    queueMicrotask(() => {
      const storedOpen = readToolDisclosureOpen(disclosureKey)
      currentStoredOpenRef.current = storedOpen
      setIsOpen(storedOpen ?? false)
      isResettingDisclosureRef.current = false
    })
  }, [disclosureKey])

  useEffect(() => {
    if (isResettingDisclosureRef.current) {
      return
    }
    if (!isOpen && currentStoredOpenRef.current === undefined) {
      return
    }
    if (disclosureKey) {
      writeToolDisclosureOpen(disclosureKey, isOpen)
    }
  }, [disclosureKey, isOpen])

  return (
    <div className="text-muted-foreground text-xs">
      <button
        type="button"
        aria-expanded={isOpen}
        className="hover:text-foreground focus-visible:text-foreground flex h-6 max-w-full items-center gap-2 rounded-md px-0.5 text-left transition-colors outline-none"
        onClick={(event) => {
          onPreserveScrollAnchor(event.currentTarget)
          setIsOpen((current) => !current)
        }}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          {renderToolGroupIcon(items)}
        </span>
        <span className="text-muted-foreground/85 min-w-0 truncate text-sm font-normal">
          {formatToolGroupSummary(items, t)}
        </span>
        {hasRunningItem ? <RunningToolSpinner /> : null}
        <ChevronDown
          size={15}
          strokeWidth={1.5}
          className={cn(
            "shrink-0 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen ? (
        <div className="mt-1 space-y-0.5 pl-7">
          {items.map((item) => (
            <ToolCallView
              item={item}
              key={item.id}
              onPreserveScrollAnchor={onPreserveScrollAnchor}
              projectPath={projectPath}
              sessionId={sessionId}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
})

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
          "text-muted-foreground mb-1 text-[10px] leading-3 font-semibold tracking-wide uppercase",
          tone === "warning" && toolFailureTextClass,
        )}
      >
        {title}
      </h4>
      <pre
        ref={preRef}
        data-chat-nested-scroll
        onScroll={(event) => {
          const node = event.currentTarget
          setIsFollowingLatest(
            node.scrollHeight - node.scrollTop - node.clientHeight < 8,
          )
        }}
        className={cn(
          "ousia-hover-scrollbar bg-background/75 text-muted-foreground max-h-48 overflow-auto rounded-[4px] px-2.5 py-1.5 font-mono text-[11px] leading-4 whitespace-pre-wrap",
          tone === "warning" &&
            "bg-[var(--ousia-tool-warning-bg)] text-[var(--ousia-tool-warning-strong)]",
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
    const verb = name === "edit" ? "edit" : "write"
    return formatToolTargetSummary(item, verb, filePreviewPath(item, verb))
  }
  return formatToolName(item.name)
}

function formatToolGroupSummary(
  items: ToolChatItem[],
  t: ReturnType<typeof getMessages>,
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
    { bash: 0, edit: 0, ls: 0, other: 0, read: 0, search: 0 },
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

function formatToolTargetSummary(
  item: ToolChatItem,
  verb: string,
  preferredTarget = "",
) {
  const target = preferredTarget || toolTargetFromInput(item.input || item.text)
  return target ? `${verb} ${target}` : verb
}

function filePreviewPath(item: ToolChatItem, verb: string) {
  const preview = item.filePreview ?? toolFilePreviewFromItem(item)
  const path = preview && "path" in preview ? (preview.path ?? "") : ""
  const trimmed = path.trim()
  return trimmed && trimmed !== verb ? trimmed : ""
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
      .filter(
        (part): part is string => typeof part === "string" && !!part.trim(),
      )
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
  return trimmed.includes("\n")
    ? (trimmed.split("\n", 1)[0]?.trim() ?? "")
    : trimmed
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
    items.some((item) => ["grep", "find"].includes(item.name.toLowerCase()))
  ) {
    return <Search size={15} strokeWidth={1.5} />
  }
  if (items.some((item) => item.name.toLowerCase() === "ls")) {
    return <FolderOpen size={15} strokeWidth={1.5} />
  }
  if (
    items.some((item) => ["edit", "write"].includes(item.name.toLowerCase()))
  ) {
    return <Pencil size={15} strokeWidth={1.5} />
  }
  return <File size={15} strokeWidth={1.5} />
}

function renderToolIcon(name: string) {
  const normalizedName = name.toLowerCase()
  if (normalizedName.includes("bash") || normalizedName.includes("shell")) {
    return <Terminal size={15} strokeWidth={1.5} />
  }
  if (normalizedName.includes("edit") || normalizedName.includes("write")) {
    return <Pencil size={15} strokeWidth={1.5} />
  }
  if (normalizedName.includes("code")) {
    return <Code size={15} strokeWidth={1.5} />
  }
  if (normalizedName.includes("read")) {
    return <File className="-translate-x-px" size={15} strokeWidth={1.5} />
  }
  if (normalizedName.includes("file")) {
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
