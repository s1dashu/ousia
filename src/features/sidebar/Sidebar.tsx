import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { createPortal } from "react-dom"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
} from "framer-motion"
import {
  FolderOpen,
  MoreHorizontal,
  Settings,
} from "@/components/icons/huge-icons"

import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import { getMessages } from "@/app/i18n"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  OusiaLanguage,
  OusiaSidebarSectionId,
  OusiaUpdateStatus,
} from "@/electron/chat-types"
import {
  isOusiaSidebarSectionId,
  normalizeOusiaSidebarSectionOrder,
} from "@/electron/app-state-collections"
import {
  defaultSessionGroupId,
  escapeAttributeSelectorValue,
  getSortableData,
  projectIdFromSessionGroup,
  sidebarCollisionDetection,
} from "@/features/sidebar/sidebar-dnd"
import {
  createSidebarDropAnimation,
  SIDEBAR_DRAG_LAND_EASE,
} from "@/features/sidebar/sidebar-drag-motion"
import {
  DragPreview,
  SidebarActionTooltip,
  SortableProjectSection,
  SortableSessionRow,
  SortableSidebarSection,
  type SidebarDragPreview,
} from "@/features/sidebar/SidebarItems"
import {
  handleTextButtonMouseDown,
  sidebarActionButtonClass,
  sidebarActionHoverClass,
  sidebarDefaultSessionPreviewCount,
  sidebarDragOverlayZIndex,
  sidebarEmptySectionRowXClass,
  sidebarFooterPaddingXClass,
  sidebarIconStrokeWidth,
  sidebarListGapClass,
  sidebarMenuIconSize,
  sidebarMenuIconXClass,
  sidebarProjectSessionCompactCount,
  sidebarProjectSessionGridClass,
  sidebarProjectSessionPreviewCount,
  sidebarRowStateClass,
  sidebarRowXClass,
  sidebarScrollPaddingXClass,
  sidebarScrollRevealPadding,
  sidebarSessionRowXClass,
  sidebarSingleActionGridClass,
} from "@/features/sidebar/sidebar-layout"

type SidebarMoveSessionTarget = {
  sessionId: string
  targetProjectId?: string
  targetSessionId?: string
}

const sidebarDragTiltAt = 800
const sidebarDragTiltMax = 2.5

type SidebarProps = {
  onArchiveProject: (projectId: string) => void
  onCreateProjectSession: (projectId: string) => void
  onCreateSession: () => void
  onDeleteProject: (projectId: string) => void
  onArchiveSession: (sessionId: string) => void
  onExpandedProjectIdsChange: (projectIds: string[]) => void
  onMoveSession: (target: SidebarMoveSessionTarget) => void | Promise<void>
  onOpenProject: () => void
  onOpenSettings: () => void
  onShowDefaultSessionInFolder: () => void
  onShowProjectInFolder: (projectId: string) => void
  onUpdateAction: () => void
  onRenameSession: (sessionId: string, title: string) => void
  onReorderProjects: (sourceProjectId: string, targetProjectId: string) => void
  onReorderSidebarSections: (
    sourceSectionId: OusiaSidebarSectionId,
    targetSectionId: OusiaSidebarSectionId
  ) => void
  onReorderSessions: (sourceSessionId: string, targetSessionId: string) => void
  onSelectSession: (sessionId: string) => void
  onScrollTargetHandled: () => void
  expandedProjectIds: string[]
  projects: ProjectRecord[]
  selectedSessionId: string
  sidebarSectionOrder: OusiaSidebarSectionId[]
  scrollTargetSessionId: string
  sessionRunStatusById: Record<string, "idle" | "working">
  unreadCompletedSessionIds: Set<string>
  sessions: SessionRecord[]
  language: OusiaLanguage
  updateStatus: OusiaUpdateStatus
  style: CSSProperties
}

function AnimatedDragPreview({
  lift,
  preview,
  reduceMotion,
  screenX,
  tiltGain,
}: {
  lift: MotionValue<number>
  preview: SidebarDragPreview
  reduceMotion: boolean
  screenX: MotionValue<number>
  tiltGain: MotionValue<number>
}) {
  const velocityX = useVelocity(screenX)
  const tiltTarget = useTransform(
    velocityX,
    [-sidebarDragTiltAt, sidebarDragTiltAt],
    [-sidebarDragTiltMax, sidebarDragTiltMax],
    { clamp: true }
  )
  const tiltSpring = useSpring(tiltTarget, {
    stiffness: 300,
    damping: 30,
    mass: 0.6,
  })
  const tilt = useTransform(() =>
    reduceMotion ? 0 : tiltSpring.get() * tiltGain.get()
  )
  const scale = useTransform(lift, [0, 1], [1, 1.02])
  const y = useTransform(lift, [0, 1], [0, -2])

  return (
    <motion.div
      data-sidebar-drag-preview=""
      className="relative will-change-transform"
      style={{
        rotate: tilt,
        scale,
        transformOrigin: "50% 65%",
        y,
      }}
    >
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[var(--ousia-sidebar-selected-radius)] shadow-[0_14px_30px_-17px_rgba(24,24,27,0.34),0_5px_14px_-8px_rgba(24,24,27,0.2)] dark:shadow-[0_16px_34px_-16px_rgba(0,0,0,0.8),0_5px_15px_-7px_rgba(0,0,0,0.58)]"
        style={{ opacity: lift }}
      />
      <div className="relative">
        <DragPreview preview={preview} />
      </div>
    </motion.div>
  )
}

function SidebarComponent({
  onArchiveProject,
  onCreateProjectSession,
  onCreateSession,
  onDeleteProject,
  onArchiveSession,
  onExpandedProjectIdsChange,
  onMoveSession,
  onOpenProject,
  onOpenSettings,
  onShowDefaultSessionInFolder,
  onShowProjectInFolder,
  onUpdateAction,
  onRenameSession,
  onReorderProjects,
  onReorderSidebarSections,
  onReorderSessions,
  onSelectSession,
  onScrollTargetHandled,
  expandedProjectIds,
  projects,
  selectedSessionId,
  sidebarSectionOrder,
  scrollTargetSessionId,
  sessionRunStatusById,
  unreadCompletedSessionIds,
  sessions,
  language,
  updateStatus,
  style,
}: SidebarProps) {
  const t = getMessages(language)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingSessionTitle, setEditingSessionTitle] = useState("")
  const [isDefaultSessionListCompact, setIsDefaultSessionListCompact] =
    useState(true)
  const [compactProjectSessionIds, setCompactProjectSessionIds] = useState<
    string[]
  >([])
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<
    OusiaSidebarSectionId[]
  >([])
  const [dragPreview, setDragPreview] = useState<SidebarDragPreview | null>(
    null
  )
  const reduceDragMotion = useReducedMotion() ?? false
  const dragScreenX = useMotionValue(0)
  const dragLift = useMotionValue(0)
  const dragTiltGain = useMotionValue(0)
  const shouldAnimateDrop = useMotionValue(false)
  const editingInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const defaultSessions = sessions.filter((session) => !session.projectId)
  const isDefaultSessionSelected = defaultSessions.some(
    (session) => session.id === selectedSessionId
  )
  const canCompactDefaultSessions =
    defaultSessions.length > sidebarDefaultSessionPreviewCount
  const visibleDefaultSessions =
    canCompactDefaultSessions && isDefaultSessionListCompact
      ? defaultSessions.slice(0, sidebarDefaultSessionPreviewCount)
      : defaultSessions
  const visibleSidebarSectionOrder =
    normalizeOusiaSidebarSectionOrder(sidebarSectionOrder)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  const dropAnimation = useMemo(
    () => createSidebarDropAnimation(shouldAnimateDrop),
    [shouldAnimateDrop]
  )
  const visibleExpandedProjectIds = useMemo(() => {
    const projectIds = new Set(projects.map((project) => project.id))
    return new Set(
      expandedProjectIds.filter((projectId) => projectIds.has(projectId))
    )
  }, [expandedProjectIds, projects])

  useEffect(() => {
    if (!editingSessionId) {
      return
    }
    editingInputRef.current?.focus()
    editingInputRef.current?.select()
  }, [editingSessionId])

  useEffect(() => {
    if (!scrollTargetSessionId) {
      return
    }

    let animationFrameId = 0
    let nextAnimationFrameId = 0
    animationFrameId = window.requestAnimationFrame(() => {
      nextAnimationFrameId = window.requestAnimationFrame(() => {
        const container = scrollContainerRef.current
        const target = container?.querySelector<HTMLElement>(
          `[data-sidebar-session-id="${escapeAttributeSelectorValue(scrollTargetSessionId)}"]`
        )
        if (container && target) {
          const containerRect = container.getBoundingClientRect()
          const targetRect = target.getBoundingClientRect()
          const revealTop = containerRect.top + sidebarScrollRevealPadding
          const revealBottom = containerRect.bottom - sidebarScrollRevealPadding
          const isTargetVisible =
            targetRect.top >= revealTop && targetRect.bottom <= revealBottom

          if (!isTargetVisible) {
            const scrollDelta =
              targetRect.top < revealTop
                ? targetRect.top - revealTop
                : targetRect.bottom - revealBottom

            container.scrollTo({
              top: container.scrollTop + scrollDelta,
              behavior: "smooth",
            })
          }
        }
        onScrollTargetHandled()
      })
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      window.cancelAnimationFrame(nextAnimationFrameId)
    }
  }, [onScrollTargetHandled, scrollTargetSessionId])

  useEffect(() => {
    if (!dragPreview) {
      return
    }

    function clearDragPreview() {
      setDragPreview(null)
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        clearDragPreview()
      }
    }

    window.addEventListener("blur", clearDragPreview)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.removeEventListener("blur", clearDragPreview)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [dragPreview])

  function startRenameSession(session: SessionRecord) {
    setEditingSessionId(session.id)
    setEditingSessionTitle(session.title)
  }

  function cancelRenameSession() {
    setEditingSessionId(null)
    setEditingSessionTitle("")
  }

  function commitRenameSession(session: SessionRecord) {
    const nextTitle = editingSessionTitle.trim()
    if (nextTitle && nextTitle !== session.title) {
      onRenameSession(session.id, nextTitle)
    }
    cancelRenameSession()
  }

  function toggleProject(projectId: string) {
    onExpandedProjectIdsChange(
      visibleExpandedProjectIds.has(projectId)
        ? expandedProjectIds.filter((id) => id !== projectId)
        : [...expandedProjectIds, projectId]
    )
  }

  function toggleSidebarSection(sectionId: OusiaSidebarSectionId) {
    setCollapsedSectionIds((current) =>
      current.includes(sectionId)
        ? current.filter((id) => id !== sectionId)
        : [...current, sectionId]
    )
  }

  function handleDragStart(event: DragStartEvent) {
    const data = getSortableData(event.active.data.current)
    if (!data) {
      return
    }
    shouldAnimateDrop.jump(false)
    dragScreenX.jump(0)
    dragLift.jump(0)
    dragTiltGain.jump(reduceDragMotion ? 0 : 1)
    if (!reduceDragMotion) {
      animate(dragLift, 1, {
        type: "spring",
        stiffness: 420,
        damping: 32,
        mass: 0.55,
      })
    }
    setDragPreview({
      ...data,
      id: String(event.active.id),
    })
  }

  function handleDragMove(event: DragMoveEvent) {
    if (!reduceDragMotion) {
      dragScreenX.set(event.delta.x)
    }
  }

  function settleDragPreview(animateLanding: boolean) {
    shouldAnimateDrop.jump(animateLanding && !reduceDragMotion)
    if (!shouldAnimateDrop.get()) {
      dragLift.jump(0)
      dragTiltGain.jump(0)
      return
    }
    animate(dragTiltGain, 0, {
      duration: 0.11,
      ease: SIDEBAR_DRAG_LAND_EASE,
    })
    animate(dragLift, 0, {
      duration: 0.15,
      ease: SIDEBAR_DRAG_LAND_EASE,
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeData = getSortableData(event.active.data.current)
    const overData = getSortableData(event.over?.data.current)
    if (!activeData || !overData || !event.over) {
      settleDragPreview(false)
      setDragPreview(null)
      return
    }

    if (activeData.kind === "session") {
      settleDragPreview(
        overData.kind === "session" && activeData.groupId === overData.groupId
      )
      const sourceSessionId = String(event.active.id)
      if (overData.kind === "session") {
        if (
          event.active.id !== event.over.id &&
          activeData.groupId === overData.groupId
        ) {
          onReorderSessions(sourceSessionId, String(event.over.id))
        } else if (
          activeData.groupId !== overData.groupId &&
          overData.groupId
        ) {
          void onMoveSession({
            sessionId: sourceSessionId,
            targetProjectId: projectIdFromSessionGroup(overData.groupId),
            targetSessionId: String(event.over.id),
          })
        }
      } else if (overData.kind === "project") {
        void onMoveSession({
          sessionId: sourceSessionId,
          targetProjectId: String(event.over.id),
        })
      } else if (
        overData.kind === "section" &&
        String(event.over.id) === "sessions"
      ) {
        void onMoveSession({
          sessionId: sourceSessionId,
          targetProjectId: undefined,
        })
      }
      setDragPreview(null)
      return
    }

    if (event.active.id === event.over.id) {
      settleDragPreview(activeData.kind === overData.kind)
      setDragPreview(null)
      return
    }

    settleDragPreview(activeData.kind === overData.kind)
    if (activeData.kind === "section" && overData.kind === "section") {
      const activeSectionId = String(event.active.id)
      const overSectionId = String(event.over.id)
      if (
        isOusiaSidebarSectionId(activeSectionId) &&
        isOusiaSidebarSectionId(overSectionId)
      ) {
        onReorderSidebarSections(activeSectionId, overSectionId)
      }
    } else if (activeData.kind === "project" && overData.kind === "project") {
      onReorderProjects(String(event.active.id), String(event.over.id))
    }
    setDragPreview(null)
  }

  function handleDragCancel() {
    settleDragPreview(false)
    setDragPreview(null)
  }

  function renderSessionRow(
    session: SessionRecord,
    options: { projectChild?: boolean; groupId: string }
  ) {
    return (
      <SortableSessionRow
        key={session.id}
        editingInputRef={editingInputRef}
        editingSessionId={editingSessionId}
        editingSessionTitle={editingSessionTitle}
        groupId={options.groupId}
        onCancelRename={cancelRenameSession}
        onCommitRename={commitRenameSession}
        onArchiveSession={onArchiveSession}
        onRenameTitleChange={setEditingSessionTitle}
        onSelectSession={onSelectSession}
        onStartRename={startRenameSession}
        projectChild={options.projectChild}
        selectedSessionId={selectedSessionId}
        session={session}
        sessionHasUnreadCompletion={unreadCompletedSessionIds.has(session.id)}
        sessionRunStatus={sessionRunStatusById[session.id] ?? "idle"}
        t={t}
      />
    )
  }

  function renderSessionsSection() {
    return (
      <SortableSidebarSection
        key="sessions"
        id="sessions"
        label={t.sidebar.sessions}
        isCollapsed={collapsedSectionIds.includes("sessions")}
        actionLabel={t.sidebar.newSession}
        toggleLabel={t.sidebar.toggleSection(t.sidebar.sessions)}
        onAction={onCreateSession}
        onToggleCollapsed={toggleSidebarSection}
        beforeAction={
          isDefaultSessionSelected ? (
            <DropdownMenu modal={false}>
              <SidebarActionTooltip label={t.sidebar.defaultSessionActions}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={`${sidebarActionButtonClass} ${sidebarActionHoverClass}`}
                    aria-label={t.sidebar.defaultSessionActions}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <MoreHorizontal
                      className={`${sidebarMenuIconXClass} text-muted-foreground`}
                      size={sidebarMenuIconSize}
                      strokeWidth={sidebarIconStrokeWidth}
                    />
                  </Button>
                </DropdownMenuTrigger>
              </SidebarActionTooltip>
              <DropdownMenuContent align="end" className="w-auto min-w-44">
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation()
                    onShowDefaultSessionInFolder()
                  }}
                >
                  <FolderOpen className="text-muted-foreground" />
                  {t.sidebar.openDefaultSessionFolder}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      >
        <SortableContext
          items={visibleDefaultSessions.map((session) => session.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className={sidebarListGapClass}>
            {defaultSessions.length ? (
              visibleDefaultSessions.map((session) =>
                renderSessionRow(session, {
                  groupId: defaultSessionGroupId,
                })
              )
            ) : (
              <div
                className={`h-9 text-sm leading-9 text-muted-foreground/45 ${sidebarEmptySectionRowXClass}`}
              >
                {t.sidebar.noSessions}
              </div>
            )}
            {canCompactDefaultSessions ? (
              <button
                type="button"
                className={[
                  "font-radix-regular grid h-8 items-center text-left text-xs text-muted-foreground/65 outline-none hover:text-muted-foreground focus-visible:text-muted-foreground",
                  sidebarSingleActionGridClass,
                  sidebarSessionRowXClass,
                ].join(" ")}
                onMouseDown={handleTextButtonMouseDown}
                onClick={() => {
                  setIsDefaultSessionListCompact((current) => !current)
                }}
              >
                <span>
                  {isDefaultSessionListCompact
                    ? t.sidebar.showMore
                    : t.sidebar.showLess}
                </span>
              </button>
            ) : null}
          </div>
        </SortableContext>
      </SortableSidebarSection>
    )
  }

  function renderProjectsSection() {
    return (
      <SortableSidebarSection
        key="projects"
        id="projects"
        label={t.sidebar.projects}
        isCollapsed={collapsedSectionIds.includes("projects")}
        actionLabel={t.sidebar.createProject}
        toggleLabel={t.sidebar.toggleSection(t.sidebar.projects)}
        onAction={onOpenProject}
        onToggleCollapsed={toggleSidebarSection}
      >
        <SortableContext
          items={projects.map((project) => project.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className={sidebarListGapClass}>
            {projects.map((project) => {
              const isExpanded = visibleExpandedProjectIds.has(project.id)
              const projectSessions = sessions.filter(
                (session) => session.projectId === project.id
              )
              const canCompactProjectSessions =
                projectSessions.length > sidebarProjectSessionPreviewCount
              const isProjectSessionListCompact =
                compactProjectSessionIds.includes(project.id)
              const visibleProjectSessions =
                canCompactProjectSessions && isProjectSessionListCompact
                  ? projectSessions.slice(0, sidebarProjectSessionCompactCount)
                  : projectSessions
              return (
                <SortableProjectSection
                  key={project.id}
                  hasWorkingSession={projectSessions.some(
                    (session) => sessionRunStatusById[session.id] === "working"
                  )}
                  isExpanded={isExpanded}
                  onArchiveProject={onArchiveProject}
                  onCreateProjectSession={onCreateProjectSession}
                  onDeleteProject={onDeleteProject}
                  onShowProjectInFolder={onShowProjectInFolder}
                  onToggleProject={toggleProject}
                  project={project}
                  t={t}
                >
                  {isExpanded ? (
                    <div className="-my-1 overflow-visible py-1">
                      <SortableContext
                        items={visibleProjectSessions.map(
                          (session) => session.id
                        )}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className={`${sidebarListGapClass} pt-px`}>
                          {projectSessions.length ? (
                            visibleProjectSessions.map((session) =>
                              renderSessionRow(session, {
                                groupId: project.id,
                                projectChild: true,
                              })
                            )
                          ) : (
                            <div className="h-9 px-3 text-sm leading-9 text-muted-foreground/45">
                              {t.sidebar.noSessions}
                            </div>
                          )}
                          {canCompactProjectSessions ? (
                            <button
                              type="button"
                              className={[
                                "font-radix-regular grid h-8 items-center text-left text-xs text-muted-foreground/65 outline-none hover:text-muted-foreground focus-visible:text-muted-foreground",
                                sidebarProjectSessionGridClass,
                                sidebarRowXClass,
                              ].join(" ")}
                              onMouseDown={handleTextButtonMouseDown}
                              onClick={() => {
                                setCompactProjectSessionIds((current) =>
                                  isProjectSessionListCompact
                                    ? current.filter((id) => id !== project.id)
                                    : [...current, project.id]
                                )
                              }}
                            >
                              <span aria-hidden="true" />
                              <span>
                                {isProjectSessionListCompact
                                  ? t.sidebar.showMore
                                  : t.sidebar.showLess}
                              </span>
                            </button>
                          ) : null}
                        </div>
                      </SortableContext>
                    </div>
                  ) : null}
                </SortableProjectSection>
              )
            })}
            {!projects.length ? (
              <div
                className={`h-9 text-sm leading-9 text-muted-foreground/45 ${sidebarEmptySectionRowXClass}`}
              >
                {t.sidebar.noProjects}
              </div>
            ) : null}
          </div>
        </SortableContext>
      </SortableSidebarSection>
    )
  }

  function renderSidebarSection(sectionId: OusiaSidebarSectionId) {
    return sectionId === "sessions"
      ? renderSessionsSection()
      : renderProjectsSection()
  }

  const dragOverlay = (
    <DragOverlay
      zIndex={sidebarDragOverlayZIndex}
      dropAnimation={dropAnimation}
    >
      {dragPreview ? (
        <AnimatedDragPreview
          lift={dragLift}
          preview={dragPreview}
          reduceMotion={reduceDragMotion}
          screenX={dragScreenX}
          tiltGain={dragTiltGain}
        />
      ) : null}
    </DragOverlay>
  )

  return (
    <aside
      className="ousia-sidebar-shell ousia-sidebar-theme flex min-h-0 shrink-0 flex-col bg-sidebar text-sidebar-foreground"
      style={style}
    >
      <div className="window-drag h-[var(--ousia-titlebar-height)] shrink-0" />

      <div
        ref={scrollContainerRef}
        className={`ousia-hover-scrollbar ousia-sidebar-scrollbar-gutter min-h-0 flex-1 overflow-auto ${sidebarScrollPaddingXClass} pb-2`}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={sidebarCollisionDetection}
          onDragAbort={handleDragCancel}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={visibleSidebarSectionOrder}
            strategy={verticalListSortingStrategy}
          >
            {visibleSidebarSectionOrder.map(renderSidebarSection)}
          </SortableContext>
          {createPortal(dragOverlay, document.body)}
        </DndContext>
      </div>

      <div
        className={`${sidebarFooterPaddingXClass} flex items-center gap-1 py-2`}
      >
        <Button
          type="button"
          variant="ghost"
          className={`font-radix-regular h-9 min-w-0 flex-1 justify-start gap-2 rounded-lg text-sm ${sidebarRowStateClass}`}
          onClick={onOpenSettings}
        >
          <Settings size={18} strokeWidth={sidebarIconStrokeWidth} />
          <span>{t.sidebar.settings}</span>
        </Button>
        {updateStatus.phase === "available" ||
        updateStatus.phase === "checking" ||
        updateStatus.phase === "downloading" ||
        updateStatus.phase === "downloaded" ||
        updateStatus.phase === "error" ? (
          <Button
            type="button"
            size="xs"
            variant={updateStatus.phase === "error" ? "destructive" : "default"}
            className="shrink-0 border-transparent"
            disabled={
              updateStatus.phase === "checking" ||
              updateStatus.phase === "downloading"
            }
            title={
              updateStatus.phase === "error"
                ? `${t.sidebar.updateFailed} ${updateStatus.message}`
                : updateStatus.phase === "downloaded"
                  ? t.sidebar.restartToUpdate
                  : updateStatus.phase === "checking"
                    ? t.sidebar.checkingForUpdate
                    : updateStatus.phase === "downloading"
                      ? t.sidebar.updating
                      : `${t.sidebar.update} ${updateStatus.version}`
            }
            onClick={onUpdateAction}
          >
            {updateStatus.phase === "downloaded"
              ? t.sidebar.restartToUpdate
              : updateStatus.phase === "checking"
                ? t.sidebar.checkingForUpdate
                : updateStatus.phase === "downloading"
                  ? t.sidebar.updating
                  : updateStatus.phase === "error"
                    ? t.sidebar.updateFailed
                    : t.sidebar.update}
          </Button>
        ) : null}
      </div>
    </aside>
  )
}

export const Sidebar = memo(SidebarComponent)
