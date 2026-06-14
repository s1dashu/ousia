import {
  useCallback,
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
  ChevronDown,
  Plus,
} from "lucide-react"

import type {
  AppSettings,
  ProjectRecord,
  SessionRecord,
} from "@/app/app-state"
import { isDefaultSessionTitle } from "@/app/i18n"
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
  type OusiaLanguage,
  type OusiaChatAttachment,
  type OusiaChatEvent,
  type OusiaModelRegistryResult,
  type OusiaThinkingLevel,
} from "@/electron/chat-types"
import { getMessages } from "@/app/i18n"
import {
  AttachmentStrip,
  QueuedMessageList,
  type QueuedChatMessage,
} from "@/features/chat/ChatComposerParts"
import { ChatHeader, type ChatCopyStatus } from "@/features/chat/ChatHeader"
import { ChatMessageList } from "@/features/chat/ChatMessageList"
import {
  chatAttachmentFromFile,
  filesFromDataTransfer,
  normalizePastedMessageText,
} from "@/features/chat/chat-attachments"
import {
  formatSessionHistoryForClipboard,
  writeTextToClipboard,
} from "@/features/chat/chat-history-clipboard"
import {
  shouldShowTurnWaitIndicator,
  useDelayedTurnWaitIndicator,
} from "@/features/chat/chat-turn-wait"
import { CHAT_HORIZONTAL_PADDING_CLASS, CHAT_CONTENT_MAX_WIDTH_CLASS } from "@/features/chat/chat-layout"
import type { ChatItem } from "@/features/chat/chat-events"
import { cn } from "@/lib/utils"

const CHAT_INPUT_MAX_HEIGHT = 192
const CHAT_INPUT_MIN_HEIGHT = 48
const DEFAULT_CHAT_THINKING_LEVEL: OusiaThinkingLevel = "medium"
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
  items: ChatItem[]
  isAgentWorking: boolean
  isSidebarCollapsed: boolean
  isWindowFullscreen: boolean
  isTerminalPanelCollapsed: boolean
  language: OusiaLanguage
  modelRegistry: OusiaModelRegistryResult | undefined
  onLocalEvent: (event: OusiaChatEvent) => void
  onGenerateSessionTitle: (sessionId: string, firstPrompt: string) => void
  onExpandTerminalPanel: () => void
  onSettingsChange: (settings: AppSettings) => void
  onToggleSidebar: () => void
  settings: AppSettings
  style: CSSProperties
}

function defaultThinkingLevelFor(levels: OusiaThinkingLevel[]) {
  return levels.includes(DEFAULT_CHAT_THINKING_LEVEL)
    ? DEFAULT_CHAT_THINKING_LEVEL
    : (levels[0] ?? DEFAULT_CHAT_THINKING_LEVEL)
}

export function ChatArea({
  currentProject,
  currentSession,
  items,
  isAgentWorking,
  isSidebarCollapsed,
  isWindowFullscreen,
  isTerminalPanelCollapsed,
  language,
  modelRegistry,
  onLocalEvent,
  onGenerateSessionTitle,
  onExpandTerminalPanel,
  onSettingsChange,
  onToggleSidebar,
  settings,
  style,
}: ChatAreaProps) {
  const t = getMessages(language)
  const [draft, setDraft] = useState("")
  const [attachments, setAttachments] = useState<OusiaChatAttachment[]>([])
  const [queuedMessages, setQueuedMessages] = useState<QueuedChatMessage[]>([])
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [draggingQueueId, setDraggingQueueId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isInterrupting, setIsInterrupting] = useState(false)
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(
    null
  )
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<ChatCopyStatus>("idle")
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputScrollTopBeforeResizeRef = useRef(0)
  const isComposingRef = useRef(false)
  const isProgrammaticScrollRef = useRef(false)
  const wasAgentWorkingRef = useRef(isAgentWorking)
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
  const sendDuringRunMode = settings.sendDuringRunMode

  function isScrolledToLatest(node: HTMLDivElement) {
    return node.scrollHeight - node.scrollTop - node.clientHeight < 24
  }

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
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
  }, [])

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

  const sendMessage = useCallback(
    async ({
      text,
      attachments: outgoingAttachments,
      sendBehavior = "normal",
    }: {
      text: string
      attachments: OusiaChatAttachment[]
      sendBehavior?: "normal" | "steer" | "followUp"
    }) => {
      if ((!text && outgoingAttachments.length === 0) || isSending) {
        return
      }
      if (!window.ousia || !currentProject || !currentSession) {
        onLocalEvent({
          type: "error",
          id: `no-electron-${Date.now()}`,
          text: window.ousia
            ? t.chat.noSelection
            : t.chat.noElectron,
          timestamp: new Date().toISOString(),
        })
        return
      }
      if (
        outgoingAttachments.some((attachment) => attachment.kind === "image") &&
        selectedModelPreset &&
        !selectedModelPreset.input.includes("image")
      ) {
        onLocalEvent({
          type: "error",
          id: `image-model-${Date.now()}`,
          text: t.chat.imageUnsupported,
          timestamp: new Date().toISOString(),
        })
        return
      }
      scrollToLatest("auto")
      setIsSending(true)
      const shouldGenerateTitle =
        isDefaultSessionTitle(currentSession.title) && items.length === 0
      onLocalEvent({
        type: "run_status",
        status: "starting",
        timestamp: new Date().toISOString(),
      })
      try {
        const result = await window.ousia.sendChatMessage({
          prompt: text,
          attachments: outgoingAttachments,
          sendBehavior,
          agentMode: settings.agentMode,
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
            text ||
            outgoingAttachments.map((attachment) => attachment.name).join(" ")
          if (titlePrompt) {
            onGenerateSessionTitle(currentSession.id, titlePrompt)
          }
        }
      } finally {
        setIsSending(false)
      }
    },
    [
      currentProject,
      currentSession,
      isSending,
      items.length,
      onGenerateSessionTitle,
      onLocalEvent,
      scrollToLatest,
      selectedModelPreset,
      selectedThinkingLevel,
      settings,
      t.chat.imageUnsupported,
      t.chat.noElectron,
      t.chat.noSelection,
    ]
  )

  function queueDraftMessage(text: string, outgoingAttachments: OusiaChatAttachment[]) {
    if (editingQueueId) {
      setQueuedMessages((current) =>
        current.map((message) =>
          message.id === editingQueueId
            ? { ...message, text, attachments: outgoingAttachments }
            : message
        )
      )
      setEditingQueueId(null)
      return
    }
    setQueuedMessages((current) => [
      ...current,
      {
        id: `queued-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text,
        attachments: outgoingAttachments,
      },
    ])
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if ((!text && attachments.length === 0) || isSending) {
      return
    }
    const outgoingAttachments = attachments
    setDraft("")
    setAttachments([])

    if (editingQueueId || (isAgentWorking && sendDuringRunMode === "queue")) {
      queueDraftMessage(text, outgoingAttachments)
      return
    }

    await sendMessage({
      text,
      attachments: outgoingAttachments,
      sendBehavior: isAgentWorking ? "steer" : "normal",
    })
  }

  function sendQueuedMessageNow(id: string) {
    const message = queuedMessages.find((item) => item.id === id)
    if (!message) {
      return
    }
    setQueuedMessages((current) => current.filter((item) => item.id !== id))
    if (editingQueueId === id) {
      setEditingQueueId(null)
      setDraft("")
      setAttachments([])
    }
    void sendMessage({
      text: message.text,
      attachments: message.attachments,
      sendBehavior: isAgentWorking ? "steer" : "normal",
    })
  }

  function editQueuedMessage(id: string) {
    const message = queuedMessages.find((item) => item.id === id)
    if (!message) {
      return
    }
    setEditingQueueId(id)
    setDraft(message.text)
    setAttachments(message.attachments)
    window.requestAnimationFrame(() => {
      const node = inputRef.current
      if (!node) {
        return
      }
      node.focus({ preventScroll: true })
      const cursor = node.value.length
      node.setSelectionRange(cursor, cursor)
    })
  }

  function deleteQueuedMessage(id: string) {
    setQueuedMessages((current) => current.filter((item) => item.id !== id))
    if (editingQueueId === id) {
      setEditingQueueId(null)
      setDraft("")
      setAttachments([])
    }
  }

  function moveQueuedMessage(activeId: string, overId: string) {
    if (activeId === overId) {
      return
    }
    setQueuedMessages((current) => {
      const from = current.findIndex((item) => item.id === activeId)
      const to = current.findIndex((item) => item.id === overId)
      if (from < 0 || to < 0) {
        return current
      }
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  useEffect(() => {
    if (isAgentWorking) {
      wasAgentWorkingRef.current = true
      return
    }
    if (!wasAgentWorkingRef.current) {
      return
    }
    wasAgentWorkingRef.current = false
    if (editingQueueId || isSending || !queuedMessages.length) {
      return
    }
    const timer = window.setTimeout(() => {
      const [nextMessage] = queuedMessages
      setQueuedMessages((current) => current.slice(1))
      if (editingQueueId === nextMessage.id) {
        setEditingQueueId(null)
      }
      void sendMessage({
        text: nextMessage.text,
        attachments: nextMessage.attachments,
        sendBehavior: "normal",
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editingQueueId, isAgentWorking, isSending, queuedMessages, sendMessage])

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
      t,
      sessionTitle: currentSession?.title ?? t.app.newSession,
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
        text: t.chat.copyHistoryFailed,
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
        text: t.chat.totalAttachmentsTooLarge,
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
          text: t.chat.fileTooLarge(file.name),
          timestamp: new Date().toISOString(),
        })
        continue
      }
      try {
        next.push(await chatAttachmentFromFile(file, t))
      } catch {
        onLocalEvent({
          type: "error",
          id: `attachment-read-failed-${Date.now()}-${file.name}`,
          text: t.chat.fileReadFailed(file.name),
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
      className={cn(
        "@container/chat ousia-squircle-corners flex min-w-0 shrink-0 flex-col overflow-hidden rounded-l-[var(--ousia-chat-panel-radius)] rounded-r-none border border-border/60 bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.035)] dark:bg-card dark:shadow-[-8px_0_24px_rgba(0,0,0,0.18)]",
        isTerminalPanelCollapsed ? "" : "border-r-0"
      )}
      style={style}
      onKeyDownCapture={handleEscapeKey}
    >
      <ChatHeader
        copyStatus={copyStatus}
        currentSession={currentSession}
        isSessionMenuOpen={isSessionMenuOpen}
        isSidebarCollapsed={isSidebarCollapsed}
        isTerminalPanelCollapsed={isTerminalPanelCollapsed}
        isWindowFullscreen={isWindowFullscreen}
        onCopySessionHistory={() => void handleCopySessionHistory()}
        onExpandTerminalPanel={onExpandTerminalPanel}
        onSessionMenuOpenChange={(open) => {
          setOpenSessionMenuKey(open ? currentSessionMenuKey : null)
          if (!open) {
            setCopyStatus("idle")
          }
        }}
        onToggleSidebar={onToggleSidebar}
        t={t}
      />

      <div
        ref={scrollRef}
        className={cn(
          "ousia-hover-scrollbar ousia-stable-scrollbar-gutter min-h-0 flex-1 select-text overflow-auto pt-4 pb-16",
          CHAT_HORIZONTAL_PADDING_CLASS
        )}
        onScroll={handleChatScroll}
      >
        <ChatMessageList
          items={items}
          showTurnWaitIndicator={showTurnWaitIndicator}
          t={t}
        />
      </div>

      {showScrollToLatest ? (
        <div className="pointer-events-none relative z-20 h-0 shrink-0">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="pointer-events-auto absolute bottom-3 left-1/2 size-6 -translate-x-1/2 rounded-full border bg-popover/90 text-popover-foreground backdrop-blur dark:shadow-md"
            aria-label={t.chat.scrollToLatest}
            onClick={() => scrollToLatest("smooth")}
          >
            <ArrowDown className="size-[18px]" strokeWidth={1.5} />
          </Button>
        </div>
      ) : null}

      <form
        className={cn("shrink-0 pt-2 pb-6", CHAT_HORIZONTAL_PADDING_CLASS)}
        onSubmit={handleSubmit}
      >
        <div className={CHAT_CONTENT_MAX_WIDTH_CLASS}>
          {queuedMessages.length ? (
            <QueuedMessageList
              editingId={editingQueueId}
              draggingId={draggingQueueId}
              messages={queuedMessages}
              onDelete={deleteQueuedMessage}
              onDragEnd={() => setDraggingQueueId(null)}
              onDragOver={moveQueuedMessage}
              onDragStart={setDraggingQueueId}
              onEdit={editQueuedMessage}
              onSendNow={sendQueuedMessageNow}
              t={t}
            />
          ) : null}
          <div
            className={cn(
              "ousia-squircle-corners border-[0.5px] border-foreground/10 bg-popover px-4 pt-3 pb-3 shadow-[0_6px_22px_rgba(0,0,0,0.04),0_1px_8px_rgba(0,0,0,0.022),inset_0_1px_0_rgba(255,255,255,0.42)] transition-shadow focus-within:border-foreground/10 focus-within:shadow-[0_8px_26px_rgba(0,0,0,0.06),0_2px_10px_rgba(0,0,0,0.032),inset_0_1px_0_rgba(255,255,255,0.46)] focus-within:ring-0 dark:border-foreground/10 dark:shadow-[0_6px_22px_rgba(0,0,0,0.22),0_1px_8px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.035)] dark:focus-within:shadow-[0_8px_26px_rgba(0,0,0,0.28),0_2px_10px_rgba(0,0,0,0.16),inset_0_1px_0_rgba(255,255,255,0.045)]",
              queuedMessages.length
                ? "rounded-t-xl rounded-b-[var(--ousia-chat-composer-radius)]"
                : "rounded-[var(--ousia-chat-composer-radius)]"
            )}
          >
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
                t={t}
              />
            ) : null}
            <Textarea
              ref={inputRef}
              aria-label={t.chat.message}
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
              placeholder={
                editingQueueId
                  ? t.chat.editQueuedMessage
                  : isAgentWorking
                    ? t.chat.continueMessage
                    : t.chat.inputPlaceholder
              }
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  aria-label={t.chat.addAttachment}
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
                    aria-label={t.chat.modelAndThinking}
                    className="flex h-7 max-w-64 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
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
                      size={18}
                      strokeWidth={1.5}
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
                className="size-6"
                disabled={isSending || !hasDraftContent}
                aria-label={t.app.send}
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
