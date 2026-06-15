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
  SlidersHorizontal,
} from "@/components/icons/nucleo-icons"

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  getOusiaModelProviderApiKey,
  normalizeOusiaAppSettings,
  type OusiaAgentMode,
  type OusiaAgentToolName,
  type OusiaChatExportFormat,
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
const allAgentTools: OusiaAgentToolName[] = [
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
]

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
  contextUsage:
    | {
        tokens: number | null
        contextWindow: number
        percent: number | null
      }
    | undefined
  items: ChatItem[]
  isAgentWorking: boolean
  isSidebarCollapsed: boolean
  isWindowFullscreen: boolean
  isTerminalPanelCollapsed: boolean
  language: OusiaLanguage
  modelRegistry: OusiaModelRegistryResult | undefined
  onLocalEvent: (event: OusiaChatEvent) => void
  onGenerateSessionTitle: (sessionId: string, firstPrompt: string) => void
  onBranchFromMessage: (messageId: string) => void
  onExpandTerminalPanel: () => void
  onSettingsChange: (settings: AppSettings) => void
  queuedChatState: {
    steering: string[]
    followUp: string[]
  }
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
  contextUsage: contextUsageFromEvent,
  items,
  isAgentWorking,
  isSidebarCollapsed,
  isWindowFullscreen,
  isTerminalPanelCollapsed,
  language,
  modelRegistry,
  onLocalEvent,
  onGenerateSessionTitle,
  onBranchFromMessage,
  onExpandTerminalPanel,
  onSettingsChange,
  queuedChatState,
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
  const [isComposerSettingsOpen, setIsComposerSettingsOpen] = useState(false)
  const [isCustomToolsDialogOpen, setIsCustomToolsDialogOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<ChatCopyStatus>("idle")
  const [contextUsageState, setContextUsageState] = useState<{
    key: string
    usage?: {
      tokens: number | null
      contextWindow: number
      percent: number | null
    }
  }>()
  const [isChatScrolled, setIsChatScrolled] = useState(false)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputScrollTopBeforeResizeRef = useRef(0)
  const followLatestFrameRef = useRef(0)
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
  const currentContextUsageKey =
    currentProject && currentSession
      ? `${currentProject.path}::${currentSession.id}`
      : ""
  const contextUsage =
    contextUsageFromEvent ??
    (contextUsageState?.key === currentContextUsageKey
      ? contextUsageState.usage
      : undefined)
  const hasActualContextUsage = typeof contextUsage?.percent === "number"
  const contextRemainingPercent =
    hasActualContextUsage
      ? Math.max(0, Math.round(100 - contextUsage.percent))
      : 0
  const contextUsageStrokeDasharray = `${Math.max(
    0,
    Math.min(100, contextRemainingPercent)
  )} 100`
  const shouldShowContextUsageRing =
    settings.showContextUsage && items.length > 0 && hasActualContextUsage
  const piQueuedMessages: QueuedChatMessage[] = [
    ...queuedChatState.steering.map((text, index) => ({
      id: `pi-steering-${index}`,
      text,
      attachments: [],
    })),
    ...queuedChatState.followUp.map((text, index) => ({
      id: `pi-follow-up-${index}`,
      text,
      attachments: [],
    })),
  ].filter((message) => message.text.trim())
  const visibleQueuedMessages = queuedMessages.length
    ? queuedMessages
    : piQueuedMessages
  const isPiQueueVisible = !queuedMessages.length && piQueuedMessages.length > 0

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
    window.cancelAnimationFrame(followLatestFrameRef.current)
    followLatestFrameRef.current = window.requestAnimationFrame(() => {
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
    })
    return () => {
      window.cancelAnimationFrame(followLatestFrameRef.current)
    }
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
    if (
      !settings.showContextUsage ||
      !window.ousia ||
      !currentProject ||
      !currentSession ||
      items.length === 0
    ) {
      return
    }
    let isCancelled = false
    void window.ousia
      .getChatContextUsage({
        projectPath: currentProject.path,
        sessionId: currentSession.id,
      })
      .then((result) => {
        if (!isCancelled && result.ok) {
          setContextUsageState({
            key: `${currentProject.path}::${currentSession.id}`,
            usage: result.usage,
          })
        }
      })
    return () => {
      isCancelled = true
    }
  }, [
    currentProject,
    currentSession,
    isAgentWorking,
    items.length,
    settings.showContextUsage,
  ])

  function handleChatScroll(event: UIEvent<HTMLDivElement>) {
    const isAtLatest = isScrolledToLatest(event.currentTarget)
    setIsChatScrolled(event.currentTarget.scrollTop > 2)
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

  function updateComposerSettings(patch: Partial<AppSettings>) {
    onSettingsChange(
      normalizeOusiaAppSettings({
        ...settings,
        ...patch,
      })
    )
  }

  function toggleCustomAgentTool(tool: OusiaAgentToolName) {
    const current = new Set(settings.customAgentTools)
    if (current.has(tool)) {
      current.delete(tool)
    } else {
      current.add(tool)
    }
    updateComposerSettings({
      agentMode: "custom",
      customAgentTools: allAgentTools.filter((item) => current.has(item)),
    })
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
          customAgentTools: settings.customAgentTools,
          autoCompactContext: settings.autoCompactContext,
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

    if (editingQueueId) {
      queueDraftMessage(text, outgoingAttachments)
      return
    }

    if (isAgentWorking && sendDuringRunMode === "queue") {
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
        continueQueuedMessages: settings.continueQueuedMessagesAfterInterrupt,
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

  async function handleExportSession(format: OusiaChatExportFormat) {
    if (!window.ousia || !currentProject || !currentSession) {
      return
    }
    const markdown = formatSessionHistoryForClipboard({
      items,
      projectPath: currentProject.path,
      t,
      sessionTitle: currentSession.title,
    })
    const result = await window.ousia.exportChat({
      format,
      markdown: format === "jsonl" ? undefined : markdown,
      agentMode: settings.agentMode,
      customAgentTools: settings.customAgentTools,
      autoCompactContext: settings.autoCompactContext,
      projectPath: currentProject.path,
      sessionId: currentSession.id,
      thinkingLevel: selectedThinkingLevel,
      model: {
        provider: settings.modelProvider,
        modelId: settings.modelId,
        apiKey: getOusiaModelProviderApiKey(settings)?.trim() || undefined,
      },
    })
    if (!result.ok && !result.canceled) {
      onLocalEvent({
        type: "error",
        id: `export-chat-${Date.now()}`,
        text: result.error ?? t.chat.exportFailed,
        timestamp: new Date().toISOString(),
      })
    }
    if (result.ok) {
      setOpenSessionMenuKey(null)
      onLocalEvent({
        type: "run_status",
        status: "finished",
        text: t.chat.exportSucceeded(result.path),
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
        "@container/chat ousia-main-panel ousia-squircle-corners relative z-20 flex min-w-0 shrink-0 flex-col overflow-hidden rounded-l-[var(--ousia-chat-panel-radius)] rounded-r-none border-[0.5px] border-border/60 bg-white shadow-[var(--ousia-chat-composer-shadow)] dark:bg-card",
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
        isScrolled={isChatScrolled}
        isTerminalPanelCollapsed={isTerminalPanelCollapsed}
        isWindowFullscreen={isWindowFullscreen}
        onCopySessionHistory={() => void handleCopySessionHistory()}
        onExportSession={(format) => void handleExportSession(format)}
        onExpandTerminalPanel={onExpandTerminalPanel}
        onSessionMenuOpenChange={(open) => {
          setOpenSessionMenuKey(open ? currentSessionMenuKey : null)
          if (!open) {
            setCopyStatus("idle")
          }
        }}
        t={t}
      />

      <div
        ref={scrollRef}
        className={cn(
          "ousia-hover-scrollbar ousia-stable-scrollbar-gutter min-h-0 flex-1 select-text overflow-auto bg-white pt-14 pb-16 dark:bg-card",
          CHAT_HORIZONTAL_PADDING_CLASS
        )}
        onScroll={handleChatScroll}
      >
        <ChatMessageList
          items={items}
          onBranchFromMessage={onBranchFromMessage}
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
            className="pointer-events-auto absolute bottom-3 left-1/2 size-6 -translate-x-1/2 rounded-full border-[0.5px] border-foreground/10 bg-popover/90 text-popover-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.72),inset_0_0_0_1px_rgba(255,255,255,0.22),0_4px_14px_rgba(0,0,0,0.045),0_1px_5px_rgba(0,0,0,0.025)] backdrop-blur hover:bg-popover/95 dark:border-foreground/10 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_0_1px_rgba(255,255,255,0.04),0_4px_14px_rgba(0,0,0,0.22),0_1px_5px_rgba(0,0,0,0.12)]"
            aria-label={t.chat.scrollToLatest}
            onClick={() => scrollToLatest("smooth")}
          >
            <ArrowDown className="size-[18px]" strokeWidth={1.5} />
          </Button>
        </div>
      ) : null}

      <form
        className={cn(
          "shrink-0 bg-white pt-2 pb-4 dark:bg-card",
          CHAT_HORIZONTAL_PADDING_CLASS
        )}
        onSubmit={handleSubmit}
      >
        <div className={CHAT_CONTENT_MAX_WIDTH_CLASS}>
          <div className="relative">
            {visibleQueuedMessages.length ? (
              <QueuedMessageList
                editingId={isPiQueueVisible ? null : editingQueueId}
                draggingId={isPiQueueVisible ? null : draggingQueueId}
                messages={visibleQueuedMessages}
                onDelete={deleteQueuedMessage}
                onDragEnd={() => setDraggingQueueId(null)}
                onDragOver={moveQueuedMessage}
                onDragStart={setDraggingQueueId}
                onEdit={editQueuedMessage}
                onSendNow={sendQueuedMessageNow}
                readOnly={isPiQueueVisible}
                t={t}
              />
            ) : null}
            <div
              className={cn(
                "ousia-chat-composer-ring ousia-squircle-corners relative z-10 rounded-[var(--ousia-chat-composer-radius)] border-[0.5px] border-foreground/10 bg-[var(--ousia-sidebar)] px-4 pt-3 pb-3 shadow-[var(--ousia-chat-composer-shadow)] transition-[border-color,box-shadow] focus-within:border-ring/30 focus-within:shadow-[var(--ousia-chat-composer-shadow-focus)] focus-within:ring-0 dark:border-white/10 dark:focus-within:border-white/20",
                visibleQueuedMessages.length && "-mt-8"
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
              className="ousia-hover-scrollbar min-h-12 rounded-none border-0 bg-transparent p-0 text-sm leading-6 placeholder:text-muted-foreground/55 [field-sizing:fixed] focus-visible:ring-0"
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
                  open={isComposerSettingsOpen}
                  onOpenChange={setIsComposerSettingsOpen}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-6"
                      aria-label={t.chat.composerSettings}
                    >
                      <SlidersHorizontal size={18} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    sideOffset={8}
                    align="start"
                    className="ousia-hover-scrollbar w-72 rounded-xl p-2"
                  >
                    <DropdownMenuLabel className="px-2 pt-1 pb-1 text-sm text-neutral-500">
                      {t.settings.agentMode}
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={settings.agentMode}>
                      <TooltipProvider>
                        {(
                          [
                            [
                              "standard",
                              t.settings.standardMode,
                              t.settings.standardModeDescription,
                            ],
                            [
                              "readOnly",
                              t.settings.readOnlyMode,
                              t.settings.readOnlyModeDescription,
                            ],
                            [
                              "noTerminal",
                              t.settings.noTerminalMode,
                              t.settings.noTerminalModeDescription,
                            ],
                            [
                              "custom",
                              t.chat.customMode,
                              t.settings.customModeDescription,
                            ],
                          ] satisfies Array<[OusiaAgentMode, string, string]>
                        ).map(([value, label, description]) => (
                          <Tooltip key={value}>
                            <TooltipTrigger asChild>
                              <DropdownMenuRadioItem
                                value={value}
                                className="h-9 rounded-md px-2 hover:bg-neutral-100 focus:bg-neutral-100"
                                onClick={() => {
                                  updateComposerSettings({ agentMode: value })
                                  if (value === "custom") {
                                    setIsCustomToolsDialogOpen(true)
                                  }
                                }}
                              >
                                {label}
                              </DropdownMenuRadioItem>
                            </TooltipTrigger>
                            <TooltipContent
                              side="right"
                              align="center"
                              className="max-w-56"
                            >
                              {description}
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </TooltipProvider>
                    </DropdownMenuRadioGroup>
                    <div className="h-2" />
                    <DropdownMenuLabel className="px-2 pt-1 pb-1 text-sm text-neutral-500">
                      {t.chat.appendMessages}
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={settings.sendDuringRunMode}>
                      <DropdownMenuRadioItem
                        value="queue"
                        className="h-9 rounded-md px-2 hover:bg-neutral-100 focus:bg-neutral-100"
                        onClick={() =>
                          updateComposerSettings({ sendDuringRunMode: "queue" })
                        }
                      >
                        {t.settings.queue}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem
                        value="steer"
                        className="h-9 rounded-md px-2 hover:bg-neutral-100 focus:bg-neutral-100"
                        onClick={() =>
                          updateComposerSettings({ sendDuringRunMode: "steer" })
                        }
                      >
                        {t.settings.steer}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                    <div className="h-2" />
                    <DropdownMenuLabel className="px-2 pt-1 pb-1 text-sm text-neutral-500">
                      {t.chat.interruptBehavior}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      className="flex h-10 justify-between rounded-md px-2 hover:bg-neutral-100 focus:bg-neutral-100"
                      onSelect={(event) => {
                        event.preventDefault()
                        updateComposerSettings({
                          continueQueuedMessagesAfterInterrupt:
                            !settings.continueQueuedMessagesAfterInterrupt,
                        })
                      }}
                    >
                      <span className="min-w-0 truncate">
                        {t.chat.continueQueuedAfterInterrupt}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "relative ml-3 h-5 w-9 shrink-0 rounded-full transition-colors",
                          settings.continueQueuedMessagesAfterInterrupt
                            ? "bg-neutral-950"
                            : "bg-neutral-200"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-[left]",
                            settings.continueQueuedMessagesAfterInterrupt
                              ? "left-[18px]"
                              : "left-0.5"
                          )}
                        />
                      </span>
                    </DropdownMenuItem>
                    <div className="h-2" />
                    <DropdownMenuLabel className="px-2 pt-1 pb-1 text-sm text-neutral-500">
                      {t.chat.context}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      className="flex h-10 justify-between rounded-md px-2 hover:bg-neutral-100 focus:bg-neutral-100"
                      onSelect={(event) => {
                        event.preventDefault()
                        updateComposerSettings({
                          showContextUsage: !settings.showContextUsage,
                        })
                      }}
                    >
                      <span className="min-w-0 truncate">
                        {t.chat.showContextUsage}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "relative ml-3 h-5 w-9 shrink-0 rounded-full transition-colors",
                          settings.showContextUsage
                            ? "bg-neutral-950"
                            : "bg-neutral-200"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-[left]",
                            settings.showContextUsage ? "left-[18px]" : "left-0.5"
                          )}
                        />
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu
                  modal={false}
                  open={isModelMenuOpen}
                  onOpenChange={setIsModelMenuOpen}
                >
                  <DropdownMenuTrigger
                    aria-label={t.chat.modelAndThinking}
                    className="flex h-7 max-w-64 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
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
                    className="w-72 rounded-xl p-2"
                  >
                    <DropdownMenuLabel className="px-2 pt-1 pb-1 text-sm text-neutral-500">
                      Reasoning
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={selectedThinkingLevel}>
                      {activeThinkingLevels.map((level) => (
                        <DropdownMenuRadioItem
                          key={level}
                          value={level}
                          className="h-10 rounded-md px-2 hover:bg-neutral-100 focus:bg-neutral-100"
                          onClick={() => updateThinkingLevel(level)}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {chatThinkingLabels[level]}
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator className="my-2 bg-neutral-200" />
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
                            className="h-10 rounded-md px-2 hover:bg-neutral-100 focus:bg-neutral-100"
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
              <div className="flex shrink-0 items-center gap-2">
                {shouldShowContextUsageRing ? (
                  <span
                    className="flex size-6 items-center justify-center text-muted-foreground"
                    aria-label={t.chat.contextRemaining(
                      contextRemainingPercent
                    )}
                    title={t.chat.contextRemaining(contextRemainingPercent)}
                  >
                    <svg
                      aria-hidden="true"
                      className="size-[18px] -rotate-90"
                      viewBox="0 0 18 18"
                    >
                      <circle
                        cx="9"
                        cy="9"
                        r="6"
                        fill="none"
                        stroke="currentColor"
                        strokeOpacity="0.22"
                        strokeWidth="3"
                      />
                      <circle
                        cx="9"
                        cy="9"
                        r="6"
                        fill="none"
                        pathLength="100"
                        stroke="currentColor"
                        strokeDasharray={contextUsageStrokeDasharray}
                        strokeLinecap="round"
                        strokeWidth="3"
                      />
                    </svg>
                  </span>
                ) : null}
                <Button
                  type="submit"
                  size="icon-sm"
                  className="size-6 rounded-full border-[0.5px] border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_4px_12px_rgba(0,0,0,0.09),0_1px_4px_rgba(0,0,0,0.06)] hover:bg-primary/90 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_12px_rgba(0,0,0,0.28),0_1px_4px_rgba(0,0,0,0.18)]"
                  disabled={isSending || !hasDraftContent}
                  aria-label={t.app.send}
                >
                  <ArrowUp size={18} />
                </Button>
              </div>
            </div>
          </div>
          </div>
        </div>
      </form>
      <Dialog
        open={isCustomToolsDialogOpen}
        onOpenChange={setIsCustomToolsDialogOpen}
      >
        <DialogContent className="max-w-sm rounded-3xl bg-white text-neutral-950 dark:bg-white dark:text-neutral-950">
          <DialogHeader>
            <DialogTitle className="text-xl">{t.chat.customTools}</DialogTitle>
            <DialogDescription className="text-neutral-500">
              {t.chat.customToolsDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid gap-1">
            {allAgentTools.map((tool) => {
              const isEnabled = settings.customAgentTools.includes(tool)
              return (
                <button
                  key={tool}
                  type="button"
                  className="flex h-11 items-center justify-between rounded-xl px-3 text-left text-sm hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none"
                  onClick={() => toggleCustomAgentTool(tool)}
                >
                  <span>{t.chat.agentToolNames[tool]}</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "relative ml-3 h-5 w-9 shrink-0 rounded-full transition-colors",
                      isEnabled ? "bg-neutral-950" : "bg-neutral-200"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-[left]",
                        isEnabled ? "left-[18px]" : "left-0.5"
                      )}
                    />
                  </span>
                </button>
              )
            })}
          </div>
          <DialogFooter className="mt-5">
            <Button
              type="button"
              size="sm"
              className="rounded-xl px-5"
              onClick={() => setIsCustomToolsDialogOpen(false)}
            >
              {t.app.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
