import {
  memo,
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
} from "@/components/icons/huge-icons"

import type { AppSettings, ProjectRecord, SessionRecord } from "@/app/app-state"
import { isDefaultSessionTitle } from "@/app/i18n"
import {
  getConfiguredModelPresets,
  modelLabel,
  modelPresetValue,
} from "@/app/model-presets"
import {
  reasoningEffortLabel,
  reasoningPreferencePatch,
  resolveModelReasoningEffort,
} from "@/app/reasoning-efforts"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { MAIN_PANEL_LEFT_CORNERS_CLASS } from "@/features/shell/main-panel-styles"
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
  type OusiaReasoningEffort,
} from "@/electron/chat-types"
import { getMessages } from "@/app/i18n"
import {
  AttachmentStrip,
  CHAT_COMPOSER_INPUT_CLASS,
  CHAT_COMPOSER_SHELL_CLASS,
  CHAT_QUEUE_OVERLAY_CLASS,
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
  composerScrollTopAfterResize,
  isComposerSelectionAtLatest,
} from "@/features/chat/chat-composer-scroll"
import {
  formatSessionHistoryForClipboard,
  writeTextToClipboard,
} from "@/features/chat/chat-history-clipboard"
import {
  shouldShowTurnWaitIndicator,
  useDelayedTurnWaitIndicator,
} from "@/features/chat/chat-turn-wait"
import {
  createOptimisticUserMessage,
  sendChatMessageOptimistically,
  shouldEndOptimisticRunAfterBridgeFailure,
} from "@/features/chat/optimistic-chat-send"
import {
  CHAT_HORIZONTAL_PADDING_CLASS,
  CHAT_CONTENT_MAX_WIDTH_CLASS,
} from "@/features/chat/chat-layout"
import type { ChatItem } from "@/features/chat/chat-events"
import {
  canScrollInDirection,
  chatBottomClearanceForOverlay,
  classifyChatScrollMovement,
  decideChatScrollFollow,
  isScrollAtLatest,
  type ScrollMetrics,
} from "@/features/chat/chat-scroll-follow"
import { cn } from "@/lib/utils"

const CHAT_INPUT_MAX_HEIGHT = 192
const CHAT_INPUT_MIN_HEIGHT = 48
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 40 * 1024 * 1024

function chatScrollMetrics(
  node: HTMLDivElement,
  scrollTop = node.scrollTop,
): ScrollMetrics {
  return {
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    scrollTop,
  }
}

const allAgentTools: OusiaAgentToolName[] = [
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
]

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
    isFullyVisible: boolean,
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

function isPiConfigurationRequiredStatusItem(item: ChatItem) {
  return (
    (item.id.startsWith("provider-api-key-") ||
      item.id.startsWith("pi-configuration-")) &&
    (item.role === "system" || item.role === "error")
  )
}

function ChatAreaComponent({
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
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(
    null,
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
  const [chatBottomClearance, setChatBottomClearance] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatContentRef = useRef<HTMLDivElement>(null)
  const queueOverlayRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputScrollTopBeforeResizeRef = useRef(0)
  const inputShouldFollowLatestAfterResizeRef = useRef(false)
  const followLatestFrameRef = useRef(0)
  const manualScrollIntentTimerRef = useRef(0)
  const manualScrollAwayFromLatestRef = useRef(false)
  const manualScrollIntentRef = useRef(false)
  const lastChatScrollMetricsRef = useRef<ScrollMetrics | null>(null)
  const programmaticScrollResetFrameRef = useRef(0)
  const pendingProgrammaticScrollTargetRef = useRef<number | null>(null)
  const reportedPendingScrollCorrectionRef = useRef(false)
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
  const isAgentWorkingRef = useRef(isAgentWorking)
  const isComposingRef = useRef(false)
  const isProgrammaticScrollRef = useRef(false)
  const sendDuringRunModeRef = useRef(settings.sendDuringRunMode)
  const wasAgentWorkingRef = useRef(isAgentWorking)
  isAgentWorkingRef.current = isAgentWorking
  const currentSessionMenuKey = currentSession?.id ?? "no-session"
  const isSessionMenuOpen = openSessionMenuKey === currentSessionMenuKey
  const effectiveAgentMode: OusiaAgentMode = settings.agentMode
  const piModelPresets = useMemo(
    () =>
      getConfiguredModelPresets(
        settings.modelProviders,
        modelRegistry,
        settings.disabledModelProviderIds,
      ),
    [modelRegistry, settings.disabledModelProviderIds, settings.modelProviders],
  )
  const configuredModelPresets = piModelPresets
  const selectedModelPreset = useMemo(
    () =>
      configuredModelPresets.find(
        (model) =>
          model.modelId === settings.modelId &&
          model.provider === settings.modelProvider,
      ),
    [configuredModelPresets, settings.modelId, settings.modelProvider],
  )
  const storedReasoningEffort = settings.thinkingLevel
  const activeThinkingLevels = selectedModelPreset?.thinkingLevels ?? [
    storedReasoningEffort ?? "medium",
  ]
  const selectedThinkingLevel = resolveModelReasoningEffort(
    selectedModelPreset,
    storedReasoningEffort,
  )
  const selectedModelLabel = selectedModelPreset
    ? modelLabel(selectedModelPreset)
    : t.chat.model
  const hasSelectedPiModel = !modelRegistry || Boolean(selectedModelPreset)
  const visibleChatItems = useMemo(() => {
    if (!hasSelectedPiModel) {
      return items
    }

    return items.filter((item) => !isPiConfigurationRequiredStatusItem(item))
  }, [hasSelectedPiModel, items])
  const showTurnWaitIndicator = useDelayedTurnWaitIndicator(
    shouldShowTurnWaitIndicator(items, isAgentWorking),
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

  const updateChatBottomClearance = useCallback(() => {
    const scrollNode = scrollRef.current
    const overlayNode = queueOverlayRef.current
    if (!scrollNode || !overlayNode) {
      setChatBottomClearance(0)
      return
    }

    const existingBottomPadding = Number.parseFloat(
      window.getComputedStyle(scrollNode).paddingBottom,
    )
    if (!Number.isFinite(existingBottomPadding)) {
      throw new Error(
        "Conversation bottom padding could not be measured for queue clearance.",
      )
    }
    const viewport = scrollNode.getBoundingClientRect()
    const overlay = overlayNode.getBoundingClientRect()
    const nextClearance = chatBottomClearanceForOverlay({
      existingBottomPadding,
      overlay,
      viewport,
    })
    setChatBottomClearance((current) =>
      current === nextClearance ? current : nextClearance,
    )
  }, [])

  const markCurrentSessionViewed = useCallback(() => {
    if (currentSession) {
      onSessionViewed(currentSession.id)
    }
  }, [currentSession, onSessionViewed])

  function isScrolledToLatest(node: HTMLDivElement) {
    return isScrollAtLatest(node)
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
      '[data-chat-message-role="assistant"]',
    )
    const latestAssistantMessage = assistantMessages.item(
      assistantMessages.length - 1,
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
    pendingProgrammaticScrollTargetRef.current = null
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
    ],
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
      lastChatScrollMetricsRef.current = chatScrollMetrics(node)
    }
    setShowScrollToLatest(!isScrolledToLatest(node))
    return true
  }, [clearChatLayoutAnchor])

  const markManualScrollIntent = useCallback(
    (awayFromLatest = false) => {
      clearManualScrollIntent()
      manualScrollIntentRef.current = true
      manualScrollAwayFromLatestRef.current = awayFromLatest
      manualScrollIntentTimerRef.current = window.setTimeout(() => {
        manualScrollIntentRef.current = false
        manualScrollAwayFromLatestRef.current = false
        manualScrollIntentTimerRef.current = 0
      }, 1200)
    },
    [clearManualScrollIntent],
  )

  const verifyProgrammaticScrollAfterLayout = useCallback(
    (behavior: ScrollBehavior) => {
      if (programmaticScrollResetFrameRef.current) {
        window.cancelAnimationFrame(programmaticScrollResetFrameRef.current)
        programmaticScrollResetFrameRef.current = 0
      }

      const verify = () => {
        programmaticScrollResetFrameRef.current = 0
        const node = scrollRef.current
        if (!node || !isFollowingLatestRef.current) {
          pendingProgrammaticScrollTargetRef.current = null
          isProgrammaticScrollRef.current = false
          return
        }

        const observedMetrics = chatScrollMetrics(node)
        lastChatScrollMetricsRef.current = observedMetrics
        if (isScrolledToLatest(node)) {
          // While the renderer is still streaming, later worker/layout work can
          // move WebKit away from the bottom without changing the final outer
          // geometry. Keep the correction pending until that work has ended.
          if (isAgentWorkingRef.current) {
            return
          }
          pendingProgrammaticScrollTargetRef.current = null
          isProgrammaticScrollRef.current = false
          return
        }

        const nextTarget = maxChatScrollTop(node)
        const previousTarget = pendingProgrammaticScrollTargetRef.current
        pendingProgrammaticScrollTargetRef.current = nextTarget
        if (behavior === "auto") {
          node.scrollTop = nextTarget
        } else if (previousTarget !== nextTarget) {
          node.scrollTo({ behavior, top: nextTarget })
        }
        // A target is a request, not an observation. Never put it in the
        // movement baseline before WebKit reports the actual scrollTop.
        lastChatScrollMetricsRef.current = chatScrollMetrics(node)
        programmaticScrollResetFrameRef.current =
          window.requestAnimationFrame(verify)
      }

      programmaticScrollResetFrameRef.current =
        window.requestAnimationFrame(verify)
    },
    [],
  )

  const performLatestScroll = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const node = scrollRef.current
      if (!node) {
        return
      }
      clearProgrammaticScrollReset()
      clearManualScrollIntent()
      isProgrammaticScrollRef.current = true
      const targetScrollTop = maxChatScrollTop(node)
      pendingProgrammaticScrollTargetRef.current = targetScrollTop
      lastChatScrollMetricsRef.current = chatScrollMetrics(node)
      if (behavior === "auto") {
        node.scrollTop = targetScrollTop
      } else {
        node.scrollTo({ top: targetScrollTop, behavior })
      }
      lastChatScrollMetricsRef.current = chatScrollMetrics(node)
      setShowScrollToLatest(false)
      verifyProgrammaticScrollAfterLayout(behavior)
    },
    [
      clearManualScrollIntent,
      clearProgrammaticScrollReset,
      verifyProgrammaticScrollAfterLayout,
    ],
  )

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      isFollowingLatestRef.current = true
      performLatestScroll(behavior)
      setIsFollowingLatest(true)
    },
    [performLatestScroll],
  )

  const scheduleLatestScroll = useCallback(() => {
    if (followLatestFrameRef.current) {
      window.cancelAnimationFrame(followLatestFrameRef.current)
    }
    followLatestFrameRef.current = window.requestAnimationFrame(() => {
      followLatestFrameRef.current = 0
      if (isFollowingLatestRef.current) {
        performLatestScroll("auto")
      }
    })
  }, [performLatestScroll])

  const loadOlderHistory = useCallback(() => {
    const node = scrollRef.current
    if (!node || !hasMoreHistory || isLoadingHistory || isLoadingOlderHistory) {
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

  useEffect(() => {
    if (isAgentWorking) {
      reportedPendingScrollCorrectionRef.current = false
    }
  }, [currentSession?.id, isAgentWorking])

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
      if (followLatestFrameRef.current) {
        window.cancelAnimationFrame(followLatestFrameRef.current)
        followLatestFrameRef.current = 0
      }
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
        latestFinishedAssistantIdBeforeRunRef.current =
          latestFinishedAssistantId()
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
      completionVisibilityFrameRef.current = window.requestAnimationFrame(
        () => {
          completionVisibilityFrameRef.current = 0
          if (
            pendingCompletionVisibilitySessionIdRef.current !== pendingSessionId
          ) {
            return
          }
          pendingCompletionVisibilitySessionIdRef.current = null
          onSessionCompletionVisibility(
            pendingSessionId,
            isLatestAssistantMessageFullyVisible(),
          )
        },
      )
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
    scheduleLatestScroll()
    return () => {
      if (followLatestFrameRef.current) {
        window.cancelAnimationFrame(followLatestFrameRef.current)
        followLatestFrameRef.current = 0
      }
    }
  }, [
    currentProject?.path,
    currentSession?.id,
    isAgentWorking,
    items,
    scheduleLatestScroll,
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
    lastChatScrollMetricsRef.current = chatScrollMetrics(node)
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
      scheduleLatestScroll()
    })

    resizeObserver.observe(contentNode)
    const scrollNode = scrollRef.current
    if (scrollNode) {
      resizeObserver.observe(scrollNode)
    }
    return () => {
      resizeObserver.disconnect()
    }
  }, [applyChatLayoutAnchor, scheduleLatestScroll])

  useLayoutEffect(() => {
    updateChatBottomClearance()
    const scrollNode = scrollRef.current
    const overlayNode = queueOverlayRef.current
    if (!scrollNode || !overlayNode) {
      return
    }
    if (typeof ResizeObserver === "undefined") {
      throw new Error(
        "ResizeObserver is required for queued-message bottom clearance.",
      )
    }

    const resizeObserver = new ResizeObserver(updateChatBottomClearance)
    resizeObserver.observe(scrollNode)
    resizeObserver.observe(overlayNode)
    window.addEventListener("resize", updateChatBottomClearance)
    return () => {
      window.removeEventListener("resize", updateChatBottomClearance)
      resizeObserver.disconnect()
    }
  }, [updateChatBottomClearance, visibleQueuedMessages.length])

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

  useLayoutEffect(() => {
    const node = inputRef.current
    if (!node) {
      return
    }

    const previousScrollTop = Math.max(
      node.scrollTop,
      inputScrollTopBeforeResizeRef.current,
    )
    node.style.height = "auto"
    const nextHeight = Math.min(
      Math.max(node.scrollHeight, CHAT_INPUT_MIN_HEIGHT),
      CHAT_INPUT_MAX_HEIGHT,
    )
    node.style.height = `${nextHeight}px`
    node.style.overflowY =
      node.scrollHeight > CHAT_INPUT_MAX_HEIGHT ? "auto" : "hidden"
    node.scrollTop = composerScrollTopAfterResize({
      followLatest: inputShouldFollowLatestAfterResizeRef.current,
      maxScrollTop: Math.max(0, node.scrollHeight - node.clientHeight),
      previousScrollTop,
    })
    inputScrollTopBeforeResizeRef.current = node.scrollTop
    inputShouldFollowLatestAfterResizeRef.current = false
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
    const currentMetrics = chatScrollMetrics(node)
    const previousMetrics = lastChatScrollMetricsRef.current ?? currentMetrics
    const movement = classifyChatScrollMovement(previousMetrics, currentMetrics)
    lastChatScrollMetricsRef.current = currentMetrics
    const isAtLatest = isScrolledToLatest(node)
    setIsChatScrolled(currentMetrics.scrollTop > 2)
    if (currentMetrics.scrollTop < 160) {
      loadOlderHistory()
    }
    const hasPendingProgrammaticScroll = isProgrammaticScrollRef.current
    const decision = decideChatScrollFollow({
      hasPendingProgrammaticScroll,
      isAtLatest,
      isFollowingLatest: isFollowingLatestRef.current,
      isScrollingTowardHistory: movement.isUnexplainedHistoryScroll,
      manualScrollAwayFromLatest: manualScrollAwayFromLatestRef.current,
      manualScrollIntent: manualScrollIntentRef.current,
    })
    if (decision === "stop-observed-history-scroll") {
      const trace = {
        currentMetrics,
        hasPendingProgrammaticScroll,
        movement,
        previousMetrics,
        sessionId: currentSession?.id,
      }
      console.debug(
        "[chat.scroll-follow] Stopping latest follow after observed upward scroll",
        trace,
      )
      void window.ousia
        ?.reportFrontendLog({
          data: trace,
          level: "info",
          message:
            "Stopped latest follow after unexplained upward scroll movement with unchanged geometry",
          scope: "chat.scroll-follow",
        })
        .catch((error: unknown) => {
          console.error(
            "[chat.scroll-follow] Failed to persist upward-scroll trace",
            error,
          )
          throw error
        })
      markCurrentSessionViewed()
      handleManualScrollIntent(true)
      return
    }
    if (decision === "restore") {
      const trace = {
        currentMetrics,
        distanceFromLatest: maxChatScrollTop(node) - currentMetrics.scrollTop,
        hasPendingProgrammaticScroll,
        movement,
        previousMetrics,
        sessionId: currentSession?.id,
      }
      console.debug(
        "[chat.scroll-follow] Restoring latest after non-manual layout movement",
        trace,
      )
      const shouldReportPendingCorrection =
        hasPendingProgrammaticScroll &&
        movement.isUnexplainedHistoryScroll &&
        !reportedPendingScrollCorrectionRef.current
      if (shouldReportPendingCorrection) {
        reportedPendingScrollCorrectionRef.current = true
      }
      if (
        (movement.geometryChanged && movement.isScrollingTowardHistory) ||
        shouldReportPendingCorrection
      ) {
        void window.ousia
          ?.reportFrontendLog({
            data: trace,
            level: "debug",
            message: shouldReportPendingCorrection
              ? "Restored latest after WebKit moved during a pending programmatic scroll correction"
              : "Restored latest after renderer geometry changed during upward scroll movement",
            scope: "chat.scroll-follow",
          })
          .catch((error: unknown) => {
            console.error(
              "[chat.scroll-follow] Failed to persist layout-scroll trace",
              error,
            )
            throw error
          })
      }
      performLatestScroll("auto")
      return
    }
    if (decision === "follow") {
      clearManualScrollIntent()
      isFollowingLatestRef.current = true
      setIsFollowingLatest(true)
      setShowScrollToLatest(false)
      return
    }
    isFollowingLatestRef.current = false
    setIsFollowingLatest(false)
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
    const nestedScrollNode =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-chat-nested-scroll]")
        : null
    if (
      nestedScrollNode &&
      nestedScrollNode !== event.currentTarget &&
      event.currentTarget.contains(nestedScrollNode) &&
      canScrollInDirection(nestedScrollNode, event.deltaY)
    ) {
      return
    }
    const isScrollingTowardHistory = event.deltaY < 0
    if (!isScrollingTowardHistory && isScrolledToLatest(event.currentTarget)) {
      return
    }
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

  function updateThinkingLevel(thinkingLevel: OusiaReasoningEffort) {
    onSettingsChange(
      normalizeOusiaAppSettings({
        ...settings,
        ...reasoningPreferencePatch(thinkingLevel),
      }),
    )
  }

  function updateComposerSettings(patch: Partial<AppSettings>) {
    onSettingsChange(
      normalizeOusiaAppSettings({
        ...settings,
        ...patch,
      }),
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
    onSettingsChange(
      normalizeOusiaAppSettings({
        ...settings,
        modelProvider: model.provider,
        modelId: model.modelId,
      }),
    )
  }

  const ensureSelectedPiModel = useCallback(() => {
    if (!modelRegistry || selectedModelPreset) {
      return true
    }
    onLocalEvent({
      type: "status_message",
      id: `pi-configuration-${Date.now()}`,
      status: "finished",
      text: t.chat.piConfigurationRequiredInfo,
      timestamp: new Date().toISOString(),
    })
    return false
  }, [
    onLocalEvent,
    modelRegistry,
    selectedModelPreset,
    t.chat.piConfigurationRequiredInfo,
  ])

  useEffect(() => {
    if (!window.ousia || !currentProject || !currentSession || isAgentWorking) {
      return
    }
    let isCancelled = false
    const context = {
      projectPath: currentProject.path,
      sessionId: currentSession.id,
    }
    void window.ousia
      .prepareChatSession({
        ...context,
        agentMode: effectiveAgentMode,
        customAgentTools: settings.customAgentTools,
        autoCompactContext: settings.autoCompactContext,
        autoRetryOnFailure: settings.autoRetryOnFailure,
        deferConfiguration: !selectedModelPreset,
        thinkingLevel: selectedThinkingLevel,
        model: {
          provider: settings.modelProvider,
          modelId: settings.modelId,
        },
      })
      .then(() => {
        if (!isCancelled) {
          console.debug("[chat.prepare] Pi session is ready", context)
        }
      })
      .catch((error: unknown) => {
        if (isCancelled) {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        console.error("[chat.prepare] Failed to prepare Pi session", {
          ...context,
          error: message,
        })
        onLocalEvent({
          context,
          type: "error",
          id: `prepare-error-${currentSession.id}-${Date.now()}`,
          text: message,
          timestamp: new Date().toISOString(),
        })
      })
    return () => {
      isCancelled = true
    }
  }, [
    currentProject,
    currentSession,
    effectiveAgentMode,
    isAgentWorking,
    onLocalEvent,
    selectedModelPreset,
    selectedThinkingLevel,
    settings.autoCompactContext,
    settings.autoRetryOnFailure,
    settings.customAgentTools,
    settings.modelId,
    settings.modelProvider,
  ])

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
      const ousia = window.ousia
      if (!ousia || !currentProject || !currentSession) {
        onLocalEvent({
          type: "error",
          id: `no-electron-${Date.now()}`,
          text: ousia ? t.chat.noSelection : t.chat.noElectron,
          timestamp: new Date().toISOString(),
        })
        return
      }
      if (!ensureSelectedPiModel()) {
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
      setIsSending(true)
      const shouldGenerateTitle =
        isDefaultSessionTitle(currentSession.title) && items.length === 0
      const context = {
        projectPath: currentProject.path,
        sessionId: currentSession.id,
      }
      const optimisticMessage = createOptimisticUserMessage({
        attachments: outgoingAttachments,
        context,
        text,
      })
      onLocalEvent({
        context,
        type: "run_status",
        status: "starting",
        timestamp: new Date().toISOString(),
      })
      try {
        const pendingResult = sendChatMessageOptimistically({
          event: optimisticMessage.event,
          onLocalEvent,
          send: () =>
            ousia.sendChatMessage({
              messageId: optimisticMessage.messageId,
              prompt: text,
              attachments: outgoingAttachments,
              sendBehavior,
              agentMode: effectiveAgentMode,
              customAgentTools: settings.customAgentTools,
              autoCompactContext: settings.autoCompactContext,
              autoRetryOnFailure: settings.autoRetryOnFailure,
              ...context,
              thinkingLevel: selectedThinkingLevel,
              model: {
                provider: settings.modelProvider,
                modelId: settings.modelId,
              },
            }),
        })
        console.debug("[chat.send] Published optimistic user message", {
          agentProvider: "pi",
          messageId: optimisticMessage.messageId,
          sessionId: currentSession.id,
        })
        scrollToLatest("auto")
        const result = await pendingResult
        if (!result.ok) {
          onLocalEvent({
            context,
            type: "user_message_failed",
            id: optimisticMessage.messageId,
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
      } catch (error) {
        const text = error instanceof Error ? error.message : t.chat.sendFailed
        console.error("[chat.send] Send failed", {
          error: text,
          messageId: optimisticMessage.messageId,
          sessionId: currentSession.id,
        })
        onLocalEvent({
          context,
          type: "error",
          id: `send-error-${optimisticMessage.messageId}`,
          text,
          timestamp: new Date().toISOString(),
        })
        onLocalEvent({
          context,
          type: "user_message_failed",
          id: optimisticMessage.messageId,
          timestamp: new Date().toISOString(),
        })
        if (shouldEndOptimisticRunAfterBridgeFailure(isAgentWorking)) {
          onLocalEvent({
            context,
            type: "run_status",
            status: "error",
            timestamp: new Date().toISOString(),
          })
        }
      } finally {
        setIsSending(false)
      }
    },
    [
      currentProject,
      currentSession,
      effectiveAgentMode,
      isAgentWorking,
      isSending,
      items.length,
      onLocalEvent,
      onGenerateSessionTitle,
      ensureSelectedPiModel,
      scrollToLatest,
      selectedModelPreset,
      selectedThinkingLevel,
      settings,
      t.chat.imageUnsupported,
      t.chat.noElectron,
      t.chat.noSelection,
      t.chat.sendFailed,
    ],
  )

  function queueDraftMessage(
    text: string,
    outgoingAttachments: OusiaChatAttachment[],
  ) {
    setIsQueuePausedAfterInterrupt(false)
    if (editingQueueId) {
      setQueuedMessages((current) =>
        current.map((message) =>
          message.id === editingQueueId
            ? { ...message, text, attachments: outgoingAttachments }
            : message,
        ),
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
    messages: QueuedChatMessage[] = piQueuedMessages,
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
    if (!ensureSelectedPiModel()) {
      return
    }
    inputRef.current?.focus({ preventScroll: true })
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
    if (!ensureSelectedPiModel()) {
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
      if (!ensureSelectedPiModel()) {
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
    ensureSelectedPiModel,
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
        })),
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
    if (!ensureSelectedPiModel()) {
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
        agentMode: effectiveAgentMode,
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

  async function handleExportSession(format: OusiaChatExportFormat) {
    if (!window.ousia || !currentProject || !currentSession) {
      return
    }
    if (!ensureSelectedPiModel()) {
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
      agentMode: effectiveAgentMode,
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
    inputShouldFollowLatestAfterResizeRef.current = isComposerSelectionAtLatest(
      target.value.length,
      selectionStart,
      selectionEnd,
    )
    setDraft(
      (current) =>
        `${current.slice(0, selectionStart)}${normalizedText}${current.slice(selectionEnd)}`,
    )
    window.requestAnimationFrame(() => {
      const nextCursor = selectionStart + normalizedText.length
      inputRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  function handleDraftChange(event: ChangeEvent<HTMLTextAreaElement>) {
    markCurrentSessionViewed()
    const target = event.currentTarget
    inputScrollTopBeforeResizeRef.current = target.scrollTop
    inputShouldFollowLatestAfterResizeRef.current = isComposerSelectionAtLatest(
      target.value.length,
      target.selectionStart,
      target.selectionEnd,
    )
    setDraft(target.value)
  }

  async function addFiles(files: File[]) {
    const currentTotal = attachments.reduce(
      (total, item) => total + item.size,
      0,
    )
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
        "ousia-main-panel border-border/60 bg-card @container/chat relative z-20 flex min-w-0 shrink-0 flex-col overflow-hidden rounded-r-[var(--ousia-chat-panel-radius)] border-[0.5px] border-l-0 shadow-[var(--ousia-main-panel-shadow)]",
        MAIN_PANEL_LEFT_CORNERS_CLASS,
      )}
      style={style}
      onKeyDownCapture={handleChatKeyDownCapture}
      onPointerDownCapture={markCurrentSessionViewed}
    >
      <ChatHeader
        copyStatus={copyStatus}
        currentSession={currentSession}
        isCompacting={isCompacting}
        isSessionMenuOpen={isSessionMenuOpen}
        isSidebarCollapsed={isSidebarCollapsed}
        isScrolled={isChatScrolled}
        isWindowFullscreen={isWindowFullscreen}
        onCopySessionHistory={() => void handleCopySessionHistory()}
        onExportSession={(format) => void handleExportSession(format)}
        onManualCompact={() => void handleManualCompact()}
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
          "ousia-hover-scrollbar ousia-stable-scrollbar-gutter bg-card min-h-0 flex-1 overflow-auto pt-4 pb-16 select-text",
          CHAT_HORIZONTAL_PADDING_CLASS,
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
              className="text-muted-foreground flex h-8 items-center justify-center"
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
          {chatBottomClearance ? (
            <div
              aria-hidden="true"
              data-chat-bottom-clearance
              style={{ height: chatBottomClearance }}
            />
          ) : null}
        </div>
      </div>

      {showScrollToLatest ? (
        <div className="pointer-events-none relative z-20 h-0 shrink-0">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="border-foreground/10 bg-popover/90 text-popover-foreground hover:bg-popover/95 dark:border-foreground/10 pointer-events-auto absolute bottom-1 left-1/2 size-6 -translate-x-1/2 rounded-full border-[0.5px] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),inset_0_0_0_1px_rgba(255,255,255,0.22),0_4px_14px_rgba(0,0,0,0.045),0_1px_5px_rgba(0,0,0,0.025)] backdrop-blur dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_0_1px_rgba(255,255,255,0.04),0_4px_14px_rgba(0,0,0,0.22),0_1px_5px_rgba(0,0,0,0.12)]"
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
        className={cn(CHAT_COMPOSER_SHELL_CLASS, CHAT_HORIZONTAL_PADDING_CLASS)}
        onSubmit={handleSubmit}
      >
        <div className={CHAT_CONTENT_MAX_WIDTH_CLASS}>
          <div className="relative">
            {/* Queue growth must not resize the conversation scroll viewport. */}
            {visibleQueuedMessages.length ? (
              <QueuedMessageList
                className={CHAT_QUEUE_OVERLAY_CLASS}
                editingId={editingQueueId}
                draggingId={draggingQueueId}
                messages={visibleQueuedMessages}
                onDelete={deleteQueuedMessage}
                onDragEnd={() => setDraggingQueueId(null)}
                onDragOver={moveQueuedMessage}
                onDragStart={setDraggingQueueId}
                onEdit={editQueuedMessage}
                onSendNow={sendQueuedMessageNow}
                rootRef={queueOverlayRef}
                t={t}
              />
            ) : null}
            <div className="ousia-chat-composer-ring relative z-10 rounded-[var(--ousia-chat-composer-radius)] border-[0.5px] border-[color:var(--ousia-chat-composer-border)] bg-[var(--ousia-composer-surface)] px-4 pt-3 pb-3 shadow-[var(--ousia-chat-composer-shadow)] transition-[border-color,box-shadow] focus-within:border-[color:var(--ousia-chat-composer-border-focus)] focus-within:shadow-[var(--ousia-chat-composer-shadow-focus)] focus-within:ring-0">
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
                    if (
                      isComposingRef.current ||
                      event.nativeEvent.isComposing
                    ) {
                      return
                    }
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                className={CHAT_COMPOSER_INPUT_CLASS}
                placeholder={
                  editingQueueId
                    ? t.chat.editQueuedMessage
                    : isAgentWorking
                      ? t.chat.continueMessage
                      : t.chat.inputPlaceholder
                }
              />
              <div className="mt-2 flex items-center justify-between gap-3">
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
                      className="w-72"
                    >
                      <DropdownMenuRadioGroup value={effectiveAgentMode}>
                        <DropdownMenuLabel>
                          {t.settings.agentMode}
                        </DropdownMenuLabel>
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
                                  onClick={() => {
                                    updateComposerSettings({
                                      agentMode: value,
                                    })
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
                      <DropdownMenuSeparator />
                      <DropdownMenuRadioGroup
                        value={sendDuringRunMode}
                        onValueChange={(value) =>
                          updateSendDuringRunMode(
                            value === "queue" ? "queue" : "steer",
                          )
                        }
                      >
                        <DropdownMenuLabel>
                          {t.chat.appendMessages}
                        </DropdownMenuLabel>
                        <DropdownMenuRadioItem value="queue">
                          {t.settings.queue}
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="steer">
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
                      className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex h-7 max-w-64 items-center gap-1.5 rounded-md px-2 text-xs transition-colors outline-none"
                    >
                      <span className="text-foreground hidden shrink-0 @max-[520px]:inline">
                        {t.chat.model}
                      </span>
                      <span className="text-foreground min-w-0 truncate @max-[520px]:hidden">
                        {selectedModelLabel}
                      </span>
                      {selectedModelPreset &&
                      selectedThinkingLevel !== "off" ? (
                        <span className="text-muted-foreground shrink-0 @max-[520px]:hidden">
                          {reasoningEffortLabel(selectedThinkingLevel)}
                        </span>
                      ) : null}
                      <ChevronDown
                        size={18}
                        strokeWidth={1.5}
                        className="text-muted-foreground shrink-0"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      side="top"
                      sideOffset={8}
                      collisionPadding={24}
                      align="start"
                      className="max-h-[min(var(--available-height),640px)] w-72"
                    >
                      <DropdownMenuRadioGroup value={selectedThinkingLevel}>
                        <DropdownMenuLabel>Reasoning</DropdownMenuLabel>
                        {activeThinkingLevels.map((level) => (
                          <DropdownMenuRadioItem
                            key={level}
                            value={level}
                            title={
                              selectedModelPreset?.thinkingLevelDescriptions?.[
                                level
                              ]
                            }
                            onClick={() => updateThinkingLevel(level)}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {reasoningEffortLabel(level)}
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      <div className="text-muted-foreground flex items-center justify-between gap-3 px-2 py-1.5 text-xs font-medium">
                        <span>{t.chat.model}</span>
                        <button
                          type="button"
                          className="hover:text-foreground focus-visible:text-foreground whitespace-nowrap underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                          onClick={() => void onRefreshModelRegistry()}
                        >
                          {t.chat.refreshLocalPiModels}
                        </button>
                      </div>
                      <DropdownMenuRadioGroup
                        value={
                          selectedModelPreset
                            ? modelPresetValue(
                                selectedModelPreset.provider,
                                selectedModelPreset.modelId,
                              )
                            : undefined
                        }
                      >
                        {configuredModelPresets.map((preset) => {
                          const value = modelPresetValue(
                            preset.provider,
                            preset.modelId,
                          )

                          return (
                            <DropdownMenuRadioItem
                              key={value}
                              value={value}
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
                            className="text-muted-foreground/55 flex size-6 items-center justify-center"
                            aria-label={t.chat.contextUsageDetails(
                              contextUsagePercentLabel,
                              contextRemainingLabel,
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
                            contextRemainingLabel,
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : null}
                  <Button
                    type="submit"
                    size="icon-sm"
                    className="hover:bg-primary/90 size-6 rounded-full border-[0.5px] border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_4px_12px_rgba(0,0,0,0.09),0_1px_4px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_12px_rgba(0,0,0,0.28),0_1px_4px_rgba(0,0,0,0.18)]"
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
        open={isCustomToolsDialogOpen}
        onOpenChange={setIsCustomToolsDialogOpen}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl">{t.chat.customTools}</DialogTitle>
            <DialogDescription>
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
                  className="hover:bg-muted focus-visible:bg-muted flex h-11 items-center justify-between rounded-md px-3 text-left text-sm focus-visible:outline-none"
                  onClick={() => toggleCustomAgentTool(tool)}
                >
                  <span>{t.chat.agentToolNames[tool]}</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "relative ml-3 h-5 w-9 shrink-0 rounded-full transition-colors",
                      isEnabled ? "bg-primary" : "bg-input",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-4 rounded-full shadow-sm transition-[left,background-color]",
                        isEnabled
                          ? "bg-primary-foreground"
                          : "bg-background dark:bg-foreground",
                        isEnabled ? "left-[18px]" : "left-0.5",
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
              className="px-5"
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

export const ChatArea = memo(ChatAreaComponent)
