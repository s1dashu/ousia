import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type UIEvent,
  type WheelEvent,
} from "react"

import type { ChatItem } from "@/features/chat/chat-events"

type ChatScrollMetrics = Pick<
  HTMLDivElement,
  "clientHeight" | "scrollHeight" | "scrollTop"
>

type UseChatScrollOptions = {
  currentProjectPath: string | undefined
  currentSessionId: string | undefined
  hasMoreHistory: boolean
  isAgentWorking: boolean
  isLoadingHistory: boolean
  isLoadingOlderHistory: boolean
  items: ChatItem[]
  onCurrentSessionViewed: () => void
  onLoadOlderHistory: () => Promise<void> | void
  onSessionCompletionVisibility: (
    sessionId: string,
    isFullyVisible: boolean
  ) => void
}

export function isScrolledToLatest(node: ChatScrollMetrics) {
  return node.scrollHeight - node.scrollTop - node.clientHeight < 24
}

export function maxChatScrollTop(node: ChatScrollMetrics) {
  return Math.max(0, node.scrollHeight - node.clientHeight)
}

export function latestAssistantItem(items: ChatItem[]) {
  return [...items].reverse().find((item) => item.role === "assistant")
}

export function latestFinishedAssistantId(items: ChatItem[]) {
  return (
    [...items]
      .reverse()
      .find((item) => item.role === "assistant" && item.status === "finished")
      ?.id ?? null
  )
}

export function useChatScroll({
  currentProjectPath,
  currentSessionId,
  hasMoreHistory,
  isAgentWorking,
  isLoadingHistory,
  isLoadingOlderHistory,
  items,
  onCurrentSessionViewed,
  onLoadOlderHistory,
  onSessionCompletionVisibility,
}: UseChatScrollOptions) {
  const [isChatScrolled, setIsChatScrolled] = useState(false)
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatContentRef = useRef<HTMLDivElement>(null)
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
  const isProgrammaticScrollRef = useRef(false)

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

  const getLatestAssistantItem = useCallback(
    () => latestAssistantItem(items),
    [items]
  )

  const getLatestFinishedAssistantId = useCallback(
    () => latestFinishedAssistantId(items),
    [items]
  )

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
    [clearManualScrollIntent]
  )

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
        programmaticScrollResetTimerRef.current = window.setTimeout(
          release,
          450
        )
        return
      }

      programmaticScrollResetFrameRef.current = window.requestAnimationFrame(
        () => {
          programmaticScrollResetFrameRef.current =
            window.requestAnimationFrame(release)
        }
      )
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

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      isFollowingLatestRef.current = true
      performLatestScroll(behavior)
      setIsFollowingLatest(true)
    },
    [performLatestScroll]
  )

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

  useLayoutEffect(() => {
    olderHistoryScrollAnchorRef.current = null
    isFollowingLatestRef.current = true
    performLatestScroll("auto")
  }, [currentProjectPath, currentSessionId, performLatestScroll])

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
        latestFinishedAssistantIdBeforeRunRef.current =
          getLatestFinishedAssistantId()
      }
      wasAgentWorkingForVisibilityRef.current = true
      pendingCompletionVisibilitySessionIdRef.current = null
      return
    }
    if (!wasAgentWorkingForVisibilityRef.current) {
      return
    }
    wasAgentWorkingForVisibilityRef.current = false
    pendingCompletionVisibilitySessionIdRef.current = currentSessionId ?? null
  }, [currentSessionId, getLatestFinishedAssistantId, isAgentWorking, items])

  useLayoutEffect(() => {
    const pendingSessionId = pendingCompletionVisibilitySessionIdRef.current
    if (
      !pendingSessionId ||
      pendingSessionId !== currentSessionId ||
      isAgentWorking
    ) {
      return
    }
    const latestAssistant = getLatestAssistantItem()
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
            isLatestAssistantMessageFullyVisible()
          )
        }
      )
    })
    return () => {
      if (completionVisibilityFrameRef.current) {
        window.cancelAnimationFrame(completionVisibilityFrameRef.current)
        completionVisibilityFrameRef.current = 0
      }
    }
  }, [
    currentSessionId,
    getLatestAssistantItem,
    isAgentWorking,
    items,
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
    currentProjectPath,
    currentSessionId,
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
    const isScrollingTowardHistory =
      scrollTop < lastChatScrollTopRef.current - 1
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
        onCurrentSessionViewed()
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
    onCurrentSessionViewed()
    handleManualScrollIntent(isScrollingTowardHistory)
    if (isScrollingTowardHistory && event.currentTarget.scrollTop < 160) {
      loadOlderHistory()
    }
  }

  function handleScrollPointerDown(event: PointerEvent<HTMLDivElement>) {
    onCurrentSessionViewed()
    const rect = event.currentTarget.getBoundingClientRect()
    const scrollbarHitSize = 18
    const isLikelyScrollbarPointer =
      event.clientX >= rect.right - scrollbarHitSize ||
      event.clientY >= rect.bottom - scrollbarHitSize
    if (isLikelyScrollbarPointer) {
      handleManualScrollIntent()
    }
  }

  return {
    chatContentRef,
    handleChatScroll,
    handleManualScrollIntent,
    handleScrollPointerDown,
    handleWheelCapture,
    isChatScrolled,
    preserveChatLayoutAnchor,
    scrollRef,
    scrollToLatest,
    showScrollToLatest,
  }
}
