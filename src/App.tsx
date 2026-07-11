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
  createDefaultAppState,
  createProject,
  createSession,
  loadInitialAppState,
  projectNameFromPath,
  type AppSettings,
  type InitialAppState,
  type ProjectRecord,
  type SessionRecord,
} from "@/app/app-state"
import {
  chatKey,
  findWorkingChatSession,
  resolveChatEventTarget,
} from "@/app/chat-event-routing"
import {
  shouldResetEmptyChatHistory,
  shouldRetryChatHistoryAfterSelection,
  shouldScheduleAutomaticChatHistoryRetry,
} from "@/app/chat-history-state"
import {
  normalizeOusiaAppSettings,
  resolveOusiaChatContentWidthValue,
  resolveOusiaFontFamilyValue,
  type OusiaAppStateTransactionResult,
  type OusiaChatEvent,
  type OusiaCodexEnvironmentStatus,
  type OusiaModelRegistryResult,
  type OusiaSidebarSectionId,
  type OusiaUpdateStatus,
} from "@/electron/chat-types"
import { getMessages, isDefaultSessionTitle } from "@/app/i18n"
import { getConfiguredModelPresets } from "@/app/model-presets"
import { ChatArea } from "@/features/chat/ChatArea"
import { applyChatEvent, type ChatItem } from "@/features/chat/chat-events"
import type { SettingsSectionId } from "@/features/settings/settings-navigation"
import { SettingsPage } from "@/features/settings/SettingsPage"
import { SettingsSidebar } from "@/features/settings/SettingsSidebar"
import { TitleBarSidebarToggle } from "@/features/shell/TitleBarTrafficLightSlot"
import { Sidebar } from "@/features/sidebar/Sidebar"
import { useStableEvent } from "@/lib/use-stable-event"

const MIN_SIDEBAR_WIDTH = 200
const SIDEBAR_COLLAPSE_THRESHOLD = 120
const MAX_SIDEBAR_WIDTH = 320
const MIN_CHAT_WIDTH = 300
const RESIZE_HANDLE_WIDTH = 1
const CHAT_HISTORY_PAGE_SIZE = 20
const SIDEBAR_STYLE = { width: "var(--ousia-sidebar-live-width)" }
const MAIN_PANEL_STYLE = { flex: "1 1 0", width: "auto" }

type AgentRunStatus = "idle" | "working"
type ShellResizeHandle = "sidebar"
type QueuedChatState = {
  steering: string[]
  followUp: string[]
}
type MoveSessionTarget = {
  sessionId: string
  targetProjectId?: string
  targetSessionId?: string
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
  status: "loading-initial" | "ready" | "loading-older" | "empty" | "error"
  totalItems?: number
}
type TextDeltaChatEvent = Extract<
  OusiaChatEvent,
  { type: "assistant_text_delta" | "thinking_delta" }
>
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function projectPathForAppStateSession(
  state: InitialAppState,
  session: SessionRecord
) {
  if (!session.projectId) {
    return state.settings.defaultSessionDir
  }
  return (
    state.projects.find((project) => project.id === session.projectId)?.path ??
    state.settings.defaultSessionDir
  )
}

function moveRecordKey<T>(
  record: Record<string, T>,
  sourceKey: string,
  targetKey: string
) {
  if (
    sourceKey === targetKey ||
    !Object.prototype.hasOwnProperty.call(record, sourceKey)
  ) {
    return record
  }
  const next = { ...record }
  next[targetKey] = record[sourceKey]
  delete next[sourceKey]
  return next
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
  const sourceSession = sessions.find(
    (session) => session.id === sourceSessionId
  )
  const targetSession = sessions.find(
    (session) => session.id === targetSessionId
  )
  if (
    !sourceSession ||
    !targetSession ||
    sourceSession.projectId !== targetSession.projectId
  ) {
    return sessions
  }
  return reorderById(sessions, sourceSessionId, targetSessionId)
}

function withSessionProjectId(
  session: SessionRecord,
  projectId: string | undefined
) {
  if (!projectId) {
    const { projectId: _projectId, ...defaultSession } = session
    void _projectId
    return defaultSession
  }
  return { ...session, projectId }
}

function moveSessionToProjectGroup(
  sessions: SessionRecord[],
  sessionId: string,
  targetProjectId: string | undefined,
  targetSessionId?: string
) {
  const sourceSession = sessions.find((session) => session.id === sessionId)
  if (!sourceSession) {
    return sessions
  }

  const normalizedTargetProjectId = targetProjectId || undefined
  const targetSession = targetSessionId
    ? sessions.find((session) => session.id === targetSessionId)
    : undefined
  const canInsertAtTarget =
    Boolean(targetSession) &&
    targetSession?.id !== sessionId &&
    (targetSession?.projectId || undefined) === normalizedTargetProjectId
  if (
    (sourceSession.projectId || undefined) === normalizedTargetProjectId &&
    !canInsertAtTarget
  ) {
    return sessions
  }

  const movedSession = withSessionProjectId(
    sourceSession,
    normalizedTargetProjectId
  )
  const remainingSessions = sessions.filter(
    (session) => session.id !== sessionId
  )
  const targetIndex = canInsertAtTarget
    ? remainingSessions.findIndex((session) => session.id === targetSessionId)
    : -1
  const groupStartIndex = remainingSessions.findIndex(
    (session) => (session.projectId || undefined) === normalizedTargetProjectId
  )
  const insertIndex =
    targetIndex >= 0 ? targetIndex : groupStartIndex >= 0 ? groupStartIndex : 0
  const next = [...remainingSessions]
  next.splice(insertIndex, 0, movedSession)
  return next
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
  const remainingSessions = sessions.filter(
    (session) => session.id !== sessionId
  )
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
            : "w-px bg-transparent group-focus-within/resize:bg-ring/70 group-hover/resize:w-1 group-hover/resize:bg-ring/70"
        }`}
      />
      <div aria-hidden="true" className="window-drag relative h-10 shrink-0" />
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
  const [initialState] = useState<InitialAppState>(() =>
    createDefaultAppState()
  )
  const [isAppStateLoaded, setIsAppStateLoaded] = useState(!window.ousia)
  const [updateStatus, setUpdateStatus] = useState<OusiaUpdateStatus>({
    phase: "disabled",
    reason: "Updates are unavailable in the browser preview.",
  })
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
  const [zoomIndicatorPercent, setZoomIndicatorPercent] = useState<
    number | null
  >(null)
  const zoomIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const [settings, setSettings] = useState<AppSettings>(initialState.settings)
  const t = getMessages(settings.language)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>("general")
  const [modelRegistry, setModelRegistry] = useState<OusiaModelRegistryResult>()
  const [codexEnvironment, setCodexEnvironment] =
    useState<OusiaCodexEnvironmentStatus>()
  const [projects, setProjects] = useState<ProjectRecord[]>(
    initialState.projects
  )
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(
    initialState.expandedProjectIds
  )
  const [sessions, setSessions] = useState<SessionRecord[]>(
    initialState.sessions
  )
  const sessionsRef = useRef(sessions)
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
  const historyRetryAttemptsRef = useRef<Map<string, number>>(new Map())
  const historyRetryTimersRef = useRef<Map<string, number>>(new Map())
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

  const applyPersistentAppState = useCallback(
    (
      state: InitialAppState,
      options: {
        syncSettings?: boolean
        syncShellLayout?: boolean
        syncTheme?: boolean
      } = {}
    ) => {
      if (options.syncTheme) {
        isApplyingStoredThemeRef.current = true
        setTheme(state.settings.theme)
      }
      if (options.syncSettings !== false) {
        setSettings(state.settings)
      }
      if (options.syncShellLayout !== false) {
        setSidebarWidth(state.shellLayout.sidebarWidth)
        setIsSidebarCollapsed(state.shellLayout.isSidebarCollapsed)
        setSidebarSectionOrder(
          normalizeSidebarSectionOrder(state.shellLayout.sidebarSectionOrder)
        )
      }
      setProjects(state.projects)
      setExpandedProjectIds(state.expandedProjectIds)
      sessionsRef.current = state.sessions
      setSessions(state.sessions)
      setSelectedSessionId(state.selectedSessionId)
    },
    [setTheme]
  )

  const applyAppStateTransaction = useCallback(
    (result: OusiaAppStateTransactionResult) => {
      if (!result.ok) {
        console.warn(result.error)
        if (result.state) {
          applyPersistentAppState(result.state, {
            syncSettings: false,
            syncShellLayout: false,
          })
        }
        return false
      }
      applyPersistentAppState(result.state, {
        syncSettings: false,
        syncShellLayout: false,
      })
      return true
    },
    [applyPersistentAppState]
  )

  const projectPathForSession = useCallback(
    (session: SessionRecord) => {
      if (!session.projectId) {
        return settings.defaultSessionDir
      }
      return (
        projects.find((project) => project.id === session.projectId)?.path ??
        settings.defaultSessionDir
      )
    },
    [projects, settings.defaultSessionDir]
  )
  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? sessions[0]
  const visibleSurfaceAgentProvider = isSettingsOpen
    ? settings.defaultAgentProvider
    : selectedSession?.agentProvider
  const selectedSessionIdForHistory = selectedSession?.id
  const selectedProject = selectedSession?.projectId
    ? projects.find((project) => project.id === selectedSession.projectId)
    : undefined
  const selectedProjectPath = selectedSession
    ? projectPathForSession(selectedSession)
    : settings.defaultSessionDir
  const currentProject = useMemo<ProjectRecord>(
    () =>
      selectedProject ?? {
        id: "default-workdir",
        name: projectNameFromPath(settings.defaultSessionDir),
        path: selectedProjectPath,
      },
    [selectedProject, selectedProjectPath, settings.defaultSessionDir]
  )
  const selectedChatKey =
    currentProject && selectedSession
      ? chatKey(selectedProjectPath, selectedSession.id)
      : ""
  const selectedChatKeyRef = useRef(selectedChatKey)
  const previousHistorySelectionRef = useRef(selectedChatKey)
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
  const handleSettingsChange = useCallback(
    (nextSettings: AppSettings) => {
      const normalizedSettings = normalizeOusiaAppSettings(nextSettings)
      if (
        normalizedSettings.autoRetryOnFailure !== settings.autoRetryOnFailure
      ) {
        void window.ousia
          ?.savePiRetrySettings({
            autoRetryOnFailure: normalizedSettings.autoRetryOnFailure,
          })
          .then((result) => {
            if (!result.ok) {
              console.warn(result.error)
            }
          })
      }
      setSettings(normalizedSettings)
      if (isAppStateLoaded) {
        void window.ousia
          ?.saveAppSettings({ settings: normalizedSettings })
          .then((result) => {
            if (!result.ok) {
              console.warn(result.error)
            }
          })
      }
    },
    [isAppStateLoaded, settings.autoRetryOnFailure]
  )

  const refreshModelRegistry = useCallback(async () => {
    if (!window.ousia) {
      return undefined
    }
    const registry = await window.ousia.listModels()
    setModelRegistry(registry)
    return registry
  }, [])
  const refreshCodexEnvironment = useCallback(async () => {
    if (!window.ousia) {
      return undefined
    }
    const status = await window.ousia.checkCodexEnvironment()
    setCodexEnvironment(status)
    return status
  }, [])
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
      pendingChatEventsFrameRef.current = window.requestAnimationFrame(
        flushPendingChatEvents
      )
    },
    [flushPendingChatEvents]
  )

  useEffect(() => {
    if (!window.ousia) return
    void window.ousia.getUpdateStatus().then(setUpdateStatus)
    return window.ousia.onUpdateStatus(setUpdateStatus)
  }, [])

  const handleUpdateAction = useCallback(() => {
    if (!window.ousia) return
    if (updateStatus.phase === "downloaded") {
      void window.ousia.installUpdate()
      return
    }
    void window.ousia.downloadUpdate()
  }, [updateStatus.phase])

  useEffect(() => {
    let isCancelled = false
    void loadInitialAppState().then((state) => {
      if (isCancelled) {
        return
      }
      applyPersistentAppState(state, { syncTheme: true })
      setIsAppStateLoaded(true)
    })
    return () => {
      isCancelled = true
    }
  }, [applyPersistentAppState])

  useEffect(() => {
    if (!isAppStateLoaded || visibleSurfaceAgentProvider !== "pi") {
      return
    }
    void refreshModelRegistry()
  }, [isAppStateLoaded, refreshModelRegistry, visibleSurfaceAgentProvider])

  useEffect(() => {
    if (!isAppStateLoaded || visibleSurfaceAgentProvider !== "codex") {
      return
    }
    void refreshCodexEnvironment()
  }, [isAppStateLoaded, refreshCodexEnvironment, visibleSurfaceAgentProvider])

  useEffect(() => {
    if (!modelRegistry) {
      return
    }
    const configuredModelPresets = getConfiguredModelPresets(
      settings.modelProviders,
      modelRegistry,
      settings.disabledModelProviderIds
    )
    if (
      configuredModelPresets.some(
        (model) =>
          model.provider === settings.modelProvider &&
          model.modelId === settings.modelId
      )
    ) {
      return
    }
    const nextModel = configuredModelPresets[0]
    if (!nextModel) {
      return
    }
    const nextSettings = normalizeOusiaAppSettings({
      ...settings,
      modelProvider: nextModel.provider,
      modelId: nextModel.modelId,
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
      handleSettingsChange({
        ...settings,
        theme,
      })
    })
  }, [handleSettingsChange, isAppStateLoaded, settings, theme])

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
    void window.ousia
      ?.saveShellLayout({
        shellLayout: {
          isSidebarCollapsed,
          sidebarSectionOrder,
          sidebarWidth,
        },
      })
      .then((result) => {
        if (!result.ok) {
          console.warn(result.error)
        }
      })
  }, [
    isAppStateLoaded,
    isShellResizing,
    isSidebarCollapsed,
    sidebarSectionOrder,
    sidebarWidth,
  ])

  useEffect(() => {
    if (!isAppStateLoaded) {
      return
    }
    void window.ousia
      ?.saveAppSelection({
        expandedProjectIds: expandedProjectIds.filter((projectId) =>
          projects.some((project) => project.id === projectId)
        ),
        selectedSessionId: selectedSession?.id ?? "",
      })
      .then((result) => {
        if (!result.ok) {
          console.warn(result.error)
        }
      })
  }, [expandedProjectIds, isAppStateLoaded, projects, selectedSession?.id])

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
    if (!selectedChatKey) {
      return
    }
    const status = selectedHistoryPageState?.status
    if (!shouldResetEmptyChatHistory(status, selectedItems.length)) {
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
    const previousChatKey = previousHistorySelectionRef.current
    previousHistorySelectionRef.current = selectedChatKey
    if (previousChatKey !== selectedChatKey && selectedChatKey) {
      historyRetryAttemptsRef.current.delete(selectedChatKey)
      const retryTimer = historyRetryTimersRef.current.get(selectedChatKey)
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer)
        historyRetryTimersRef.current.delete(selectedChatKey)
      }
    }
    if (
      !shouldRetryChatHistoryAfterSelection(
        previousChatKey,
        selectedChatKey,
        selectedHistoryPageState?.status
      )
    ) {
      return
    }
    setHistoryPageStateBySession((current) => {
      if (current[selectedChatKey]?.status !== "error") {
        return current
      }
      const next = { ...current }
      delete next[selectedChatKey]
      return next
    })
  }, [selectedChatKey, selectedHistoryPageState?.status])

  useEffect(() => {
    const retryTimers = historyRetryTimersRef.current
    return () => {
      for (const timer of retryTimers.values()) {
        window.clearTimeout(timer)
      }
      retryTimers.clear()
    }
  }, [])

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
      !isAppStateLoaded ||
      !selectedSessionIdForHistory ||
      !selectedChatKey
    ) {
      return
    }
    const historyKey = selectedChatKey
    const historyProjectPath = selectedProjectPath
    const historySessionId = selectedSessionIdForHistory
    const pageState = historyPageStateBySessionRef.current[historyKey]
    const hasLoadedItems = Boolean(
      itemsBySessionRef.current[historyKey]?.length
    )
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
          historyRetryAttemptsRef.current.delete(historyKey)
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
        .catch((error: unknown) => {
          console.error("[chat.history] Failed to load session history", error)
          const errorMessage =
            error instanceof Error ? error.message : String(error)
          setHistoryPageStateBySession((current) => ({
            ...current,
            [historyKey]: {
              error: errorMessage,
              hasMore: false,
              status: "error",
            },
          }))
          const completedRetries =
            historyRetryAttemptsRef.current.get(historyKey) ?? 0
          if (shouldScheduleAutomaticChatHistoryRetry(completedRetries)) {
            historyRetryAttemptsRef.current.set(
              historyKey,
              completedRetries + 1
            )
            const retryTimer = window.setTimeout(() => {
              historyRetryTimersRef.current.delete(historyKey)
              setHistoryPageStateBySession((current) => {
                if (current[historyKey]?.status !== "error") {
                  return current
                }
                const next = { ...current }
                delete next[historyKey]
                return next
              })
            }, 750)
            historyRetryTimersRef.current.set(historyKey, retryTimer)
          }
        })
        .finally(() => {
          historyInFlightKeysRef.current.delete(historyKey)
        })
    })
  }, [
    isAppStateLoaded,
    selectedProjectPath,
    selectedChatKey,
    selectedHistoryPageState?.status,
    selectedItems.length,
    selectedSessionIdForHistory,
  ])

  useEffect(() => {
    return window.ousia?.onChatEvent((event) => {
      const target = resolveChatEventTarget(
        sessionsRef.current,
        event.context,
        selectedChatKeyRef.current
      )
      if (target.kind === "drop") {
        if (target.reason === "unknown-context-session") {
          console.warn(
            `[chat.event] Dropped event for an unknown session: ${JSON.stringify(
              {
                eventType: event.type,
                projectPath: target.context.projectPath,
                sessionId: target.context.sessionId,
              }
            )}`
          )
        }
        return
      }
      const targetKey = target.targetKey
      const targetSession =
        target.kind === "context" ? target.session : undefined
      if (event.type === "user_message") {
        draftSessionKeysRef.current.delete(targetKey)
      }
      if (event.type === "run_status") {
        const nextStatus =
          event.status === "starting" || event.status === "running"
            ? "working"
            : "idle"
        const wasWorking =
          runStatusBySessionRef.current[targetKey] === "working"
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
        void window.ousia
          ?.touchSession({
            sessionId: targetSession.id,
            time: event.timestamp,
          })
          .then((result) => {
            if (!result.ok) {
              console.warn(result.error)
            }
          })
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
    const target = resolveChatEventTarget(
      sessionsRef.current,
      event.context,
      selectedChatKeyRef.current
    )
    if (target.kind === "drop") {
      console.error("[chat.local-event] Dropped event", {
        eventType: event.type,
        reason: target.reason,
        ...(target.kind === "drop" && "context" in target
          ? { context: target.context }
          : {}),
      })
      return
    }
    const targetKey = target.targetKey
    const targetSession = target.kind === "context" ? target.session : undefined
    if (event.type === "user_message") {
      draftSessionKeysRef.current.delete(targetKey)
      if (targetSession) {
        setSessions((current) =>
          moveSessionToGroupFront(current, targetSession.id, event.timestamp)
        )
        void window.ousia
          ?.touchSession({
            sessionId: targetSession.id,
            time: event.timestamp,
          })
          .then((result) => {
            if (!result.ok) {
              console.warn(result.error)
            }
          })
      }
    }
    if (event.type === "run_status") {
      const nextStatus =
        event.status === "starting" || event.status === "running"
          ? "working"
          : "idle"
      setRunStatusBySession((current) => ({
        ...current,
        [targetKey]: nextStatus,
      }))
      runStatusBySessionRef.current = {
        ...runStatusBySessionRef.current,
        [targetKey]: nextStatus,
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
    setItemsBySession((current) => ({
      ...current,
      [targetKey]: applyChatEvent(current[targetKey] ?? [], event),
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
      await addProject(rawPath, projectNameFromPath(rawPath))
      return
    }
    const result = await window.ousia.openProjectDirectory({
      defaultPath: settings.defaultProjectCreationDir,
    })
    if (result.canceled) {
      return
    }
    await addProject(result.path, result.name)
  }

  async function addProject(path: string, name: string) {
    if (window.ousia) {
      const knownSessionIds = new Set(
        sessionsRef.current.map((session) => session.id)
      )
      const result = await window.ousia.createProject({
        name,
        path,
        selectOrCreateSession: true,
        sessionTitle: t.app.newSession,
      })
      if (!result.ok) {
        applyAppStateTransaction(result)
        return
      }
      applyAppStateTransaction(result)
      if (result.session && !knownSessionIds.has(result.session.id)) {
        const targetKey = chatKey(
          projectPathForAppStateSession(result.state, result.session),
          result.session.id
        )
        draftSessionKeysRef.current.add(targetKey)
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
      }
      if (result.session) {
        setSidebarScrollTargetSessionId(result.session.id)
      }
      setIsSettingsOpen(false)
      return
    }

    const existing = projects.find((project) => project.path === path)
    if (existing) {
      await selectOrCreateProjectSession(existing)
      setIsSettingsOpen(false)
      return
    }
    const project = createProject(path, name)
    setProjects((current) => [...current, project])
    setExpandedProjectIds((current) => [...current, project.id])
    await createProjectSession(project.id, project.path)
    setIsSettingsOpen(false)
  }

  async function handleCreateSession() {
    if (window.ousia) {
      const result = await window.ousia.createSession({
        agentProvider: settings.defaultAgentProvider,
        title: t.app.newSession,
      })
      if (!result.ok) {
        applyAppStateTransaction(result)
        return
      }
      applyAppStateTransaction(result)
      if (!result.session) {
        return
      }
      const targetKey = chatKey(
        projectPathForAppStateSession(result.state, result.session),
        result.session.id
      )
      draftSessionKeysRef.current.add(targetKey)
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
      setSidebarScrollTargetSessionId(result.session.id)
      setIsSettingsOpen(false)
      return
    }

    const session = createSession(
      t.app.newSession,
      settings.defaultAgentProvider
    )
    const targetKey = chatKey(settings.defaultSessionDir, session.id)
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

  async function createProjectSession(
    projectId: string,
    explicitProjectPath?: string
  ) {
    if (window.ousia) {
      const result = await window.ousia.createSession({
        agentProvider: settings.defaultAgentProvider,
        projectId,
        title: t.app.newSession,
      })
      if (!result.ok) {
        applyAppStateTransaction(result)
        return
      }
      applyAppStateTransaction(result)
      if (!result.session) {
        return
      }
      const targetKey = chatKey(
        projectPathForAppStateSession(result.state, result.session),
        result.session.id
      )
      draftSessionKeysRef.current.add(targetKey)
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
      setSidebarScrollTargetSessionId(result.session.id)
      return
    }

    const session = {
      ...createSession(t.app.newSession, settings.defaultAgentProvider),
      projectId,
    }
    const projectPath =
      explicitProjectPath ??
      projects.find((project) => project.id === projectId)?.path ??
      settings.defaultSessionDir
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

  async function selectOrCreateProjectSession(project: ProjectRecord) {
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
    await createProjectSession(project.id)
  }

  async function handleDeleteProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId)
    if (!project) {
      return
    }
    const projectSessions = sessionsRef.current.filter(
      (session) => session.projectId === projectId
    )
    const workingSession = findWorkingChatSession(
      projectSessions,
      project.path,
      runStatusBySessionRef.current
    )
    if (workingSession) {
      console.warn(
        `[app-state.delete] Blocked project deletion because a session is running: ${JSON.stringify(
          { projectId, sessionId: workingSession.id }
        )}`
      )
      return
    }

    if (window.ousia) {
      const result = await window.ousia.deleteProject({ projectId })
      if (!result.ok) {
        applyAppStateTransaction(result)
        return
      }
      const removedSessions = result.removedSessions ?? []
      applyAppStateTransaction(result)
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
        setIsSettingsOpen(false)
      }
      return
    }

    const remaining = projects.filter((item) => item.id !== projectId)
    const removedSessions = projectSessions
    const remainingSessions = sessionsRef.current.filter(
      (session) => session.projectId !== projectId
    )
    setProjects(remaining)
    setExpandedProjectIds((current) =>
      current.filter((item) => item !== projectId)
    )
    sessionsRef.current = remainingSessions
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
    setActiveSettingsSection("general")
    setIsSettingsOpen(true)
  }

  async function handleRenameSession(sessionId: string, title: string) {
    const nextTitle = title.trim()
    if (!nextTitle) {
      return
    }
    if (window.ousia) {
      const result = await window.ousia.renameSession({
        sessionId,
        title: nextTitle,
      })
      applyAppStateTransaction(result)
      return
    }
    setSessions((current) =>
      current.map((candidate) =>
        candidate.id === sessionId
          ? { ...candidate, title: nextTitle }
          : candidate
      )
    )
  }

  function moveSessionStateKeys(sourceKey: string, targetKey: string) {
    if (sourceKey === targetKey) {
      return
    }

    setItemsBySession((current) => moveRecordKey(current, sourceKey, targetKey))
    setHistoryPageStateBySession((current) =>
      moveRecordKey(current, sourceKey, targetKey)
    )
    setQueuedChatStateBySession((current) =>
      moveRecordKey(current, sourceKey, targetKey)
    )
    setContextUsageBySession((current) =>
      moveRecordKey(current, sourceKey, targetKey)
    )
    setRunStatusBySession((current) => {
      const next = moveRecordKey(current, sourceKey, targetKey)
      runStatusBySessionRef.current = next
      return next
    })

    if (draftSessionKeysRef.current.delete(sourceKey)) {
      draftSessionKeysRef.current.add(targetKey)
    }
    historyInFlightKeysRef.current.delete(sourceKey)
    historyInFlightKeysRef.current.delete(targetKey)
  }

  async function handleMoveSession({
    sessionId,
    targetProjectId,
    targetSessionId,
  }: MoveSessionTarget) {
    const sourceSession = sessionsRef.current.find(
      (session) => session.id === sessionId
    )
    if (!sourceSession) {
      return
    }

    const targetProject = targetProjectId
      ? projects.find((project) => project.id === targetProjectId)
      : undefined
    if (targetProjectId && !targetProject) {
      return
    }

    const sourceProjectPath = projectPathForSession(sourceSession)
    const targetProjectPath = targetProject?.path ?? settings.defaultSessionDir
    const sourceKey = chatKey(sourceProjectPath, sessionId)
    const targetKey = chatKey(targetProjectPath, sessionId)

    if (runStatusBySessionRef.current[sourceKey] === "working") {
      return
    }

    if (window.ousia) {
      const result = await window.ousia.moveChatSession({
        sessionId,
        sourceProjectPath,
        targetProjectId,
        targetProjectPath,
      })
      if (!result.ok) {
        console.warn(result.error)
        return
      }

      const stateResult = await window.ousia.moveSession({
        sessionId,
        targetProjectId,
        targetSessionId,
      })
      if (!stateResult.ok) {
        applyAppStateTransaction(stateResult)
        return
      }
      moveSessionStateKeys(sourceKey, targetKey)
      applyAppStateTransaction(stateResult)
      setSidebarScrollTargetSessionId(sessionId)
      return
    }

    moveSessionStateKeys(sourceKey, targetKey)
    setSessions((current) =>
      moveSessionToProjectGroup(
        current,
        sessionId,
        targetProjectId,
        targetSessionId
      )
    )
    if (targetProjectId) {
      setExpandedProjectIds((current) =>
        current.includes(targetProjectId)
          ? current
          : [...current, targetProjectId]
      )
    }
    setSidebarScrollTargetSessionId(sessionId)
  }

  function handleReorderProjects(
    sourceProjectId: string,
    targetProjectId: string
  ) {
    setProjects((current) =>
      reorderById(current, sourceProjectId, targetProjectId)
    )
    void window.ousia
      ?.reorderProjects({
        sourceProjectId,
        targetProjectId,
      })
      .then(applyAppStateTransaction)
  }

  function handleReorderSessions(
    sourceSessionId: string,
    targetSessionId: string
  ) {
    setSessions((current) =>
      reorderSessionsById(current, sourceSessionId, targetSessionId)
    )
    void window.ousia
      ?.reorderSessions({
        sourceSessionId,
        targetSessionId,
      })
      .then(applyAppStateTransaction)
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
    const session = sessionsRef.current.find(
      (candidate) => candidate.id === sessionId
    )
    if (!session) {
      return
    }
    titleGenerationSessionIdsRef.current.add(sessionId)
    void window.ousia
      .generateChatTitle({
        agentProvider: session.agentProvider,
        prompt: firstPrompt,
        projectPath: projectPathForSession(session),
        sessionId,
        model: {
          provider:
            session.agentProvider === "codex"
              ? "openai"
              : settings.modelProvider,
          modelId:
            session.agentProvider === "codex"
              ? settings.codexModelId
              : settings.modelId,
        },
      })
      .then((result) => {
        if (!result.ok) {
          console.warn(result.error)
          return
        }
        if (window.ousia) {
          const currentSession = sessionsRef.current.find(
            (candidate) => candidate.id === sessionId
          )
          if (!currentSession || !isDefaultSessionTitle(currentSession.title)) {
            return
          }
          void window.ousia
            .renameSession({
              sessionId,
              title: result.title,
            })
            .then(applyAppStateTransaction)
          return
        }
        setSessions((current) =>
          current.map((candidate) =>
            candidate.id === sessionId && isDefaultSessionTitle(candidate.title)
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
    const branchTitle = `${selectedSession.title} · ${titleSuffix}`
    let branchSession = {
      ...createSession(branchTitle, selectedSession.agentProvider),
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
    let branchKey = chatKey(selectedProjectPath, branchSession.id)
    const branchSourceItem = selectedItems[branchIndex]

    let resolvedBranchItems = branchItems
    if (window.ousia) {
      const createResult = await window.ousia.createSession({
        agentProvider: selectedSession.agentProvider,
        projectId: selectedSession.projectId,
        select: false,
        title: branchTitle,
      })
      if (!createResult.ok) {
        applyAppStateTransaction(createResult)
        return
      }
      if (!createResult.session) {
        return
      }
      branchSession = createResult.session
      branchKey = chatKey(selectedProjectPath, branchSession.id)

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
        const rollbackResult = await window.ousia.deleteSession({
          sessionId: branchSession.id,
        })
        applyAppStateTransaction(rollbackResult)
        appendLocalEvent({
          type: "error",
          id: `branch-${Date.now()}`,
          text: result.error,
          timestamp: now,
        })
        return
      }
      resolvedBranchItems = result.items

      const selectResult = await window.ousia.saveAppSelection({
        selectedSessionId: branchSession.id,
      })
      applyAppStateTransaction(selectResult)
      setItemsBySession((current) => ({
        ...current,
        [branchKey]: resolvedBranchItems,
      }))
      setSelectedSessionId(branchSession.id)
      setSidebarScrollTargetSessionId(branchSession.id)
      setIsSettingsOpen(false)
      return
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

  async function handleDeleteSession(sessionId: string) {
    const session = sessionsRef.current.find((item) => item.id === sessionId)
    if (!session) {
      return
    }
    const targetKey = chatKey(projectPathForSession(session), sessionId)
    if (runStatusBySessionRef.current[targetKey] === "working") {
      console.warn(
        `[app-state.delete] Blocked running session deletion: ${JSON.stringify({
          sessionId,
        })}`
      )
      return
    }

    if (window.ousia) {
      const result = await window.ousia.deleteSession({ sessionId })
      if (!result.ok) {
        applyAppStateTransaction(result)
        return
      }
      applyAppStateTransaction(result)
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
      return
    }

    const remaining = sessionsRef.current.filter(
      (item) => item.id !== sessionId
    )
    sessionsRef.current = remaining
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

  const stableCreateProjectSession = useStableEvent(createProjectSession)
  const stableCreateSession = useStableEvent(handleCreateSession)
  const stableDeleteProject = useStableEvent(handleDeleteProject)
  const stableDeleteSession = useStableEvent(handleDeleteSession)
  const stableMoveSession = useStableEvent(handleMoveSession)
  const stableOpenProject = useStableEvent(handleOpenProject)
  const stableOpenSettings = useStableEvent(handleOpenSettings)
  const stableRenameSession = useStableEvent(handleRenameSession)
  const stableReorderProjects = useStableEvent(handleReorderProjects)
  const stableReorderSidebarSections = useStableEvent(
    handleReorderSidebarSections
  )
  const stableReorderSessions = useStableEvent(handleReorderSessions)
  const stableSelectSession = useStableEvent(handleSelectSession)
  const stableAppendLocalEvent = useStableEvent(appendLocalEvent)
  const stableGenerateSessionTitle = useStableEvent(handleGenerateSessionTitle)
  const stableBranchFromMessage = useStableEvent(handleBranchFromMessage)
  const handleSidebarScrollTargetHandled = useCallback(
    () => setSidebarScrollTargetSessionId(""),
    []
  )
  const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), [])

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
          "pointer-events-none fixed top-3 right-3 z-50 rounded-md border border-foreground/10 bg-popover/92 px-3 py-1.5 text-sm font-medium text-popover-foreground tabular-nums shadow-lg backdrop-blur transition-all duration-150",
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
          <div className={isSettingsOpen ? "hidden" : "flex min-h-0"}>
            <Sidebar
              onCreateProjectSession={stableCreateProjectSession}
              onCreateSession={stableCreateSession}
              onDeleteProject={stableDeleteProject}
              onDeleteSession={stableDeleteSession}
              onMoveSession={stableMoveSession}
              onOpenProject={stableOpenProject}
              onOpenSettings={stableOpenSettings}
              onUpdateAction={handleUpdateAction}
              onRenameSession={stableRenameSession}
              onReorderProjects={stableReorderProjects}
              onReorderSidebarSections={stableReorderSidebarSections}
              onReorderSessions={stableReorderSessions}
              onSelectSession={stableSelectSession}
              onScrollTargetHandled={handleSidebarScrollTargetHandled}
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
              updateStatus={updateStatus}
              style={SIDEBAR_STYLE}
            />
          </div>
          {isSettingsOpen ? (
            <SettingsSidebar
              activeSection={activeSettingsSection}
              agentProvider={settings.defaultAgentProvider}
              language={settings.language}
              onBack={handleCloseSettings}
              onSectionChange={setActiveSettingsSection}
              style={SIDEBAR_STYLE}
            />
          ) : null}
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
              activeSection={activeSettingsSection}
              codexEnvironment={codexEnvironment}
              modelRegistry={modelRegistry}
              settings={settings}
              onRefreshModelRegistry={refreshModelRegistry}
              onRefreshCodexEnvironment={refreshCodexEnvironment}
              onSettingsChange={handleSettingsChange}
            />
          ) : (
            <ChatArea
              codexEnvironment={codexEnvironment}
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
              onLocalEvent={stableAppendLocalEvent}
              onGenerateSessionTitle={stableGenerateSessionTitle}
              onBranchFromMessage={stableBranchFromMessage}
              onLoadOlderHistory={handleLoadOlderHistory}
              onRefreshModelRegistry={refreshModelRegistry}
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
              style={MAIN_PANEL_STYLE}
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
