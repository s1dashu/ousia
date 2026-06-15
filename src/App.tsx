import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
import { TerminalPanel } from "@/features/terminal/TerminalPanel"

const SESSION_TITLE_MODEL_ID = "deepseek-v4-flash"

const MIN_SIDEBAR_WIDTH = 200
const SIDEBAR_COLLAPSE_THRESHOLD = 120
const MAX_SIDEBAR_WIDTH = 360
const MIN_CHAT_WIDTH = 300
const MIN_TERMINAL_PANEL_WIDTH = 400
const MIN_TERMINAL_PANEL_COMPACT_WIDTH = 100
const RESIZE_HANDLE_WIDTH = 1

type AgentRunStatus = "idle" | "working"
type QueuedChatState = {
  steering: string[]
  followUp: string[]
}
type ChatContextUsageState = {
  tokens: number | null
  contextWindow: number
  percent: number | null
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

function canMergeTextDeltaEvents(
  previousEvent: OusiaChatEvent | undefined,
  nextEvent: OusiaChatEvent
): previousEvent is TextDeltaChatEvent {
  return (
    Boolean(previousEvent) &&
    (nextEvent.type === "assistant_text_delta" ||
      nextEvent.type === "thinking_delta") &&
    previousEvent?.type === nextEvent.type &&
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
  label,
  onPointerDown,
  showLine = false,
}: {
  label: string
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  showLine?: boolean
}) {
  return (
    <div
      className="relative z-10 flex w-px shrink-0 flex-col"
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-px ${showLine ? "bg-border/80" : "bg-transparent"}`}
      />
      <div
        aria-hidden="true"
        className="window-drag relative h-10 shrink-0"
      />
      <div
        aria-label={label}
        className="window-no-drag group relative min-h-0 flex-1"
        onPointerDown={onPointerDown}
        role="separator"
        tabIndex={0}
      >
        <div className="window-no-drag absolute inset-y-0 left-1/2 w-5 -translate-x-1/2 cursor-col-resize" />
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-ring group-focus:bg-ring" />
      </div>
    </div>
  )
}

export function App() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [initialState] = useState<InitialAppState>(() => createDefaultAppState())
  const [isAppStateLoaded, setIsAppStateLoaded] = useState(!window.ousia)
  const shellRef = useRef<HTMLElement>(null)
  const [sidebarWidth, setSidebarWidth] = useState(
    initialState.shellLayout.sidebarWidth
  )
  const [terminalPanelWidth, setTerminalPanelWidth] = useState(
    initialState.shellLayout.terminalPanelWidth
  )
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    initialState.shellLayout.isSidebarCollapsed
  )
  const [sidebarSectionOrder, setSidebarSectionOrder] = useState<
    OusiaSidebarSectionId[]
  >(normalizeSidebarSectionOrder(initialState.shellLayout.sidebarSectionOrder))
  const [isShellResizing, setIsShellResizing] = useState(false)
  const [shellWidth, setShellWidth] = useState(0)
  const shellWidthRef = useRef(0)
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false)
  const [zoomIndicatorPercent, setZoomIndicatorPercent] = useState<number | null>(
    null
  )
  const zoomIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const [isTerminalPanelCollapsed, setIsTerminalPanelCollapsed] = useState(
    initialState.shellLayout.isTerminalPanelCollapsed
  )
  const [hasTerminalPanelMounted, setHasTerminalPanelMounted] = useState(
    !initialState.shellLayout.isTerminalPanelCollapsed
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
  const pendingChatEventsRef = useRef<Map<string, OusiaChatEvent[]>>(new Map())
  const pendingChatEventsFrameRef = useRef(0)
  const [runStatusBySession, setRunStatusBySession] = useState<
    Record<string, AgentRunStatus>
  >({})
  const [queuedChatStateBySession, setQueuedChatStateBySession] = useState<
    Record<string, QueuedChatState>
  >({})
  const [contextUsageBySession, setContextUsageBySession] = useState<
    Record<string, ChatContextUsageState | undefined>
  >({})
  const titleGenerationSessionIdsRef = useRef<Set<string>>(new Set())
  const isApplyingStoredThemeRef = useRef(false)

  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? sessions[0]
  const selectedProject = selectedSession?.projectId
    ? projects.find((project) => project.id === selectedSession.projectId)
    : undefined
  const defaultWorkDirProject: ProjectRecord = {
    id: "default-workdir",
    name: projectNameFromPath(settings.defaultWorkDir),
    path: settings.defaultWorkDir,
  }
  const currentProject = selectedProject ?? defaultWorkDirProject
  const selectedChatKey =
    currentProject && selectedSession
      ? chatKey(currentProject.path, selectedSession.id)
      : ""
  const sessionsRef = useRef(sessions)
  const selectedChatKeyRef = useRef(selectedChatKey)
  const selectedItems = selectedChatKey
    ? (itemsBySession[selectedChatKey] ?? [])
    : []
  const selectedQueuedChatState = selectedChatKey
    ? (queuedChatStateBySession[selectedChatKey] ?? {
        steering: [],
        followUp: [],
      })
    : {
        steering: [],
        followUp: [],
      }
  const selectedContextUsage = selectedChatKey
    ? contextUsageBySession[selectedChatKey]
    : undefined
  const createAppStateSnapshot = useCallback(
    (nextSettings: AppSettings = settings): InitialAppState => ({
      schemaVersion: APP_STATE_SCHEMA_VERSION,
      settings: nextSettings,
      sessions,
      projects,
      shellLayout: {
        sidebarWidth,
        terminalPanelWidth,
        isSidebarCollapsed,
        isTerminalPanelCollapsed,
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
      isTerminalPanelCollapsed,
      projects,
      selectedSession?.id,
      sessions,
      settings,
      sidebarSectionOrder,
      sidebarWidth,
      terminalPanelWidth,
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
        if (canMergeTextDeltaEvents(previousEvent, event)) {
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
      setTerminalPanelWidth(state.shellLayout.terminalPanelWidth)
      setIsSidebarCollapsed(state.shellLayout.isSidebarCollapsed)
      setIsTerminalPanelCollapsed(state.shellLayout.isTerminalPanelCollapsed)
      setHasTerminalPanelMounted(!state.shellLayout.isTerminalPanelCollapsed)
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
    if (!isAppStateLoaded) {
      return
    }
    void saveAppState(createAppStateSnapshot())
  }, [createAppStateSnapshot, isAppStateLoaded])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    selectedChatKeyRef.current = selectedChatKey
  }, [selectedChatKey])

  useEffect(() => {
    if (
      !window.ousia ||
      !selectedSession ||
      !selectedChatKey ||
      itemsBySession[selectedChatKey]?.length
    ) {
      return
    }

    let isCancelled = false
    window.ousia
      .getChatHistory({
        projectPath: currentProject.path,
        sessionId: selectedSession.id,
      })
      .then((history) => {
        if (isCancelled || !history.items.length) {
          return
        }
        setItemsBySession((current) => {
          if (current[selectedChatKey]?.length) {
            return current
          }
          return {
            ...current,
            [selectedChatKey]: history.items,
          }
        })
      })
      .catch(() => {
        // History hydration is best-effort; live chat still works.
      })

    return () => {
      isCancelled = true
    }
  }, [itemsBySession, selectedChatKey, currentProject.path, selectedSession])

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
      if (event.type === "run_status") {
        setRunStatusBySession((current) => ({
          ...current,
          [targetKey]:
            event.status === "starting" || event.status === "running"
              ? "working"
              : "idle",
        }))
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
      window.clearTimeout(zoomIndicatorTimerRef.current)
    }
    zoomIndicatorTimerRef.current = window.setTimeout(() => {
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
    if (event.type === "run_status") {
      setRunStatusBySession((current) => ({
        ...current,
        [selectedChatKey]:
          event.status === "starting" || event.status === "running"
            ? "working"
            : "idle",
      }))
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

  async function handleOpenProject() {
    if (!window.ousia) {
      const rawPath = window.prompt(t.shell.projectPathPrompt)
      if (!rawPath) {
        return
      }
      addProject(rawPath, projectNameFromPath(rawPath))
      return
    }
    const result = await window.ousia.openProjectDirectory()
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
    createProjectSession(project.id)
    setIsSettingsOpen(false)
  }

  function handleCreateSession() {
    const session = createSession(t.app.newSession)
    setSessions((current) => [session, ...current])
    setSelectedSessionId(session.id)
    setSidebarScrollTargetSessionId(session.id)
    setIsSettingsOpen(false)
  }

  function createProjectSession(projectId: string) {
    const session = { ...createSession(t.app.newSession), projectId }
    setSessions((current) => [session, ...current])
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

  function projectPathForSession(session: SessionRecord) {
    if (!session.projectId) {
      return settings.defaultWorkDir
    }
    return (
      projects.find((project) => project.id === session.projectId)?.path ??
      settings.defaultWorkDir
    )
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
    titleGenerationSessionIdsRef.current.add(sessionId)
    void window.ousia
      .generateChatTitle({
        prompt: firstPrompt,
        model: {
          provider: "deepseek",
          modelId: SESSION_TITLE_MODEL_ID,
          apiKey:
            getOusiaModelProviderApiKey(settings, "deepseek")?.trim() ||
            undefined,
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
    const branchItems = selectedItems
      .slice(0, branchIndex + 1)
      .map((item) =>
        item.role === "tool"
          ? { ...item }
          : {
              ...item,
              attachments: item.attachments
                ? item.attachments.map((attachment) => ({ ...attachment }))
                : undefined,
            }
      )
    const branchKey = chatKey(currentProject.path, branchSession.id)
    const branchSourceItem = selectedItems[branchIndex]

    let resolvedBranchItems = branchItems
    if (window.ousia) {
      const result = await window.ousia
        .branchChat({
          projectPath: currentProject.path,
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
    const remaining = sessions.filter((item) => item.id !== sessionId)
    setSessions(remaining)
    setItemsBySession((current) => {
      const next = { ...current }
      delete next[chatKey(projectPathForSession(session), sessionId)]
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

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) {
      return
    }

    let animationFrameId = 0
    const updateShellWidth = (width: number) => {
      const nextWidth = Math.round(width)
      if (!nextWidth || shellWidthRef.current === nextWidth) {
        return
      }

      shellWidthRef.current = nextWidth
      setShellWidth(nextWidth)
    }

    updateShellWidth(shell.getBoundingClientRect().width)
    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (!width) {
        return
      }

      cancelAnimationFrame(animationFrameId)
      animationFrameId = requestAnimationFrame(() => updateShellWidth(width))
    })
    resizeObserver.observe(shell)
    return () => {
      cancelAnimationFrame(animationFrameId)
      resizeObserver.disconnect()
    }
  }, [])

  const currentShellWidth = shellWidth || getShellWidth()
  const isTerminalPanelOpen = isAppStateLoaded && !isTerminalPanelCollapsed
  const preferredSidebarWidth = isSidebarCollapsed ? 0 : sidebarWidth
  const sidebarColumnWidth =
    preferredSidebarWidth + (isSidebarCollapsed ? 0 : RESIZE_HANDLE_WIDTH)
  const availableWorkAreaWidth = Math.max(
    0,
    currentShellWidth - sidebarColumnWidth
  )
  const splitTerminalLayoutMinWidth =
    MIN_CHAT_WIDTH + RESIZE_HANDLE_WIDTH + MIN_TERMINAL_PANEL_COMPACT_WIDTH
  const isTerminalPanelSolo =
    isTerminalPanelOpen && availableWorkAreaWidth < splitTerminalLayoutMinWidth
  const preferredTerminalPanelWidth = isTerminalPanelOpen
    ? Math.max(MIN_TERMINAL_PANEL_WIDTH, terminalPanelWidth)
    : 0
  const effectiveSidebarWidth = preferredSidebarWidth
  const splitTerminalPanelWidth = Math.max(
    MIN_TERMINAL_PANEL_COMPACT_WIDTH,
    availableWorkAreaWidth - MIN_CHAT_WIDTH - RESIZE_HANDLE_WIDTH
  )
  const effectiveTerminalPanelWidth = isTerminalPanelSolo
    ? availableWorkAreaWidth
    : Math.min(preferredTerminalPanelWidth, splitTerminalPanelWidth)

  function beginSidebarResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const resizeTarget = event.currentTarget
    resizeTarget.setPointerCapture(event.pointerId)
    setIsShellResizing(true)
    const startX = event.clientX
    const startSidebarWidth = sidebarWidth
    const shellWidth = getShellWidth()

    function stopSidebarResize() {
      if (resizeTarget.hasPointerCapture(event.pointerId)) {
        resizeTarget.releasePointerCapture(event.pointerId)
      }
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
      window.removeEventListener("blur", handlePointerUp)
      setIsShellResizing(false)
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
        shellWidth -
          MIN_CHAT_WIDTH -
          (isTerminalPanelOpen
            ? RESIZE_HANDLE_WIDTH + effectiveTerminalPanelWidth
            : 0) -
          RESIZE_HANDLE_WIDTH
      )
      const nextSidebarWidth = clamp(
        rawSidebarWidth,
        MIN_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, maxSidebarWidth)
      )
      setSidebarWidth(nextSidebarWidth)
    }

    function handlePointerUp() {
      stopSidebarResize()
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
    window.addEventListener("pointercancel", handlePointerUp, { once: true })
    window.addEventListener("blur", handlePointerUp, { once: true })
  }

  function beginTerminalPanelResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const resizeTarget = event.currentTarget
    resizeTarget.setPointerCapture(event.pointerId)
    setIsShellResizing(true)
    const startX = event.clientX
    const startTerminalPanelWidth = terminalPanelWidth
    const shellWidth = getShellWidth()

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const maxTerminalPanelWidth =
        shellWidth -
        MIN_CHAT_WIDTH -
        (isSidebarCollapsed ? 0 : effectiveSidebarWidth + RESIZE_HANDLE_WIDTH) -
        RESIZE_HANDLE_WIDTH
      const nextTerminalPanelWidth = clamp(
        startTerminalPanelWidth - (moveEvent.clientX - startX),
        MIN_TERMINAL_PANEL_COMPACT_WIDTH,
        Math.max(MIN_TERMINAL_PANEL_COMPACT_WIDTH, maxTerminalPanelWidth)
      )
      setTerminalPanelWidth(nextTerminalPanelWidth)
    }

    function handlePointerUp() {
      if (resizeTarget.hasPointerCapture(event.pointerId)) {
        resizeTarget.releasePointerCapture(event.pointerId)
      }
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
      window.removeEventListener("blur", handlePointerUp)
      setIsShellResizing(false)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
    window.addEventListener("pointercancel", handlePointerUp, { once: true })
    window.addEventListener("blur", handlePointerUp, { once: true })
  }

  const shouldShowTerminalPanel = isTerminalPanelOpen
  const shouldRenderTerminalPanel = isAppStateLoaded && hasTerminalPanelMounted
  const shouldShowChatArea = !isTerminalPanelSolo

  const expandSidebar = useCallback(() => {
    setIsSidebarCollapsed(false)
  }, [])

  const expandTerminalPanel = useCallback(() => {
    setHasTerminalPanelMounted(true)
    setIsTerminalPanelCollapsed(false)
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
      className="relative flex h-screen overflow-hidden rounded-[var(--ousia-window-radius)] bg-sidebar text-foreground"
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
        <div className="relative z-0 flex shrink-0 overflow-hidden">
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
            sessionRunStatusById={runStatusBySession}
            sessions={sessions}
            language={settings.language}
            style={{ width: effectiveSidebarWidth }}
          />
          <ResizeHandle
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
            <>
              {shouldShowChatArea ? (
                <ChatArea
                  key={selectedChatKey}
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
                  isTerminalPanelCollapsed={!shouldShowTerminalPanel}
                  onLocalEvent={appendLocalEvent}
                  onGenerateSessionTitle={handleGenerateSessionTitle}
                  onBranchFromMessage={handleBranchFromMessage}
                  contextUsage={selectedContextUsage}
                  onExpandTerminalPanel={() => {
                    expandTerminalPanel()
                  }}
                  onSettingsChange={handleSettingsChange}
                  modelRegistry={modelRegistry}
                  queuedChatState={selectedQueuedChatState}
                  settings={settings}
                  language={settings.language}
                  style={
                    !shouldShowTerminalPanel
                      ? { flex: "1 1 0", width: "auto" }
                      : {
                          flex: "1 1 0",
                          minWidth: MIN_CHAT_WIDTH,
                          width: "auto",
                        }
                  }
                />
              ) : null}
              {shouldRenderTerminalPanel ? (
                <div
                  aria-hidden={!shouldShowTerminalPanel}
                  className={
                    shouldShowTerminalPanel
                      ? "flex h-full max-h-full min-h-0 shrink-0 overflow-hidden"
                      : "hidden"
                  }
                  style={
                    shouldShowTerminalPanel
                      ? { width: effectiveTerminalPanelWidth }
                      : undefined
                  }
                >
                  {isTerminalPanelSolo ? null : (
                    <ResizeHandle
                      label={t.shell.resizeTerminal}
                      onPointerDown={beginTerminalPanelResize}
                      showLine
                    />
                  )}
                  <TerminalPanel
                    projectPath={selectedSession ? currentProject.path : ""}
                    sessionId={selectedSession?.id ?? ""}
                    isVisible={shouldShowTerminalPanel}
                    isJoinedToChat={!isTerminalPanelSolo && shouldShowChatArea}
                    language={settings.language}
                    resolvedTheme={resolvedTheme}
                    onCollapse={() => setIsTerminalPanelCollapsed(true)}
                  />
                </div>
              ) : null}
            </>
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
