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
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { AnimatePresence, motion } from "framer-motion"
import { Folder, FolderOpen, Plus, Settings, Trash2 } from "lucide-react"

import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import { Button } from "@/components/ui/button"
import { TitleBarSidebarToggle } from "@/features/shell/TitleBarTrafficLightSlot"

const sidebarAddIconSize = 19
const sidebarFolderIconSize = 18
const sidebarMenuIconSize = 18
const sidebarIconStrokeWidth = 1.8
const sidebarActionButtonClass = "size-7 justify-self-end"
const sidebarSingleActionGridClass = "grid-cols-[minmax(0,1fr)_28px]"
const sidebarProjectActionButtonClass = "size-6 justify-self-center"
const sidebarProjectLeadGridClass =
  "grid-cols-[26px_minmax(0,1fr)_24px_4px_24px]"
const sidebarProjectSessionGridClass = "grid-cols-[26px_minmax(0,1fr)_28px]"
const sidebarRowXClass = "px-2"
const sidebarListGapClass = "flex flex-col gap-px"
const sidebarSectionHeaderXClass = "pl-2 pr-0"
const sidebarProjectSessionCompactCount = 5
const sidebarProjectSessionPreviewCount = 10
const sidebarRowStateClass =
  "text-sidebar-accent-foreground hover:bg-[var(--sidebar-accent)]"
const sidebarSelectedRowClass = "bg-[var(--sidebar-accent)]"
const sidebarGhostActionClass =
  "hover:bg-[var(--sidebar-accent)] hover:text-sidebar-accent-foreground"
const defaultSessionGroupId = "default"

type SidebarSortableData = {
  kind: "project" | "session"
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
  onReorderSessions: (sourceSessionId: string, targetSessionId: string) => void
  onSelectSession: (sessionId: string) => void
  onToggleSidebar: () => void
  expandedProjectIds: string[]
  projects: ProjectRecord[]
  selectedSessionId: string
  sessionRunStatusById: Record<string, "idle" | "working">
  sessions: SessionRecord[]
  isWindowFullscreen: boolean
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
  sessionRunStatus: "idle" | "working"
}

type SortableProjectSectionProps = {
  children: React.ReactNode
  isExpanded: boolean
  onCreateProjectSession: (projectId: string) => void
  onDeleteProject: (projectId: string) => void
  onToggleProject: (projectId: string) => void
  project: ProjectRecord
}

function handleTextButtonMouseDown(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

function getSortableData(value: unknown): SidebarSortableData | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const data = value as Partial<SidebarSortableData>
  if (data.kind !== "project" && data.kind !== "session") {
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

function DragPreview({ label }: { label: string }) {
  return (
    <div
      className={[
        "grid h-9 w-[220px] items-center rounded-lg",
        "bg-[var(--sidebar-accent)] px-3 text-sm text-sidebar-accent-foreground opacity-95",
      ].join(" ")}
    >
      <div className="truncate">{label}</div>
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
  sessionRunStatus,
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
    } satisfies SidebarSortableData,
    disabled: editingSessionId === session.id,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const isSessionWorking = sessionRunStatus === "working"

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "group/session font-radix-regular relative grid h-9 w-full cursor-grab items-center rounded-lg text-sm active:cursor-grabbing",
        sidebarRowStateClass,
        projectChild ? "gap-x-0 gap-y-1" : "gap-1",
        projectChild ? sidebarProjectSessionGridClass : sidebarSingleActionGridClass,
        sidebarRowXClass,
        session.id === selectedSessionId ? sidebarSelectedRowClass : "",
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
      {...attributes}
      {...listeners}
    >
      {projectChild ? <div aria-hidden="true" /> : null}
      {editingSessionId === session.id ? (
        <input
          ref={editingInputRef}
          aria-label="重命名会话"
          className="min-w-0 bg-transparent text-left outline-none"
          value={editingSessionTitle}
          onChange={(event) => onRenameTitleChange(event.target.value)}
          onBlur={() => onCommitRename(session)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
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
        >
          {session.title}
        </button>
      )}
      <div className="relative size-7 justify-self-end">
        {isSessionWorking ? (
          <div
            className={[
              "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity",
              "group-hover/session:opacity-0 group-focus-within/session:opacity-0",
            ].join(" ")}
            aria-label={`${session.title} 运行中`}
            title="运行中"
          >
            <span className="size-3.5 animate-spin rounded-full border-2 border-sidebar-accent-foreground/20 border-t-sidebar-accent-foreground" />
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
          aria-label={`删除 ${session.title}`}
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
          sidebarRowStateClass,
          sidebarProjectLeadGridClass,
          sidebarRowXClass,
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
          className="font-radix-regular h-full min-w-0 rounded-md pr-1 text-left text-sm outline-none focus-visible:ring-0"
          title={project.path}
          onMouseDown={handleTextButtonMouseDown}
          onClick={() => onToggleProject(project.id)}
        >
          <span className="min-w-0 truncate">{project.name}</span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={`${sidebarProjectActionButtonClass} ${sidebarGhostActionClass} project-row-action opacity-0 transition-opacity`}
          aria-label={`从 Ousia 移除 ${project.name}`}
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
        <div aria-hidden="true" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={`${sidebarProjectActionButtonClass} ${sidebarGhostActionClass} project-row-action opacity-0 transition-opacity`}
          aria-label={`在 ${project.name} 下新建会话`}
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
  onReorderSessions,
  onSelectSession,
  onToggleSidebar,
  expandedProjectIds,
  projects,
  selectedSessionId,
  sessionRunStatusById,
  sessions,
  isWindowFullscreen,
  style,
}: SidebarProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingSessionTitle, setEditingSessionTitle] = useState("")
  const [compactProjectSessionIds, setCompactProjectSessionIds] = useState<
    string[]
  >([])
  const [dragPreview, setDragPreview] = useState<SidebarDragPreview | null>(null)
  const editingInputRef = useRef<HTMLInputElement>(null)
  const defaultSessions = sessions.filter((session) => !session.projectId)
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
    if (!activeData || !overData || !event.over || event.active.id === event.over.id) {
      setDragPreview(null)
      return
    }
    if (activeData.kind === "project" && overData.kind === "project") {
      onReorderProjects(String(event.active.id), String(event.over.id))
    } else if (
      activeData.kind === "session" &&
      overData.kind === "session" &&
      activeData.groupId === overData.groupId
    ) {
      onReorderSessions(String(event.active.id), String(event.over.id))
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
        onDeleteSession={onDeleteSession}
        onRenameTitleChange={setEditingSessionTitle}
        onSelectSession={onSelectSession}
        onStartRename={startRenameSession}
        projectChild={options.projectChild}
        selectedSessionId={selectedSessionId}
        session={session}
        sessionRunStatus={sessionRunStatusById[session.id] ?? "idle"}
      />
    )
  }

  return (
    <aside
      className="flex min-h-0 shrink-0 flex-col bg-sidebar text-sidebar-foreground"
      style={style}
    >
      <div className="window-drag flex h-10 shrink-0 items-center border-b px-4">
        <TitleBarSidebarToggle
          isFullscreen={isWindowFullscreen}
          label="收起侧边栏"
          onClick={onToggleSidebar}
        />
      </div>

      <div className="ousia-hover-scrollbar min-h-0 flex-1 overflow-auto px-3 pb-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div
            className={[
              "grid items-center gap-1 pt-2 pb-1.5",
              sidebarSingleActionGridClass,
              sidebarSectionHeaderXClass,
            ].join(" ")}
          >
            <div className="font-radix-medium text-sm text-muted-foreground">
              会话
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={sidebarActionButtonClass}
              aria-label="新建会话"
              onMouseDown={handleTextButtonMouseDown}
              onClick={() => onCreateSession()}
            >
              <Plus
                className="text-muted-foreground"
                size={sidebarAddIconSize}
                strokeWidth={sidebarIconStrokeWidth}
              />
            </Button>
          </div>
          <SortableContext
            items={defaultSessions.map((session) => session.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className={sidebarListGapClass}>
              {defaultSessions.length ? (
                defaultSessions.map((session) =>
                  renderSessionRow(session, {
                    groupId: defaultSessionGroupId,
                  })
                )
              ) : (
                <div className="h-9 px-3 text-sm leading-9 text-muted-foreground/45">
                  无会话
                </div>
              )}
            </div>
          </SortableContext>

          <div
            className={[
              "mt-3 grid items-center gap-1 pt-2 pb-1.5",
              sidebarSingleActionGridClass,
              sidebarSectionHeaderXClass,
            ].join(" ")}
          >
            <div className="font-radix-medium text-sm text-muted-foreground">
              项目
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={sidebarActionButtonClass}
              aria-label="创建项目"
              onMouseDown={handleTextButtonMouseDown}
              onClick={onOpenProject}
            >
              <Plus
                className="text-muted-foreground"
                size={sidebarAddIconSize}
                strokeWidth={sidebarIconStrokeWidth}
              />
            </Button>
          </div>
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
                    isExpanded={isExpanded}
                    onCreateProjectSession={onCreateProjectSession}
                    onDeleteProject={onDeleteProject}
                    onToggleProject={toggleProject}
                    project={project}
                  >
                    <AnimatePresence initial={false}>
                      {isExpanded ? (
                        <motion.div
                          key={`${project.id}-sessions`}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{
                            duration: 0.16,
                            ease: [0.2, 0, 0, 1],
                          }}
                          className="overflow-hidden"
                        >
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
                                  无会话
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
                                      ? "展示更多"
                                      : "展示更少"}
                                  </span>
                                </button>
                              ) : null}
                            </div>
                          </SortableContext>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </SortableProjectSection>
                )
              })}
              {!projects.length ? (
                <div className="h-9 px-3 text-sm leading-9 text-muted-foreground/45">
                  无项目
                </div>
              ) : null}
            </div>
          </SortableContext>
          <DragOverlay
            dropAnimation={{
              duration: 150,
              easing: "cubic-bezier(0.2, 0, 0, 1)",
            }}
          >
            {dragPreview ? <DragPreview label={dragPreview.label} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      <div className="p-2">
        <Button
          type="button"
          variant="ghost"
          className={`font-radix-regular h-9 w-full justify-start gap-2 text-sm ${sidebarRowStateClass}`}
          onClick={onOpenSettings}
        >
          <Settings size={18} strokeWidth={sidebarIconStrokeWidth} />
          <span>设置</span>
        </Button>
      </div>
    </aside>
  )
}
