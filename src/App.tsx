import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react"

import { useTheme } from "@/components/theme-provider"
import {
  APP_STATE_SCHEMA_VERSION,
  createDefaultAppState,
  createProject,
  createSession,
  loadInitialAppState,
  projectNameFromPath,
  saveAppState,
  type AppSettings,
  type InitialAppState,
  type ProjectRecord,
  type SessionRecord,
} from "@/app/app-state"
import {
  getOusiaModelProviderApiKey,
  normalizeOusiaAppSettings,
  resolveOusiaChatContentWidthValue,
  resolveOusiaFontFamilyValue,
  type OusiaChatEvent,
  type OusiaModelRegistryResult,
  type OusiaSidebarSectionId,
} from "@/electron/chat-types"
import { getMessages, isDefaultSessionTitle } from "@/app/i18n"
import { modelsForProvider } from "@/app/model-presets"
import { ChatArea } from "@/features/chat/ChatArea"
import { applyChatEvent, type ChatItem } from "@/features/chat/chat-events"
import { SettingsPage } from "@/features/settings/SettingsPage"
import { TitleBarSidebarToggle } from "@/features/shell/TitleBarTrafficLightSlot"
import { Sidebar } from "@/features/sidebar/Sidebar"

const MIN_SIDEBAR_WIDTH = 200
const SIDEBAR_COLLAPSE_THRESHOLD = 120
const MAX_SIDEBAR_WIDTH = 320
const MIN_CHAT_WIDTH = 300
const RESIZE_HANDLE_WIDTH = 1
const CHAT_HISTORY_PAGE_SIZE = 20

type AgentRunStatus = "idle" | "working"
type ShellResizeHandle = "sidebar"
type QueuedChatState = {
  steering: string[]
  followUp: string[]
}
type ChatContextUsageState = {
  tokens: number | null
  contextWindow: number
  percent: number | null
}
type ChatHistoryPageState = {
  cursor?: string
  error?: string
  hasMore: boolean
  status:
    | "loading-initial"
    | "ready"
    | "loading-older"
    | "empty"
    | "error"
  totalItems?: number
}
type TextDeltaChatEvent = Extract<
  OusiaChatEvent,
  { type: "assistant_text_delta" | "thinking_delta" }
>
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function chatKey(projectPath: string, sessionId: string) {
  return `${projectPath}::${sessionId}`
}

function historyPageStateFromResult(
  items: ChatItem[],
  history: {
    hasMore?: boolean
    nextCursor?: string
    totalItems?: number
  }
) {
  if (!items.length) {
    return {
      hasMore: false,
      status: "empty" as const,
      totalItems: history.totalItems,
    }
  }
  return {
    cursor: history.hasMore ? (history.nextCursor ?? items[0]?.id) : undefined,
    hasMore: Boolean(history.hasMore),
    status: "ready" as const,
    totalItems: history.totalItems,
  }
}

function mergePersistedChatItems(
  existingItems: ChatItem[],
  persistedItems: ChatItem[]
) {
  if (!existingItems.length) {
    return persistedItems
  }
  if (!persistedItems.length) {
    return existingItems
  }
  const persistedIds = new Set(persistedItems.map((item) => item.id))
  return [
    ...persistedItems,
    ...existingItems.filter((item) => !persistedIds.has(item.id)),
  ]
}

function isTextDeltaEvent(
  event: OusiaChatEvent | undefined
): event is TextDeltaChatEvent {
  return (
    event?.type === "assistant_text_delta" || event?.type === "thinking_delta"
  )
}

function canMergeTextDeltaEvents(
  previousEvent: OusiaChatEvent | undefined,
  nextEvent: TextDeltaChatEvent
): previousEvent is TextDeltaChatEvent {
  return (
    isTextDeltaEvent(previousEvent) &&
    previousEvent.type === nextEvent.type &&
    previousEvent.id === nextEvent.id
  )
}

function reorderById<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string
) {
  const sourceIndex = items.findIndex((item) => item.id === sourceId)
  const targetIndex = items.findIndex((item) => item.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return items
  }
  const next = [...items]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

function reorderSessionsById(
  sessions: SessionRecord[],
  sourceSessionId: string,
  targetSessionId: string
) {
  const sourceSession = sessions.find((session) => session.id === sourceSessionId)
  const targetSession = sessions.find((session) => session.id === targetSessionId)
  if (
    !sourceSession ||
    !targetSession ||
    sourceSession.projectId !== targetSession.projectId
  ) {
    return sessions
  }
  return reorderById(sessions, sourceSessionId, targetSessionId)
}

function moveSessionToGroupFront(
  sessions: SessionRecord[],
  sessionId: string,
  time: string
) {
  const targetSession = sessions.find((session) => session.id === sessionId)
  if (!targetSession) {
    return sessions
  }
  const updatedSession = { ...targetSession, time }
  const remainingSessions = sessions.filter((session) => session.id !== sessionId)
  const groupStartIndex = remainingSessions.findIndex(
    (session) => session.projectId === targetSession.projectId
  )
  if (groupStartIndex < 0) {
    return [updatedSession, ...remainingSessions]
  }
  const next = [...remainingSessions]
  next.splice(groupStartIndex, 0, updatedSession)
  return next
}

function normalizeSidebarSectionOrder(
  sectionOrder: OusiaSidebarSectionId[]
): OusiaSidebarSectionId[] {
  return [
    ...new Set(
      [...sectionOrder, "sessions", "projects"].filter(
        (sectionId): sectionId is OusiaSidebarSectionId =>
          sectionId === "sessions" || sectionId === "projects"
      )
    ),
  ]
}

function ResizeHandle({
  isActive = false,
  label,
  onPointerDown,
}: {
  isActive?: boolean
  label: string
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div className="group/resize relative z-10 -mx-1.5 flex w-3 shrink-0 flex-col">
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-full transition-[width,background-color,opacity] ${
          isActive
            ? "w-1 bg-ring/80"
            : "w-px bg-transparent group-hover/resize:w-1 group-hover/resize:bg-ring/70 group-focus-within/resize:bg-ring/70"
        }`}
      />
      <div
        aria-hidden="true"
        className="window-drag relative h-10 shrink-0"
      />
      <div
        aria-label={label}
        className="window-no-drag group relative min-h-0 flex-1 overflow-visible"
        onPointerDown={onPointerDown}
        role="separator"
        tabIndex={0}
      >
        <div className="window-no-drag absolute inset-y-0 left-1/2 w-5 -translate-x-1/2 cursor-col-resize" />
      </div>
    </div>
  )
}

export function App() {
  const { theme, setTheme } = useTheme()
  const [initialState] = useState<InitialAppState>(() => createDefaultAppState())
  const [isAppStateLoaded, setIsAppStateLoaded] = useState(!window.ousia)
  const shellRef = useRef<HTMLElement>(null)
  const sidebarShellRef = useRef<HTMLDivElement>(null)
  const [sidebarWidth, setSidebarWidth] = useState(
    initialState.shellLayout.sidebarWidth
  )
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    initialState.shellLayout.isSidebarCollapsed
  )
  const [sidebarSectionOrder, setSidebarSectionOrder] = useState<
    OusiaSidebarSectionId[]
  >(normalizeSidebarSectionOrder(initialState.shellLayout.sidebarSectionOrder))
  const [activeShellResizeHandle, setActiveShellResizeHandle] =
    useState<ShellResizeHandle | null>(null)
  const isShellResizing = activeShellResizeHandle !== null
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false)
  const [zoomIndicatorPercent, setZoomIndicatorPercent] = useState<number | null>(
    null
  )
  const zoomIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const [settings, setSettings] = useState<AppSettings>(initialState.settings)
  const t = getMessages(settings.language)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [modelRegistry, setModelRegistry] = useState<OusiaModelRegistryResult>()
  const [projects, setProjects] = useState<ProjectRecord[]>(
    initialState.projects
  )
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(
    initialState.expandedProjectIds
  )
  const [sessions, setSessions] = useState<SessionRecord[]>(
    initialState.sessions
  )
  const [selectedSessionId, setSelectedSessionId] = useState(
    initialState.selectedSessionId
  )
  const [sidebarScrollTargetSessionId, setSidebarScrollTargetSessionId] =
    useState("")
  const [itemsBySession, setItemsBySession] = useState<
    Record<string, ChatItem[]>
  >({})
  const [historyPageStateBySession, setHistoryPageStateBySession] = useState<
    Record<string, ChatHistoryPageState>
  >({})
  const itemsBySessionRef = useRef(itemsBySession)
  const historyPageStateBySessionRef = useRef(historyPageStateBySession)
  const historyInFlightKeysRef = useRef<Set<string>>(new Set())
  const pendingChatEventsRef = useRef<Map<string, OusiaChatEvent[]>>(new Map())
  const pendingChatEventsFrameRef = useRef(0)
  const sidebarResizeFrameRef = useRef(0)
  const [runStatusBySession, setRunStatusBySession] = useState<
    Record<string, AgentRunStatus>
  >({})
  const [unreadCompletedSessionIds, setUnreadCompletedSessionIds] = useState<
    Set<string>
  >(() => new Set())
  const [queuedChatStateBySession, setQueuedChatStateBySession] = useState<
    Record<string, QueuedChatState>
  >({})
  const [contextUsageBySession, setContextUsageBySession] = useState<
    Record<string, ChatContextUsageState | undefined>
  >({})
  const titleGenerationSessionIdsRef = useRef<Set<string>>(new Set())
  const draftSessionKeysRef = useRef<Set<string>>(new Set())
  const isApplyingStoredThemeRef = useRef(false)

  const projectPathForSession = useCallback(
    (session: SessionRecord) => {
      if (!session.projectId) {
        return settings.defaultWorkDir
      }
      return (
        projects.find((project) => project.id === session.projectId)?.path ??
        settings.defaultWorkDir
      )
    },
    [projects, settings.defaultWorkDir]
  )
  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? sessions[0]
  const selectedSessionIdForHistory = selectedSession?.id
  const selectedProject = selectedSession?.projectId
    ? projects.find((project) => project.id === selectedSession.projectId)
    : undefined
  const selectedProjectPath = selectedSession
    ? projectPathForSession(selectedSession)
    : settings.defaultWorkDir
  const defaultWorkDirProject: ProjectRecord = {
    id: "default-workdir",
    name: projectNameFromPath(settings.defaultWorkDir),
    path: selectedProjectPath,
  }
  const currentProject = selectedProject ?? defaultWorkDirProject
  const selectedChatKey =
    currentProject && selectedSession
      ? chatKey(selectedProjectPath, selectedSession.id)
      : ""
  const sessionsRef = useRef(sessions)
  const selectedChatKeyRef = useRef(selectedChatKey)
  const selectedSessionIdRef = useRef(selectedSessionId)
  const isSettingsOpenRef = useRef(isSettingsOpen)
  const runStatusBySessionRef = useRef(runStatusBySession)
  const selectedItems = selectedChatKey
    ? (itemsBySession[selectedChatKey] ?? [])
    : []
  const selectedQueuedChatState = useMemo(
    () =>
      selectedChatKey
        ? (queuedChatStateBySession[selectedChatKey] ?? {
            steering: [],
            followUp: [],
          })
        : {
            steering: [],
            followUp: [],
          },
    [queuedChatStateBySession, selectedChatKey]
  )
  const selectedContextUsage = selectedChatKey
    ? contextUsageBySession[selectedChatKey]
    : undefined
  const selectedHistoryPageState = selectedChatKey
    ? historyPageStateBySession[selectedChatKey]
    : undefined
  const sidebarRunStatusBySessionId = useMemo(() => {
    const next: Record<string, AgentRunStatus> = {}
    for (const session of sessions) {
      const targetKey = chatKey(projectPathForSession(session), session.id)
      if (runStatusBySession[targetKey] === "working") {
        next[session.id] = "working"
      }
    }
    return next
  }, [projectPathForSession, runStatusBySession, sessions])
  const unreadCompletedSessionIdSet = useMemo(
    () => unreadCompletedSessionIds,
    [unreadCompletedSessionIds]
  )
  const markSessionViewed = useCallback((sessionId: string) => {
    if (!sessionId) {
      return
    }
    setUnreadCompletedSessionIds((current) => {
      if (!current.has(sessionId)) {
        return current
      }
      const next = new Set(current)
      next.delete(sessionId)
      return next
    })
  }, [])
  const markSessionCompletionVisibility = useCallback(
    (sessionId: string, isFullyVisible: boolean) => {
      if (!sessionId || isFullyVisible) {
        return
      }
      setUnreadCompletedSessionIds((current) => {
        if (current.has(sessionId)) {
          return current
        }
        const next = new Set(current)
        next.add(sessionId)
        return next
      })
    },
    []
  )
  const createAppStateSnapshot = useCallback(
    (nextSettings: AppSettings = settings): InitialAppState => ({
      schemaVersion: APP_STATE_SCHEMA_VERSION,
      settings: nextSettings,
      sessions,
      projects,
      shellLayout: {
        sidebarWidth,
        isSidebarCollapsed,
        sidebarSectionOrder,
      },
      windowState: initialState.windowState,
      expandedProjectIds: expandedProjectIds.filter((projectId) =>
        projects.some((project) => project.id === projectId)
      ),
      selectedSessionId: selectedSession?.id ?? "",
    }),
    [
      expandedProjectIds,
      initialState.windowState,
      isSidebarCollapsed,
      projects,
      selectedSession?.id,
      sessions,
      settings,
      sidebarSectionOrder,
      sidebarWidth,
    ]
  )
  const handleSettingsChange = useCallback(
    (nextSettings: AppSettings) => {
      const normalizedSettings = normalizeOusiaAppSettings(nextSettings)
      setSettings(normalizedSettings)
      if (isAppStateLoaded) {
        void saveAppState(createAppStateSnapshot(normalizedSettings))
      }
    },
    [createAppStateSnapshot, isAppStateLoaded]
  )
  const flushPendingChatEvents = useCallback(() => {
    pendingChatEventsFrameRef.current = 0
    const pendingEvents = pendingChatEventsRef.current
    if (!pendingEvents.size) {
      return
    }

    pendingChatEventsRef.current = new Map()
    setItemsBySession((current) => {
      let nextBySession = current
      for (const [targetKey, events] of pendingEvents) {
        let nextItems = current[targetKey] ?? []
        for (const event of events) {
          nextItems = applyChatEvent(nextItems, event)
        }
        if (nextItems !== current[targetKey]) {
          if (nextBySession === current) {
            nextBySession = { ...current }
          }
          nextBySession[targetKey] = nextItems
        }
      }
      return nextBySession
    })
  }, [])
  const queueChatItemEvent = useCallback(
    (targetKey: string, event: OusiaChatEvent) => {
      const pendingEvents = pendingChatEventsRef.current
      const targetEvents = pendingEvents.get(targetKey)
      if (targetEvents) {
        const previousEvent = targetEvents[targetEvents.length - 1]
        if (
          isTextDeltaEvent(event) &&
          canMergeTextDeltaEvents(previousEvent, event)
        ) {
          targetEvents[targetEvents.length - 1] = {
            ...event,
            delta: previousEvent.delta + event.delta,
          } as TextDeltaChatEvent
          return
        }
        targetEvents.push(event)
      } else {
        pendingEvents.set(targetKey, [event])
      }
      if (pendingChatEventsFrameRef.current) {
        return
      }
      pendingChatEventsFrameRef.current =
        window.requestAnimationFrame(flushPendingChatEvents)
    },
    [flushPendingChatEvents]
  )

  useEffect(() => {
    let isCancelled = false
    void loadInitialAppState().then((state) => {
      if (isCancelled) {
        return
      }
      isApplyingStoredThemeRef.current = true
      setSettings(state.settings)
      setTheme(state.settings.theme)
      setSidebarWidth(state.shellLayout.sidebarWidth)
      setIsSidebarCollapsed(state.shellLayout.isSidebarCollapsed)
      setSidebarSectionOrder(
        normalizeSidebarSectionOrder(state.shellLayout.sidebarSectionOrder)
      )
      setProjects(state.projects)
      setExpandedProjectIds(state.expandedProjectIds)
      setSessions(state.sessions)
      setSelectedSessionId(state.selectedSessionId)
      setIsAppStateLoaded(true)
    })
    return () => {
      isCancelled = true
    }
  }, [setTheme])

  useEffect(() => {
    if (!window.ousia) {
      return
    }
    let isCancelled = false
    void window.ousia.listModels().then((registry) => {
      if (!isCancelled) {
        setModelRegistry(registry)
      }
    })
    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!modelRegistry) {
      return
    }
    const providerModels = modelsForProvider(modelRegistry, settings.modelProvider)
    if (!providerModels.length) {
      return
    }
    if (providerModels.some((model) => model.modelId === settings.modelId)) {
      return
    }
    const nextSettings = normalizeOusiaAppSettings({
      ...settings,
      modelId: providerModels[0].modelId,
    })
    queueMicrotask(() => handleSettingsChange(nextSettings))
  }, [handleSettingsChange, modelRegistry, settings])

  useEffect(() => {
    if (!isAppStateLoaded) {
      return
    }
    if (isApplyingStoredThemeRef.current) {
      if (settings.theme === theme) {
        isApplyingStoredThemeRef.current = false
      }
      return
    }
    if (settings.theme === theme) {
      return
    }
    queueMicrotask(() => {
      setSettings((current) => ({
        ...current,
        theme,
      }))
    })
  }, [isAppStateLoaded, settings.theme, theme])

  useEffect(() => {
    document.documentElement.dataset.radixColorScale =
      settings.appearanceColorScale
  }, [settings.appearanceColorScale])

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--font-sans-default",
      resolveOusiaFontFamilyValue(settings.appFontFamily)
    )
  }, [settings.appFontFamily])

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--ousia-chat-font-family",
      resolveOusiaFontFamilyValue(settings.chatFontFamily)
    )
  }, [settings.chatFontFamily])

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--ousia-chat-content-max-width",
      resolveOusiaChatContentWidthValue(settings.chatContentWidth)
    )
  }, [settings.chatContentWidth])

  useEffect(() => {
    if (!isAppStateLoaded) {
      return
    }
    if (isShellResizing) {
      return
    }
    void saveAppState(createAppStateSnapshot())
  }, [createAppStateSnapshot, isAppStateLoaded, isShellResizing])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    runStatusBySessionRef.current = runStatusBySession
  }, [runStatusBySession])

  useEffect(() => {
    itemsBySessionRef.current = itemsBySession
  }, [itemsBySession])

  useEffect(() => {
    historyPageStateBySessionRef.current = historyPageStateBySession
  }, [historyPageStateBySession])

  useEffect(() => {
    selectedChatKeyRef.current = selectedChatKey
  }, [selectedChatKey])

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])

  useEffect(() => {
    isSettingsOpenRef.current = isSettingsOpen
  }, [isSettingsOpen])

  useEffect(() => {
    if (!selectedChatKey || selectedItems.length > 0) {
      return
    }
    const status = selectedHistoryPageState?.status
    if (status !== "ready" && status !== "error") {
      return
    }
    setHistoryPageStateBySession((current) => {
      if (current[selectedChatKey]?.status !== status) {
        return current
      }
      const next = { ...current }
      delete next[selectedChatKey]
      return next
    })
  }, [selectedChatKey, selectedHistoryPageState?.status, selectedItems.length])

  useEffect(() => {
    const inconsistentKeys = Object.entries(historyPageStateBySession)
      .filter(([key, state]) => {
        if (state.status !== "empty" && state.status !== "error") {
          return false
        }
        return Boolean(itemsBySession[key]?.length)
      })
      .map(([key]) => key)
    if (!inconsistentKeys.length) {
      return
    }
    setHistoryPageStateBySession((current) => {
      let next = current
      for (const key of inconsistentKeys) {
        const state = current[key]
        if (
          (state?.status === "empty" || state?.status === "error") &&
          itemsBySession[key]?.length
        ) {
          if (next === current) {
            next = { ...current }
          }
          delete next[key]
        }
      }
      return next
    })
  }, [historyPageStateBySession, itemsBySession])

  useEffect(() => {
    if (
      !window.ousia ||
      !selectedSessionIdForHistory ||
      !selectedChatKey
    ) {
      return
    }
    const historyKey = selectedChatKey
    const historyProjectPath = selectedProjectPath
    const historySessionId = selectedSessionIdForHistory
    const pageState = historyPageStateBySessionRef.current[historyKey]
    const hasLoadedItems = Boolean(itemsBySessionRef.current[historyKey]?.length)
    if (
      (draftSessionKeysRef.current.has(historyKey) && !hasLoadedItems) ||
      historyInFlightKeysRef.current.has(historyKey) ||
      pageState?.status === "loading-initial" ||
      pageState?.status === "loading-older" ||
      pageState?.status === "empty" ||
      pageState?.status === "error" ||
      hasLoadedItems
    ) {
      return
    }

    historyInFlightKeysRef.current.add(historyKey)
    queueMicrotask(() => {
      setHistoryPageStateBySession((current) => ({
        ...current,
        [historyKey]: {
          hasMore: false,
          status: "loading-initial",
        },
      }))
      void window.ousia
        ?.getChatHistory({
          includeToolPayloads: false,
          limit: CHAT_HISTORY_PAGE_SIZE,
          projectPath: historyProjectPath,
          sessionId: historySessionId,
        })
        .then((history) => {
          startTransition(() => {
            setItemsBySession((current) => ({
              ...current,
              [historyKey]: mergePersistedChatItems(
                current[historyKey] ?? [],
                history.items
              ),
            }))
            setHistoryPageStateBySession((current) => ({
              ...current,
              [historyKey]: historyPageStateFromResult(history.items, history),
            }))
          })
        })
        .catch(() => {
          setHistoryPageStateBySession((current) => ({
            ...current,
            [historyKey]: {
              error: "会话历史加载失败。",
              hasMore: false,
              status: "error",
            },
          }))
        })
        .finally(() => {
          historyInFlightKeysRef.current.delete(historyKey)
        })
    })
  }, [
    selectedProjectPath,
    selectedChatKey,
    selectedHistoryPageState?.status,
    selectedItems.length,
    selectedSessionIdForHistory,
  ])

  useEffect(() => {
    return window.ousia?.onChatEvent((event) => {
      const targetSession = sessionsRef.current.find(
        (session) => session.id === event.context?.sessionId
      )
      const targetKey =
        targetSession && event.context
          ? chatKey(event.context.projectPath, targetSession.id)
          : selectedChatKeyRef.current
      if (!targetKey) {
        return
      }
      if (event.type === "user_message") {
        draftSessionKeysRef.current.delete(targetKey)
        setHistoryPageStateBySession((current) => {
          if (!current[targetKey]) {
            return current
          }
          const next = { ...current }
          delete next[targetKey]
          return next
        })
      }
      if (event.type === "run_status") {
        const nextStatus =
          event.status === "starting" || event.status === "running"
            ? "working"
            : "idle"
        const wasWorking = runStatusBySessionRef.current[targetKey] === "working"
        setRunStatusBySession((current) => ({
          ...current,
          [targetKey]: nextStatus,
        }))
        runStatusBySessionRef.current = {
          ...runStatusBySessionRef.current,
          [targetKey]: nextStatus,
        }
        if (
          targetSession &&
          wasWorking &&
          nextStatus === "idle" &&
          (event.status === "finished" || event.status === "error")
        ) {
          const canMeasureSelectedSession =
            selectedSessionIdRef.current === targetSession.id &&
            !isSettingsOpenRef.current
          if (!canMeasureSelectedSession) {
            setUnreadCompletedSessionIds((current) => {
              if (current.has(targetSession.id)) {
                return current
              }
              const next = new Set(current)
              next.add(targetSession.id)
              return next
            })
          }
        }
      }
      if (event.type === "queue_update") {
        setQueuedChatStateBySession((current) => ({
          ...current,
          [targetKey]: {
            steering: event.steering,
            followUp: event.followUp,
          },
        }))
        return
      }
      if (event.type === "context_usage") {
        setContextUsageBySession((current) => ({
          ...current,
          [targetKey]: {
            tokens: event.tokens,
            contextWindow: event.contextWindow,
            percent: event.percent,
          },
        }))
        return
      }
      if (
        targetSession &&
        (event.type === "user_message" ||
          event.type === "assistant_text_end" ||
          event.type === "error")
      ) {
        setSessions((current) =>
          moveSessionToGroupFront(current, targetSession.id, event.timestamp)
        )
      }
      queueChatItemEvent(targetKey, event)
    })
  }, [queueChatItemEvent])

  useEffect(() => {
    return () => {
      if (pendingChatEventsFrameRef.current) {
        window.cancelAnimationFrame(pendingChatEventsFrameRef.current)
      }
      if (sidebarResizeFrameRef.current) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current)
      }
      pendingChatEventsRef.current = new Map()
    }
  }, [])

  useEffect(() => {
    let isCancelled = false
    void window.ousia?.getWindowFullscreenState().then((event) => {
      if (!isCancelled) {
        setIsWindowFullscreen(event.isFullscreen)
      }
    })
    const unsubscribe = window.ousia?.onWindowFullscreenChange((event) => {
      setIsWindowFullscreen(event.isFullscreen)
    })
    return () => {
      isCancelled = true
      unsubscribe?.()
    }
  }, [])

  const showZoomIndicator = useCallback((zoomPercent: number) => {
    setZoomIndicatorPercent(zoomPercent)
    if (zoomIndicatorTimerRef.current) {
      globalThis.clearTimeout(zoomIndicatorTimerRef.current)
    }
    zoomIndicatorTimerRef.current = globalThis.setTimeout(() => {
      setZoomIndicatorPercent(null)
      zoomIndicatorTimerRef.current = null
    }, 1200)
  }, [])

  useEffect(() => {
    const unsubscribe = window.ousia?.onWindowZoomChange((event) => {
      showZoomIndicator(event.zoomPercent)
    })
    return () => {
      unsubscribe?.()
      if (zoomIndicatorTimerRef.current) {
        window.clearTimeout(zoomIndicatorTimerRef.current)
        zoomIndicatorTimerRef.current = null
      }
    }
  }, [showZoomIndicator])

  function appendLocalEvent(event: OusiaChatEvent) {
    if (!selectedChatKey) {
      return
    }
    if (event.type === "user_message") {
      draftSessionKeysRef.current.delete(selectedChatKey)
      setHistoryPageStateBySession((current) => {
        if (!current[selectedChatKey]) {
          return current
        }
        const next = { ...current }
        delete next[selectedChatKey]
        return next
      })
    }
    if (event.type === "run_status") {
      const nextStatus =
        event.status === "starting" || event.status === "running"
          ? "working"
          : "idle"
      setRunStatusBySession((current) => ({
        ...current,
        [selectedChatKey]: nextStatus,
      }))
      runStatusBySessionRef.current = {
        ...runStatusBySessionRef.current,
        [selectedChatKey]: nextStatus,
      }
    }
    if (event.type === "queue_update") {
      setQueuedChatStateBySession((current) => ({
        ...current,
        [selectedChatKey]: {
          steering: event.steering,
          followUp: event.followUp,
        },
      }))
      return
    }
    if (event.type === "context_usage") {
      setContextUsageBySession((current) => ({
        ...current,
        [selectedChatKey]: {
          tokens: event.tokens,
          contextWindow: event.contextWindow,
          percent: event.percent,
        },
      }))
      return
    }
    setItemsBySession((current) => ({
      ...current,
      [selectedChatKey]: applyChatEvent(current[selectedChatKey] ?? [], event),
    }))
  }

  const handleLoadOlderHistory = useCallback(async () => {
    if (!window.ousia || !selectedSession || !selectedChatKey) {
      return
    }
    const pageState = historyPageStateBySession[selectedChatKey]
    const currentItems = itemsBySession[selectedChatKey] ?? []
    const beforeItemId = pageState?.cursor ?? currentItems[0]?.id
    if (
      !beforeItemId ||
      !pageState?.hasMore ||
      pageState.status === "loading-initial" ||
      pageState.status === "loading-older"
    ) {
      return
    }

    setHistoryPageStateBySession((current) => ({
      ...current,
      [selectedChatKey]: {
        ...pageState,
        status: "loading-older",
      },
    }))

    try {
      const history = await window.ousia.getChatHistory({
        beforeItemId,
        includeToolPayloads: false,
        limit: CHAT_HISTORY_PAGE_SIZE,
        projectPath: selectedProjectPath,
        sessionId: selectedSession.id,
      })
      startTransition(() => {
        setItemsBySession((current) => {
          const existingItems = current[selectedChatKey] ?? []
          const existingIds = new Set(existingItems.map((item) => item.id))
          const olderItems = history.items.filter(
            (item) => !existingIds.has(item.id)
          )
          if (!olderItems.length) {
            return current
          }
          return {
            ...current,
            [selectedChatKey]: [...olderItems, ...existingItems],
          }
        })
        setHistoryPageStateBySession((current) => ({
          ...current,
          [selectedChatKey]: history.items.length
            ? historyPageStateFromResult(history.items, history)
            : {
                ...pageState,
                hasMore: false,
                status: "ready",
              },
        }))
      })
    } catch (error) {
      setHistoryPageStateBySession((current) => ({
        ...current,
        [selectedChatKey]: {
          ...pageState,
          error: error instanceof Error ? error.message : String(error),
          status: "ready",
        },
      }))
    }
  }, [
    historyPageStateBySession,
    itemsBySession,
    selectedProjectPath,
    selectedChatKey,
    selectedSession,
  ])

  async function handleOpenProject() {
    if (!window.ousia) {
      const rawPath = window.prompt(t.shell.projectPathPrompt)
      if (!rawPath) {
        return
      }
      addProject(rawPath, projectNameFromPath(rawPath))
      return
    }
    const result = await window.ousia.openProjectDirectory({
      defaultPath: settings.defaultWorkDir,
    })
    if (result.canceled) {
      return
    }
    addProject(result.path, result.name)
  }

  function addProject(path: string, name: string) {
    const existing = projects.find((project) => project.path === path)
    if (existing) {
      selectOrCreateProjectSession(existing)
      setIsSettingsOpen(false)
      return
    }
    const project = createProject(path, name)
    setProjects((current) => [...current, project])
    setExpandedProjectIds((current) => [...current, project.id])
    createProjectSession(project.id, project.path)
    setIsSettingsOpen(false)
  }

  function handleCreateSession() {
    const session = createSession(t.app.newSession)
    const targetKey = chatKey(settings.defaultWorkDir, session.id)
    draftSessionKeysRef.current.add(targetKey)
    setSessions((current) => [session, ...current])
    setItemsBySession((current) => {
      const next = { ...current }
      delete next[targetKey]
      return next
    })
    setHistoryPageStateBySession((current) => {
      const next = { ...current }
      delete next[targetKey]
      return next
    })
    setSelectedSessionId(session.id)
    setSidebarScrollTargetSessionId(session.id)
    setIsSettingsOpen(false)
  }

  function createProjectSession(projectId: string, explicitProjectPath?: string) {
    const session = { ...createSession(t.app.newSession), projectId }
    const projectPath =
      explicitProjectPath ??
      projects.find((project) => project.id === projectId)?.path ??
      settings.defaultWorkDir
    const targetKey = chatKey(projectPath, session.id)
    draftSessionKeysRef.current.add(targetKey)
    setSessions((current) => [session, ...current])
    setItemsBySession((current) => {
      const next = { ...current }
      delete next[targetKey]
      return next
    })
    setHistoryPageStateBySession((current) => {
      const next = { ...current }
      delete next[targetKey]
      return next
    })
    setExpandedProjectIds((current) =>
      current.includes(projectId) ? current : [...current, projectId]
    )
    setSelectedSessionId(session.id)
    setSidebarScrollTargetSessionId(session.id)
  }

  function selectOrCreateProjectSession(project: ProjectRecord) {
    const existingSession = sessions.find(
      (session) => session.projectId === project.id
    )
    if (existingSession) {
      setExpandedProjectIds((current) =>
        current.includes(project.id) ? current : [...current, project.id]
      )
      setSelectedSessionId(existingSession.id)
      return
    }
    createProjectSession(project.id)
  }

  function handleDeleteProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId)
    if (!project) {
      return
    }

    const remaining = projects.filter((item) => item.id !== projectId)
    const removedSessions = sessions.filter(
      (session) => session.projectId === projectId
    )
    const remainingSessions = sessions.filter(
      (session) => session.projectId !== projectId
    )
    setProjects(remaining)
    setExpandedProjectIds((current) =>
      current.filter((item) => item !== projectId)
    )
    setSessions(remainingSessions)
    setItemsBySession((current) => {
      const next = { ...current }
      for (const session of removedSessions) {
        delete next[chatKey(project.path, session.id)]
      }
      return next
    })
    setHistoryPageStateBySession((current) => {
      const next = { ...current }
      for (const session of removedSessions) {
        delete next[chatKey(project.path, session.id)]
      }
      return next
    })
    setRunStatusBySession((current) => {
      const next = { ...current }
      for (const session of removedSessions) {
        delete next[chatKey(project.path, session.id)]
      }
      return next
    })
    for (const session of removedSessions) {
      draftSessionKeysRef.current.delete(chatKey(project.path, session.id))
    }
    setUnreadCompletedSessionIds((current) => {
      if (!removedSessions.some((session) => current.has(session.id))) {
        return current
      }
      const next = new Set(current)
      for (const session of removedSessions) {
        next.delete(session.id)
      }
      return next
    })

    if (selectedSession?.projectId === projectId) {
      const nextSession = remainingSessions[0]
      setSelectedSessionId(nextSession?.id ?? "")
      setIsSettingsOpen(false)
    }
  }

  function handleSelectSession(sessionId: string) {
    setSelectedSessionId(sessionId)
    setIsSettingsOpen(false)
  }

  function handleOpenSettings() {
    setIsSettingsOpen(true)
  }

  function handleRenameSession(sessionId: string, title: string) {
    const nextTitle = title.trim()
    if (!nextTitle) {
      return
    }
    setSessions((current) =>
      current.map((candidate) =>
        candidate.id === sessionId ? { ...candidate, title: nextTitle } : candidate
      )
    )
  }

  function handleReorderProjects(sourceProjectId: string, targetProjectId: string) {
    setProjects((current) =>
      reorderById(current, sourceProjectId, targetProjectId)
    )
  }

  function handleReorderSessions(sourceSessionId: string, targetSessionId: string) {
    setSessions((current) =>
      reorderSessionsById(current, sourceSessionId, targetSessionId)
    )
  }

  function handleReorderSidebarSections(
    sourceSectionId: OusiaSidebarSectionId,
    targetSectionId: OusiaSidebarSectionId
  ) {
    setSidebarSectionOrder((current) =>
      reorderById(
        normalizeSidebarSectionOrder(current).map((id) => ({ id })),
        sourceSectionId,
        targetSectionId
      ).map((item) => item.id)
    )
  }

  function handleGenerateSessionTitle(sessionId: string, firstPrompt: string) {
    if (!window.ousia || titleGenerationSessionIdsRef.current.has(sessionId)) {
      return
    }
    const apiKey = getOusiaModelProviderApiKey(settings)?.trim()
    if (!apiKey) {
      return
    }
    titleGenerationSessionIdsRef.current.add(sessionId)
    void window.ousia
      .generateChatTitle({
        prompt: firstPrompt,
        model: {
          provider: settings.modelProvider,
          modelId: settings.modelId,
          apiKey,
        },
      })
      .then((result) => {
        if (!result.ok) {
          console.warn(result.error)
          return
        }
        setSessions((current) =>
          current.map((candidate) =>
            candidate.id === sessionId &&
            isDefaultSessionTitle(candidate.title)
              ? { ...candidate, title: result.title }
              : candidate
          )
        )
      })
      .finally(() => {
        titleGenerationSessionIdsRef.current.delete(sessionId)
      })
  }

  async function handleBranchFromMessage(messageId: string) {
    if (!selectedSession || !selectedChatKey) {
      return
    }
    const branchIndex = selectedItems.findIndex((item) => item.id === messageId)
    if (branchIndex < 0) {
      return
    }

    const now = new Date().toISOString()
    const titleSuffix = settings.language === "zh" ? "分支" : "Fork"
    const branchSession = {
      ...createSession(`${selectedSession.title} · ${titleSuffix}`),
      projectId: selectedSession.projectId,
      time: now,
    }
    const branchItems: ChatItem[] = selectedItems
      .slice(0, branchIndex + 1)
      .map((item) => {
        if (item.role === "tool") {
          return { ...item }
        }
        const attachments = item.attachments?.map((attachment) => ({
          ...attachment,
        }))
        return attachments ? { ...item, attachments } : { ...item }
      })
    const branchKey = chatKey(selectedProjectPath, branchSession.id)
    const branchSourceItem = selectedItems[branchIndex]

    let resolvedBranchItems = branchItems
    if (window.ousia) {
      const result = await window.ousia
        .branchChat({
          projectPath: selectedProjectPath,
          sessionId: selectedSession.id,
          messageId,
          messageText:
            branchSourceItem.role === "assistant"
              ? branchSourceItem.text
              : undefined,
          targetSessionId: branchSession.id,
        })
        .catch((error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        }))
      if (!result.ok) {
        appendLocalEvent({
          type: "error",
          id: `branch-${Date.now()}`,
          text: result.error,
          timestamp: now,
        })
        return
      }
      resolvedBranchItems = result.items
    }

    setSessions((current) => [branchSession, ...current])
    setItemsBySession((current) => ({
      ...current,
      [branchKey]: resolvedBranchItems,
    }))
    if (branchSession.projectId) {
      setExpandedProjectIds((current) =>
        current.includes(branchSession.projectId!)
          ? current
          : [...current, branchSession.projectId!]
      )
    }
    setSelectedSessionId(branchSession.id)
    setSidebarScrollTargetSessionId(branchSession.id)
    setIsSettingsOpen(false)
  }

  function handleDeleteSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId)
    if (!session) {
      return
    }
    const targetKey = chatKey(projectPathForSession(session), sessionId)
    const remaining = sessions.filter((item) => item.id !== sessionId)
    setSessions(remaining)
    setItemsBySession((current) => {
      const next = { ...current }
      delete next[targetKey]
      return next
    })
    setHistoryPageStateBySession((current) => {
      const next = { ...current }
      delete next[targetKey]
      return next
    })
    draftSessionKeysRef.current.delete(targetKey)
    setRunStatusBySession((current) => {
      const next = { ...current }
      delete next[targetKey]
      return next
    })
    setUnreadCompletedSessionIds((current) => {
      if (!current.has(sessionId)) {
        return current
      }
      const next = new Set(current)
      next.delete(sessionId)
      return next
    })
    if (selectedSessionId === sessionId) {
      const nextSession = remaining[0]
      setSelectedSessionId(nextSession?.id ?? "")
    }
  }

  function getShellWidth() {
    return shellRef.current?.getBoundingClientRect().width ?? window.innerWidth
  }

  const preferredSidebarWidth = isSidebarCollapsed ? 0 : sidebarWidth
  const effectiveSidebarWidth = preferredSidebarWidth

  function beginSidebarResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const resizeTarget = event.currentTarget
    resizeTarget.setPointerCapture(event.pointerId)
    setActiveShellResizeHandle("sidebar")
    const startX = event.clientX
    const startSidebarWidth = sidebarWidth
    const shellWidth = getShellWidth()
    let pendingSidebarWidth = startSidebarWidth
    let isStopped = false

    function commitSidebarWidth(nextSidebarWidth: number) {
      pendingSidebarWidth = nextSidebarWidth
      if (sidebarResizeFrameRef.current) {
        return
      }
      sidebarResizeFrameRef.current = window.requestAnimationFrame(() => {
        sidebarResizeFrameRef.current = 0
        sidebarShellRef.current?.style.setProperty(
          "--ousia-sidebar-live-width",
          `${pendingSidebarWidth}px`
        )
      })
    }

    function stopSidebarResize() {
      if (isStopped) {
        return
      }
      isStopped = true
      if (resizeTarget.hasPointerCapture(event.pointerId)) {
        resizeTarget.releasePointerCapture(event.pointerId)
      }
      if (sidebarResizeFrameRef.current) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current)
        sidebarResizeFrameRef.current = 0
      }
      sidebarShellRef.current?.style.setProperty(
        "--ousia-sidebar-live-width",
        `${pendingSidebarWidth}px`
      )
      setSidebarWidth(pendingSidebarWidth)
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
      window.removeEventListener("blur", handlePointerUp)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      resizeTarget.removeEventListener("lostpointercapture", handlePointerUp)
      setActiveShellResizeHandle(null)
    }

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const rawSidebarWidth = startSidebarWidth + moveEvent.clientX - startX
      if (rawSidebarWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
        setIsSidebarCollapsed(true)
        stopSidebarResize()
        return
      }

      const maxSidebarWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        shellWidth - MIN_CHAT_WIDTH - RESIZE_HANDLE_WIDTH
      )
      const nextSidebarWidth = clamp(
        rawSidebarWidth,
        MIN_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, maxSidebarWidth)
      )
      commitSidebarWidth(nextSidebarWidth)
    }

    function handlePointerUp() {
      stopSidebarResize()
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        stopSidebarResize()
      }
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
    window.addEventListener("pointercancel", handlePointerUp, { once: true })
    window.addEventListener("blur", handlePointerUp, { once: true })
    document.addEventListener("visibilitychange", handleVisibilityChange)
    resizeTarget.addEventListener("lostpointercapture", handlePointerUp, {
      once: true,
    })
  }

  const expandSidebar = useCallback(() => {
    setIsSidebarCollapsed(false)
  }, [])

  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "b" ||
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return
      }
      event.preventDefault()
      if (isSidebarCollapsed) {
        expandSidebar()
        return
      }
      setIsSidebarCollapsed(true)
    }

    window.addEventListener("keydown", handleGlobalKeyDown)
    return () => window.removeEventListener("keydown", handleGlobalKeyDown)
  }, [expandSidebar, isSidebarCollapsed])

  return (
    <main
      ref={shellRef}
      data-shell-resizing={isShellResizing ? "true" : undefined}
      className="relative flex h-screen min-h-screen w-screen min-w-0 overflow-hidden rounded-[var(--ousia-window-radius)] bg-background text-foreground"
    >
      <div
        aria-hidden={zoomIndicatorPercent === null}
        aria-live="polite"
        className={[
          "pointer-events-none fixed top-3 right-3 z-50 rounded-md border border-foreground/10 bg-popover/92 px-3 py-1.5 text-sm font-medium tabular-nums text-popover-foreground shadow-lg backdrop-blur transition-all duration-150",
          zoomIndicatorPercent === null
            ? "translate-y-1 opacity-0"
            : "translate-y-0 opacity-100",
        ].join(" ")}
      >
        {zoomIndicatorPercent ?? 100}%
      </div>
      {isSidebarCollapsed ? null : (
        <div
          ref={sidebarShellRef}
          className="relative z-0 flex shrink-0 overflow-hidden"
          style={
            {
              "--ousia-sidebar-live-width": `${effectiveSidebarWidth}px`,
            } as CSSProperties
          }
        >
          <Sidebar
            onCreateProjectSession={createProjectSession}
            onCreateSession={handleCreateSession}
            onDeleteProject={handleDeleteProject}
            onDeleteSession={handleDeleteSession}
            onOpenProject={handleOpenProject}
            onOpenSettings={handleOpenSettings}
            onRenameSession={handleRenameSession}
            onReorderProjects={handleReorderProjects}
            onReorderSidebarSections={handleReorderSidebarSections}
            onReorderSessions={handleReorderSessions}
            onSelectSession={handleSelectSession}
            onScrollTargetHandled={() => setSidebarScrollTargetSessionId("")}
            expandedProjectIds={expandedProjectIds}
            onExpandedProjectIdsChange={setExpandedProjectIds}
            projects={projects}
            selectedSessionId={selectedSession?.id ?? ""}
            sidebarSectionOrder={sidebarSectionOrder}
            scrollTargetSessionId={sidebarScrollTargetSessionId}
            sessionRunStatusById={sidebarRunStatusBySessionId}
            unreadCompletedSessionIds={unreadCompletedSessionIdSet}
            sessions={sessions}
            language={settings.language}
            style={{ width: "var(--ousia-sidebar-live-width)" }}
          />
          <ResizeHandle
            isActive={activeShellResizeHandle === "sidebar"}
            label={t.shell.resizeSidebar}
            onPointerDown={beginSidebarResize}
          />
        </div>
      )}
      <div className="relative z-20 min-w-0 flex-1 bg-sidebar">
        <div className="flex h-full min-w-0 overflow-visible">
          {isSettingsOpen ? (
            <SettingsPage
              isSidebarCollapsed={isSidebarCollapsed}
              isWindowFullscreen={isWindowFullscreen}
              modelRegistry={modelRegistry}
              settings={settings}
              onClose={() => setIsSettingsOpen(false)}
              onSettingsChange={handleSettingsChange}
            />
          ) : (
            <ChatArea
              currentProject={selectedSession ? currentProject : undefined}
              currentSession={selectedSession}
              items={selectedItems}
              isAgentWorking={
                selectedChatKey
                  ? runStatusBySession[selectedChatKey] === "working"
                  : false
              }
              isSidebarCollapsed={isSidebarCollapsed}
              isWindowFullscreen={isWindowFullscreen}
              onLocalEvent={appendLocalEvent}
              onGenerateSessionTitle={handleGenerateSessionTitle}
              onBranchFromMessage={handleBranchFromMessage}
              onLoadOlderHistory={handleLoadOlderHistory}
              onSessionCompletionVisibility={markSessionCompletionVisibility}
              onSessionViewed={markSessionViewed}
              hasMoreHistory={Boolean(selectedHistoryPageState?.hasMore)}
              isLoadingHistory={
                selectedHistoryPageState?.status === "loading-initial"
              }
              isLoadingOlderHistory={
                selectedHistoryPageState?.status === "loading-older"
              }
              contextUsage={selectedContextUsage}
              onSettingsChange={handleSettingsChange}
              modelRegistry={modelRegistry}
              queuedChatState={selectedQueuedChatState}
              settings={settings}
              language={settings.language}
              style={{ flex: "1 1 0", width: "auto" }}
            />
          )}
        </div>
      </div>
      <TitleBarSidebarToggle
        className="absolute top-0 left-4 z-50"
        isFullscreen={isWindowFullscreen}
        label={isSidebarCollapsed ? t.chat.expandSidebar : t.sidebar.collapse}
        onClick={
          isSidebarCollapsed ? expandSidebar : () => setIsSidebarCollapsed(true)
        }
      />
    </main>
  )
}

export default App
