import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react"
import { createPortal } from "react-dom"
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  Archive,
  ChevronDown,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Settings,
  Trash2,
} from "@/components/icons/huge-icons"

import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import { getMessages, type I18nMessages } from "@/app/i18n"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  OusiaLanguage,
  OusiaSidebarSectionId,
  OusiaUpdateStatus,
} from "@/electron/chat-types"

const sidebarAddIconSize = 18
const sidebarFolderIconSize = 18
const sidebarMenuIconSize = 18
const sidebarSectionIconSize = 14
const sidebarIconStrokeWidth = 1.5
const sidebarActionButtonClass = "size-6 justify-self-end"
const sidebarSingleActionGridClass = "grid-cols-[minmax(0,1fr)_24px]"
const sidebarProjectActionButtonClass = "size-6 justify-self-end"
const sidebarProjectLeadGridClass = "grid-cols-[24px_minmax(0,1fr)_24px_24px]"
const sidebarProjectSessionGridClass = "grid-cols-[24px_minmax(0,1fr)_24px]"
const sidebarScrollPaddingXClass = "px-0"
const sidebarFooterPaddingXClass = "px-[7px]"
const sidebarRowFrameXClass = "-ml-1 w-full"
const sidebarRowContentXClass = "pl-3 pr-2"
const sidebarRowXClass = `${sidebarRowFrameXClass} ${sidebarRowContentXClass}`
const sidebarSessionRowXClass = "mr-1 pl-2 pr-1"
const sidebarSessionDragPreviewXClass = "px-3"
const sidebarRightActionRowXClass = `${sidebarRowFrameXClass} pl-3 pr-1`
const sidebarProjectRowXClass = sidebarRightActionRowXClass
const sidebarListGapClass = "flex flex-col gap-0.5"
const sidebarSectionHeaderXClass = sidebarRightActionRowXClass
const sidebarEmptySectionRowXClass = sidebarSectionHeaderXClass
const sidebarDefaultSessionPreviewCount = 10
const sidebarProjectSessionCompactCount = 5
const sidebarProjectSessionPreviewCount = 10
const sidebarScrollRevealPadding = 12
const sidebarRowStateClass =
  "text-sidebar-accent-foreground hover:bg-[var(--sidebar-accent)]"
const sidebarProjectRowStateClass =
  "relative text-sidebar-accent-foreground before:pointer-events-none before:absolute before:inset-0 before:rounded-md before:bg-transparent hover:before:bg-[var(--sidebar-accent)] focus-within:before:bg-[var(--sidebar-accent)] [&>*]:relative [&>*]:z-[1]"
const sidebarSelectedRowClass =
  "bg-white text-sidebar-accent-foreground shadow-[var(--ousia-sidebar-selected-shadow)] dark:bg-card"
const sidebarActionHoverClass =
  "hover:bg-muted hover:text-sidebar-accent-foreground"
const sidebarDragPlaceholderClass =
  "!bg-neutral-500/12 !text-transparent !shadow-none hover:!bg-neutral-500/12 focus-within:!bg-neutral-500/12 dark:!bg-white/10 dark:!text-transparent dark:hover:!bg-white/10 dark:focus-within:!bg-white/10 [&>*]:opacity-0"
const sidebarCompletionAccentClass = "bg-blue-500"
const sidebarDragOverlayZIndex = 1000
const defaultSessionGroupId = "default"

type SidebarSortableData = {
  kind: "project" | "section" | "session"
  label: string
  groupId?: string
  projectChild?: boolean
}

type SidebarDragPreview = SidebarSortableData & {
  id: string
}

type SidebarMoveSessionTarget = {
  sessionId: string
  targetProjectId?: string
  targetSessionId?: string
}

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

type SortableSessionRowProps = {
  editingInputRef: React.RefObject<HTMLInputElement | null>
  editingSessionId: string | null
  editingSessionTitle: string
  groupId: string
  onCancelRename: () => void
  onCommitRename: (session: SessionRecord) => void
  onArchiveSession: (sessionId: string) => void
  onRenameTitleChange: (title: string) => void
  onSelectSession: (sessionId: string) => void
  onStartRename: (session: SessionRecord) => void
  projectChild?: boolean
  selectedSessionId: string
  session: SessionRecord
  sessionHasUnreadCompletion: boolean
  sessionRunStatus: "idle" | "working"
  t: I18nMessages
}

type SortableProjectSectionProps = {
  children: React.ReactNode
  hasWorkingSession: boolean
  isExpanded: boolean
  onArchiveProject: (projectId: string) => void
  onCreateProjectSession: (projectId: string) => void
  onDeleteProject: (projectId: string) => void
  onShowProjectInFolder: (projectId: string) => void
  onToggleProject: (projectId: string) => void
  project: ProjectRecord
  t: I18nMessages
}

type SortableSidebarSectionProps = {
  actionLabel: string
  beforeAction?: React.ReactNode
  children: React.ReactNode
  id: OusiaSidebarSectionId
  isCollapsed: boolean
  label: string
  onAction: () => void
  onToggleCollapsed: (sectionId: OusiaSidebarSectionId) => void
  toggleLabel: string
}

function handleTextButtonMouseDown(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

function SidebarRunningIndicator({
  label,
  title,
}: {
  label: string
  title: string
}) {
  return (
    <div
      className="pointer-events-none flex size-6 items-center justify-center justify-self-end"
      aria-label={label}
      role="status"
      title={title}
    >
      <span className="size-3.5 animate-spin rounded-full border-2 border-sidebar-accent-foreground/20 border-t-sidebar-accent-foreground motion-reduce:animate-none" />
    </div>
  )
}

function getSortableData(value: unknown): SidebarSortableData | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const data = value as Partial<SidebarSortableData>
  if (
    data.kind !== "project" &&
    data.kind !== "section" &&
    data.kind !== "session"
  ) {
    return null
  }
  if (typeof data.label !== "string") {
    return null
  }
  return {
    kind: data.kind,
    label: data.label,
    ...(typeof data.groupId === "string" ? { groupId: data.groupId } : {}),
    ...(typeof data.projectChild === "boolean"
      ? { projectChild: data.projectChild }
      : {}),
  }
}

function isSidebarSectionId(value: string): value is OusiaSidebarSectionId {
  return value === "sessions" || value === "projects"
}

function normalizeSidebarSectionOrder(
  sectionOrder: OusiaSidebarSectionId[]
): OusiaSidebarSectionId[] {
  return [
    ...new Set(
      [...sectionOrder, "sessions", "projects"].filter(isSidebarSectionId)
    ),
  ]
}

function escapeAttributeSelectorValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function projectIdFromSessionGroup(groupId: string | undefined) {
  return groupId && groupId !== defaultSessionGroupId ? groupId : undefined
}

function DragPreview({ preview }: { preview: SidebarDragPreview }) {
  if (preview.kind === "section") {
    return (
      <div
        className={[
          "grid h-8.5 w-full items-center gap-1 rounded-[var(--ousia-sidebar-selected-radius)]",
          "px-2 text-sm",
          sidebarSelectedRowClass,
          "grid-cols-[minmax(0,1fr)_24px_24px]",
        ].join(" ")}
      >
        <div className="font-radix-regular min-w-0 truncate">
          {preview.label}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none flex size-6 items-center justify-center rounded-lg text-sidebar-accent-foreground/75"
        >
          <ChevronDown
            size={sidebarSectionIconSize}
            strokeWidth={sidebarIconStrokeWidth}
          />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none flex size-6 items-center justify-center rounded-lg text-sidebar-accent-foreground/75"
        >
          <Plus
            size={sidebarSectionIconSize}
            strokeWidth={sidebarIconStrokeWidth}
          />
        </div>
      </div>
    )
  }

  if (preview.kind === "session") {
    return (
      <div
        className={[
          "grid h-8.5 w-full items-center rounded-[var(--ousia-sidebar-selected-radius)] text-sm",
          "font-radix-regular",
          sidebarSelectedRowClass,
          preview.projectChild
            ? sidebarProjectSessionGridClass
            : sidebarSingleActionGridClass,
          sidebarSessionDragPreviewXClass,
        ].join(" ")}
      >
        {preview.projectChild ? <div aria-hidden="true" /> : null}
        <div className="truncate">{preview.label}</div>
        <div aria-hidden="true" />
      </div>
    )
  }

  return (
    <div
      className={[
        "grid h-9 w-full items-center rounded-[var(--ousia-sidebar-selected-radius)]",
        "px-3 text-sm",
        sidebarSelectedRowClass,
      ].join(" ")}
    >
      <div className="truncate">{preview.label}</div>
    </div>
  )
}

function SortableSessionRow({
  editingInputRef,
  editingSessionId,
  editingSessionTitle,
  groupId,
  onCancelRename,
  onCommitRename,
  onArchiveSession,
  onRenameTitleChange,
  onSelectSession,
  onStartRename,
  projectChild,
  selectedSessionId,
  session,
  sessionHasUnreadCompletion,
  sessionRunStatus,
  t,
}: SortableSessionRowProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: session.id,
    data: {
      kind: "session",
      label: session.title,
      groupId,
      projectChild: Boolean(projectChild),
    } satisfies SidebarSortableData,
    disabled: editingSessionId === session.id,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const isSessionWorking = sessionRunStatus === "working"
  const isSelectedSession = session.id === selectedSessionId

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "group/session font-radix-regular relative grid h-8.5 cursor-grab items-center rounded-[var(--ousia-sidebar-selected-radius)] text-sm active:cursor-grabbing",
        isSelectedSession ? sidebarSelectedRowClass : sidebarRowStateClass,
        projectChild ? "gap-x-0 gap-y-1" : "gap-1",
        projectChild
          ? sidebarProjectSessionGridClass
          : sidebarSingleActionGridClass,
        sidebarSessionRowXClass,
        isDragging ? sidebarDragPlaceholderClass : "",
      ].join(" ")}
      onClick={() => {
        if (editingSessionId !== session.id) {
          onSelectSession(session.id)
        }
      }}
      onDoubleClick={() => {
        if (editingSessionId !== session.id) {
          onStartRename(session)
        }
      }}
      {...(editingSessionId === session.id ? {} : attributes)}
      {...(editingSessionId === session.id ? {} : listeners)}
      data-sidebar-session-id={session.id}
    >
      {projectChild ? <div aria-hidden="true" /> : null}
      {editingSessionId === session.id ? (
        <input
          ref={editingInputRef}
          aria-label={t.sidebar.renameSession}
          className="min-w-0 bg-transparent text-left outline-none"
          value={editingSessionTitle}
          onChange={(event) => onRenameTitleChange(event.target.value)}
          onBlur={() => onCommitRename(session)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onCommitRename(session)
            } else if (event.key === "Escape") {
              event.preventDefault()
              onCancelRename()
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="min-w-0 truncate text-left outline-none focus-visible:text-sidebar-accent-foreground"
          onMouseDown={handleTextButtonMouseDown}
          onDoubleClick={(event) => {
            event.stopPropagation()
            onStartRename(session)
          }}
        >
          {session.title}
        </button>
      )}
      <div className="relative size-6 justify-self-end">
        {isSessionWorking ? (
          <SidebarRunningIndicator
            label={`${session.title} ${t.sidebar.running}`}
            title={t.sidebar.running}
          />
        ) : (
          <>
            {sessionHasUnreadCompletion ? (
              <div
                className={[
                  "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity",
                  "group-focus-within/session:opacity-0 group-hover/session:opacity-0",
                ].join(" ")}
                aria-hidden="true"
              >
                <span
                  className={`size-2 rounded-full ${sidebarCompletionAccentClass}`}
                />
              </div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={[
                "absolute inset-0",
                sidebarActionButtonClass,
                sidebarActionHoverClass,
                "opacity-0 transition-opacity group-focus-within/session:opacity-100 group-hover/session:opacity-100",
              ].join(" ")}
              aria-label={t.sidebar.archiveSession(session.title)}
              onClick={(event) => {
                event.stopPropagation()
                onArchiveSession(session.id)
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Archive
                className="text-sidebar-accent-foreground"
                size={sidebarMenuIconSize}
                strokeWidth={sidebarIconStrokeWidth}
              />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function SortableProjectSection({
  children,
  hasWorkingSession,
  isExpanded,
  onArchiveProject,
  onCreateProjectSession,
  onDeleteProject,
  onShowProjectInFolder,
  onToggleProject,
  project,
  t,
}: SortableProjectSectionProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: project.id,
    data: {
      kind: "project",
      label: project.name,
    } satisfies SidebarSortableData,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <section ref={setNodeRef} style={style} className="min-w-0">
      <div
        className={[
          "project-row grid h-9 w-full min-w-0 cursor-grab items-center gap-x-0 gap-y-1 rounded-md active:cursor-grabbing",
          sidebarProjectRowStateClass,
          sidebarProjectLeadGridClass,
          sidebarProjectRowXClass,
          isDragging ? "opacity-35" : "",
        ].join(" ")}
        {...attributes}
        {...listeners}
      >
        {isExpanded ? (
          <FolderOpen
            className="shrink-0 justify-self-start"
            size={sidebarFolderIconSize}
            strokeWidth={sidebarIconStrokeWidth}
          />
        ) : (
          <Folder
            className="shrink-0 justify-self-start"
            size={sidebarFolderIconSize}
            strokeWidth={sidebarIconStrokeWidth}
          />
        )}
        <button
          type="button"
          aria-expanded={isExpanded}
          className="font-radix-regular flex h-full min-w-0 items-center rounded-md pr-1 text-left text-sm outline-none focus-visible:ring-0"
          title={project.path}
          onMouseDown={handleTextButtonMouseDown}
          onClick={() => onToggleProject(project.id)}
        >
          <span className="block min-w-0 flex-1 truncate">{project.name}</span>
        </button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={`${sidebarProjectActionButtonClass} ${sidebarActionHoverClass} project-row-action shrink-0 opacity-0 transition-opacity`}
              aria-label={t.sidebar.projectActions(project.name)}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <MoreHorizontal
                className="text-sidebar-accent-foreground"
                size={sidebarMenuIconSize}
                strokeWidth={sidebarIconStrokeWidth}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-44">
            <DropdownMenuItem onClick={() => onShowProjectInFolder(project.id)}>
              <FolderOpen className="text-muted-foreground" />
              {t.sidebar.showProjectInFolder}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={hasWorkingSession}
              onClick={() => onArchiveProject(project.id)}
            >
              <Archive className="text-muted-foreground" />
              {t.sidebar.archiveProject}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={hasWorkingSession}
              onClick={() => onDeleteProject(project.id)}
            >
              <Trash2 />
              {t.sidebar.deleteProject}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={`${sidebarProjectActionButtonClass} ${sidebarActionHoverClass} project-row-action shrink-0 opacity-0 transition-opacity`}
          aria-label={t.sidebar.newProjectSession(project.name)}
          onClick={(event) => {
            event.stopPropagation()
            onCreateProjectSession(project.id)
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Plus
            className="text-sidebar-accent-foreground"
            size={sidebarAddIconSize}
            strokeWidth={sidebarIconStrokeWidth}
          />
        </Button>
      </div>
      {children}
    </section>
  )
}

function SortableSidebarSection({
  actionLabel,
  beforeAction,
  children,
  id,
  isCollapsed,
  label,
  onAction,
  onToggleCollapsed,
  toggleLabel,
}: SortableSidebarSectionProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id,
    data: {
      kind: "section",
      label,
    } satisfies SidebarSortableData,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={[
        "mt-3 min-w-0 first:mt-0",
        isDragging
          ? `rounded-[var(--ousia-sidebar-selected-radius)] ${sidebarDragPlaceholderClass}`
          : "",
      ].join(" ")}
    >
      <div
        className={[
          "group/section-header grid cursor-pointer items-center gap-1 pt-2 pb-1.5",
          beforeAction
            ? "grid-cols-[minmax(0,1fr)_24px_24px]"
            : sidebarSingleActionGridClass,
          sidebarSectionHeaderXClass,
        ].join(" ")}
        aria-expanded={!isCollapsed}
        onClick={() => onToggleCollapsed(id)}
        {...attributes}
        {...listeners}
      >
        <div className="flex min-w-0 items-center gap-1">
          <div className="font-radix-regular min-w-0 truncate text-sm text-muted-foreground">
            {label}
          </div>
          <ChevronDown
            aria-hidden="true"
            className={[
              "shrink-0 text-muted-foreground transition-[opacity,transform] duration-150",
              isCollapsed
                ? "-rotate-90 opacity-100"
                : "rotate-0 opacity-0 group-focus-within/section-header:opacity-100 group-hover/section-header:opacity-100",
            ].join(" ")}
            size={sidebarSectionIconSize}
            strokeWidth={sidebarIconStrokeWidth}
          />
          <span className="sr-only">{toggleLabel}</span>
        </div>
        {beforeAction}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={`${sidebarActionButtonClass} ${sidebarActionHoverClass}`}
          aria-label={actionLabel}
          onMouseDown={handleTextButtonMouseDown}
          onClick={(event) => {
            event.stopPropagation()
            if (isCollapsed) {
              onToggleCollapsed(id)
            }
            onAction()
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Plus
            className="text-muted-foreground"
            size={sidebarSectionIconSize}
            strokeWidth={sidebarIconStrokeWidth}
          />
        </Button>
      </div>
      {isCollapsed || isDragging ? null : children}
    </section>
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
    normalizeSidebarSectionOrder(sidebarSectionOrder)
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
    setDragPreview({
      ...data,
      id: String(event.active.id),
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeData = getSortableData(event.active.data.current)
    const overData = getSortableData(event.over?.data.current)
    if (!activeData || !overData || !event.over) {
      setDragPreview(null)
      return
    }

    if (activeData.kind === "session") {
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
      setDragPreview(null)
      return
    }

    if (activeData.kind === "section" && overData.kind === "section") {
      const activeSectionId = String(event.active.id)
      const overSectionId = String(event.over.id)
      if (
        isSidebarSectionId(activeSectionId) &&
        isSidebarSectionId(overSectionId)
      ) {
        onReorderSidebarSections(activeSectionId, overSectionId)
      }
    } else if (activeData.kind === "project" && overData.kind === "project") {
      onReorderProjects(String(event.active.id), String(event.over.id))
    }
    setDragPreview(null)
  }

  function handleDragCancel() {
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
                    className="text-muted-foreground"
                    size={sidebarMenuIconSize}
                    strokeWidth={sidebarIconStrokeWidth}
                  />
                </Button>
              </DropdownMenuTrigger>
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
      dropAnimation={{
        duration: 0,
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      {dragPreview ? <DragPreview preview={dragPreview} /> : null}
    </DragOverlay>
  )

  return (
    <aside
      className="ousia-sidebar-shell ousia-sidebar-theme flex min-h-0 shrink-0 flex-col bg-sidebar text-sidebar-foreground"
      style={style}
    >
      <div
        className="window-drag h-[var(--ousia-titlebar-height)] shrink-0"
        data-tauri-drag-region="deep"
      />

      <div
        ref={scrollContainerRef}
        className={`ousia-hover-scrollbar ousia-stable-scrollbar-gutter min-h-0 flex-1 overflow-auto ${sidebarScrollPaddingXClass} pb-2`}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragAbort={handleDragCancel}
          onDragStart={handleDragStart}
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
                  : t.sidebar.update}
          </Button>
        ) : null}
      </div>
    </aside>
  )
}

export const Sidebar = memo(SidebarComponent)
