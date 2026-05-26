import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type UIEvent,
} from "react"
import {
  Add01Icon,
  AiSearchIcon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowUp02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CodeIcon,
  Copy01Icon,
  DatabaseIcon,
  File01Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  LayoutRightIcon,
  Search01Icon,
  TerminalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown } from "lucide-react"
import { Streamdown } from "streamdown"
import "streamdown/styles.css"

import type {
  AppSettings,
  ProjectRecord,
  SessionRecord,
} from "@/app/app-state"
import {
  findModelPreset,
  modelPresetValue,
  modelPresets,
} from "@/app/model-presets"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  OusiaChatEvent,
} from "@/electron/chat-types"
import type { ChatItem } from "@/features/chat/chat-events"
import { TitleBarSidebarToggle } from "@/features/shell/TitleBarTrafficLightSlot"
import { cn } from "@/lib/utils"

const CHAT_INPUT_MAX_HEIGHT = 192
const CHAT_CONTENT_MAX_WIDTH_CLASS = "mx-auto w-full max-w-4xl"

type ChatAreaProps = {
  currentProject: ProjectRecord | undefined
  currentSession: SessionRecord | undefined
  items: ChatItem[]
  isAgentWorking: boolean
  isSidebarCollapsed: boolean
  isWindowFullscreen: boolean
  isWorkspaceCollapsed: boolean
  onLocalEvent: (event: OusiaChatEvent) => void
  onGenerateSessionTitle: (sessionId: string, firstPrompt: string) => void
  onExpandWorkspace: () => void
  onSettingsChange: (settings: AppSettings) => void
  onToggleSidebar: () => void
  settings: AppSettings
  style: CSSProperties
}

function formatToolName(name: string) {
  if (!name) {
    return "工具"
  }
  return name
    .replace(/^tool[-_:]/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function ChatArea({
  currentProject,
  currentSession,
  items,
  isAgentWorking,
  isSidebarCollapsed,
  isWindowFullscreen,
  isWorkspaceCollapsed,
  onLocalEvent,
  onGenerateSessionTitle,
  onExpandWorkspace,
  onSettingsChange,
  onToggleSidebar,
  settings,
  style,
}: ChatAreaProps) {
  const [draft, setDraft] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [isInterrupting, setIsInterrupting] = useState(false)
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(
    null
  )
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle"
  )
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sessionMenuRef = useRef<HTMLDivElement>(null)
  const isComposingRef = useRef(false)
  const isProgrammaticScrollRef = useRef(false)
  const hasElectronApi = Boolean(window.ousia)
  const currentSessionMenuKey = currentSession?.id ?? "no-session"
  const isSessionMenuOpen = openSessionMenuKey === currentSessionMenuKey
  const selectedModelPreset = findModelPreset(
    settings.modelProvider,
    settings.modelId
  )
  const selectedModelValue = selectedModelPreset
    ? modelPresetValue(selectedModelPreset.provider, selectedModelPreset.modelId)
    : "custom"

  function isScrolledToLatest(node: HTMLDivElement) {
    return node.scrollHeight - node.scrollTop - node.clientHeight < 24
  }

  function scrollToLatest(behavior: ScrollBehavior = "auto") {
    const node = scrollRef.current
    if (!node) {
      return
    }
    isProgrammaticScrollRef.current = true
    node.scrollTo({
      top: node.scrollHeight,
      behavior,
    })
    setIsFollowingLatest(true)
    setShowScrollToLatest(false)
    window.setTimeout(
      () => {
        const currentNode = scrollRef.current
        if (currentNode && isScrolledToLatest(currentNode)) {
          isProgrammaticScrollRef.current = false
        }
      },
      behavior === "smooth" ? 450 : 0
    )
  }

  useEffect(() => {
    if (!isFollowingLatest) {
      return
    }
    const node = scrollRef.current
    if (!node) {
      return
    }
    isProgrammaticScrollRef.current = true
    node.scrollTo({
      top: node.scrollHeight,
      behavior: "auto",
    })
    window.setTimeout(() => {
      const currentNode = scrollRef.current
      if (currentNode && isScrolledToLatest(currentNode)) {
        isProgrammaticScrollRef.current = false
      }
    }, 0)
  }, [isAgentWorking, isFollowingLatest, items])

  useEffect(() => {
    if (!currentSession) {
      return
    }
    inputRef.current?.focus()
  }, [currentSession])

  useEffect(() => {
    if (!isSessionMenuOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const node = sessionMenuRef.current
      if (node?.contains(event.target as Node)) {
        return
      }
      setOpenSessionMenuKey(null)
      setCopyStatus("idle")
    }

    window.addEventListener("pointerdown", handlePointerDown)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [isSessionMenuOpen])

  useLayoutEffect(() => {
    const node = inputRef.current
    if (!node) {
      return
    }

    node.style.height = "auto"
    const nextHeight = Math.min(node.scrollHeight, CHAT_INPUT_MAX_HEIGHT)
    node.style.height = `${nextHeight}px`
    node.style.overflowY =
      node.scrollHeight > CHAT_INPUT_MAX_HEIGHT ? "auto" : "hidden"
  }, [draft])

  function handleChatScroll(event: UIEvent<HTMLDivElement>) {
    const isAtLatest = isScrolledToLatest(event.currentTarget)
    if (isProgrammaticScrollRef.current) {
      if (isAtLatest) {
        isProgrammaticScrollRef.current = false
      }
      return
    }
    setIsFollowingLatest(isAtLatest)
    setShowScrollToLatest(!isAtLatest)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || isSending) {
      return
    }
    if (!window.ousia || !currentProject || !currentSession) {
      onLocalEvent({
        type: "error",
        id: `no-electron-${Date.now()}`,
        text: window.ousia
          ? "请先选择项目和会话，再开始聊天。"
          : "请用 Electron 打开此应用以使用 pi coding agent。",
        timestamp: new Date().toISOString(),
      })
      return
    }
    setDraft("")
    scrollToLatest("auto")
    setIsSending(true)
    const shouldGenerateTitle =
      currentSession.title.trim() === "新会话" && items.length === 0
    try {
      await window.ousia.sendChatMessage({
        prompt: text,
        projectPath: currentProject.path,
        sessionId: currentSession.id,
        thinkingLevel: settings.thinkingLevel,
        model: {
          provider: settings.modelProvider,
          modelId: settings.modelId,
          apiKey: settings.modelApiKey.trim() || undefined,
        },
      })
      if (shouldGenerateTitle) {
        onGenerateSessionTitle(currentSession.id, text)
      }
    } finally {
      setIsSending(false)
    }
  }

  async function handleInterrupt() {
    if (isInterrupting || !window.ousia || !currentProject || !currentSession) {
      return
    }
    setIsInterrupting(true)
    try {
      await window.ousia.interruptChat({
        projectPath: currentProject.path,
        sessionId: currentSession.id,
      })
    } finally {
      setIsInterrupting(false)
    }
  }

  function handleEscapeKey(event: KeyboardEvent) {
    if (event.key !== "Escape") {
      return
    }
    if (isSessionMenuOpen) {
      event.preventDefault()
      setOpenSessionMenuKey(null)
      setCopyStatus("idle")
      return
    }
    event.preventDefault()
    void handleInterrupt()
  }

  async function handleCopySessionHistory() {
    const text = formatSessionHistoryForClipboard({
      items,
      projectPath: currentProject?.path,
      sessionTitle: currentSession?.title ?? "新会话",
    })
    try {
      await writeTextToClipboard(text)
      setCopyStatus("copied")
      window.setTimeout(() => {
        setOpenSessionMenuKey(null)
        setCopyStatus("idle")
      }, 700)
    } catch {
      setCopyStatus("failed")
      onLocalEvent({
        type: "error",
        id: `copy-history-${Date.now()}`,
        text: "复制会话历史失败，请检查系统剪贴板权限。",
        timestamp: new Date().toISOString(),
      })
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const text = event.clipboardData.getData("text/plain")
    const normalizedText = normalizePastedMessageText(text)
    if (normalizedText === text) {
      return
    }
    event.preventDefault()
    const target = event.currentTarget
    const selectionStart = target.selectionStart
    const selectionEnd = target.selectionEnd
    setDraft(
      (current) =>
        `${current.slice(0, selectionStart)}${normalizedText}${current.slice(selectionEnd)}`
    )
    window.requestAnimationFrame(() => {
      const nextCursor = selectionStart + normalizedText.length
      inputRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  return (
    <section
      className="flex min-w-0 shrink-0 flex-col bg-[#fff] dark:bg-background"
      style={style}
      onKeyDownCapture={handleEscapeKey}
    >
      <header className="window-drag grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b px-4">
        <div className="window-drag flex min-w-0 items-center gap-3 self-stretch">
          {isSidebarCollapsed ? (
            <TitleBarSidebarToggle
              isFullscreen={isWindowFullscreen}
              label="展开侧边栏"
              onClick={onToggleSidebar}
            />
          ) : null}
          <div className="window-drag flex min-w-0 flex-1 items-center self-stretch">
            <h1 className="window-drag truncate text-base font-semibold">
              {currentSession?.title ?? "新会话"}
            </h1>
          </div>
        </div>
        <div className="window-no-drag flex shrink-0 items-center gap-1">
          <div className="relative" ref={sessionMenuRef}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="更多会话操作"
              aria-expanded={isSessionMenuOpen}
              aria-haspopup="menu"
              onClick={() => {
                setOpenSessionMenuKey((current) =>
                  current === currentSessionMenuKey ? null : currentSessionMenuKey
                )
                setCopyStatus("idle")
              }}
            >
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                size={19}
                strokeWidth={1.8}
              />
            </Button>
            {isSessionMenuOpen ? (
              <div
                role="menu"
                aria-label="会话操作"
                className="absolute top-full right-0 z-50 mt-2 min-w-48 rounded-md bg-popover p-1 text-popover-foreground ring-1 ring-foreground/10 dark:shadow-md"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                  onClick={() => void handleCopySessionHistory()}
                >
                  <HugeiconsIcon
                    icon={copyStatus === "copied" ? Tick02Icon : Copy01Icon}
                    size={16}
                    strokeWidth={1.9}
                    className="text-muted-foreground"
                  />
                  <span className="flex-1">
                    {copyStatus === "copied"
                      ? "已复制"
                      : copyStatus === "failed"
                        ? "复制失败"
                        : "复制会话历史"}
                  </span>
                </button>
              </div>
            ) : null}
          </div>
          {isWorkspaceCollapsed ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="展开工作区"
              onClick={onExpandWorkspace}
            >
              <HugeiconsIcon
                icon={LayoutRightIcon}
                size={19}
                strokeWidth={1.8}
              />
            </Button>
          ) : null}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="ousia-hover-scrollbar min-h-0 flex-1 select-text overflow-auto px-5 pt-4 pb-8"
        onScroll={handleChatScroll}
      >
        <div className={cn(CHAT_CONTENT_MAX_WIDTH_CLASS, "space-y-3")}>
          {items.length ? (
            <>
              {items.map((item) => <ChatItemView item={item} key={item.id} />)}
              {shouldShowTurnWaitIndicator(items, isAgentWorking) ? (
                <AgentTurnWaitIndicator />
              ) : null}
            </>
          ) : (
            <div className="flex min-h-[45vh] items-center justify-center text-center text-sm leading-6 text-muted-foreground">
              <div className="max-w-sm">
                {hasElectronApi
                  ? `让智能体在 ${currentProject?.path ?? "某个项目"} 中工作。`
                  : "请用 Electron 打开以和 pi coding agent 对话。"}
              </div>
            </div>
          )}
        </div>
      </div>

      {showScrollToLatest ? (
        <div className="pointer-events-none relative z-20 h-0 shrink-0">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="pointer-events-auto absolute bottom-3 left-1/2 size-8 -translate-x-1/2 rounded-full border bg-popover/90 text-popover-foreground backdrop-blur dark:shadow-md"
            aria-label="滚动到最新消息"
            onClick={() => scrollToLatest("smooth")}
          >
            <ArrowDown className="size-4" strokeWidth={2} />
          </Button>
        </div>
      ) : null}

      <form className="shrink-0 px-5 pt-2 pb-5" onSubmit={handleSubmit}>
        <div className={CHAT_CONTENT_MAX_WIDTH_CLASS}>
          <div className="rounded-xl bg-card p-3 dark:shadow-sm">
            <textarea
              ref={inputRef}
              aria-label="消息"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={handlePaste}
              onCompositionStart={() => {
                isComposingRef.current = true
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  if (isComposingRef.current || event.nativeEvent.isComposing) {
                    return
                  }
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              className="ousia-hover-scrollbar min-h-14 w-full resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground"
              placeholder={isAgentWorking ? "继续发送消息..." : "在这里输入消息...."}
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="添加附件"
                >
                  <HugeiconsIcon icon={Add01Icon} size={18} strokeWidth={2} />
                </Button>
                <Select
                  items={[
                    ...modelPresets.map((preset) => ({
                      label: preset.label,
                      value: modelPresetValue(preset.provider, preset.modelId),
                    })),
                    { label: "自定义模型", value: "custom" },
                  ]}
                  value={selectedModelValue}
                  onValueChange={(value) => {
                    if (value === "custom") {
                      return
                    }
                    const preset = modelPresets.find(
                      (item) =>
                        modelPresetValue(item.provider, item.modelId) === value
                    )
                    if (!preset) {
                      return
                    }
                    onSettingsChange({
                      ...settings,
                      modelProvider: preset.provider,
                      modelId: preset.modelId,
                    })
                  }}
                >
                  <SelectTrigger
                    aria-label="切换模型"
                    size="sm"
                    className="max-w-52 border-transparent bg-transparent px-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground dark:bg-transparent dark:hover:bg-accent"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    <SelectGroup>
                      {modelPresets.map((preset) => (
                        <SelectItem
                          key={modelPresetValue(
                            preset.provider,
                            preset.modelId
                          )}
                          value={modelPresetValue(
                            preset.provider,
                            preset.modelId
                          )}
                        >
                          {preset.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">自定义模型</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="submit"
                size="icon"
                disabled={isSending || !draft.trim()}
              >
                <HugeiconsIcon icon={ArrowUp02Icon} size={19} strokeWidth={2} />
              </Button>
            </div>
          </div>
        </div>
      </form>
    </section>
  )
}

function ChatItemView({ item }: { item: ChatItem }) {
  if (item.role === "thinking") {
    if (item.status === "finished") {
      return null
    }

    return (
      <div className="border-l border-border/70 py-1 pr-2 pl-3 text-xs leading-5 text-muted-foreground/70 italic">
        {item.text || "思考中..."}
      </div>
    )
  }

  if (item.role === "tool") {
    return <ToolCallView item={item} />
  }

  if (item.role === "system" || item.role === "error") {
    return (
      <div
        className={[
          "text-xs leading-5",
          item.role === "error" ? "text-destructive" : "text-muted-foreground",
        ].join(" ")}
      >
        {item.text}
      </div>
    )
  }

  return (
    <article
      className={[
        "select-text text-sm leading-5",
        item.role === "user"
          ? "ml-auto w-fit rounded-lg bg-card px-3 py-2 text-card-foreground"
          : "text-foreground",
      ].join(" ")}
    >
      {item.role === "assistant" ? (
        <Streamdown
          mode={item.status === "streaming" ? "streaming" : "static"}
          isAnimating={item.status === "streaming"}
          linkSafety={{ enabled: false }}
          className="ousia-chat-markdown space-y-0 text-sm leading-5 break-words"
        >
          {item.text}
        </Streamdown>
      ) : (
        <p className="m-0 break-words whitespace-pre-wrap">{item.text}</p>
      )}
    </article>
  )
}

function normalizePastedMessageText(text: string) {
  if (!text.includes("\n")) {
    return text
  }
  const normalizedLineEndings = text.replace(/\r\n/g, "\n")
  const trimmed = normalizedLineEndings.replace(/^\n+/, "").replace(/\n+$/, "")
  if (!trimmed) {
    return text
  }

  const leadingBlankLines = normalizedLineEndings.match(/^\n+/)?.[0].length ?? 0
  const trailingBlankLines = normalizedLineEndings.match(/\n+$/)?.[0].length ?? 0
  const looksLikeCopiedSingleMessage =
    (leadingBlankLines > 0 || trailingBlankLines > 0) &&
    !/^\s/.test(trimmed) &&
    !/\n\s*$/.test(trimmed)

  return looksLikeCopiedSingleMessage ? trimmed : text
}

function formatSessionHistoryForClipboard({
  items,
  projectPath,
  sessionTitle,
}: {
  items: ChatItem[]
  projectPath?: string
  sessionTitle: string
}) {
  const lines = [
    "# 会话历史",
    "",
    `会话: ${sessionTitle}`,
    projectPath ? `项目: ${projectPath}` : undefined,
    `导出时间: ${new Date().toISOString()}`,
    "",
  ].filter((line): line is string => line !== undefined)

  if (!items.length) {
    lines.push("（当前会话暂无消息）")
    return lines.join("\n")
  }

  items.forEach((item, index) => {
    if (index > 0) {
      lines.push("")
    }
    if (item.role === "tool") {
      lines.push(
        `## Tool Call: ${formatToolName(item.name)}`,
        `状态: ${item.status}`
      )
      appendHistoryBlock(lines, "Input", item.input || item.text || "{}")
      if (item.errorText) {
        appendHistoryBlock(lines, "Error", item.errorText)
      } else if (item.output) {
        appendHistoryBlock(lines, "Output", item.output)
      }
      return
    }

    const label = {
      assistant: "Agent",
      error: "Error",
      system: "System",
      thinking: "Agent Thinking",
      user: "User",
    }[item.role]
    lines.push(`## ${label}`)
    appendHistoryText(lines, item.text)
  })

  return lines.join("\n")
}

function appendHistoryBlock(lines: string[], title: string, value: string) {
  lines.push(`${title}:`)
  appendHistoryText(lines, value)
}

function appendHistoryText(lines: string[], value: string) {
  const text = value.trim()
  lines.push(text || "（空）")
}

async function writeTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textArea = document.createElement("textarea")
  textArea.value = text
  textArea.style.position = "fixed"
  textArea.style.opacity = "0"
  document.body.append(textArea)
  textArea.focus()
  textArea.select()
  const ok = document.execCommand("copy")
  textArea.remove()
  if (!ok) {
    throw new Error("Clipboard copy failed")
  }
}

function shouldShowTurnWaitIndicator(items: ChatItem[], isAgentWorking: boolean) {
  if (!isAgentWorking) {
    return false
  }
  return !items.some((item) => {
    if (item.role === "assistant" || item.role === "thinking") {
      return item.status === "streaming"
    }
    if (item.role === "tool") {
      return item.status === "running"
    }
    return false
  })
}

function AgentTurnWaitIndicator() {
  return (
    <div className="flex items-center px-2 py-1" aria-label="等待下一步响应" role="status">
      <span className="flex h-5 items-center gap-1">
        {[0, 1, 2].map((index) => (
          <span
            className="size-1.5 rounded-full bg-muted-foreground/55 motion-reduce:animate-none"
            key={index}
            style={{
              animation: "ousia-wave-dot 0.9s ease-in-out infinite",
              animationDelay: `${index * 0.12}s`,
            }}
          />
        ))}
      </span>
    </div>
  )
}

type ToolChatItem = Extract<ChatItem, { role: "tool" }>

function ToolCallView({ item }: { item: ToolChatItem }) {
  const [isOpen, setIsOpen] = useState(false)
  const input = item.input ?? (item.status === "running" ? item.text : "")
  const output = item.output ?? (item.status === "finished" ? item.text : "")
  const errorText = item.errorText ?? (item.status === "failed" ? item.text : "")
  const status = getToolStatus(item.status)
  const ToolIcon = getToolIcon(item.name)

  return (
    <div className="overflow-hidden rounded-lg bg-muted/25 text-xs text-card-foreground">
      <button
        type="button"
        aria-expanded={isOpen}
        className="flex h-9 w-full items-center gap-2 bg-muted/35 px-3 text-left outline-none transition-colors hover:bg-muted/55 focus-visible:bg-muted/65"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background/70 text-muted-foreground">
          <HugeiconsIcon icon={ToolIcon} size={15} strokeWidth={1.9} />
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
          <HugeiconsIcon
            icon={status.icon}
            size={12}
            strokeWidth={2}
            className={status.isSpinning ? "animate-spin" : undefined}
          />
          {status.label}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={15}
          strokeWidth={1.9}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen ? (
        <div className="bg-muted/15 px-3 py-3">
          <ToolPayloadSection title="Parameters" value={input || "{}"} />
          {errorText ? (
            <ToolPayloadSection
              title="Error"
              value={errorText}
              tone="destructive"
            />
          ) : output ? (
            <ToolPayloadSection title="Result" value={output} />
          ) : item.status === "running" ? (
            <div className="mt-3 text-[11px] leading-5 text-muted-foreground">
              Waiting for result...
            </div>
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

function getToolStatus(status: ToolChatItem["status"]) {
  if (status === "failed") {
    return {
      label: "Error",
      icon: AlertCircleIcon,
      className:
        "bg-destructive/10 text-destructive dark:bg-destructive/15",
      isSpinning: false,
    }
  }
  if (status === "running") {
    return {
      label: "Running",
      icon: Loading03Icon,
      className: "bg-background/70 text-muted-foreground",
      isSpinning: true,
    }
  }
  return {
    label: "Completed",
    icon: CheckmarkCircle02Icon,
    className: "bg-background/70 text-muted-foreground",
    isSpinning: false,
  }
}

function getToolIcon(name: string) {
  const normalizedName = name.toLowerCase()
  if (normalizedName.includes("bash") || normalizedName.includes("shell")) {
    return TerminalIcon
  }
  if (normalizedName.includes("read") || normalizedName.includes("file")) {
    return File01Icon
  }
  if (normalizedName.includes("grep") || normalizedName.includes("find")) {
    return Search01Icon
  }
  if (normalizedName.includes("search")) {
    return AiSearchIcon
  }
  if (normalizedName.includes("database") || normalizedName.includes("sql")) {
    return DatabaseIcon
  }
  if (normalizedName.includes("code") || normalizedName.includes("edit")) {
    return CodeIcon
  }
  return Clock01Icon
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
