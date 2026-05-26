import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Delete02Icon, LayoutRightIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import type {
  OusiaModelSettings,
  OusiaRuntimeExtensionsResult,
  OusiaThinkingLevel,
  OusiaWorkspaceAction,
} from "@/electron/chat-types"
import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import { ExtensionSlot } from "@/extensions/ExtensionSlot"
import { runtimeExtensionsToDefinitions } from "@/extensions/extensions"
import { extensionsBySlot } from "@/extensions/registry"
import type { ExtensionContext } from "@/extensions/types"
import {
  getWorkspaceExtensionIcon,
  getWorkspaceExtensionIconClass,
  getWorkspaceExtensionIconImages,
  isEdgeToEdgeWorkspaceExtension,
} from "@/extensions/workspace-extension-ui"
import {
  createWorkspaceTab,
  normalizeWorkspaceTabsState,
  type WorkspaceTab,
  type WorkspaceTabResource,
  type WorkspaceTabsState,
} from "@/extensions/workspace-tabs"

type WorkspaceProps = {
  currentProject?: ProjectRecord
  currentSession?: SessionRecord
  agentModel: OusiaModelSettings
  agentThinkingLevel: OusiaThinkingLevel
  initialWorkspaceTabs?: WorkspaceTabsState
  onCollapse: () => void
  pendingWorkspaceAction?: OusiaWorkspaceAction | null
  selectedWorkspaceExtensionId: string
  onWorkspaceTabsChange: (state: WorkspaceTabsState) => void
  onSelectWorkspaceExtension: (extensionId: string) => void
  onWorkspaceActionHandled?: (requestId: string) => void
}

export function Workspace({
  currentProject,
  currentSession,
  agentModel,
  agentThinkingLevel,
  initialWorkspaceTabs,
  onCollapse,
  pendingWorkspaceAction,
  selectedWorkspaceExtensionId,
  onWorkspaceTabsChange,
  onSelectWorkspaceExtension,
  onWorkspaceActionHandled,
}: WorkspaceProps) {
  const { theme, resolvedTheme } = useTheme()
  const [runtimeResult, setRuntimeResult] =
    useState<OusiaRuntimeExtensionsResult | null>(null)
  const [isManagingExtensions, setIsManagingExtensions] = useState(false)
  const [selectedExtensionDirs, setSelectedExtensionDirs] = useState<Set<string>>(
    () => new Set()
  )
  const tabListRef = useRef<HTMLDivElement>(null)
  const [isTabListOverflowing, setIsTabListOverflowing] = useState(false)
  const initialTabsState = normalizeWorkspaceTabsState(
    initialWorkspaceTabs,
    selectedWorkspaceExtensionId
  )
  const [tabs, setTabs] = useState<WorkspaceTab[]>(initialTabsState.tabs)
  const [activeTabId, setActiveTabId] = useState(initialTabsState.activeTabId)
  const [tabActions, setTabActions] = useState<
    Record<string, OusiaWorkspaceAction | undefined>
  >(() => workspaceResourceActions(initialTabsState.tabs))
  const runtimeExtensions = useMemo(
    () =>
      runtimeResult
        ? runtimeExtensionsToDefinitions(
            runtimeResult.extensions,
            runtimeResult.errors
          )
        : [],
    [runtimeResult]
  )
  const workspaceExtensions = useMemo(
    () => [
      ...extensionsBySlot("workspace.tab"),
      ...runtimeExtensions.filter((extension) => extension.slot === "workspace.tab"),
    ],
    [runtimeExtensions]
  )
  const extensionsById = useMemo(
    () => new Map(workspaceExtensions.map((extension) => [extension.id, extension])),
    [workspaceExtensions]
  )
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const baseContext: ExtensionContext = {
    extensionId: "",
    project: {
      id: currentProject?.id ?? "",
      name: currentProject?.name ?? "未选择项目",
      path: currentProject?.path ?? "",
    },
    conversation: {
      id: currentSession?.id ?? "",
      title: currentSession?.title ?? "未选择会话",
    },
    agent: {
      thinkingLevel: agentThinkingLevel,
      model: agentModel,
    },
    theme: {
      preference: theme,
      resolved: resolvedTheme,
    },
    state: createExtensionStateApi(""),
  }
  const manageableRuntimeExtensions = useMemo(
    () => [
      ...(runtimeResult?.extensions.map((extension) => ({
        id: extension.id,
        title: extension.title,
        extensionDir: extension.extensionDir,
        sourcePath: extension.sourcePath,
        status: "ready" as const,
      })) ?? []),
      ...(runtimeResult?.errors.flatMap((error) =>
        error.extensionDir
          ? [
              {
                id: error.id,
                title: error.title,
                extensionDir: error.extensionDir,
                sourcePath: error.sourcePath ?? error.extensionDir,
                status: "error" as const,
              },
            ]
          : []
      ) ?? []),
    ],
    [runtimeResult]
  )
  const updateTabListOverflow = useCallback(() => {
    const tabList = tabListRef.current
    if (!tabList) {
      return
    }
    setIsTabListOverflowing(tabList.scrollWidth - tabList.clientWidth > 1)
  }, [])

  useEffect(() => {
    onWorkspaceTabsChange({ tabs, activeTabId })
  }, [activeTabId, onWorkspaceTabsChange, tabs])

  useEffect(() => {
    if (!pendingWorkspaceAction) {
      return
    }
    queueMicrotask(() => {
      const existingTab = tabs.find(
        (tab) => tab.extensionId === pendingWorkspaceAction.extensionId
      )
      const targetTab =
        existingTab ?? createWorkspaceTab(pendingWorkspaceAction.extensionId)
      const resource = workspaceResourceFromAction(pendingWorkspaceAction)
      setIsManagingExtensions(false)
      if (!existingTab) {
        setTabs((current) => [
          ...current,
          resource ? { ...targetTab, resource } : targetTab,
        ])
      } else if (resource) {
        setTabs((current) =>
          current.map((tab) =>
            tab.id === targetTab.id ? { ...tab, resource } : tab
          )
        )
      }
      setActiveTabId(targetTab.id)
      setTabActions((actions) => ({
        ...actions,
        [targetTab.id]: pendingWorkspaceAction,
      }))
      onSelectWorkspaceExtension(pendingWorkspaceAction.extensionId)
      onWorkspaceActionHandled?.(pendingWorkspaceAction.requestId)
    })
  }, [
    onSelectWorkspaceExtension,
    onWorkspaceActionHandled,
    pendingWorkspaceAction,
    tabs,
  ])

  useLayoutEffect(() => {
    updateTabListOverflow()
  }, [tabs, updateTabListOverflow])

  useEffect(() => {
    const tabList = tabListRef.current
    if (!tabList) {
      return
    }
    const resizeObserver = new ResizeObserver(updateTabListOverflow)
    resizeObserver.observe(tabList)
    return () => resizeObserver.disconnect()
  }, [updateTabListOverflow])

  function getExtensionTitle(tab: WorkspaceTab) {
    if (!tab.extensionId) {
      return "新标签页"
    }
    return extensionsById.get(tab.extensionId)?.title ?? "缺失的扩展"
  }

  function handleSelectTab(tab: WorkspaceTab) {
    setActiveTabId(tab.id)
    if (tab.extensionId) {
      onSelectWorkspaceExtension(tab.extensionId)
    }
  }

  function handleNewTab() {
    const tab = createWorkspaceTab(null)
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
    setIsManagingExtensions(false)
  }

  function handleCloseTab(tabId: string) {
    setTabs((current) => {
      const closingIndex = current.findIndex((tab) => tab.id === tabId)
      const next = current.filter((tab) => tab.id !== tabId)
      if (tabId === activeTabId) {
        const nextActive =
          next[Math.min(closingIndex, next.length - 1)] ?? next.at(-1)
        setActiveTabId(nextActive?.id ?? "")
        if (nextActive?.extensionId) {
          onSelectWorkspaceExtension(nextActive.extensionId)
        }
      }
      return next
    })
  }

  function handleChooseExtension(extensionId: string) {
    setIsManagingExtensions(false)
    if (!activeTab) {
      const tab = createWorkspaceTab(extensionId)
      setTabs([tab])
      setActiveTabId(tab.id)
      onSelectWorkspaceExtension(extensionId)
      return
    }
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTab.id ? { ...tab, extensionId } : tab
      )
    )
    onSelectWorkspaceExtension(extensionId)
  }

  function toggleManagedExtension(extensionDir: string) {
    setSelectedExtensionDirs((current) => {
      const next = new Set(current)
      if (next.has(extensionDir)) {
        next.delete(extensionDir)
      } else {
        next.add(extensionDir)
      }
      return next
    })
  }

  async function deleteSelectedRuntimeExtensions() {
    if (!window.ousia || !selectedExtensionDirs.size) {
      return
    }
    const selectedDirs = new Set(selectedExtensionDirs)
    const selectedIds = new Set(
      manageableRuntimeExtensions
        .filter((extension) => selectedDirs.has(extension.extensionDir))
        .map((extension) => extension.id)
    )
    await Promise.all(
      [...selectedDirs].map((extensionDir) =>
        window.ousia!.deleteRuntimeExtension({ extensionDir })
      )
    )
    setSelectedExtensionDirs(new Set())
    setTabs((current) => {
      const next = current.filter(
        (tab) => !tab.extensionId || !selectedIds.has(tab.extensionId)
      )
      if (!next.length) {
        return [createWorkspaceTab(null)]
      }
      if (next.every((tab) => tab.id !== activeTabId)) {
        setActiveTabId(next[0].id)
      }
      return next
    })
    await refreshRuntimeExtensions()
  }

  const refreshRuntimeExtensions = useCallback(async () => {
    if (!window.ousia) {
      return
    }
    try {
      setRuntimeResult(await window.ousia.listRuntimeExtensions())
    } catch {
      // Runtime extensions are optional; workspace system tabs still work.
    }
  }, [])

  useEffect(() => {
    if (!window.ousia) {
      return
    }
    let isCancelled = false
    const removeRuntimeExtensionsChangedListener =
      window.ousia.onRuntimeExtensionsChanged(() => {
        void refreshRuntimeExtensions()
      })
    window.ousia
      .watchRuntimeExtensions()
      .then((result) => {
        if (!isCancelled) {
          setRuntimeResult(result)
        }
      })
      .catch(() => {
        // Runtime extensions are optional; workspace system tabs still work.
      })
    return () => {
      isCancelled = true
      removeRuntimeExtensionsChangedListener()
      void window.ousia?.unwatchRuntimeExtensions()
    }
  }, [refreshRuntimeExtensions])

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#fff] dark:bg-background">
      <div className="window-drag flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <div
          ref={tabListRef}
          className="flex min-w-0 flex-1 scrollbar-none gap-1 overflow-x-auto"
          role="tablist"
          aria-label="工作区标签页"
        >
          {tabs.map((tab) => {
            const Icon = getWorkspaceExtensionIcon(tab.extensionId)
            const isActive = tab.id === activeTab?.id
            return (
              <Button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                className="group/tab min-w-0 max-w-44 shrink-0 focus-visible:border-transparent focus-visible:ring-0"
                onClick={() => handleSelectTab(tab)}
                title={getExtensionTitle(tab)}
              >
                <span className="relative grid size-5 shrink-0 place-items-center">
                  <Icon className="size-5 transition-opacity group-hover/tab:opacity-0" />
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 grid place-items-center rounded-sm opacity-0 transition-opacity group-hover/tab:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleCloseTab(tab.id)
                    }}
                  >
                    <X className="size-4" strokeWidth={2.2} />
                  </span>
                </span>
                <span className="min-w-0 truncate">{getExtensionTitle(tab)}</span>
              </Button>
            )
          })}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={[
              "shrink-0",
              isTabListOverflowing ? "pointer-events-none opacity-0" : "",
            ].join(" ")}
            aria-hidden={isTabListOverflowing}
            aria-label="新建工作区标签页"
            tabIndex={isTabListOverflowing ? -1 : 0}
            onClick={handleNewTab}
            title="新标签页"
          >
            <Plus className="size-4" strokeWidth={2} />
          </Button>
        </div>
        {isTabListOverflowing ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="新建工作区标签页"
            onClick={handleNewTab}
            title="新标签页"
          >
            <Plus className="size-4" strokeWidth={2} />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="收起工作区"
          onClick={onCollapse}
        >
          <HugeiconsIcon icon={LayoutRightIcon} size={19} strokeWidth={1.8} />
        </Button>
      </div>

      {activeTab?.extensionId ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          {tabs.map((tab) => {
            if (!tab.extensionId) {
              return null
            }
            const extension = extensionsById.get(tab.extensionId)
            if (!extension) {
              return null
            }
            return (
              <div
                key={tab.id}
                hidden={tab.id !== activeTab.id}
                className={[
                  "h-full min-h-0 max-h-full",
                  isEdgeToEdgeWorkspaceExtension(tab.extensionId)
                    ? "overflow-hidden p-0"
                    : "ousia-hover-scrollbar overflow-auto p-4",
                ].join(" ")}
              >
                <ExtensionSlot
                  extension={extension}
                  context={{
                    ...baseContext,
                    extensionId: extension.id,
                    tabId: tab.id,
                    action: tabActions[tab.id],
                    resource: tab.resource,
                    state: createExtensionStateApi(extension.id),
                  }}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div className="ousia-hover-scrollbar relative min-h-0 flex-1 overflow-auto px-10 py-5 pb-24 sm:px-14 lg:px-20 xl:px-24">
          <div className="pointer-events-none absolute right-10 bottom-5 z-20 flex items-center justify-end gap-2 sm:right-14 lg:right-20 xl:right-24">
            {isManagingExtensions ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="pointer-events-auto bg-background/90 shadow-sm backdrop-blur"
                  onClick={() => {
                    setIsManagingExtensions(false)
                    setSelectedExtensionDirs(new Set())
                  }}
                >
                  完成
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="pointer-events-auto shadow-sm"
                  disabled={!selectedExtensionDirs.size}
                  onClick={() => void deleteSelectedRuntimeExtensions()}
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    size={16}
                    strokeWidth={1.8}
                  />
                  删除
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="pointer-events-auto bg-background/90 shadow-sm backdrop-blur"
                onClick={() => setIsManagingExtensions(true)}
              >
                管理扩展
              </Button>
            )}
          </div>

          {isManagingExtensions ? (
            <div className="flex min-h-full items-center justify-center">
              <div className="grid w-full max-w-[760px] grid-cols-[repeat(auto-fit,minmax(136px,1fr))] justify-items-center gap-x-14 gap-y-14">
                {manageableRuntimeExtensions.length ? (
                  manageableRuntimeExtensions.map((extension) => {
                    const isSelected = selectedExtensionDirs.has(
                      extension.extensionDir
                    )
                    const Icon = getWorkspaceExtensionIcon(extension.id)
                    const iconImages = getWorkspaceExtensionIconImages(extension.id)
                    return (
                      <button
                        key={extension.extensionDir}
                        type="button"
                        className={[
                          "group flex w-[136px] min-w-0 flex-col items-center gap-4 rounded-xl px-2 py-3 text-center text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                          isSelected ? "bg-accent" : "",
                        ].join(" ")}
                        onClick={() =>
                          toggleManagedExtension(extension.extensionDir)
                        }
                      >
                        <span
                          className={[
                            "relative grid size-28 shrink-0 place-items-center overflow-hidden rounded-[28px] border border-white/20 ring-1 ring-black/5 transition-transform group-hover:-translate-y-0.5",
                            iconImages
                              ? "bg-card"
                              : getWorkspaceExtensionIconClass(extension.id),
                          ].join(" ")}
                        >
                          {iconImages ? (
                            <>
                              <img
                                src={iconImages.light}
                                alt=""
                                className="size-full object-cover dark:hidden"
                                draggable={false}
                              />
                              <img
                                src={iconImages.dark}
                                alt=""
                                className="hidden size-full object-cover dark:block"
                                draggable={false}
                              />
                            </>
                          ) : (
                            <Icon className="size-14" />
                          )}
                          <span
                            aria-hidden="true"
                            className={[
                              "absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full border dark:shadow-sm",
                              isSelected
                                ? "border-background bg-ring"
                                : "border-white/45 bg-background/80 opacity-0 group-hover:opacity-100",
                            ].join(" ")}
                          />
                        </span>
                        <span className="min-w-0 max-w-full px-1">
                          <span className="block truncate text-sm font-medium leading-tight">
                            {extension.title}
                          </span>
                          <span className="mt-1 block truncate text-xs leading-tight text-muted-foreground">
                            {extension.status === "error"
                              ? "加载失败"
                              : "本地用户扩展"}
                          </span>
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <div className="col-span-full rounded-lg border bg-card p-6 text-sm text-muted-foreground">
                    未找到运行时扩展。
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-full items-center justify-center">
              <div className="grid w-full max-w-[760px] grid-cols-[repeat(auto-fit,minmax(136px,1fr))] justify-items-center gap-x-14 gap-y-14">
                {workspaceExtensions.map((extension) => {
                  const Icon = getWorkspaceExtensionIcon(extension.id)
                  const iconImages = getWorkspaceExtensionIconImages(extension.id)
                  return (
                    <button
                      key={extension.id}
                      type="button"
                      className="group flex w-[136px] min-w-0 flex-col items-center gap-4 rounded-xl px-2 py-3 text-center text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      onClick={() => handleChooseExtension(extension.id)}
                    >
                      <span
                        className={[
                          "grid size-28 shrink-0 place-items-center overflow-hidden rounded-[28px] border border-white/20 ring-1 ring-black/5 transition-transform group-hover:-translate-y-0.5",
                          iconImages
                            ? "bg-card"
                            : getWorkspaceExtensionIconClass(extension.id),
                        ].join(" ")}
                      >
                        {iconImages ? (
                          <>
                            <img
                              src={iconImages.light}
                              alt=""
                              className="size-full object-cover dark:hidden"
                              draggable={false}
                            />
                            <img
                              src={iconImages.dark}
                              alt=""
                              className="hidden size-full object-cover dark:block"
                              draggable={false}
                            />
                          </>
                        ) : (
                          <Icon className="size-14" />
                        )}
                      </span>
                      <span className="min-w-0 max-w-full truncate px-1 text-base font-medium leading-tight">
                        {extension.title}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

const extensionStateApiCache = new Map<string, ExtensionContext["state"]>()

function createExtensionStateApi(extensionId: string): ExtensionContext["state"] {
  const cached = extensionStateApiCache.get(extensionId)
  if (cached) {
    return cached
  }
  const api: ExtensionContext["state"] = {
    async get(scope, key) {
      if (!window.ousia || !extensionId) {
        return null
      }
      const result = await window.ousia.getExtensionState({
        extensionId,
        scope,
        key,
      })
      return result.value
    },
    async set(scope, key, value) {
      if (!window.ousia || !extensionId) {
        return
      }
      await window.ousia.setExtensionState({
        extensionId,
        scope,
        key,
        value,
      })
    },
    async delete(scope, key) {
      if (!window.ousia || !extensionId) {
        return
      }
      await window.ousia.deleteExtensionState({
        extensionId,
        scope,
        key,
      })
    },
  }
  extensionStateApiCache.set(extensionId, api)
  return api
}

function workspaceResourceFromAction(
  action: OusiaWorkspaceAction
): WorkspaceTabResource | undefined {
  if (action.action !== "openFile") {
    return undefined
  }
  if (!action.args || typeof action.args !== "object" || Array.isArray(action.args)) {
    return undefined
  }
  const args = action.args as {
    path?: unknown
    name?: unknown
    projectPath?: unknown
  }
  if (typeof args.path !== "string" || !args.path.trim()) {
    return undefined
  }
  return {
    kind: "file",
    path: args.path,
    ...(typeof args.name === "string" ? { name: args.name } : {}),
    ...(typeof args.projectPath === "string"
      ? { projectPath: args.projectPath }
      : {}),
  }
}

function workspaceResourceActions(tabs: WorkspaceTab[]) {
  return Object.fromEntries(
    tabs.flatMap((tab) => {
      if (!tab.extensionId || tab.resource?.kind !== "file") {
        return []
      }
      return [
        [
          tab.id,
          {
            type: "extension.invoke",
            extensionId: tab.extensionId,
            action: "openFile",
            args: tab.resource,
            requestId: `restore-${tab.id}`,
          } satisfies OusiaWorkspaceAction,
        ],
      ]
    })
  )
}
