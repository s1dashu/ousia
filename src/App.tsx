import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react"
import { ArrowLeft, FolderOpen, Plus, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useTheme, type Theme } from "@/components/theme-provider"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
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
import {
  getOusiaModelProviderApiKey,
  normalizeOusiaAppSettings,
  type OusiaAppearanceColorScale,
  type OusiaChatEvent,
  type OusiaModelRegistryResult,
  type OusiaSidebarSectionId,
  type OusiaWorkspaceAction,
} from "@/electron/chat-types"
import type { ExtensionAgentQuoteToInputPayload } from "@/extensions/types"
import type { WorkspaceTabsState } from "@/extensions/workspace-tabs"
import { ChatArea, type ChatQuoteIntent } from "@/features/chat/ChatArea"
import { applyChatEvent, type ChatItem } from "@/features/chat/chat-events"
import { Sidebar } from "@/features/sidebar/Sidebar"
import { Workspace } from "@/features/workspace/Workspace"
import {
  modelsForProvider,
  providerLabel,
} from "@/app/model-presets"

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
  { label: "Sand", value: "sand", description: "Radix Sand，温和的暖灰。" },
  { label: "Gray", value: "gray", description: "Radix Gray，中性的纯灰。" },
  { label: "Slate", value: "slate", description: "Radix Slate，略偏冷的蓝灰。" },
  { label: "Mauve", value: "mauve", description: "Radix Mauve，带轻微紫调的灰。" },
  { label: "Sage", value: "sage", description: "Radix Sage，带轻微绿调的灰。" },
  { label: "Olive", value: "olive", description: "Radix Olive，偏自然的橄榄灰。" },
  { label: "Tomato", value: "tomato", description: "Radix Tomato，明亮番茄红。" },
  { label: "Red", value: "red", description: "Radix Red，经典红色。" },
  { label: "Ruby", value: "ruby", description: "Radix Ruby，偏宝石感的红。" },
  { label: "Crimson", value: "crimson", description: "Radix Crimson，偏玫红的深红。" },
  { label: "Pink", value: "pink", description: "Radix Pink，清晰的粉色。" },
  { label: "Plum", value: "plum", description: "Radix Plum，偏梅子色的紫。" },
  { label: "Purple", value: "purple", description: "Radix Purple，标准紫色。" },
  { label: "Violet", value: "violet", description: "Radix Violet，偏蓝紫。" },
  { label: "Iris", value: "iris", description: "Radix Iris，柔和鸢尾蓝紫。" },
  { label: "Indigo", value: "indigo", description: "Radix Indigo，深靛蓝。" },
  { label: "Blue", value: "blue", description: "Radix Blue，清爽蓝色。" },
  { label: "Cyan", value: "cyan", description: "Radix Cyan，偏青的蓝。" },
  { label: "Teal", value: "teal", description: "Radix Teal，蓝绿色。" },
  { label: "Jade", value: "jade", description: "Radix Jade，偏玉石感的绿色。" },
  { label: "Green", value: "green", description: "Radix Green，标准绿色。" },
  { label: "Grass", value: "grass", description: "Radix Grass，偏草绿色。" },
  { label: "Brown", value: "brown", description: "Radix Brown，温暖棕色。" },
  { label: "Orange", value: "orange", description: "Radix Orange，鲜明橙色。" },
  { label: "Amber", value: "amber", description: "Radix Amber，琥珀黄色。" },
  { label: "Yellow", value: "yellow", description: "Radix Yellow，明亮黄色。" },
  { label: "Lime", value: "lime", description: "Radix Lime，酸橙黄绿。" },
  { label: "Mint", value: "mint", description: "Radix Mint，薄荷青绿。" },
  { label: "Sky", value: "sky", description: "Radix Sky，天空蓝。" },
]

function createIntentId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

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
}: {
  label: string
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div className="relative z-10 flex w-px shrink-0 flex-col bg-border">
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

function SettingsPage({
  modelRegistry,
  onClose,
  onSettingsChange,
  settings,
}: {
  modelRegistry: OusiaModelRegistryResult | undefined
  onClose: () => void
  onSettingsChange: (settings: AppSettings) => void
  settings: AppSettings
}) {
  const [draft, setDraft] = useState(settings)
  const [isAddProviderDialogOpen, setIsAddProviderDialogOpen] = useState(false)
  const [newProviderId, setNewProviderId] = useState("")
  const [newProviderApiKey, setNewProviderApiKey] = useState("")
  const { setTheme } = useTheme()

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
    const nextSettings = normalizeOusiaAppSettings({
      ...settings,
      ...patch,
    })
    setDraft((current) => ({
      ...current,
      ...nextSettings,
    }))
    onSettingsChange(nextSettings)
  }

  function applyThemeSetting(nextTheme: Theme) {
    setTheme(nextTheme)
    applySettings({ theme: nextTheme })
  }

  function commitRequiredTextSetting(key: "defaultWorkDir") {
    const value = draft[key].trim()
    if (!value) {
      updateDraft({ [key]: settings[key] })
      return
    }
    applySettings({ [key]: value })
  }

  async function chooseDefaultWorkDir() {
    if (!window.ousia) {
      const rawPath = window.prompt("默认工作目录", draft.defaultWorkDir)
      if (!rawPath?.trim()) {
        return
      }
      applySettings({ defaultWorkDir: rawPath.trim() })
      return
    }
    const result = await window.ousia.selectDirectory()
    if (result.canceled) {
      return
    }
    applySettings({ defaultWorkDir: result.path })
  }

  function addProvider() {
    const id = newProviderId.trim()
    const provider = modelRegistry?.providers.find((item) => item.id === id)
    if (
      !provider ||
      settings.modelProviders.some((configured) => configured.id === id)
    ) {
      return
    }
    const nextModelId = provider.models[0]?.modelId || settings.modelId
    applySettings({
      modelProvider: id,
      modelId: nextModelId,
      modelProviders: [
        ...settings.modelProviders,
        {
          id,
          apiKey: newProviderApiKey.trim(),
        },
      ],
    })
    setNewProviderId("")
    setNewProviderApiKey("")
    setIsAddProviderDialogOpen(false)
  }

  function updateProviderDraft(providerId: string, apiKey: string) {
    updateDraft({
      modelProviders: draft.modelProviders.map((provider) =>
        provider.id === providerId ? { ...provider, apiKey } : provider
      ),
    })
  }

  function commitProviderApiKey(providerId: string) {
    const draftProvider = draft.modelProviders.find(
      (provider) => provider.id === providerId
    )
    if (!draftProvider) {
      return
    }
    applySettings({
      modelProviders: settings.modelProviders.map((provider) =>
        provider.id === providerId
          ? { ...provider, apiKey: draftProvider.apiKey.trim() }
          : provider
      ),
    })
  }

  function deleteProvider(providerId: string) {
    if (settings.modelProviders.length <= 1) {
      return
    }
    const nextProviders = settings.modelProviders.filter(
      (provider) => provider.id !== providerId
    )
    const nextProviderId =
      settings.modelProvider === providerId
        ? (nextProviders[0]?.id ?? settings.modelProvider)
        : settings.modelProvider
    const nextProviderModel = modelsForProvider(
      modelRegistry,
      nextProviderId
    ).find((model) => model.modelId === settings.modelId)
    const nextDefaultModel = modelsForProvider(modelRegistry, nextProviderId)[0]
    applySettings({
      modelProviders: nextProviders,
      modelProvider: nextProviderId,
      modelId:
        nextProviderModel?.modelId ?? nextDefaultModel?.modelId ?? settings.modelId,
    })
  }

  const addableProviders =
    modelRegistry?.providers.filter(
      (provider) =>
        provider.models.length > 0 &&
        !draft.modelProviders.some((configured) => configured.id === provider.id)
    ) ?? []
  const addableProviderSelectItems = addableProviders.map((provider) => ({
    label: provider.name,
    value: provider.id,
  }))
  const canAddProvider = addableProviders.some(
    (provider) => provider.id === newProviderId
  )

  function openAddProviderDialog() {
    setNewProviderId(addableProviders[0]?.id ?? "")
    setNewProviderApiKey("")
    setIsAddProviderDialogOpen(true)
  }
  const selectedThemeDescription = themeOptions.find(
    (option) => option.value === draft.theme
  )?.description
  const selectedColorScaleDescription = appearanceColorScales.find(
    (scale) => scale.value === draft.appearanceColorScale
  )?.description

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
          <ArrowLeft className="text-muted-foreground" size={19} />
        </Button>
        <h1 className="text-base font-semibold">设置</h1>
      </header>
      <div className="ousia-hover-scrollbar min-h-0 flex-1 overflow-auto px-8 py-7">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-10">
          <section>
            <h2 className="text-sm font-semibold">通用设置</h2>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">
              默认工作目录
            </label>
            <div className="mt-2 flex items-center gap-2">
              <Input
                className="flex-1 rounded-md bg-card/40"
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
                placeholder="~/.ousia/workspace"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={chooseDefaultWorkDir}
              >
                <FolderOpen size={15} />
                选择
              </Button>
            </div>
            <div className="mt-2 text-xs leading-5 text-muted-foreground">
              未归属项目的会话会使用该目录。支持 ~/.ousia/workspace 这类路径。
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold">外观设置</h2>
            <div className="mt-4">
              <span className="text-xs font-medium text-muted-foreground">
                外观模式
              </span>
              <Select
                items={themeOptions}
                value={draft.theme}
                onValueChange={(value) => applyThemeSetting(value as Theme)}
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

          <section>
            <h2 className="text-sm font-semibold">模型设置</h2>
            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  供应商密钥
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="border-transparent bg-muted/45 hover:bg-muted/60 active:scale-[0.96]"
                  disabled={!addableProviders.length}
                  onClick={openAddProviderDialog}
                >
                  <Plus size={15} />
                  添加
                </Button>
              </div>
                  <div className="mt-4">
                    <Table>
                      <TableBody>
                        {draft.modelProviders.map((provider) => (
                          <TableRow
                            key={provider.id}
                            className="border-0 hover:bg-transparent"
                          >
                            <TableCell className="w-[30%] py-2 pr-4 pl-0 align-middle">
                              <div className="flex h-9 min-w-0 items-center text-sm font-medium text-foreground/75">
                                <span className="block truncate">
                                  {providerLabel(modelRegistry, provider.id)}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="py-2 px-0 align-middle">
                              <Input
                                aria-label={`${provider.id} API Key`}
                                className="rounded-md border-transparent bg-background/85 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.03)] focus-visible:bg-background dark:bg-background/45 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] dark:focus-visible:bg-background/65"
                                value={provider.apiKey}
                                onChange={(event) =>
                                  updateProviderDraft(
                                    provider.id,
                                    event.target.value
                                  )
                                }
                                onBlur={() => commitProviderApiKey(provider.id)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur()
                                  }
                                }}
                                placeholder="sk-..."
                                type="password"
                              />
                            </TableCell>
                            <TableCell className="w-10 py-2 pr-0 pl-3 text-right align-middle">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground hover:bg-muted/60 hover:text-foreground active:scale-[0.96]"
                                aria-label={`删除 ${provider.id}`}
                                disabled={draft.modelProviders.length <= 1}
                                onClick={() => deleteProvider(provider.id)}
                              >
                                <Trash2 size={17} />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">
                    留空时会使用 pi 的认证存储或对应环境变量。模型和推理强度在聊天输入框上直接选择。
                  </div>
                </div>
                <Dialog
                  open={isAddProviderDialogOpen}
                  onOpenChange={setIsAddProviderDialogOpen}
                >
                  <DialogContent>
                    <div className="flex items-start justify-between gap-4">
                      <DialogHeader>
                        <DialogTitle>添加供应商</DialogTitle>
                        <DialogDescription>
                          从 pi 的供应商列表中选择，并按需填写 API Key。
                        </DialogDescription>
                      </DialogHeader>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:bg-muted/60 hover:text-foreground active:scale-[0.96]"
                        aria-label="关闭"
                        onClick={() => setIsAddProviderDialogOpen(false)}
                      >
                        <X size={16} />
                      </Button>
                    </div>

                    <label className="mt-4 block">
                      <span className="text-xs font-medium text-muted-foreground">
                        供应商
                      </span>
                      <Select
                        items={addableProviderSelectItems}
                        value={newProviderId}
                        onValueChange={(value) => setNewProviderId(value ?? "")}
                      >
                        <SelectTrigger
                          aria-label="供应商"
                          className="mt-2 w-full rounded-md border-transparent bg-muted/45 hover:bg-muted/60"
                        >
                          <SelectValue placeholder="选择供应商" />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectGroup>
                            {addableProviders.map((provider) => (
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
                        className="mt-2 rounded-md border-transparent bg-muted/45 focus-visible:bg-background"
                        value={newProviderApiKey}
                        onChange={(event) =>
                          setNewProviderApiKey(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && canAddProvider) {
                            event.preventDefault()
                            addProvider()
                          }
                        }}
                        placeholder="sk-..."
                        type="password"
                      />
                    </label>

                    <DialogFooter className="mt-5">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="active:scale-[0.96]"
                        onClick={() => setIsAddProviderDialogOpen(false)}
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="active:scale-[0.96]"
                        disabled={!canAddProvider}
                        onClick={addProvider}
                      >
                        添加
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </section>
        </div>
      </div>
    </section>
  )
}

export function App() {
  const { theme, setTheme } = useTheme()
  const [initialState] = useState<InitialAppState>(() => createDefaultAppState())
  const [isAppStateLoaded, setIsAppStateLoaded] = useState(!window.ousia)
  const shellRef = useRef<HTMLElement>(null)
  const [sidebarWidth, setSidebarWidth] = useState(
    initialState.shellLayout.sidebarWidth
  )
  const [chatWidth, setChatWidth] = useState(initialState.shellLayout.chatWidth)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    initialState.shellLayout.isSidebarCollapsed
  )
  const [sidebarSectionOrder, setSidebarSectionOrder] = useState<
    OusiaSidebarSectionId[]
  >(normalizeSidebarSectionOrder(initialState.shellLayout.sidebarSectionOrder))
  const [isShellResizing, setIsShellResizing] = useState(false)
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false)
  const [isWorkspaceCollapsed, setIsWorkspaceCollapsed] = useState(
    initialState.shellLayout.isWorkspaceCollapsed
  )
  const [settings, setSettings] = useState<AppSettings>(initialState.settings)
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
  const [pendingChatQuoteIntent, setPendingChatQuoteIntent] =
    useState<ChatQuoteIntent | null>(null)
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
    currentProject && selectedSession ? chatKey(selectedSession.id) : ""
  const selectedItems = selectedChatKey
    ? (itemsBySession[selectedChatKey] ?? [])
    : []
  const handleQuoteToInputIntent = useCallback(
    (payload: ExtensionAgentQuoteToInputPayload) => {
      const text = payload.quote.text.trim()
      if (!text) {
        return
      }
      setPendingChatQuoteIntent({
        ...payload,
        quote: {
          ...payload.quote,
          text,
        },
        id: createIntentId("quote-to-input"),
      })
    },
    []
  )
  const persistAppState = useCallback(
    (nextSettings: AppSettings) => {
      if (!isAppStateLoaded) {
        return
      }
      void saveAppState({
        schemaVersion: APP_STATE_SCHEMA_VERSION,
        settings: nextSettings,
        sessions,
        projects,
        shellLayout: {
          sidebarWidth,
          chatWidth,
          isSidebarCollapsed,
          isWorkspaceCollapsed,
          sidebarSectionOrder,
        },
        windowState: initialState.windowState,
        expandedProjectIds: expandedProjectIds.filter((projectId) =>
          projects.some((project) => project.id === projectId)
        ),
        selectedProjectId: selectedProject?.id ?? "",
        selectedSessionId: selectedSession?.id ?? "",
        selectedWorkspaceExtensionId,
        workspaceTabs,
      })
    },
    [
      isAppStateLoaded,
      expandedProjectIds,
      chatWidth,
      isSidebarCollapsed,
      isWorkspaceCollapsed,
      projects,
      sessions,
      selectedProject?.id,
      selectedSession?.id,
      selectedWorkspaceExtensionId,
      sidebarSectionOrder,
      sidebarWidth,
      workspaceTabs,
      initialState.windowState,
    ]
  )
  const handleSettingsChange = useCallback(
    (nextSettings: AppSettings) => {
      const normalizedSettings = normalizeOusiaAppSettings(nextSettings)
      setSettings(normalizedSettings)
      persistAppState(normalizedSettings)
    },
    [persistAppState]
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
      setChatWidth(state.shellLayout.chatWidth)
      setIsSidebarCollapsed(state.shellLayout.isSidebarCollapsed)
      setIsWorkspaceCollapsed(state.shellLayout.isWorkspaceCollapsed)
      setSidebarSectionOrder(
        normalizeSidebarSectionOrder(state.shellLayout.sidebarSectionOrder)
      )
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
        chatWidth,
        isSidebarCollapsed,
        isWorkspaceCollapsed,
        sidebarSectionOrder,
      },
      windowState: initialState.windowState,
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
    chatWidth,
    isSidebarCollapsed,
    isWorkspaceCollapsed,
    projects,
    sessions,
    settings,
    selectedProject?.id,
    selectedSession?.id,
    selectedWorkspaceExtensionId,
    sidebarSectionOrder,
    sidebarWidth,
    workspaceTabs,
    initialState.windowState,
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
    const resizeTarget = event.currentTarget
    resizeTarget.setPointerCapture(event.pointerId)
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

  const expandSidebar = useCallback(async () => {
    await ensureShellWidthForPanel(
      sidebarWidth +
        RESIZE_HANDLE_WIDTH +
        MIN_CHAT_WIDTH +
        (shouldShowWorkspace ? RESIZE_HANDLE_WIDTH + MIN_WORKSPACE_WIDTH : 0),
      "right"
    )
    setIsSidebarCollapsed(false)
  }, [ensureShellWidthForPanel, shouldShowWorkspace, sidebarWidth])

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
        void expandSidebar()
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
          modelRegistry={modelRegistry}
          settings={settings}
          onClose={() => setIsSettingsOpen(false)}
          onSettingsChange={handleSettingsChange}
        />
      ) : (
        <>
          <ChatArea
            key={selectedChatKey}
            currentProject={selectedSession ? currentProject : undefined}
            currentSession={selectedSession}
            draftQuoteIntent={pendingChatQuoteIntent}
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
            onDraftQuoteIntentHandled={(id) => {
              setPendingChatQuoteIntent((current) =>
                current?.id === id ? null : current
              )
            }}
            onExpandWorkspace={() => {
              void expandWorkspace()
            }}
            onSettingsChange={handleSettingsChange}
            onToggleSidebar={() => {
              expandSidebar()
            }}
            modelRegistry={modelRegistry}
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
                  apiKey:
                    getOusiaModelProviderApiKey(settings)?.trim() || undefined,
                }}
                agentThinkingLevel={settings.thinkingLevel}
                initialWorkspaceTabs={workspaceTabs}
                onCollapse={() => setIsWorkspaceCollapsed(true)}
                onOpenProjectDirectory={handleOpenProject}
                onQuoteToInput={handleQuoteToInputIntent}
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
