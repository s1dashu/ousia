import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type UIEvent,
  type WheelEvent,
} from "react"
import {
  ChevronDown,
  LoaderCircle,
  Plus,
  SendArrowDown,
  SendArrowUp,
  SlidersHorizontal,
  X,
} from "@/components/icons/huge-icons"

import type {
  AppSettings,
  ProjectRecord,
  SessionRecord,
} from "@/app/app-state"
import { isDefaultSessionTitle } from "@/app/i18n"
import {
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  normalizeOusiaAppSettings,
  type OusiaAgentMode,
  type OusiaAgentToolName,
  type OusiaChatExportFormat,
  type OusiaLanguage,
  type OusiaChatAttachment,
  type OusiaChatEvent,
  type OusiaModelRegistryResult,
  type OusiaSendDuringRunMode,
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
  hasMoreHistory: boolean
  isAgentWorking: boolean
  isLoadingHistory: boolean
  isLoadingOlderHistory: boolean
  isSidebarCollapsed: boolean
  isWindowFullscreen: boolean
  language: OusiaLanguage
  modelRegistry: OusiaModelRegistryResult | undefined
  onLocalEvent: (event: OusiaChatEvent) => void
  onGenerateSessionTitle: (sessionId: string, firstPrompt: string) => void
  onBranchFromMessage: (messageId: string) => void
  onLoadOlderHistory: () => Promise<void> | void
  onRefreshModelRegistry: () => Promise<OusiaModelRegistryResult | undefined>
  onSessionCompletionVisibility: (
    sessionId: string,
    isFullyVisible: boolean
  ) => void
  onSessionViewed: (sessionId: string) => void
  onSettingsChange: (settings: AppSettings) => void
  queuedChatState: {
    steering: string[]
    followUp: string[]
  }
  settings: AppSettings
  style: CSSProperties
}

type ContextUsage = NonNullable<ChatAreaProps["contextUsage"]>

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value))
}

function getContextUsagePercent(usage: ContextUsage | undefined) {
  if (
    usage &&
    typeof usage.percent === "number" &&
    Number.isFinite(usage.percent) &&
    usage.percent >= 0
  ) {
    return clampPercentage(usage.percent)
  }

  if (
    usage &&
    typeof usage.tokens === "number" &&
    Number.isFinite(usage.tokens) &&
    usage.tokens > 0 &&
    Number.isFinite(usage.contextWindow) &&
    usage.contextWindow > 0
  ) {
    return clampPercentage((usage.tokens / usage.contextWindow) * 100)
  }

  return undefined
}

function formatContextUsagePercent(percent: number) {
  return percent < 10 ? percent.toFixed(1) : Math.round(percent).toString()
}

function defaultThinkingLevelFor(levels: OusiaThinkingLevel[]) {
  return levels.includes(DEFAULT_CHAT_THINKING_LEVEL)
    ? DEFAULT_CHAT_THINKING_LEVEL
    : (levels[0] ?? DEFAULT_CHAT_THINKING_LEVEL)
}

function isProviderApiKeyRequiredStatusItem(item: ChatItem) {
  return (
    item.id.startsWith("provider-api-key-") &&
    (item.role === "system" || item.role === "error")
  )
}

export function ChatArea({
  currentProject,
  currentSession,
  contextUsage: contextUsageFromEvent,
  items,
  hasMoreHistory,
  isAgentWorking,
  isLoadingHistory,
  isLoadingOlderHistory,
  isSidebarCollapsed,
  isWindowFullscreen,
  language,
  modelRegistry,
  onLocalEvent,
  onGenerateSessionTitle,
  onBranchFromMessage,
  onLoadOlderHistory,
  onRefreshModelRegistry,
  onSessionCompletionVisibility,
  onSessionViewed,
  onSettingsChange,
  queuedChatState,
  settings,
  style,
}: ChatAreaProps) {
  const t = getMessages(language)
  const [draft, setDraft] = useState("")
  const [attachments, setAttachments] = useState<OusiaChatAttachment[]>([])
  const [queuedMessages, setQueuedMessages] = useState<QueuedChatMessage[]>([])
  const [isQueuePausedAfterInterrupt, setIsQueuePausedAfterInterrupt] =
    useState(false)
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [draggingQueueId, setDraggingQueueId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isInterrupting, setIsInterrupting] = useState(false)
  const [isCompacting, setIsCompacting] = useState(false)
  const [isOpeningProjectDirectory, setIsOpeningProjectDirectory] =
    useState(false)
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(
    null
  )
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isComposerSettingsOpen, setIsComposerSettingsOpen] = useState(false)
  const [isCustomToolsDialogOpen, setIsCustomToolsDialogOpen] = useState(false)
  const [isProviderKeyDialogOpen, setIsProviderKeyDialogOpen] =
    useState(false)
  const [providerKeyDialogProviderId, setProviderKeyDialogProviderId] =
    useState("")
  const [providerKeyDialogApiKey, setProviderKeyDialogApiKey] = useState("")
  const [providerKeyDialogError, setProviderKeyDialogError] = useState("")
  const [isSavingProviderKey, setIsSavingProviderKey] = useState(false)
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
  const chatContentRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputScrollTopBeforeResizeRef = useRef(0)
  const followLatestFrameRef = useRef(0)
  const manualScrollIntentTimerRef = useRef(0)
  const manualScrollAwayFromLatestRef = useRef(false)
  const manualScrollIntentRef = useRef(false)
  const lastChatScrollTopRef = useRef(0)
  const programmaticScrollResetFrameRef = useRef(0)
  const programmaticScrollResetTimerRef = useRef(0)
  const chatLayoutAnchorResetTimerRef = useRef(0)
  const completionVisibilityFrameRef = useRef(0)
  const pendingCompletionVisibilitySessionIdRef = useRef<string | null>(null)
  const latestFinishedAssistantIdBeforeRunRef = useRef<string | null>(null)
  const wasAgentWorkingForVisibilityRef = useRef(false)
  const olderHistoryScrollAnchorRef = useRef<{
    height: number
    top: number
  } | null>(null)
  const chatLayoutAnchorRef = useRef<{
    element: HTMLElement
    top: number
  } | null>(null)
  const isFollowingLatestRef = useRef(isFollowingLatest)
  const isComposingRef = useRef(false)
  const isProgrammaticScrollRef = useRef(false)
  const sendDuringRunModeRef = useRef(settings.sendDuringRunMode)
  const wasAgentWorkingRef = useRef(isAgentWorking)
  const currentSessionMenuKey = currentSession?.id ?? "no-session"
  const isSessionMenuOpen = openSessionMenuKey === currentSessionMenuKey
  const configuredModelPresets = getConfiguredModelPresets(
    settings.modelProviders,
    modelRegistry
  )
  const selectedModelPreset = configuredModelPresets.find(
    (model) =>
      model.provider === settings.modelProvider &&
      model.modelId === settings.modelId
  )
  const activeThinkingLevels =
    selectedModelPreset?.thinkingLevels ?? [settings.thinkingLevel]
  const selectedThinkingLevel = activeThinkingLevels.includes(
    settings.thinkingLevel
  )
    ? settings.thinkingLevel
    : defaultThinkingLevelFor(activeThinkingLevels)
  const selectedModelLabel =
    selectedModelPreset ? modelLabel(selectedModelPreset) : t.chat.model
  const providerKeyDialogProviders =
    modelRegistry?.providers.filter((provider) => provider.models.length > 0) ??
    []
  const providerKeyDialogSelectItems = providerKeyDialogProviders.map(
    (provider) => ({
      label: provider.name,
      value: provider.id,
    })
  )
  const providerKeyDialogProvider = providerKeyDialogProviders.find(
    (provider) => provider.id === providerKeyDialogProviderId
  )
  const canSaveProviderKey =
    Boolean(providerKeyDialogProvider) &&
    Boolean(providerKeyDialogApiKey.trim()) &&
    !isSavingProviderKey
  const hasSelectedProviderApiKey = !modelRegistry || Boolean(selectedModelPreset)
  const visibleChatItems = useMemo(() => {
    if (!hasSelectedProviderApiKey) {
      return items
    }

    return items.filter((item) => !isProviderApiKeyRequiredStatusItem(item))
  }, [hasSelectedProviderApiKey, items])
  const showTurnWaitIndicator = useDelayedTurnWaitIndicator(
    shouldShowTurnWaitIndicator(items, isAgentWorking)
  )
  const hasDraftContent = Boolean(draft.trim() || attachments.length)
  const sendDuringRunMode = settings.sendDuringRunMode
  sendDuringRunModeRef.current = sendDuringRunMode
  const currentContextUsageKey =
    currentProject && currentSession
      ? `${currentProject.path}::${currentSession.id}`
      : ""
  const localContextUsage =
    contextUsageState?.key === currentContextUsageKey
      ? contextUsageState.usage
      : undefined
  const contextUsage = localContextUsage ?? contextUsageFromEvent
  const contextUsagePercent = getContextUsagePercent(contextUsage)
  const hasActualContextUsage = typeof contextUsagePercent === "number"
  const hasContextUsageWindow =
    Boolean(contextUsage) &&
    Number.isFinite(contextUsage?.contextWindow) &&
    (contextUsage?.contextWindow ?? 0) > 0
  const contextRemainingPercent = hasActualContextUsage
    ? Math.max(0, Math.floor(100 - contextUsagePercent))
    : undefined
  const contextUsagePercentLabel = hasActualContextUsage
    ? formatContextUsagePercent(contextUsagePercent)
    : "?"
  const contextRemainingLabel =
    typeof contextRemainingPercent === "number" ? contextRemainingPercent : "?"
  const contextUsageStrokeDasharray = `${contextUsagePercent ?? 0} 100`
  const isQueueAutoSendPaused =
    isQueuePausedAfterInterrupt &&
    !settings.continueQueuedMessagesAfterInterrupt
  const shouldShowContextUsageRing =
    settings.showContextUsage &&
    items.length > 0 &&
    (hasActualContextUsage || hasContextUsageWindow)
  const piQueuedMessages: QueuedChatMessage[] = [
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

  const markCurrentSessionViewed = useCallback(() => {
    if (currentSession) {
      onSessionViewed(currentSession.id)
    }
  }, [currentSession, onSessionViewed])

  function isScrolledToLatest(node: HTMLDivElement) {
    return node.scrollHeight - node.scrollTop - node.clientHeight < 24
  }

  function maxChatScrollTop(node: HTMLDivElement) {
    return Math.max(0, node.scrollHeight - node.clientHeight)
  }

  function isLatestAssistantMessageFullyVisible() {
    const node = scrollRef.current
    if (!node) {
      return true
    }
    const assistantMessages = node.querySelectorAll<HTMLElement>(
      '[data-chat-message-role="assistant"]'
    )
    const latestAssistantMessage = assistantMessages.item(
      assistantMessages.length - 1
    )
    if (!latestAssistantMessage) {
      return true
    }
    const viewportRect = node.getBoundingClientRect()
    const messageRect = latestAssistantMessage.getBoundingClientRect()
    const visibilityTolerance = 1
    return (
      messageRect.top >= viewportRect.top - visibilityTolerance &&
      messageRect.bottom <= viewportRect.bottom + visibilityTolerance
    )
  }

  const latestAssistantItem = useCallback(() => {
    return [...items].reverse().find((item) => item.role === "assistant")
  }, [items])

  const latestFinishedAssistantId = useCallback(() => {
    return (
      [...items]
        .reverse()
        .find((item) => item.role === "assistant" && item.status === "finished")
        ?.id ?? null
    )
  }, [items])

  const clearProgrammaticScrollReset = useCallback(() => {
    if (programmaticScrollResetFrameRef.current) {
      window.cancelAnimationFrame(programmaticScrollResetFrameRef.current)
      programmaticScrollResetFrameRef.current = 0
    }
    if (programmaticScrollResetTimerRef.current) {
      window.clearTimeout(programmaticScrollResetTimerRef.current)
      programmaticScrollResetTimerRef.current = 0
    }
  }, [])

  const clearManualScrollIntent = useCallback(() => {
    manualScrollIntentRef.current = false
    manualScrollAwayFromLatestRef.current = false
    if (manualScrollIntentTimerRef.current) {
      window.clearTimeout(manualScrollIntentTimerRef.current)
      manualScrollIntentTimerRef.current = 0
    }
  }, [])

  const clearChatLayoutAnchor = useCallback(() => {
    chatLayoutAnchorRef.current = null
    if (chatLayoutAnchorResetTimerRef.current) {
      window.clearTimeout(chatLayoutAnchorResetTimerRef.current)
      chatLayoutAnchorResetTimerRef.current = 0
    }
  }, [])

  const preserveChatLayoutAnchor = useCallback(
    (element: HTMLElement) => {
      const node = scrollRef.current
      if (!node || !node.contains(element)) {
        return
      }

      clearProgrammaticScrollReset()
      clearManualScrollIntent()
      isProgrammaticScrollRef.current = false
      isFollowingLatestRef.current = false
      setIsFollowingLatest(false)
      chatLayoutAnchorRef.current = {
        element,
        top: element.getBoundingClientRect().top,
      }

      if (chatLayoutAnchorResetTimerRef.current) {
        window.clearTimeout(chatLayoutAnchorResetTimerRef.current)
      }
      chatLayoutAnchorResetTimerRef.current = window.setTimeout(() => {
        clearChatLayoutAnchor()
        const currentNode = scrollRef.current
        if (currentNode) {
          setShowScrollToLatest(!isScrolledToLatest(currentNode))
        }
      }, 2400)
    },
    [
      clearChatLayoutAnchor,
      clearManualScrollIntent,
      clearProgrammaticScrollReset,
    ]
  )

  const applyChatLayoutAnchor = useCallback(() => {
    const anchor = chatLayoutAnchorRef.current
    const node = scrollRef.current
    if (!anchor || !node) {
      return false
    }
    if (!node.contains(anchor.element)) {
      clearChatLayoutAnchor()
      return false
    }

    const nextTop = anchor.element.getBoundingClientRect().top
    const delta = nextTop - anchor.top
    if (Math.abs(delta) > 0.5) {
      node.scrollTop += delta
      lastChatScrollTopRef.current = node.scrollTop
    }
    setShowScrollToLatest(!isScrolledToLatest(node))
    return true
  }, [clearChatLayoutAnchor])

  const markManualScrollIntent = useCallback((awayFromLatest = false) => {
    clearManualScrollIntent()
    manualScrollIntentRef.current = true
    manualScrollAwayFromLatestRef.current = awayFromLatest
    manualScrollIntentTimerRef.current = window.setTimeout(() => {
      manualScrollIntentRef.current = false
      manualScrollAwayFromLatestRef.current = false
      manualScrollIntentTimerRef.current = 0
    }, 1200)
  }, [clearManualScrollIntent])

  const releaseProgrammaticScrollAfterLayout = useCallback(
    (behavior: ScrollBehavior) => {
      clearProgrammaticScrollReset()

      const release = () => {
        isProgrammaticScrollRef.current = false
        programmaticScrollResetFrameRef.current = 0
        if (programmaticScrollResetTimerRef.current) {
          window.clearTimeout(programmaticScrollResetTimerRef.current)
          programmaticScrollResetTimerRef.current = 0
        }
      }

      if (behavior === "smooth") {
        programmaticScrollResetTimerRef.current = window.setTimeout(release, 450)
        return
      }

      programmaticScrollResetFrameRef.current = window.requestAnimationFrame(() => {
        programmaticScrollResetFrameRef.current = window.requestAnimationFrame(
          release
        )
      })
      programmaticScrollResetTimerRef.current = window.setTimeout(release, 120)
    },
    [clearProgrammaticScrollReset]
  )

  const performLatestScroll = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const node = scrollRef.current
      if (!node) {
        return
      }
      clearManualScrollIntent()
      isProgrammaticScrollRef.current = true
      lastChatScrollTopRef.current = maxChatScrollTop(node)
      node.scrollTo({
        top: maxChatScrollTop(node),
        behavior,
      })
      setShowScrollToLatest(false)
      releaseProgrammaticScrollAfterLayout(behavior)
    },
    [clearManualScrollIntent, releaseProgrammaticScrollAfterLayout]
  )

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    isFollowingLatestRef.current = true
    performLatestScroll(behavior)
    setIsFollowingLatest(true)
  }, [performLatestScroll])

  const loadOlderHistory = useCallback(() => {
    const node = scrollRef.current
    if (
      !node ||
      !hasMoreHistory ||
      isLoadingHistory ||
      isLoadingOlderHistory
    ) {
      return
    }
    olderHistoryScrollAnchorRef.current = {
      height: node.scrollHeight,
      top: node.scrollTop,
    }
    void onLoadOlderHistory()
  }, [
    hasMoreHistory,
    isLoadingHistory,
    isLoadingOlderHistory,
    onLoadOlderHistory,
  ])

  useEffect(() => {
    isFollowingLatestRef.current = isFollowingLatest
  }, [isFollowingLatest])

  useLayoutEffect(() => {
    olderHistoryScrollAnchorRef.current = null
    isFollowingLatestRef.current = true
    performLatestScroll("auto")
  }, [currentProject?.path, currentSession?.id, performLatestScroll])

  useEffect(() => {
    return () => {
      clearProgrammaticScrollReset()
      clearManualScrollIntent()
      clearChatLayoutAnchor()
      if (completionVisibilityFrameRef.current) {
        window.cancelAnimationFrame(completionVisibilityFrameRef.current)
      }
    }
  }, [
    clearChatLayoutAnchor,
    clearManualScrollIntent,
    clearProgrammaticScrollReset,
  ])

  useLayoutEffect(() => {
    if (isAgentWorking) {
      if (!wasAgentWorkingForVisibilityRef.current) {
        latestFinishedAssistantIdBeforeRunRef.current = latestFinishedAssistantId()
      }
      wasAgentWorkingForVisibilityRef.current = true
      pendingCompletionVisibilitySessionIdRef.current = null
      return
    }
    if (!wasAgentWorkingForVisibilityRef.current) {
      return
    }
    wasAgentWorkingForVisibilityRef.current = false
    pendingCompletionVisibilitySessionIdRef.current = currentSession?.id ?? null
  }, [currentSession?.id, isAgentWorking, items, latestFinishedAssistantId])

  useLayoutEffect(() => {
    const pendingSessionId = pendingCompletionVisibilitySessionIdRef.current
    if (
      !pendingSessionId ||
      pendingSessionId !== currentSession?.id ||
      isAgentWorking
    ) {
      return
    }
    const latestAssistant = latestAssistantItem()
    if (
      !latestAssistant ||
      latestAssistant.status !== "finished" ||
      latestAssistant.id === latestFinishedAssistantIdBeforeRunRef.current
    ) {
      return
    }
    window.cancelAnimationFrame(completionVisibilityFrameRef.current)
    completionVisibilityFrameRef.current = window.requestAnimationFrame(() => {
      completionVisibilityFrameRef.current = window.requestAnimationFrame(() => {
        completionVisibilityFrameRef.current = 0
        if (
          pendingCompletionVisibilitySessionIdRef.current !== pendingSessionId
        ) {
          return
        }
        pendingCompletionVisibilitySessionIdRef.current = null
        onSessionCompletionVisibility(
          pendingSessionId,
          isLatestAssistantMessageFullyVisible()
        )
      })
    })
    return () => {
      if (completionVisibilityFrameRef.current) {
        window.cancelAnimationFrame(completionVisibilityFrameRef.current)
        completionVisibilityFrameRef.current = 0
      }
    }
  }, [
    currentSession?.id,
    isAgentWorking,
    items,
    latestAssistantItem,
    onSessionCompletionVisibility,
  ])

  useLayoutEffect(() => {
    if (!isFollowingLatestRef.current) {
      return
    }
    window.cancelAnimationFrame(followLatestFrameRef.current)
    followLatestFrameRef.current = window.requestAnimationFrame(() => {
      const node = scrollRef.current
      if (!node) {
        return
      }
      performLatestScroll("auto")
    })
    return () => {
      window.cancelAnimationFrame(followLatestFrameRef.current)
    }
  }, [
    currentProject?.path,
    currentSession?.id,
    isAgentWorking,
    items,
    performLatestScroll,
  ])

  useLayoutEffect(() => {
    const anchor = olderHistoryScrollAnchorRef.current
    const node = scrollRef.current
    if (!anchor || !node) {
      return
    }
    olderHistoryScrollAnchorRef.current = null
    const nextScrollTop = anchor.top + (node.scrollHeight - anchor.height)
    node.scrollTop = nextScrollTop
    lastChatScrollTopRef.current = nextScrollTop
  }, [items])

  useEffect(() => {
    if (!isLoadingOlderHistory) {
      olderHistoryScrollAnchorRef.current = null
    }
  }, [isLoadingOlderHistory])

  useLayoutEffect(() => {
    const contentNode = chatContentRef.current
    if (!contentNode) {
      return
    }

    let frameId = 0
    const resizeObserver = new ResizeObserver(() => {
      const node = scrollRef.current
      if (!node) {
        return
      }
      if (applyChatLayoutAnchor()) {
        return
      }
      if (!isFollowingLatestRef.current) {
        setShowScrollToLatest(!isScrolledToLatest(node))
        return
      }
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        if (isFollowingLatestRef.current) {
          performLatestScroll("auto")
        }
      })
    })

    resizeObserver.observe(contentNode)
    return () => {
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [applyChatLayoutAnchor, performLatestScroll])

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
        if (!isCancelled && result.ok && result.usage) {
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

  useEffect(() => {
    const node = scrollRef.current
    if (
      !node ||
      !hasMoreHistory ||
      isLoadingHistory ||
      isLoadingOlderHistory ||
      node.scrollHeight > node.clientHeight + 160
    ) {
      return
    }
    loadOlderHistory()
  }, [
    hasMoreHistory,
    isLoadingHistory,
    isLoadingOlderHistory,
    items.length,
    loadOlderHistory,
  ])

  function handleChatScroll(event: UIEvent<HTMLDivElement>) {
    const node = event.currentTarget
    const scrollTop = node.scrollTop
    const isScrollingTowardHistory = scrollTop < lastChatScrollTopRef.current - 1
    lastChatScrollTopRef.current = scrollTop
    const isAtLatest = isScrolledToLatest(node)
    setIsChatScrolled(scrollTop > 2)
    if (scrollTop < 160) {
      loadOlderHistory()
    }
    if (isProgrammaticScrollRef.current) {
      if (isAtLatest) {
        clearProgrammaticScrollReset()
        isProgrammaticScrollRef.current = false
      }
      return
    }
    if (manualScrollAwayFromLatestRef.current) {
      isFollowingLatestRef.current = false
      setIsFollowingLatest(false)
      setShowScrollToLatest(!isAtLatest)
      return
    }
    if (
      !manualScrollIntentRef.current &&
      isFollowingLatestRef.current &&
      !isAtLatest
    ) {
      if (isScrollingTowardHistory) {
        markCurrentSessionViewed()
        handleManualScrollIntent(true)
        return
      }
      performLatestScroll("auto")
      return
    }
    if (isAtLatest) {
      clearManualScrollIntent()
    }
    isFollowingLatestRef.current = isAtLatest
    setIsFollowingLatest(isAtLatest)
    setShowScrollToLatest(!isAtLatest)
  }

  function handleManualScrollIntent(awayFromLatest = false) {
    clearChatLayoutAnchor()
    markManualScrollIntent(awayFromLatest)
    if (awayFromLatest) {
      isFollowingLatestRef.current = false
      setIsFollowingLatest(false)
      const node = scrollRef.current
      setShowScrollToLatest(node ? !isScrolledToLatest(node) : true)
    }
    clearProgrammaticScrollReset()
    isProgrammaticScrollRef.current = false
  }

  function handleWheelCapture(event: WheelEvent<HTMLDivElement>) {
    const isScrollingTowardHistory = event.deltaY < 0
    markCurrentSessionViewed()
    handleManualScrollIntent(isScrollingTowardHistory)
    if (isScrollingTowardHistory && event.currentTarget.scrollTop < 160) {
      loadOlderHistory()
    }
  }

  function handleChatKeyDownCapture(event: KeyboardEvent) {
    markCurrentSessionViewed()
    handleEscapeKey(event)
  }

  function handleScrollPointerDown(event: PointerEvent<HTMLDivElement>) {
    markCurrentSessionViewed()
    const rect = event.currentTarget.getBoundingClientRect()
    const scrollbarHitSize = 18
    const isLikelyScrollbarPointer =
      event.clientX >= rect.right - scrollbarHitSize ||
      event.clientY >= rect.bottom - scrollbarHitSize
    if (isLikelyScrollbarPointer) {
      handleManualScrollIntent()
    }
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

  function updateSendDuringRunMode(mode: OusiaSendDuringRunMode) {
    sendDuringRunModeRef.current = mode
    updateComposerSettings({ sendDuringRunMode: mode })
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

  const openProviderKeyDialog = useCallback(() => {
    const providerOptions =
      modelRegistry?.providers.filter((provider) => provider.models.length > 0) ??
      []
    const provider =
      providerOptions.find((item) => item.id === "deepseek") ??
      providerOptions.find((item) => item.id === settings.modelProvider) ??
      providerOptions[0]
    const providerId = provider?.id ?? settings.modelProvider
    setProviderKeyDialogProviderId(providerId)
    setProviderKeyDialogApiKey("")
    setProviderKeyDialogError("")
    setIsComposerSettingsOpen(false)
    setIsModelMenuOpen(false)
    setOpenSessionMenuKey(null)
    setIsProviderKeyDialogOpen(true)
  }, [modelRegistry, settings])

  const ensureSelectedProviderApiKey = useCallback(() => {
    if (!modelRegistry || selectedModelPreset) {
      return true
    }
    openProviderKeyDialog()
    onLocalEvent({
      type: "status_message",
      id: `provider-api-key-${Date.now()}`,
      status: "finished",
      text: t.chat.providerApiKeyRequiredInfo,
      timestamp: new Date().toISOString(),
    })
    return false
  }, [
    onLocalEvent,
    openProviderKeyDialog,
    modelRegistry,
    selectedModelPreset,
    t.chat.providerApiKeyRequiredInfo,
  ])

  async function saveProviderKeyFromDialog() {
    const apiKey = providerKeyDialogApiKey.trim()
    const provider = providerKeyDialogProvider
    const defaultModel = provider?.models[0]
    if (!provider || !defaultModel || !apiKey || !window.ousia) {
      return
    }
    setProviderKeyDialogError("")
    setIsSavingProviderKey(true)
    const result = await window.ousia
      .savePiProviderCredential({
        apiKey,
        provider: provider.id,
      })
      .catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      }))
    setIsSavingProviderKey(false)
    if (!result.ok) {
      setProviderKeyDialogError(result.error ?? t.settings.providerSaveFailed)
      return
    }
    await onRefreshModelRegistry().catch(() => undefined)
    const nextModelProviders = settings.modelProviders.some(
      (configured) => configured.id === provider.id
    )
      ? settings.modelProviders.map((configured) =>
          configured.id === provider.id
            ? { ...configured, apiKey: "" }
            : configured
        )
      : [
          ...settings.modelProviders,
          {
            id: provider.id,
            apiKey: "",
          },
        ]
    const thinkingLevel = defaultModel.thinkingLevels.includes(
      settings.thinkingLevel
    )
      ? settings.thinkingLevel
      : defaultThinkingLevelFor(defaultModel.thinkingLevels)

    onSettingsChange(
      normalizeOusiaAppSettings({
        ...settings,
        modelProvider: provider.id,
        modelId: defaultModel.modelId,
        thinkingLevel,
        modelProviders: nextModelProviders,
      })
    )
    setProviderKeyDialogApiKey("")
    setIsProviderKeyDialogOpen(false)
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
      if (!ensureSelectedProviderApiKey()) {
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
          autoRetryOnFailure: settings.autoRetryOnFailure,
          projectPath: currentProject.path,
          sessionId: currentSession.id,
          thinkingLevel: selectedThinkingLevel,
          model: {
            provider: settings.modelProvider,
            modelId: settings.modelId,
          },
        })
        if (!result.ok) {
          onLocalEvent({
            type: "run_status",
            status: "error",
            timestamp: new Date().toISOString(),
          })
        }
        if (result.ok && shouldGenerateTitle) {
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
      ensureSelectedProviderApiKey,
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
    setIsQueuePausedAfterInterrupt(false)
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

  async function clearPiQueue() {
    if (!window.ousia || !currentProject || !currentSession) {
      return
    }

    await window.ousia.clearChatQueue({
      projectPath: currentProject.path,
      sessionId: currentSession.id,
    })
  }

  async function materializePiQueue(
    messages: QueuedChatMessage[] = piQueuedMessages
  ) {
    setQueuedMessages(messages)
    await clearPiQueue()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if ((!text && attachments.length === 0) || isSending) {
      return
    }
    if (!ensureSelectedProviderApiKey()) {
      return
    }
    const outgoingAttachments = attachments
    setDraft("")
    setAttachments([])

    if (editingQueueId) {
      queueDraftMessage(text, outgoingAttachments)
      return
    }

    if (isAgentWorking && sendDuringRunModeRef.current === "queue") {
      queueDraftMessage(text, outgoingAttachments)
      return
    }

    await sendMessage({
      text,
      attachments: outgoingAttachments,
      sendBehavior: isAgentWorking ? "steer" : "normal",
    })
  }

  async function sendQueuedMessageNow(id: string) {
    const isPiQueueMessage = isPiQueueVisible
    const sourceMessages = isPiQueueMessage ? piQueuedMessages : queuedMessages
    const message = sourceMessages.find((item) => item.id === id)
    if (!message) {
      return
    }
    if (!ensureSelectedProviderApiKey()) {
      return
    }
    const remainingMessages = sourceMessages.filter((item) => item.id !== id)
    if (remainingMessages.length === 0) {
      setIsQueuePausedAfterInterrupt(false)
    }
    if (isPiQueueMessage) {
      await materializePiQueue(remainingMessages)
    } else {
      setQueuedMessages((current) => current.filter((item) => item.id !== id))
    }
    if (editingQueueId === id) {
      setEditingQueueId(null)
      setDraft("")
      setAttachments([])
    }
    await sendMessage({
      text: message.text,
      attachments: message.attachments,
      sendBehavior: isAgentWorking ? "steer" : "normal",
    })
  }

  function editQueuedMessage(id: string) {
    const isPiQueueMessage = isPiQueueVisible
    const sourceMessages = isPiQueueMessage ? piQueuedMessages : queuedMessages
    const message = sourceMessages.find((item) => item.id === id)
    if (!message) {
      return
    }
    if (isPiQueueMessage) {
      void materializePiQueue(sourceMessages)
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
    const isPiQueueMessage = isPiQueueVisible
    const sourceMessages = isPiQueueMessage ? piQueuedMessages : queuedMessages
    const remainingMessages = sourceMessages.filter((item) => item.id !== id)
    if (remainingMessages.length === 0) {
      setIsQueuePausedAfterInterrupt(false)
    }
    if (isPiQueueMessage) {
      void materializePiQueue(remainingMessages)
    } else {
      setQueuedMessages((current) => current.filter((item) => item.id !== id))
    }
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
    const isPiQueueMessage = isPiQueueVisible
    const sourceMessages = isPiQueueMessage ? piQueuedMessages : queuedMessages
    const nextMessages = (() => {
      const from = sourceMessages.findIndex((item) => item.id === activeId)
      const to = sourceMessages.findIndex((item) => item.id === overId)
      if (from < 0 || to < 0) {
        return sourceMessages
      }
      const next = [...sourceMessages]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })()
    if (isPiQueueMessage) {
      void materializePiQueue(nextMessages)
    } else {
      setQueuedMessages(nextMessages)
    }
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
    if (
      editingQueueId ||
      isSending ||
      isQueueAutoSendPaused ||
      !queuedMessages.length
    ) {
      return
    }
    const timer = window.setTimeout(() => {
      if (!ensureSelectedProviderApiKey()) {
        setIsQueuePausedAfterInterrupt(true)
        return
      }
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
  }, [
    editingQueueId,
    ensureSelectedProviderApiKey,
    isAgentWorking,
    isQueueAutoSendPaused,
    isSending,
    queuedMessages,
    sendMessage,
  ])

  async function handleInterrupt() {
    if (isInterrupting || !window.ousia || !currentProject || !currentSession) {
      return
    }
    if (
      !settings.continueQueuedMessagesAfterInterrupt &&
      isPiQueueVisible &&
      piQueuedMessages.length
    ) {
      setQueuedMessages(
        piQueuedMessages.map((message, index) => ({
          ...message,
          id: `interrupted-${Date.now()}-${index}`,
        }))
      )
      setIsQueuePausedAfterInterrupt(true)
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

  async function handleManualCompact() {
    if (isCompacting || !window.ousia || !currentProject || !currentSession) {
      return
    }
    if (!ensureSelectedProviderApiKey()) {
      return
    }
    const statusMessageId = `compact-${Date.now()}`
    setIsCompacting(true)
    onLocalEvent({
      type: "status_message",
      id: statusMessageId,
      status: "streaming",
      text: t.chat.contextCompacting,
      timestamp: new Date().toISOString(),
    })
    try {
      const result = await window.ousia.compactChat({
        agentMode: settings.agentMode,
        customAgentTools: settings.customAgentTools,
        autoCompactContext: settings.autoCompactContext,
        autoRetryOnFailure: settings.autoRetryOnFailure,
        projectPath: currentProject.path,
        sessionId: currentSession.id,
        thinkingLevel: selectedThinkingLevel,
        model: {
          provider: settings.modelProvider,
          modelId: settings.modelId,
        },
      })
      if (!result.ok) {
        onLocalEvent({
          type: "status_message",
          id: statusMessageId,
          role: "error",
          status: "finished",
          text: result.error ?? t.chat.compactFailed,
          timestamp: new Date().toISOString(),
        })
        return
      }
      onLocalEvent({
        type: "status_message",
        id: statusMessageId,
        status: "finished",
        text: t.chat.contextCompacted,
        timestamp: new Date().toISOString(),
      })
      const usageResult = await window.ousia.getChatContextUsage({
        projectPath: currentProject.path,
        sessionId: currentSession.id,
      })
      if (usageResult.ok && usageResult.usage) {
        setContextUsageState({
          key: `${currentProject.path}::${currentSession.id}`,
          usage: usageResult.usage,
        })
      }
    } finally {
      setIsCompacting(false)
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

  async function handleOpenProjectDirectory() {
    if (isOpeningProjectDirectory) {
      return
    }
    if (!window.ousia || !currentProject) {
      onLocalEvent({
        type: "error",
        id: `open-project-directory-${Date.now()}`,
        text: window.ousia ? t.chat.noSelection : t.chat.noElectron,
        timestamp: new Date().toISOString(),
      })
      return
    }

    setIsOpeningProjectDirectory(true)
    try {
      const result = await window.ousia.openDirectoryInFinder({
        path: currentProject.path,
      })
      if (!result.ok) {
        onLocalEvent({
          type: "error",
          id: `open-project-directory-${Date.now()}`,
          text: result.error || t.chat.openProjectDirectoryFailed,
          timestamp: new Date().toISOString(),
        })
      }
    } finally {
      setIsOpeningProjectDirectory(false)
    }
  }

  async function handleExportSession(format: OusiaChatExportFormat) {
    if (!window.ousia || !currentProject || !currentSession) {
      return
    }
    if (!ensureSelectedProviderApiKey()) {
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
      autoRetryOnFailure: settings.autoRetryOnFailure,
      projectPath: currentProject.path,
      sessionId: currentSession.id,
      thinkingLevel: selectedThinkingLevel,
      model: {
        provider: settings.modelProvider,
        modelId: settings.modelId,
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
    markCurrentSessionViewed()
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
    markCurrentSessionViewed()
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
        "@container/chat ousia-main-panel ousia-squircle-corners relative z-20 flex min-w-0 shrink-0 flex-col overflow-hidden rounded-l-none rounded-r-[var(--ousia-chat-panel-radius)] border-[0.5px] border-l-0 border-border/60 bg-white shadow-none dark:bg-card"
      )}
      style={style}
      onKeyDownCapture={handleChatKeyDownCapture}
      onPointerDownCapture={markCurrentSessionViewed}
    >
      <ChatHeader
        copyStatus={copyStatus}
        currentProject={currentProject}
        currentSession={currentSession}
        isCompacting={isCompacting}
        isOpeningProjectDirectory={isOpeningProjectDirectory}
        isSessionMenuOpen={isSessionMenuOpen}
        isSidebarCollapsed={isSidebarCollapsed}
        isScrolled={isChatScrolled}
        isWindowFullscreen={isWindowFullscreen}
        onCopySessionHistory={() => void handleCopySessionHistory()}
        onExportSession={(format) => void handleExportSession(format)}
        onManualCompact={() => void handleManualCompact()}
        onOpenProjectDirectory={() => void handleOpenProjectDirectory()}
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
          "ousia-hover-scrollbar ousia-stable-scrollbar-gutter min-h-0 flex-1 select-text overflow-auto bg-white pt-4 pb-16 dark:bg-card",
          CHAT_HORIZONTAL_PADDING_CLASS
        )}
        onScroll={handleChatScroll}
        onWheelCapture={handleWheelCapture}
        onTouchStartCapture={() => {
          markCurrentSessionViewed()
          handleManualScrollIntent()
        }}
        onPointerDownCapture={handleScrollPointerDown}
      >
        <div ref={chatContentRef}>
          {isLoadingOlderHistory ? (
            <div
              aria-label={t.chat.historyLoading}
              className="flex h-8 items-center justify-center text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" strokeWidth={1.5} />
            </div>
          ) : null}
          <ChatMessageList
            items={visibleChatItems}
            isAgentWorking={isAgentWorking}
            onBranchFromMessage={onBranchFromMessage}
            onPreserveScrollAnchor={preserveChatLayoutAnchor}
            projectPath={currentProject?.path}
            sessionId={currentSession?.id}
            showTurnWaitIndicator={showTurnWaitIndicator}
            t={t}
          />
        </div>
      </div>

      {showScrollToLatest ? (
        <div className="pointer-events-none relative z-20 h-0 shrink-0">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="pointer-events-auto absolute bottom-1 left-1/2 size-6 -translate-x-1/2 rounded-full border-[0.5px] border-foreground/10 bg-popover/90 text-popover-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.72),inset_0_0_0_1px_rgba(255,255,255,0.22),0_4px_14px_rgba(0,0,0,0.045),0_1px_5px_rgba(0,0,0,0.025)] backdrop-blur hover:bg-popover/95 dark:border-foreground/10 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_0_1px_rgba(255,255,255,0.04),0_4px_14px_rgba(0,0,0,0.22),0_1px_5px_rgba(0,0,0,0.12)]"
            aria-label={t.chat.scrollToLatest}
            onClick={() => {
              markCurrentSessionViewed()
              scrollToLatest("smooth")
            }}
          >
            <SendArrowDown className="size-[18px]" strokeWidth={1.5} />
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
                className="mx-5"
                editingId={editingQueueId}
                draggingId={draggingQueueId}
                messages={visibleQueuedMessages}
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
                "ousia-chat-composer-ring ousia-squircle-corners relative z-10 rounded-[var(--ousia-chat-composer-radius)] border-[0.5px] border-[color:var(--ousia-chat-composer-border)] bg-[var(--ousia-sidebar)] px-4 pt-3 pb-3 shadow-[var(--ousia-chat-composer-shadow)] transition-[border-color,box-shadow] focus-within:border-[color:var(--ousia-chat-composer-border-focus)] focus-within:shadow-[var(--ousia-chat-composer-shadow-focus)] focus-within:ring-0",
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
              className="ousia-hover-scrollbar -mr-4 min-h-12 w-[calc(100%+1rem)] rounded-none border-0 bg-transparent py-0 pr-2 pl-0 text-sm leading-6 placeholder:text-muted-foreground/55 [field-sizing:fixed] focus-visible:ring-0"
              placeholder={
                editingQueueId
                  ? t.chat.editQueuedMessage
                  : isAgentWorking
                    ? t.chat.continueMessage
                    : t.chat.inputPlaceholder
              }
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1">
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
                    <DropdownMenuSeparator className="my-2 bg-neutral-200" />
                    <DropdownMenuLabel className="px-2 pt-1 pb-1 text-sm text-neutral-500">
                      {t.chat.appendMessages}
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={sendDuringRunMode}
                      onValueChange={(value) =>
                        updateSendDuringRunMode(
                          value === "queue" ? "queue" : "steer"
                        )
                      }
                    >
                      <DropdownMenuRadioItem
                        value="queue"
                        className="h-9 rounded-md px-2 hover:bg-neutral-100 focus:bg-neutral-100"
                      >
                        {t.settings.queue}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem
                        value="steer"
                        className="h-9 rounded-md px-2 hover:bg-neutral-100 focus:bg-neutral-100"
                      >
                        {t.settings.steer}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
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
                    <span className="hidden shrink-0 text-foreground @max-[520px]:inline">
                      {t.chat.model}
                    </span>
                    <span className="min-w-0 truncate text-foreground @max-[520px]:hidden">
                      {selectedModelLabel}
                    </span>
                    {selectedModelPreset && selectedThinkingLevel !== "off" ? (
                      <span className="shrink-0 text-muted-foreground @max-[520px]:hidden">
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
                    collisionPadding={24}
                    align="start"
                    className="ousia-hover-scrollbar max-h-[min(var(--radix-dropdown-menu-content-available-height),640px)] w-72 rounded-xl p-2"
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
                    <div className="flex items-center justify-between gap-3 px-2 pt-1 pb-1">
                      <span className="text-sm text-neutral-500">
                        {t.chat.model}
                      </span>
                      <button
                        type="button"
                        className="text-xs leading-5 font-medium whitespace-nowrap text-neutral-500 underline-offset-4 hover:text-neutral-950 hover:underline focus-visible:text-neutral-950 focus-visible:underline focus-visible:outline-none"
                        onClick={() => openProviderKeyDialog()}
                      >
                        {t.chat.addModelProvider}
                      </button>
                    </div>
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
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="flex size-6 items-center justify-center text-muted-foreground/55"
                          aria-label={t.chat.contextUsageDetails(
                            contextUsagePercentLabel,
                            contextRemainingLabel
                          )}
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
                              strokeOpacity="0.12"
                              strokeWidth="2.5"
                            />
                            <circle
                              cx="9"
                              cy="9"
                              r="6"
                              fill="none"
                              pathLength="100"
                              stroke="currentColor"
                              strokeDasharray={contextUsageStrokeDasharray}
                              strokeOpacity="0.5"
                              strokeLinecap="round"
                              strokeWidth="2.5"
                            />
                          </svg>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t.chat.contextUsageDetails(
                          contextUsagePercentLabel,
                          contextRemainingLabel
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
                <Button
                  type="submit"
                  size="icon-sm"
                  className="size-6 rounded-full border-[0.5px] border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_4px_12px_rgba(0,0,0,0.09),0_1px_4px_rgba(0,0,0,0.06)] hover:bg-primary/90 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_12px_rgba(0,0,0,0.28),0_1px_4px_rgba(0,0,0,0.18)]"
                  disabled={isSending || !hasDraftContent}
                  aria-label={t.app.send}
                >
                  <SendArrowUp size={17} strokeWidth={1.9} />
                </Button>
              </div>
            </div>
          </div>
          </div>
        </div>
      </form>
      <Dialog
        open={isProviderKeyDialogOpen}
        onOpenChange={(open) => {
          setIsProviderKeyDialogOpen(open)
          if (!open) {
            setProviderKeyDialogApiKey("")
          }
        }}
      >
        <DialogContent>
          <div className="flex items-start justify-between gap-4">
            <DialogHeader>
              <DialogTitle>{t.chat.providerApiKeyTitle}</DialogTitle>
              <DialogDescription>
                {t.chat.providerApiKeyDescription}
              </DialogDescription>
            </DialogHeader>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ousia-squircle-corners mt-0.5 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 active:scale-[0.96]"
              aria-label={t.app.close}
              onClick={() => setIsProviderKeyDialogOpen(false)}
            >
              <X size={18} />
            </Button>
          </div>

          <label className="mt-4 block">
            <span className="text-xs font-medium text-muted-foreground">
              {t.settings.provider}
            </span>
            <Select
              items={providerKeyDialogSelectItems}
              value={providerKeyDialogProviderId}
              onValueChange={(value) => {
                const nextProviderId = value ?? ""
                setProviderKeyDialogProviderId(nextProviderId)
                setProviderKeyDialogApiKey("")
                setProviderKeyDialogError("")
              }}
            >
              <SelectTrigger
                aria-label={t.settings.provider}
                className="ousia-squircle-corners mt-2 w-full rounded-xl border-[0.5px] border-foreground/10 bg-white hover:bg-white"
              >
                <SelectValue placeholder={t.settings.chooseProvider} />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  {providerKeyDialogProviders.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>

          <label className="mt-4 block">
            <span className="text-xs font-medium text-muted-foreground">
              API Key
            </span>
            <Input
              aria-label="API Key"
              className="ousia-squircle-corners mt-2 rounded-xl border-[0.5px] border-foreground/10 bg-white focus-visible:bg-white"
              value={providerKeyDialogApiKey}
              onChange={(event) =>
                setProviderKeyDialogApiKey(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && canSaveProviderKey) {
                  event.preventDefault()
                  void saveProviderKeyFromDialog()
                }
              }}
              placeholder="sk-..."
              type="password"
            />
            {!providerKeyDialogApiKey.trim() ? (
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {t.settings.apiKeyRequired}
              </span>
            ) : null}
          </label>

          {providerKeyDialogError ? (
            <div className="mt-4 rounded-xl border-[0.5px] border-red-500/20 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
              {providerKeyDialogError}
            </div>
          ) : null}

          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ousia-squircle-corners h-10 rounded-2xl border-[0.5px] border-foreground/10 bg-white px-5 text-neutral-950 hover:bg-neutral-50 active:scale-[0.96]"
              onClick={() => setIsProviderKeyDialogOpen(false)}
            >
              {t.app.cancel}
            </Button>
            <Button
              type="button"
              size="sm"
              className="ousia-squircle-corners h-10 rounded-2xl bg-neutral-950 px-5 text-white hover:bg-neutral-800 active:scale-[0.96]"
              disabled={!canSaveProviderKey}
              onClick={() => void saveProviderKeyFromDialog()}
            >
              {isSavingProviderKey ? t.settings.saving : t.app.add}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
