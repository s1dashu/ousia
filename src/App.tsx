import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react"
import { ArrowLeft02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import { useTheme, type Theme } from "@/components/theme-provider"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import type {
  OusiaAppearanceColorScale,
  OusiaChatEvent,
  OusiaThinkingLevel,
  OusiaWorkspaceAction,
} from "@/electron/chat-types"
import type { WorkspaceTabsState } from "@/extensions/workspace-tabs"
import { ChatArea } from "@/features/chat/ChatArea"
import { applyChatEvent, type ChatItem } from "@/features/chat/chat-events"
import { Sidebar } from "@/features/sidebar/Sidebar"
import { Workspace } from "@/features/workspace/Workspace"
import {
  findModelPreset,
  modelPresetValue,
  modelPresets,
} from "@/app/model-presets"

const thinkingLevels: Array<{
  label: string
  value: OusiaThinkingLevel
  description: string
}> = [
  { label: "关闭", value: "off", description: "不输出推理内容。" },
  {
    label: "极少",
    value: "minimal",
    description: "使用最小推理预算。",
  },
  {
    label: "低",
    value: "low",
    description: "为简单任务启用轻量推理。",
  },
  {
    label: "中",
    value: "medium",
    description: "编码工作的均衡默认值。",
  },
  {
    label: "高",
    value: "high",
    description: "为复杂改动启用更深推理。",
  },
  {
    label: "极高",
    value: "xhigh",
    description: "在模型支持时使用最高推理强度。",
  },
]

const themeOptions: Array<{
  label: string
  value: Theme
  description: string
}> = [
  { label: "跟随系统", value: "system", description: "使用系统当前明暗外观。" },
  { label: "浅色", value: "light", description: "始终使用浅色外观。" },
  { label: "深色", value: "dark", description: "始终使用深色外观。" },
]

const appearanceColorScales: Array<{
  label: string
  value: OusiaAppearanceColorScale
  description: string
}> = [
  {
    label: "Tea",
    value: "tea",
    description: "当前奶咖色，比 Radix Sand 更暖，接近浅茶纸面。",
  },
  {
    label: "Cloud Tea",
    value: "cloudTea",
    description: "基于截图提取色 #eee6df / #f3f2ee 的浅茶灰。",
  },
  { label: "Sand", value: "sand", description: "Radix Sand，温和的暖灰。" },
  { label: "Gray", value: "gray", description: "Radix Gray，中性的纯灰。" },
  { label: "Slate", value: "slate", description: "Radix Slate，略偏冷的蓝灰。" },
  { label: "Mauve", value: "mauve", description: "Radix Mauve，带轻微紫调的灰。" },
  { label: "Sage", value: "sage", description: "Radix Sage，带轻微绿调的灰。" },
  { label: "Olive", value: "olive", description: "Radix Olive，偏自然的橄榄灰。" },
]

const DEFAULT_SESSION_TITLE = "新会话"
const SESSION_TITLE_MODEL_ID = "deepseek-v4-flash"

const MIN_SIDEBAR_WIDTH = 200
const SIDEBAR_COLLAPSE_THRESHOLD = 120
const MAX_SIDEBAR_WIDTH = 360
const MIN_CHAT_WIDTH = 340
const MIN_WORKSPACE_WIDTH = 448
const RESIZE_HANDLE_WIDTH = 1

type AgentRunStatus = "idle" | "working"

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function chatKey(sessionId: string) {
  return sessionId
}

function ResizeHandle({
  label,
  onPointerDown,
}: {
  label: string
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      className="group pointer-events-none relative z-10 w-px shrink-0 bg-border"
    >
      <div
        aria-label={label}
        className="pointer-events-auto absolute top-10 bottom-0 left-1/2 w-3 -translate-x-1/2 cursor-col-resize"
        onPointerDown={onPointerDown}
        role="separator"
        tabIndex={0}
      />
      <div className="absolute top-10 bottom-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-ring" />
    </div>
  )
}

function SettingsPage({
  onClose,
  onSettingsChange,
  settings,
}: {
  onClose: () => void
  onSettingsChange: (settings: AppSettings) => void
  settings: AppSettings
}) {
  const [draft, setDraft] = useState(settings)
  const [activeSection, setActiveSection] = useState<
    "appearance" | "general" | "agent"
  >("appearance")
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    queueMicrotask(() => setDraft(settings))
  }, [settings])

  function updateDraft(patch: Partial<AppSettings>) {
    setDraft((current) => ({
      ...current,
      ...patch,
    }))
  }

  function applySettings(patch: Partial<AppSettings>) {
    const nextSettings = {
      ...settings,
      ...patch,
    }
    setDraft((current) => ({
      ...current,
      ...patch,
    }))
    onSettingsChange(nextSettings)
  }

  function commitRequiredTextSetting(
    key: "defaultWorkDir" | "modelProvider" | "modelId"
  ) {
    const value = draft[key].trim()
    if (!value) {
      updateDraft({ [key]: settings[key] })
      return
    }
    applySettings({ [key]: value })
  }

  function commitApiKey() {
    applySettings({ modelApiKey: draft.modelApiKey.trim() })
  }

  const selectedPreset = findModelPreset(draft.modelProvider, draft.modelId)
  const selectedModelValue = selectedPreset
    ? modelPresetValue(selectedPreset.provider, selectedPreset.modelId)
    : "custom"
  const modelSelectItems = [
    ...modelPresets.map((preset) => ({
      label: preset.label,
      value: modelPresetValue(preset.provider, preset.modelId),
    })),
    { label: "自定义模型", value: "custom" },
  ]
  const thinkingSelectItems = thinkingLevels.map((level) => ({
    label: level.label,
    value: level.value,
  }))
  const selectedThemeDescription = themeOptions.find(
    (option) => option.value === theme
  )?.description
  const selectedColorScaleDescription = appearanceColorScales.find(
    (scale) => scale.value === draft.appearanceColorScale
  )?.description
  const settingsSections = [
    { id: "appearance", label: "外观设置" },
    { id: "general", label: "通用设置" },
    { id: "agent", label: "Agent 设置" },
  ] as const

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[#fff] dark:bg-background">
      <header className="window-drag flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="返回"
          onClick={onClose}
        >
          <HugeiconsIcon
            icon={ArrowLeft02Icon}
            className="text-muted-foreground"
            size={19}
            strokeWidth={1.8}
          />
        </Button>
        <h1 className="text-base font-semibold">设置</h1>
      </header>
      <div className="flex min-h-0 flex-1 justify-center px-8">
        <div className="flex min-h-0 w-full max-w-[940px]">
          <nav className="w-44 shrink-0 py-7 pr-3">
          <div className="sticky top-7 space-y-1">
            {settingsSections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={[
                  "flex h-9 w-full items-center rounded-md px-3 text-left text-sm outline-none transition-colors",
                  activeSection === section.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                ].join(" ")}
                onClick={() => setActiveSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </div>
        </nav>

          <div className="ousia-hover-scrollbar min-h-0 flex-1 overflow-auto py-7 pl-5">
          <div className="w-full max-w-2xl">
            {activeSection === "appearance" ? (
              <section>
                <h2 className="text-sm font-semibold">外观设置</h2>
            <div className="mt-4">
              <span className="text-xs font-medium text-muted-foreground">
                外观模式
              </span>
              <Select
                items={themeOptions}
                value={theme}
                onValueChange={(value) => setTheme(value as Theme)}
              >
                <SelectTrigger
                  aria-label="外观模式"
                  className="mt-2 w-full rounded-md"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {themeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {selectedThemeDescription ? (
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                {selectedThemeDescription}
              </div>
            ) : null}

            <div className="mt-4">
              <span className="text-xs font-medium text-muted-foreground">
                Radix 色阶
              </span>
              <Select
                items={appearanceColorScales}
                value={draft.appearanceColorScale}
                onValueChange={(value) =>
                  applySettings({
                    appearanceColorScale: value as OusiaAppearanceColorScale,
                  })
                }
              >
                <SelectTrigger
                  aria-label="Radix 色阶"
                  className="mt-2 w-full rounded-md"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {appearanceColorScales.map((scale) => (
                      <SelectItem key={scale.value} value={scale.value}>
                        {scale.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {selectedColorScaleDescription ? (
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                {selectedColorScaleDescription}
              </div>
            ) : null}
              </section>
            ) : null}

            {activeSection === "general" ? (
              <section>
                <h2 className="text-sm font-semibold">通用设置</h2>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">
              默认工作目录
            </label>
            <input
              className="mt-2 h-9 w-full rounded-md border bg-card/40 px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={draft.defaultWorkDir}
              onChange={(event) =>
                updateDraft({
                  defaultWorkDir: event.target.value,
                })
              }
              onBlur={() => commitRequiredTextSetting("defaultWorkDir")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur()
                }
              }}
              placeholder="~/Ousia"
            />
            <div className="mt-2 text-xs leading-5 text-muted-foreground">
              未归属项目的会话会使用该目录。支持 ~/Ousia 这类路径。
            </div>
              </section>
            ) : null}

            {activeSection === "agent" ? (
              <section>
                <h2 className="text-sm font-semibold">Agent 设置</h2>
            <div className="mt-4">
              <span className="text-xs font-medium text-muted-foreground">
                预设
              </span>
              <Select
                items={modelSelectItems}
                value={selectedModelValue}
                onValueChange={(value) => {
                  if (value === "custom") {
                    return
                  }
                  const preset = modelPresets.find(
                    (item) =>
                      modelPresetValue(item.provider, item.modelId) === value
                  )
                  if (!preset) {
                    return
                  }
                  applySettings({
                    modelProvider: preset.provider,
                    modelId: preset.modelId,
                  })
                }}
              >
                <SelectTrigger
                  aria-label="预设"
                  className="mt-2 w-full rounded-md"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {modelPresets.map((preset) => (
                      <SelectItem
                        key={modelPresetValue(preset.provider, preset.modelId)}
                        value={modelPresetValue(
                          preset.provider,
                          preset.modelId
                        )}
                      >
                        {preset.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">自定义模型</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {selectedPreset ? (
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                {selectedPreset.description}
              </div>
            ) : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  服务商
                </span>
                <input
                  className="mt-2 h-9 w-full rounded-md border bg-card/40 px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={draft.modelProvider}
                  onChange={(event) =>
                    updateDraft({
                      modelProvider: event.target.value,
                    })
                  }
                  onBlur={() => commitRequiredTextSetting("modelProvider")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur()
                    }
                  }}
                  placeholder="deepseek"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  模型 ID
                </span>
                <input
                  className="mt-2 h-9 w-full rounded-md border bg-card/40 px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={draft.modelId}
                  onChange={(event) =>
                    updateDraft({
                      modelId: event.target.value,
                    })
                  }
                  onBlur={() => commitRequiredTextSetting("modelId")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur()
                    }
                  }}
                  placeholder="deepseek-v4-flash"
                />
              </label>
            </div>
            <div className="mt-4">
              <span className="text-xs font-medium text-muted-foreground">
                API Key
              </span>
              <input
                className="mt-2 h-9 w-full rounded-md border bg-card/40 px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={draft.modelApiKey}
                onChange={(event) =>
                  updateDraft({
                    modelApiKey: event.target.value,
                  })
                }
                onBlur={commitApiKey}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur()
                  }
                }}
                placeholder="sk-..."
                type="password"
              />
            </div>
            <div className="mt-2 text-xs leading-5 text-muted-foreground">
              该密钥会传给 pi，用于当前服务商。留空时会使用 pi 的认证存储或
              DEEPSEEK_API_KEY 等环境变量。
            </div>

            <label className="mt-4 block">
              <span className="text-xs font-medium text-muted-foreground">
                推理强度
              </span>
              <Select
                items={thinkingSelectItems}
                value={draft.thinkingLevel}
                onValueChange={(value) =>
                  applySettings({
                    thinkingLevel: value as OusiaThinkingLevel,
                  })
                }
              >
                <SelectTrigger
                  aria-label="推理强度"
                  className="mt-2 w-full rounded-md"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {thinkingLevels.map((level) => (
                      <SelectItem key={level.value} value={level.value}>
                        {level.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            <div className="mt-2 text-xs leading-5 text-muted-foreground">
              {
                thinkingLevels.find(
                  (level) => level.value === draft.thinkingLevel
                )?.description
              }{" "}
              DeepSeek 可能会自动限制不支持的强度。
            </div>
              </section>
            ) : null}
          </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function App() {
  const [initialState] = useState<InitialAppState>(() => createDefaultAppState())
  const [isAppStateLoaded, setIsAppStateLoaded] = useState(!window.ousia)
  const shellRef = useRef<HTMLElement>(null)
  const [sidebarWidth, setSidebarWidth] = useState(256)
  const [chatWidth, setChatWidth] = useState(520)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isShellResizing, setIsShellResizing] = useState(false)
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false)
  const [isWorkspaceCollapsed, setIsWorkspaceCollapsed] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(initialState.settings)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectRecord[]>(
    initialState.projects
  )
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(
    initialState.expandedProjectIds
  )
  const [sessions, setSessions] = useState<SessionRecord[]>(
    initialState.sessions
  )
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialState.selectedProjectId
  )
  const [selectedSessionId, setSelectedSessionId] = useState(
    initialState.selectedSessionId
  )
  const [selectedWorkspaceExtensionId, setSelectedWorkspaceExtensionId] = useState(
    initialState.selectedWorkspaceExtensionId
  )
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTabsState>(
    initialState.workspaceTabs
  )
  const [pendingWorkspaceAction, setPendingWorkspaceAction] =
    useState<OusiaWorkspaceAction | null>(null)
  const [itemsBySession, setItemsBySession] = useState<
    Record<string, ChatItem[]>
  >({})
  const [runStatusBySession, setRunStatusBySession] = useState<
    Record<string, AgentRunStatus>
  >({})
  const titleGenerationSessionIdsRef = useRef<Set<string>>(new Set())

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
    currentProject && selectedSession ? chatKey(selectedSession.id) : ""
  const selectedItems = selectedChatKey
    ? (itemsBySession[selectedChatKey] ?? [])
    : []
  useEffect(() => {
    let isCancelled = false
    void loadInitialAppState().then((state) => {
      if (isCancelled) {
        return
      }
      setSettings(state.settings)
      setProjects(state.projects)
      setExpandedProjectIds(state.expandedProjectIds)
      setSessions(state.sessions)
      setSelectedProjectId(state.selectedProjectId)
      setSelectedSessionId(state.selectedSessionId)
      setSelectedWorkspaceExtensionId(state.selectedWorkspaceExtensionId)
      setWorkspaceTabs(state.workspaceTabs)
      setIsAppStateLoaded(true)
    })
    return () => {
      isCancelled = true
    }
  }, [])

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
      expandedProjectIds: expandedProjectIds.filter((projectId) =>
        projects.some((project) => project.id === projectId)
      ),
      selectedProjectId: selectedProject?.id ?? "",
      selectedSessionId: selectedSession?.id ?? "",
      selectedWorkspaceExtensionId,
      workspaceTabs,
    })
  }, [
    isAppStateLoaded,
    expandedProjectIds,
    projects,
    sessions,
    settings,
    selectedProject?.id,
    selectedSession?.id,
    selectedWorkspaceExtensionId,
    workspaceTabs,
  ])

  const handleWorkspaceTabsChange = useCallback(
    (state: WorkspaceTabsState) => {
      setWorkspaceTabs(state)
    },
    []
  )

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
      const targetSession = sessions.find(
        (session) => session.id === event.context?.sessionId
      )
      const targetKey =
        targetSession && event.context
          ? chatKey(targetSession.id)
          : selectedChatKey
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
      setItemsBySession((current) => ({
        ...current,
        [targetKey]: applyChatEvent(current[targetKey] ?? [], event),
      }))
    })
  }, [selectedChatKey, sessions])

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
    setItemsBySession((current) => ({
      ...current,
      [selectedChatKey]: applyChatEvent(current[selectedChatKey] ?? [], event),
    }))
  }

  async function handleOpenProject() {
    if (!window.ousia) {
      const rawPath = window.prompt("项目路径")
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
    const session = createSession()
    setSessions((current) => [session, ...current])
    setSelectedProjectId("")
    setSelectedSessionId(session.id)
    setIsSettingsOpen(false)
  }

  function createProjectSession(projectId: string) {
    const session = { ...createSession(), projectId }
    setSessions((current) => [session, ...current])
    setExpandedProjectIds((current) =>
      current.includes(projectId) ? current : [...current, projectId]
    )
    setSelectedProjectId(projectId)
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
      setSelectedProjectId(project.id)
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
        delete next[chatKey(session.id)]
      }
      return next
    })

    if (
      selectedProjectId === projectId ||
      selectedSession?.projectId === projectId
    ) {
      const nextSession = remainingSessions[0]
      setSelectedProjectId(nextSession?.projectId ?? "")
      setSelectedSessionId(nextSession?.id ?? "")
      setIsSettingsOpen(false)
    }
  }

  function handleSelectSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId)
    setSelectedProjectId(session?.projectId ?? "")
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
          apiKey: settings.modelApiKey.trim() || undefined,
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
            candidate.title.trim() === DEFAULT_SESSION_TITLE
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
      delete next[chatKey(sessionId)]
      return next
    })
    if (selectedSessionId === sessionId) {
      const nextSession = remaining[0]
      setSelectedProjectId(nextSession?.projectId ?? "")
      setSelectedSessionId(nextSession?.id ?? "")
    }
  }

  function getShellWidth() {
    return shellRef.current?.getBoundingClientRect().width ?? window.innerWidth
  }

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
      setIsSidebarCollapsed((current) => !current)
    }

    window.addEventListener("keydown", handleGlobalKeyDown)
    return () => window.removeEventListener("keydown", handleGlobalKeyDown)
  }, [])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) {
      return
    }

    const collapseForAvailableWidth = (shellWidth: number) => {
      const sidebarHandleWidth = isSidebarCollapsed ? 0 : RESIZE_HANDLE_WIDTH
      const workspaceHandleWidth = isWorkspaceCollapsed ? 0 : RESIZE_HANDLE_WIDTH
      const widthNeededWithWorkspace =
        (isSidebarCollapsed ? 0 : sidebarWidth) +
        sidebarHandleWidth +
        MIN_CHAT_WIDTH +
        workspaceHandleWidth +
        MIN_WORKSPACE_WIDTH

      if (!isWorkspaceCollapsed && shellWidth < widthNeededWithWorkspace) {
        setIsWorkspaceCollapsed(true)
      }

      const widthNeededWithSidebar =
        sidebarWidth + RESIZE_HANDLE_WIDTH + MIN_CHAT_WIDTH
      if (!isSidebarCollapsed && shellWidth < widthNeededWithSidebar) {
        setIsSidebarCollapsed(true)
      }
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) {
        collapseForAvailableWidth(width)
      }
    })
    resizeObserver.observe(shell)
    return () => resizeObserver.disconnect()
  }, [isSidebarCollapsed, isWorkspaceCollapsed, sidebarWidth])

  function beginSidebarResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsShellResizing(true)
    const startX = event.clientX
    const startSidebarWidth = sidebarWidth
    const shellWidth = getShellWidth()

    function stopSidebarResize() {
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
        shellWidth - MIN_CHAT_WIDTH - MIN_WORKSPACE_WIDTH - 2
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

  function beginChatResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsShellResizing(true)
    const startX = event.clientX
    const startChatWidth = chatWidth
    const shellWidth = getShellWidth()

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const effectiveSidebarWidth = isSidebarCollapsed ? 0 : sidebarWidth
      const maxChatWidth =
        shellWidth - effectiveSidebarWidth - MIN_WORKSPACE_WIDTH - 2
      const nextChatWidth = clamp(
        startChatWidth + moveEvent.clientX - startX,
        MIN_CHAT_WIDTH,
        Math.max(MIN_CHAT_WIDTH, maxChatWidth)
      )
      setChatWidth(nextChatWidth)
    }

    function handlePointerUp() {
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

  const shouldShowWorkspace = isAppStateLoaded && !isWorkspaceCollapsed

  const ensureShellWidthForPanel = useCallback(async (
    minWidth: number,
    anchor: "left" | "right"
  ) => {
    if (!window.ousia) {
      return
    }
    await window.ousia.ensureWindowWidth({ anchor, minWidth })
  }, [])

  function expandSidebar() {
    setIsSidebarCollapsed(false)
  }

  const expandWorkspace = useCallback(async () => {
    const sidebarColumnWidth = isSidebarCollapsed
      ? 0
      : sidebarWidth + RESIZE_HANDLE_WIDTH
    const targetChatWidth = Math.max(MIN_CHAT_WIDTH, chatWidth)
    await ensureShellWidthForPanel(
      sidebarColumnWidth +
        targetChatWidth +
        RESIZE_HANDLE_WIDTH +
        MIN_WORKSPACE_WIDTH,
      "left"
    )
    setIsWorkspaceCollapsed(false)
  }, [chatWidth, ensureShellWidthForPanel, isSidebarCollapsed, sidebarWidth])

  useEffect(() => {
    if (!window.ousia) {
      return
    }
    return window.ousia.onWorkspaceAction((action) => {
      setPendingWorkspaceAction(action)
      void expandWorkspace()
    })
  }, [expandWorkspace])

  return (
    <main
      ref={shellRef}
      data-shell-resizing={isShellResizing ? "true" : undefined}
      className="relative flex h-svh overflow-hidden bg-background text-foreground"
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
            onSelectSession={handleSelectSession}
            onToggleSidebar={() => setIsSidebarCollapsed(true)}
            expandedProjectIds={expandedProjectIds}
            onExpandedProjectIdsChange={setExpandedProjectIds}
            projects={projects}
            selectedSessionId={selectedSession?.id ?? ""}
            sessions={sessions}
            isWindowFullscreen={isWindowFullscreen}
            style={{ width: sidebarWidth }}
          />
          <ResizeHandle
            label="调整侧边栏宽度"
            onPointerDown={beginSidebarResize}
          />
        </div>
      )}
      {isSettingsOpen ? (
        <SettingsPage
          settings={settings}
          onClose={() => setIsSettingsOpen(false)}
          onSettingsChange={setSettings}
        />
      ) : (
        <>
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
            isWorkspaceCollapsed={!shouldShowWorkspace}
            onLocalEvent={appendLocalEvent}
            onGenerateSessionTitle={handleGenerateSessionTitle}
            onExpandWorkspace={() => {
              void expandWorkspace()
            }}
            onSettingsChange={setSettings}
            onToggleSidebar={() => {
              expandSidebar()
            }}
            settings={settings}
            style={
              !shouldShowWorkspace
                ? { flex: "1 1 0", width: "auto" }
                : { width: chatWidth }
            }
          />
          {shouldShowWorkspace ? (
            <div className="flex h-full max-h-full min-h-0 min-w-0 flex-1 overflow-hidden">
              <ResizeHandle
                label="调整工作区宽度"
                onPointerDown={beginChatResize}
              />
              <Workspace
                currentProject={selectedSession ? currentProject : undefined}
                currentSession={selectedSession}
                agentModel={{
                  provider: settings.modelProvider,
                  modelId: settings.modelId,
                  apiKey: settings.modelApiKey.trim() || undefined,
                }}
                agentThinkingLevel={settings.thinkingLevel}
                initialWorkspaceTabs={workspaceTabs}
                onCollapse={() => setIsWorkspaceCollapsed(true)}
                selectedWorkspaceExtensionId={selectedWorkspaceExtensionId}
                pendingWorkspaceAction={pendingWorkspaceAction}
                onWorkspaceTabsChange={handleWorkspaceTabsChange}
                onSelectWorkspaceExtension={setSelectedWorkspaceExtensionId}
                onWorkspaceActionHandled={(requestId) => {
                  setPendingWorkspaceAction((current) =>
                    current?.requestId === requestId ? null : current
                  )
                }}
              />
            </div>
          ) : null}
        </>
      )}
    </main>
  )
}

export default App
