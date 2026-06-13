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
  type OusiaChatEvent,
  type OusiaModelRegistryResult,
  type OusiaSidebarSectionId,
} from "@/electron/chat-types"
import { getMessages, isDefaultSessionTitle } from "@/app/i18n"
import { modelsForProvider } from "@/app/model-presets"
import { ChatArea } from "@/features/chat/ChatArea"
import { applyChatEvent, type ChatItem } from "@/features/chat/chat-events"
import { SettingsPage } from "@/features/settings/SettingsPage"
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
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function chatKey(projectPath: string, sessionId: string) {
  return `${projectPath}::${sessionId}`
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
      className={`relative z-10 flex w-px shrink-0 flex-col ${showLine ? "bg-border/80" : "bg-transparent"}`}
    >
      <div
        aria-hidden="true"
        className="window-drag h-10 shrink-0"
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
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false)
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
  const [itemsBySession, setItemsBySession] = useState<
    Record<string, ChatItem[]>
  >({})
  const [runStatusBySession, setRunStatusBySession] = useState<
    Record<string, AgentRunStatus>
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
  const handleSettingsChange = useCallback(
    (nextSettings: AppSettings) => {
      const normalizedSettings = normalizeOusiaAppSettings(nextSettings)
      setSettings(normalizedSettings)
    },
    []
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
    if (!isAppStateLoaded) {
      return
    }
    void saveAppState({
      schemaVersion: APP_STATE_SCHEMA_VERSION,
      settings,
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
    })
  }, [
    isAppStateLoaded,
    expandedProjectIds,
    isSidebarCollapsed,
    isTerminalPanelCollapsed,
    projects,
    sessions,
    settings,
    selectedSession?.id,
    sidebarSectionOrder,
    sidebarWidth,
    terminalPanelWidth,
    initialState.windowState,
  ])

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
      setItemsBySession((current) => ({
        ...current,
        [targetKey]: applyChatEvent(current[targetKey] ?? [], event),
      }))
    })
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
    setIsSettingsOpen(false)
  }

  function createProjectSession(projectId: string) {
    const session = { ...createSession(t.app.newSession), projectId }
    setSessions((current) => [session, ...current])
    setExpandedProjectIds((current) =>
      current.includes(projectId) ? current : [...current, projectId]
    )
    setSelectedSessionId(session.id)
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

    setShellWidth(shell.getBoundingClientRect().width)
    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) {
        setShellWidth(width)
      }
    })
    resizeObserver.observe(shell)
    return () => resizeObserver.disconnect()
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
      className="relative flex h-svh overflow-hidden rounded-[var(--ousia-window-radius)] bg-sidebar text-foreground"
    >
      {isSidebarCollapsed ? null : (
        <div className="flex shrink-0 overflow-hidden">
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
            onToggleSidebar={() => setIsSidebarCollapsed(true)}
            expandedProjectIds={expandedProjectIds}
            onExpandedProjectIdsChange={setExpandedProjectIds}
            projects={projects}
            selectedSessionId={selectedSession?.id ?? ""}
            sidebarSectionOrder={sidebarSectionOrder}
            sessionRunStatusById={runStatusBySession}
            sessions={sessions}
            isWindowFullscreen={isWindowFullscreen}
            language={settings.language}
            style={{ width: effectiveSidebarWidth }}
          />
          <ResizeHandle
            label={t.shell.resizeSidebar}
            onPointerDown={beginSidebarResize}
          />
        </div>
      )}
      <div className="min-w-0 flex-1 bg-sidebar">
        <div className="flex h-full min-w-0 overflow-hidden">
          {isSettingsOpen ? (
            <SettingsPage
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
                  onExpandTerminalPanel={() => {
                    expandTerminalPanel()
                  }}
                  onSettingsChange={handleSettingsChange}
                  onToggleSidebar={() => {
                    expandSidebar()
                  }}
                  modelRegistry={modelRegistry}
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
    </main>
  )
}

export default App
