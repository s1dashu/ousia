import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type UIEvent,
} from "react"
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock,
  Code,
  Copy,
  Database,
  File,
  FileImage,
  FileText,
  LoaderCircle,
  type LucideIcon,
  MoreHorizontal,
  Paperclip,
  PanelLeft,
  Plus,
  Search,
  Sparkles,
  Terminal,
  X,
} from "lucide-react"
import { Streamdown } from "streamdown"
import "streamdown/styles.css"

import type {
  AppSettings,
  ProjectRecord,
  SessionRecord,
} from "@/app/app-state"
import {
  findRegistryModel,
  getConfiguredModelPresets,
  modelLabel,
  modelPresetValue,
} from "@/app/model-presets"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import {
  getOusiaModelProviderApiKey,
  normalizeOusiaAppSettings,
  type OusiaChatAttachment,
  type OusiaChatEvent,
  type OusiaModelRegistryResult,
  type OusiaThinkingLevel,
} from "@/electron/chat-types"
import type { ExtensionAgentQuoteToInputPayload } from "@/extensions/types"
import type { ChatItem } from "@/features/chat/chat-events"
import { TitleBarSidebarToggle } from "@/features/shell/TitleBarTrafficLightSlot"
import { cn } from "@/lib/utils"

const CHAT_INPUT_MAX_HEIGHT = 192
const CHAT_INPUT_MIN_HEIGHT = 48
const CHAT_CONTENT_MAX_WIDTH_CLASS = "mx-auto w-full max-w-4xl"
const DEFAULT_CHAT_THINKING_LEVEL: OusiaThinkingLevel = "medium"
const TURN_WAIT_INDICATOR_DELAY_MS = 180
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 40 * 1024 * 1024

const chatThinkingLabels: Record<OusiaThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
}

type ChatAreaProps = {
  currentProject: ProjectRecord | undefined
  currentSession: SessionRecord | undefined
  draftQuoteIntent?: ChatQuoteIntent | null
  items: ChatItem[]
  isAgentWorking: boolean
  isSidebarCollapsed: boolean
  isWindowFullscreen: boolean
  isWorkspaceCollapsed: boolean
  modelRegistry: OusiaModelRegistryResult | undefined
  onLocalEvent: (event: OusiaChatEvent) => void
  onGenerateSessionTitle: (sessionId: string, firstPrompt: string) => void
  onDraftQuoteIntentHandled?: (id: string) => void
  onExpandWorkspace: () => void
  onSettingsChange: (settings: AppSettings) => void
  onToggleSidebar: () => void
  settings: AppSettings
  style: CSSProperties
}

export type ChatQuoteIntent = ExtensionAgentQuoteToInputPayload & {
  id: string
}

type ChatAttachmentSummary = Pick<
  OusiaChatAttachment,
  "id" | "kind" | "mediaType" | "name" | "size"
>

const BUILT_IN_TOOL_NAMES = new Set([
  "bash",
  "edit",
  "find",
  "grep",
  "ls",
  "read",
  "write",
])

function normalizeToolName(name: string) {
  return name
    .trim()
    .replace(/^tool[-_:]/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
}

function formatToolName(name: string) {
  if (!name) {
    return "tool"
  }

  const normalizedName = normalizeToolName(name)
  const canonicalName = normalizedName.toLowerCase()
  if (BUILT_IN_TOOL_NAMES.has(canonicalName)) {
    return canonicalName
  }

  return normalizedName || "tool"
}

function defaultThinkingLevelFor(levels: OusiaThinkingLevel[]) {
  return levels.includes(DEFAULT_CHAT_THINKING_LEVEL)
    ? DEFAULT_CHAT_THINKING_LEVEL
    : (levels[0] ?? DEFAULT_CHAT_THINKING_LEVEL)
}

export function ChatArea({
  currentProject,
  currentSession,
  draftQuoteIntent,
  items,
  isAgentWorking,
  isSidebarCollapsed,
  isWindowFullscreen,
  isWorkspaceCollapsed,
  modelRegistry,
  onLocalEvent,
  onGenerateSessionTitle,
  onDraftQuoteIntentHandled,
  onExpandWorkspace,
  onSettingsChange,
  onToggleSidebar,
  settings,
  style,
}: ChatAreaProps) {
  const [draft, setDraft] = useState("")
  const [attachments, setAttachments] = useState<OusiaChatAttachment[]>([])
  const [isSending, setIsSending] = useState(false)
  const [isInterrupting, setIsInterrupting] = useState(false)
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(
    null
  )
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle"
  )
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputScrollTopBeforeResizeRef = useRef(0)
  const isComposingRef = useRef(false)
  const isProgrammaticScrollRef = useRef(false)
  const currentSessionMenuKey = currentSession?.id ?? "no-session"
  const isSessionMenuOpen = openSessionMenuKey === currentSessionMenuKey
  const configuredModelPresets = getConfiguredModelPresets(
    settings.modelProviders,
    modelRegistry
  )
  const selectedModelPreset = findRegistryModel(
    modelRegistry,
    settings.modelProvider,
    settings.modelId
  )
  const activeThinkingLevels =
    selectedModelPreset?.thinkingLevels ?? [settings.thinkingLevel]
  const selectedThinkingLevel = activeThinkingLevels.includes(
    settings.thinkingLevel
  )
    ? settings.thinkingLevel
    : defaultThinkingLevelFor(activeThinkingLevels)
  const selectedModelLabel =
    selectedModelPreset ? modelLabel(selectedModelPreset) : settings.modelId
  const showTurnWaitIndicator = useDelayedTurnWaitIndicator(
    shouldShowTurnWaitIndicator(items, isAgentWorking)
  )
  const hasDraftContent = Boolean(draft.trim() || attachments.length)

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
    const sessionId = currentSession?.id
    if (!sessionId) {
      return
    }
    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true })
    })
    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [currentSession?.id])

  useEffect(() => {
    if (
      !selectedModelPreset ||
      selectedModelPreset.thinkingLevels.includes(settings.thinkingLevel)
    ) {
      return
    }

    onSettingsChange(
      normalizeOusiaAppSettings({
        ...settings,
        thinkingLevel: defaultThinkingLevelFor(selectedModelPreset.thinkingLevels),
      })
    )
  }, [onSettingsChange, selectedModelPreset, settings])

  useLayoutEffect(() => {
    const node = inputRef.current
    if (!node) {
      return
    }

    const previousScrollTop = Math.max(
      node.scrollTop,
      inputScrollTopBeforeResizeRef.current
    )
    node.style.height = "auto"
    const nextHeight = Math.min(
      Math.max(node.scrollHeight, CHAT_INPUT_MIN_HEIGHT),
      CHAT_INPUT_MAX_HEIGHT
    )
    node.style.height = `${nextHeight}px`
    node.style.overflowY =
      node.scrollHeight > CHAT_INPUT_MAX_HEIGHT ? "auto" : "hidden"
    node.scrollTop = Math.min(
      previousScrollTop,
      Math.max(0, node.scrollHeight - node.clientHeight)
    )
    inputScrollTopBeforeResizeRef.current = node.scrollTop
  }, [draft])

  useEffect(() => {
    if (!draftQuoteIntent) {
      return
    }
    const block = formatQuoteIntentForDraft(draftQuoteIntent)
    let focusFrameId: number | undefined
    const frameId = window.requestAnimationFrame(() => {
      setDraft((current) => {
        const trimmedCurrent = current.replace(/\s+$/, "")
        return trimmedCurrent ? `${trimmedCurrent}\n\n${block}` : block
      })
      focusFrameId = window.requestAnimationFrame(() => {
        const node = inputRef.current
        if (!node) {
          return
        }
        node.focus({ preventScroll: true })
        const cursor = node.value.length
        node.setSelectionRange(cursor, cursor)
      })
    })
    onDraftQuoteIntentHandled?.(draftQuoteIntent.id)
    return () => {
      window.cancelAnimationFrame(frameId)
      if (focusFrameId !== undefined) {
        window.cancelAnimationFrame(focusFrameId)
      }
    }
  }, [draftQuoteIntent, onDraftQuoteIntentHandled])

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

  function updateThinkingLevel(thinkingLevel: OusiaThinkingLevel) {
    onSettingsChange(
      normalizeOusiaAppSettings({
        ...settings,
        thinkingLevel,
      })
    )
  }

  function updateModel(model: (typeof configuredModelPresets)[number]) {
    const thinkingLevel = model.thinkingLevels.includes(settings.thinkingLevel)
      ? settings.thinkingLevel
      : defaultThinkingLevelFor(model.thinkingLevels)

    onSettingsChange(
      normalizeOusiaAppSettings({
        ...settings,
        modelProvider: model.provider,
        modelId: model.modelId,
        thinkingLevel,
      })
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if ((!text && attachments.length === 0) || isSending) {
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
    if (
      attachments.some((attachment) => attachment.kind === "image") &&
      selectedModelPreset &&
      !selectedModelPreset.input.includes("image")
    ) {
      onLocalEvent({
        type: "error",
        id: `image-model-${Date.now()}`,
        text: "当前模型不支持图片输入，请切换到支持识图的模型后重试。",
        timestamp: new Date().toISOString(),
      })
      return
    }
    const outgoingAttachments = attachments
    setDraft("")
    setAttachments([])
    scrollToLatest("auto")
    setIsSending(true)
    const shouldGenerateTitle =
      currentSession.title.trim() === "新会话" && items.length === 0
    onLocalEvent({
      type: "run_status",
      status: "starting",
      timestamp: new Date().toISOString(),
    })
    try {
      const result = await window.ousia.sendChatMessage({
        prompt: text,
        attachments: outgoingAttachments,
        projectPath: currentProject.path,
        sessionId: currentSession.id,
        thinkingLevel: selectedThinkingLevel,
        model: {
          provider: settings.modelProvider,
          modelId: settings.modelId,
          apiKey: getOusiaModelProviderApiKey(settings)?.trim() || undefined,
        },
      })
      if (!result.ok) {
        onLocalEvent({
          type: "run_status",
          status: "error",
          timestamp: new Date().toISOString(),
        })
      }
      if (shouldGenerateTitle) {
        const titlePrompt =
          text || outgoingAttachments.map((attachment) => attachment.name).join(" ")
        if (titlePrompt) {
          onGenerateSessionTitle(currentSession.id, titlePrompt)
        }
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
    if (isModelMenuOpen) {
      event.preventDefault()
      setIsModelMenuOpen(false)
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
    const files = filesFromDataTransfer(event.clipboardData)
    if (files.length) {
      event.preventDefault()
      void addFiles(files)
      return
    }
    const text = event.clipboardData.getData("text/plain")
    const normalizedText = normalizePastedMessageText(text)
    if (normalizedText === text) {
      return
    }
    event.preventDefault()
    const target = event.currentTarget
    inputScrollTopBeforeResizeRef.current = target.scrollTop
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

  function handleDraftChange(event: ChangeEvent<HTMLTextAreaElement>) {
    inputScrollTopBeforeResizeRef.current = event.currentTarget.scrollTop
    setDraft(event.currentTarget.value)
  }

  async function addFiles(files: File[]) {
    const currentTotal = attachments.reduce((total, item) => total + item.size, 0)
    const selectedTotal = files.reduce((total, file) => total + file.size, 0)
    if (currentTotal + selectedTotal > MAX_TOTAL_ATTACHMENT_BYTES) {
      onLocalEvent({
        type: "error",
        id: `attachments-too-large-${Date.now()}`,
        text: "附件总大小不能超过 40 MB。",
        timestamp: new Date().toISOString(),
      })
      return
    }

    const next: OusiaChatAttachment[] = []
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        onLocalEvent({
          type: "error",
          id: `attachment-too-large-${Date.now()}-${file.name}`,
          text: `${file.name} 超过 20 MB，已跳过。`,
          timestamp: new Date().toISOString(),
        })
        continue
      }
      try {
        next.push(await chatAttachmentFromFile(file))
      } catch {
        onLocalEvent({
          type: "error",
          id: `attachment-read-failed-${Date.now()}-${file.name}`,
          text: `${file.name} 读取失败，已跳过。`,
          timestamp: new Date().toISOString(),
        })
      }
    }
    if (!next.length) {
      return
    }
    setAttachments((current) => [...current, ...next])
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true })
    })
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id))
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
          <DropdownMenu
            modal={false}
            open={isSessionMenuOpen}
            onOpenChange={(open) => {
              setOpenSessionMenuKey(open ? currentSessionMenuKey : null)
              if (!open) {
                setCopyStatus("idle")
              }
            }}
          >
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="更多会话操作"
                />
              }
            >
              <MoreHorizontal size={19} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-auto rounded-md shadow-none dark:shadow-md"
            >
              <DropdownMenuItem
                className="gap-2 rounded-sm px-2 py-1.5 hover:bg-muted/45 focus:bg-muted/45"
                onClick={() => void handleCopySessionHistory()}
              >
                {copyStatus === "copied" ? (
                  <Check size={16} className="text-muted-foreground" />
                ) : (
                  <Copy size={16} className="text-muted-foreground" />
                )}
                <span className="flex-1">
                  {copyStatus === "copied"
                    ? "已复制"
                    : copyStatus === "failed"
                      ? "复制失败"
                      : "复制会话历史"}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {isWorkspaceCollapsed ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="展开工作区"
              onClick={onExpandWorkspace}
            >
              <PanelLeft size={19} />
            </Button>
          ) : null}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="ousia-hover-scrollbar ousia-stable-scrollbar-gutter min-h-0 flex-1 select-text overflow-auto px-5 pt-4 pb-16"
        onScroll={handleChatScroll}
      >
        <div className={cn(CHAT_CONTENT_MAX_WIDTH_CLASS, "space-y-5")}>
          {items.length ? (
            <>
              {items.map((item) => <ChatItemView item={item} key={item.id} />)}
              {showTurnWaitIndicator ? <AgentTurnWaitIndicator /> : null}
            </>
          ) : (
            null
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
          <div className="rounded-xl bg-white px-3 pt-2 pb-2 ring-1 ring-border/80 outline outline-4 outline-border/30 transition-[outline-color,outline-width,ring-color] focus-within:ring-ring/45 focus-within:outline-[5px] focus-within:outline-ring/20 dark:bg-background dark:ring-border/80 dark:outline-border/30 dark:focus-within:ring-ring/45 dark:focus-within:outline-ring/20">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? [])
                event.currentTarget.value = ""
                void addFiles(files)
              }}
            />
            {attachments.length ? (
              <AttachmentStrip
                attachments={attachments}
                onRemove={removeAttachment}
              />
            ) : null}
            <Textarea
              ref={inputRef}
              aria-label="消息"
              value={draft}
              onChange={handleDraftChange}
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
              className="ousia-hover-scrollbar min-h-12 rounded-none border-0 bg-transparent p-0 text-sm leading-6 [field-sizing:fixed] focus-visible:ring-0"
              placeholder={isAgentWorking ? "继续发送消息..." : "在这里输入消息...."}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  aria-label="添加附件"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Plus size={18} />
                </Button>
                <DropdownMenu
                  modal={false}
                  open={isModelMenuOpen}
                  onOpenChange={setIsModelMenuOpen}
                >
                  <DropdownMenuTrigger
                    aria-label="切换模型和推理强度"
                    className="flex h-7 max-w-64 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground outline-none transition-[background-color,color,scale] hover:bg-accent hover:text-accent-foreground active:scale-[0.96]"
                  >
                    <span className="min-w-0 truncate text-foreground">
                      {selectedModelLabel}
                    </span>
                    {selectedThinkingLevel !== "off" ? (
                      <span className="shrink-0 text-muted-foreground">
                        {chatThinkingLabels[selectedThinkingLevel]}
                      </span>
                    ) : null}
                    <ChevronDown
                      size={16}
                      className="shrink-0 text-muted-foreground"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    sideOffset={8}
                    align="start"
                    className="w-72 rounded-xl p-2 shadow-[0_18px_50px_rgba(0,0,0,0.10),0_0_0_1px_rgba(0,0,0,0.08)] dark:shadow-[0_18px_50px_rgba(0,0,0,0.42),0_0_0_1px_rgba(255,255,255,0.1)]"
                  >
                    <DropdownMenuLabel className="px-2 pt-1 pb-1 text-sm">
                      Reasoning
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={selectedThinkingLevel}>
                      {activeThinkingLevels.map((level) => (
                        <DropdownMenuRadioItem
                          key={level}
                          value={level}
                          className="h-10 rounded-md px-2"
                          onClick={() => updateThinkingLevel(level)}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {chatThinkingLabels[level]}
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator className="my-2" />
                    <DropdownMenuRadioGroup
                      value={
                        selectedModelPreset
                          ? modelPresetValue(
                              selectedModelPreset.provider,
                              selectedModelPreset.modelId
                            )
                          : undefined
                      }
                    >
                      {configuredModelPresets.map((preset) => {
                        const value = modelPresetValue(
                          preset.provider,
                          preset.modelId
                        )

                        return (
                          <DropdownMenuRadioItem
                            key={value}
                            value={value}
                            className="h-10 rounded-md px-2"
                            onClick={() => updateModel(preset)}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {modelLabel(preset)}
                            </span>
                          </DropdownMenuRadioItem>
                        )
                      })}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button
                type="submit"
                size="icon-sm"
                className="size-7"
                disabled={isSending || !hasDraftContent}
                aria-label="发送消息"
              >
                <ArrowUp size={18} />
              </Button>
            </div>
          </div>
        </div>
      </form>
    </section>
  )
}

function AttachmentStrip({
  attachments,
  onRemove,
}: {
  attachments: OusiaChatAttachment[]
  onRemove: (id: string) => void
}) {
  return (
    <div className="mb-2 flex max-h-28 flex-wrap gap-2 overflow-auto pr-1">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group flex h-12 max-w-56 items-center gap-2 rounded-md border bg-muted/25 px-2"
        >
          {attachment.kind === "image" ? (
            <img
              alt=""
              src={`data:${attachment.mediaType};base64,${attachment.dataBase64}`}
              className="size-8 shrink-0 rounded object-cover"
            />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded bg-background text-muted-foreground">
              {attachment.kind === "text" ? (
                <FileText size={17} />
              ) : (
                <File size={17} />
              )}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs leading-4">
              {attachment.name}
            </span>
            <span className="block truncate text-[11px] leading-4 text-muted-foreground">
              {formatBytes(attachment.size)}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0 text-muted-foreground"
            aria-label={`移除 ${attachment.name}`}
            onClick={() => onRemove(attachment.id)}
          >
            <X size={14} />
          </Button>
        </div>
      ))}
    </div>
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
        <>
          {item.attachments?.length ? (
            <MessageAttachmentList attachments={item.attachments} />
          ) : null}
          {item.text ? (
            <p className="m-0 break-words whitespace-pre-wrap">{item.text}</p>
          ) : null}
        </>
      )}
    </article>
  )
}

function MessageAttachmentList({
  attachments,
}: {
  attachments: ChatAttachmentSummary[]
}) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => {
        const IconComponent =
          attachment.kind === "image"
            ? FileImage
            : attachment.kind === "text"
              ? FileText
              : Paperclip
        return (
          <span
            key={attachment.id}
            className="inline-flex max-w-52 items-center gap-1.5 rounded-md border bg-background/80 px-2 py-1 text-xs text-muted-foreground"
            title={`${attachment.name} · ${formatBytes(attachment.size)}`}
          >
            <IconComponent size={14} className="shrink-0" />
            <span className="truncate">{attachment.name}</span>
          </span>
        )
      })}
    </div>
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

function filesFromDataTransfer(dataTransfer: DataTransfer) {
  const files = Array.from(dataTransfer.files ?? [])
  if (files.length) {
    return files
  }
  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

async function chatAttachmentFromFile(
  file: File
): Promise<OusiaChatAttachment> {
  const mediaType = file.type || mediaTypeFromFileName(file.name)
  const base = {
    id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || "未命名文件",
    mediaType,
    size: file.size,
  }

  if (mediaType.startsWith("image/")) {
    return {
      ...base,
      kind: "image",
      dataBase64: await readFileAsBase64(file),
    }
  }

  if (isTextLikeFile(file, mediaType)) {
    return {
      ...base,
      kind: "text",
      text: await file.text(),
    }
  }

  return {
    ...base,
    kind: "file",
  }
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      resolve(result.replace(/^data:[^;]+;base64,/, ""))
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error("读取文件失败"))
    }
    reader.readAsDataURL(file)
  })
}

function isTextLikeFile(file: File, mediaType: string) {
  if (mediaType.startsWith("text/")) {
    return true
  }
  return /\.(c|cc|conf|cpp|cs|css|csv|go|h|hpp|html|ini|java|js|json|jsx|log|md|mjs|py|rb|rs|sh|sql|svg|toml|ts|tsx|txt|vue|xml|yaml|yml)$/i.test(
    file.name
  )
}

function mediaTypeFromFileName(name: string) {
  if (/\.png$/i.test(name)) {
    return "image/png"
  }
  if (/\.(jpe?g)$/i.test(name)) {
    return "image/jpeg"
  }
  if (/\.gif$/i.test(name)) {
    return "image/gif"
  }
  if (/\.webp$/i.test(name)) {
    return "image/webp"
  }
  if (/\.svg$/i.test(name)) {
    return "image/svg+xml"
  }
  if (/\.(md|txt|log)$/i.test(name)) {
    return "text/plain"
  }
  if (/\.json$/i.test(name)) {
    return "application/json"
  }
  return "application/octet-stream"
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B"
  }
  const units = ["B", "KB", "MB", "GB"]
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function formatQuoteIntentForDraft(intent: ChatQuoteIntent) {
  const selectedText = intent.quote.text.trim()
  const quote = selectedText
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n")
  const sourceLabel =
    intent.source.title?.trim() || intent.source.url?.trim() || "浏览器选区"
  const source = intent.source.url?.trim()
    ? `来源：[${sourceLabel}](${intent.source.url.trim()})`
    : `来源：${sourceLabel}`

  return `${quote}\n\n${source}`
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

function useDelayedTurnWaitIndicator(shouldShow: boolean) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (!shouldShow) {
      const timeoutId = window.setTimeout(() => {
        setIsVisible(false)
      }, 0)
      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    const timeoutId = window.setTimeout(() => {
      setIsVisible(true)
    }, TURN_WAIT_INDICATOR_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [shouldShow])

  return isVisible
}

function AgentTurnWaitIndicator() {
  return (
    <div
      className="flex min-h-10 items-start px-2 pt-1"
      aria-label="等待下一步响应"
      role="status"
    >
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
  const StatusIcon = status.icon

  return (
    <div className="overflow-hidden rounded-lg bg-muted/25 text-xs text-card-foreground">
      <button
        type="button"
        aria-expanded={isOpen}
        className="flex h-9 w-full items-center gap-2 bg-muted/35 px-3 text-left outline-none transition-colors hover:bg-muted/55 focus-visible:bg-muted/65"
        onClick={() => setIsOpen((current) => !current)}
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
            className={status.isSpinning ? "animate-spin" : undefined}
          />
          {status.label}
        </span>
        <ChevronDown
          size={15}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen ? (
        <div className="bg-muted/15 px-3 py-3">
          <ToolPayloadSection title="参数" value={input || "{}"} />
          {errorText ? (
            <ToolPayloadSection
              title="错误"
              value={errorText}
              tone="destructive"
            />
          ) : output ? (
            <ToolPayloadSection title="结果" value={output} />
          ) : item.status === "running" ? (
            <div className="mt-3 text-[11px] leading-5 text-muted-foreground">
              等待结果...
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

function getToolStatus(status: ToolChatItem["status"]): {
  label: string
  icon: LucideIcon
  className: string
  isSpinning: boolean
} {
  if (status === "failed") {
    return {
      label: "失败",
      icon: CircleAlert,
      className:
        "bg-destructive/10 text-destructive dark:bg-destructive/15",
      isSpinning: false,
    }
  }
  if (status === "running") {
    return {
      label: "运行中",
      icon: LoaderCircle,
      className: "bg-background/70 text-muted-foreground",
      isSpinning: true,
    }
  }
  return {
    label: "已完成",
    icon: CircleCheck,
    className: "bg-background/70 text-muted-foreground",
    isSpinning: false,
  }
}

function renderToolIcon(name: string) {
  const normalizedName = name.toLowerCase()
  if (normalizedName.includes("bash") || normalizedName.includes("shell")) {
    return <Terminal size={15} />
  }
  if (normalizedName.includes("read") || normalizedName.includes("file")) {
    return <File size={15} />
  }
  if (normalizedName.includes("grep") || normalizedName.includes("find")) {
    return <Search size={15} />
  }
  if (normalizedName.includes("search")) {
    return <Sparkles size={15} />
  }
  if (normalizedName.includes("database") || normalizedName.includes("sql")) {
    return <Database size={15} />
  }
  if (normalizedName.includes("code") || normalizedName.includes("edit")) {
    return <Code size={15} />
  }
  return <Clock size={15} />
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
