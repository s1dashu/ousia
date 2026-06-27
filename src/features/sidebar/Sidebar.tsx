import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react"
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
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
  ChevronDown,
  Folder,
  FolderOpen,
  Plus,
  Settings,
  Trash2,
} from "@/components/icons/huge-icons"

import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import { getMessages, type I18nMessages } from "@/app/i18n"
import { Button } from "@/components/ui/button"
import type { OusiaLanguage, OusiaSidebarSectionId } from "@/electron/chat-types"

const sidebarAddIconSize = 18
const sidebarFolderIconSize = 18
const sidebarMenuIconSize = 18
const sidebarSectionIconSize = 14
const sidebarIconStrokeWidth = 1.5
const sidebarActionButtonClass = "size-6 justify-self-end"
const sidebarSingleActionGridClass = "grid-cols-[minmax(0,1fr)_24px]"
const sidebarProjectActionButtonClass = "size-6 justify-self-end"
const sidebarProjectLeadGridClass =
  "grid-cols-[24px_minmax(0,1fr)_24px_24px]"
const sidebarProjectSessionGridClass = "grid-cols-[24px_minmax(0,1fr)_24px]"
const sidebarRowXClass = "pl-2 pr-0"
const sidebarSessionRowXClass =
  "-mx-[7px] w-[calc(100%+14px)] pl-3 pr-[7px]"
const sidebarProjectRowXClass = "w-full pl-2 pr-0"
const sidebarListGapClass = "flex flex-col gap-0.5"
const sidebarSectionHeaderXClass = "pl-[5px] pr-0"
const sidebarDefaultSessionPreviewCount = 10
const sidebarProjectSessionCompactCount = 5
const sidebarProjectSessionPreviewCount = 10
const sidebarScrollRevealPadding = 12
const sidebarRowStateClass =
  "text-sidebar-accent-foreground hover:bg-[var(--sidebar-accent)]"
const sidebarProjectRowStateClass =
  "relative text-sidebar-accent-foreground before:pointer-events-none before:absolute before:inset-y-0 before:-left-[5px] before:-right-[5px] before:rounded-md before:bg-transparent hover:before:bg-[var(--sidebar-accent)] focus-within:before:bg-[var(--sidebar-accent)] [&>*]:relative [&>*]:z-[1]"
const sidebarSelectedRowClass =
  "bg-white text-sidebar-accent-foreground shadow-[var(--ousia-sidebar-selected-shadow)] dark:bg-card"
const sidebarGhostActionClass =
  "hover:bg-[var(--sidebar-accent)] hover:text-sidebar-accent-foreground"
const sidebarDropTargetRowClass = "bg-white dark:bg-white dark:text-neutral-950"
const sidebarCompletionAccentClass = "bg-blue-500"
const defaultSessionGroupId = "default"

type SidebarSortableData = {
  kind: "project" | "section" | "session"
  label: string
  groupId?: string
}

type SidebarDragPreview = SidebarSortableData & {
  id: string
}

type SidebarProps = {
  onCreateProjectSession: (projectId: string) => void
  onCreateSession: () => void
  onDeleteProject: (projectId: string) => void
  onDeleteSession: (sessionId: string) => void
  onExpandedProjectIdsChange: (projectIds: string[]) => void
  onOpenProject: () => void
  onOpenSettings: () => void
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
  style: CSSProperties
}

type SortableSessionRowProps = {
  editingInputRef: React.RefObject<HTMLInputElement | null>
  editingSessionId: string | null
  editingSessionTitle: string
  groupId: string
  onCancelRename: () => void
  onCommitRename: (session: SessionRecord) => void
  onDeleteSession: (sessionId: string) => void
  onRenameTitleChange: (title: string) => void
  onSelectSession: (sessionId: string) => void
  onStartRename: (session: SessionRecord) => void
  projectChild?: boolean
  selectedSessionId: string
  session: SessionRecord
  isDropTarget?: boolean
  sessionHasUnreadCompletion: boolean
  sessionRunStatus: "idle" | "working"
  t: I18nMessages
}

type SortableProjectSectionProps = {
  children: React.ReactNode
  isExpanded: boolean
  onCreateProjectSession: (projectId: string) => void
  onDeleteProject: (projectId: string) => void
  onToggleProject: (projectId: string) => void
  project: ProjectRecord
  t: I18nMessages
}

type SortableSidebarSectionProps = {
  actionLabel: string
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
  }
}

function getSessionDropTargetId(
  event: Pick<DragOverEvent, "active" | "over">
): string | null {
  const activeData = getSortableData(event.active.data.current)
  const overData = getSortableData(event.over?.data.current)
  if (
    !activeData ||
    !overData ||
    !event.over ||
    event.active.id === event.over.id ||
    activeData.kind !== "session" ||
    overData.kind !== "session" ||
    activeData.groupId !== overData.groupId
  ) {
    return null
  }

  return String(event.over.id)
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

function DragPreview({
  innerWidth,
  preview,
}: {
  innerWidth: number
  preview: SidebarDragPreview
}) {
  if (preview.kind === "section") {
    return (
      <div
        className={[
          "grid items-start rounded-lg",
          "bg-[var(--sidebar-accent)] px-3 py-2 text-sm text-sidebar-accent-foreground opacity-80",
        ].join(" ")}
        style={{
          width: innerWidth,
          minHeight: 76,
        }}
      >
        <div className="font-radix-medium truncate text-muted-foreground">
          {preview.label}
        </div>
      </div>
    )
  }

  return (
    <div
      className={[
        "grid h-9 w-[220px] items-center rounded-lg",
        "bg-[var(--sidebar-accent)] px-3 text-sm text-sidebar-accent-foreground opacity-95",
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
  onDeleteSession,
  onRenameTitleChange,
  onSelectSession,
  onStartRename,
  projectChild,
  selectedSessionId,
  session,
  isDropTarget,
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
  } = useSortable({
    id: session.id,
    data: {
      kind: "session",
      label: session.title,
      groupId,
    } satisfies SidebarSortableData,
    disabled: editingSessionId === session.id,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
  }
  const isSessionWorking = sessionRunStatus === "working"
  const isSelectedSession = session.id === selectedSessionId

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "group/session ousia-squircle-corners font-radix-regular relative grid h-8.5 cursor-grab items-center rounded-[var(--ousia-sidebar-selected-radius)] text-sm active:cursor-grabbing",
        isSelectedSession ? sidebarSelectedRowClass : sidebarRowStateClass,
        isDropTarget ? sidebarDropTargetRowClass : "",
        projectChild ? "gap-x-0 gap-y-1" : "gap-1",
        projectChild ? sidebarProjectSessionGridClass : sidebarSingleActionGridClass,
        sidebarSessionRowXClass,
        isDragging ? "opacity-35" : "",
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
          <div
            className={[
              "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity",
              "group-hover/session:opacity-0 group-focus-within/session:opacity-0",
            ].join(" ")}
            aria-label={`${session.title} ${t.sidebar.running}`}
            title={t.sidebar.running}
          >
            <span className="size-3.5 animate-spin rounded-full border-2 border-sidebar-accent-foreground/20 border-t-sidebar-accent-foreground" />
          </div>
        ) : sessionHasUnreadCompletion ? (
          <div
            className={[
              "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity",
              "group-hover/session:opacity-0 group-focus-within/session:opacity-0",
            ].join(" ")}
            aria-hidden="true"
          >
            <span className={`size-2 rounded-full ${sidebarCompletionAccentClass}`} />
          </div>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={[
            "absolute inset-0",
            sidebarActionButtonClass,
            sidebarGhostActionClass,
            "opacity-0 transition-opacity group-hover/session:opacity-100 group-focus-within/session:opacity-100",
          ].join(" ")}
          aria-label={t.sidebar.deleteSession(session.title)}
          onClick={(event) => {
            event.stopPropagation()
            onDeleteSession(session.id)
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Trash2
            className="text-sidebar-accent-foreground"
            size={sidebarMenuIconSize}
            strokeWidth={sidebarIconStrokeWidth}
          />
        </Button>
      </div>
    </div>
  )
}

function SortableProjectSection({
  children,
  isExpanded,
  onCreateProjectSession,
  onDeleteProject,
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
  } = useSortable({
    id: project.id,
    data: {
      kind: "project",
      label: project.name,
    } satisfies SidebarSortableData,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={`${sidebarProjectActionButtonClass} ${sidebarGhostActionClass} project-row-action shrink-0 opacity-0 transition-opacity`}
          aria-label={t.sidebar.removeProject(project.name)}
          onClick={(event) => {
            event.stopPropagation()
            onDeleteProject(project.id)
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Trash2
            className="text-sidebar-accent-foreground"
            size={sidebarMenuIconSize}
            strokeWidth={sidebarIconStrokeWidth}
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={`${sidebarProjectActionButtonClass} ${sidebarGhostActionClass} project-row-action shrink-0 opacity-0 transition-opacity`}
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
  } = useSortable({
    id,
    data: {
      kind: "section",
      label,
    } satisfies SidebarSortableData,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
  }

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={["mt-3 min-w-0 first:mt-0", isDragging ? "opacity-35" : ""].join(
        " "
      )}
    >
      <div
        className={[
          "group/section-header grid cursor-pointer items-center gap-1 pt-2 pb-1.5",
          sidebarSingleActionGridClass,
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
              "shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 group-hover/section-header:opacity-100 group-focus-within/section-header:opacity-100",
              isCollapsed ? "-rotate-90" : "rotate-0",
            ].join(" ")}
            size={sidebarSectionIconSize}
            strokeWidth={sidebarIconStrokeWidth}
          />
          <span className="sr-only">{toggleLabel}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={sidebarActionButtonClass}
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
      {isCollapsed ? null : children}
    </section>
  )
}

export function Sidebar({
  onCreateProjectSession,
  onCreateSession,
  onDeleteProject,
  onDeleteSession,
  onExpandedProjectIdsChange,
  onOpenProject,
  onOpenSettings,
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
  const [dragPreview, setDragPreview] = useState<SidebarDragPreview | null>(null)
  const [dropTargetSessionId, setDropTargetSessionId] = useState<string | null>(
    null
  )
  const editingInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const defaultSessions = sessions.filter((session) => !session.projectId)
  const canCompactDefaultSessions =
    defaultSessions.length > sidebarDefaultSessionPreviewCount
  const visibleDefaultSessions =
    canCompactDefaultSessions && isDefaultSessionListCompact
      ? defaultSessions.slice(0, sidebarDefaultSessionPreviewCount)
      : defaultSessions
  const sidebarInnerWidth =
    typeof style.width === "number" ? Math.max(176, style.width - 24) : 220
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
          const revealBottom =
            containerRect.bottom - sidebarScrollRevealPadding
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
      setDropTargetSessionId(null)
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
    setDropTargetSessionId(null)
    setDragPreview({
      ...data,
      id: String(event.active.id),
    })
  }

  function handleDragOver(event: DragOverEvent) {
    setDropTargetSessionId(getSessionDropTargetId(event))
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeData = getSortableData(event.active.data.current)
    const overData = getSortableData(event.over?.data.current)
    if (!activeData || !overData || !event.over || event.active.id === event.over.id) {
      setDragPreview(null)
      setDropTargetSessionId(null)
      return
    }
    if (activeData.kind === "section" && overData.kind === "section") {
      const activeSectionId = String(event.active.id)
      const overSectionId = String(event.over.id)
      if (isSidebarSectionId(activeSectionId) && isSidebarSectionId(overSectionId)) {
        onReorderSidebarSections(activeSectionId, overSectionId)
      }
    } else if (activeData.kind === "project" && overData.kind === "project") {
      onReorderProjects(String(event.active.id), String(event.over.id))
    } else if (
      activeData.kind === "session" &&
      overData.kind === "session" &&
      activeData.groupId === overData.groupId
    ) {
      onReorderSessions(String(event.active.id), String(event.over.id))
    }
    setDragPreview(null)
    setDropTargetSessionId(null)
  }

  function handleDragCancel() {
    setDragPreview(null)
    setDropTargetSessionId(null)
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
        onDeleteSession={onDeleteSession}
        onRenameTitleChange={setEditingSessionTitle}
        onSelectSession={onSelectSession}
        onStartRename={startRenameSession}
        projectChild={options.projectChild}
        selectedSessionId={selectedSessionId}
        session={session}
        isDropTarget={dropTargetSessionId === session.id}
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
              <div className="h-9 px-3 text-sm leading-9 text-muted-foreground/45">
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
              const isProjectSessionListCompact = compactProjectSessionIds.includes(
                project.id
              )
              const visibleProjectSessions =
                canCompactProjectSessions && isProjectSessionListCompact
                  ? projectSessions.slice(0, sidebarProjectSessionCompactCount)
                  : projectSessions
              return (
                <SortableProjectSection
                  key={project.id}
                  isExpanded={isExpanded}
                  onCreateProjectSession={onCreateProjectSession}
                  onDeleteProject={onDeleteProject}
                  onToggleProject={toggleProject}
                  project={project}
                  t={t}
                >
                  {isExpanded ? (
                    <div className="overflow-visible py-1 -my-1">
                      <SortableContext
                        items={visibleProjectSessions.map((session) => session.id)}
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
              <div className="h-9 px-3 text-sm leading-9 text-muted-foreground/45">
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

  return (
    <aside
      className="ousia-sidebar-shell flex min-h-0 shrink-0 flex-col bg-sidebar text-sidebar-foreground"
      style={style}
    >
      <div className="window-drag h-[var(--ousia-titlebar-height)] shrink-0" />

      <div
        ref={scrollContainerRef}
        className="ousia-hover-scrollbar min-h-0 flex-1 overflow-auto px-3 pb-2"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragAbort={handleDragCancel}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={visibleSidebarSectionOrder}
            strategy={verticalListSortingStrategy}
          >
            {visibleSidebarSectionOrder.map(renderSidebarSection)}
          </SortableContext>
          <DragOverlay
            dropAnimation={{
              duration: 0,
              easing: "cubic-bezier(0.2, 0, 0, 1)",
            }}
          >
            {dragPreview ? (
              <DragPreview
                innerWidth={sidebarInnerWidth}
                preview={dragPreview}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <div className="p-2">
        <Button
          type="button"
          variant="ghost"
          className={`font-radix-regular h-9 w-full justify-start gap-2 rounded-lg text-sm ${sidebarRowStateClass}`}
          onClick={onOpenSettings}
        >
          <Settings size={18} strokeWidth={sidebarIconStrokeWidth} />
          <span>{t.sidebar.settings}</span>
        </Button>
      </div>
    </aside>
  )
}
