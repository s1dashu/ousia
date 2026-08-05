import type { CSSProperties } from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

import {
  ArchiveAction,
  ChevronDown,
  Folder,
  FolderOpen,
  Plus,
  SidebarActions,
  Trash2,
} from "@/components/icons/nucleo-icons"
import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import type { I18nMessages } from "@/app/i18n"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { OusiaSidebarSectionId } from "@/electron/chat-types"
import type { SidebarSortableData } from "@/features/sidebar/sidebar-dnd"
import {
  handleTextButtonMouseDown,
  sidebarActionButtonClass,
  sidebarActionHoverClass,
  sidebarAddIconSize,
  sidebarCompletionAccentClass,
  sidebarDragPlaceholderClass,
  sidebarFolderIconSize,
  sidebarIconStrokeWidth,
  sidebarMenuIconSize,
  sidebarProjectActionButtonClass,
  sidebarProjectLeadGridClass,
  sidebarProjectRowStateClass,
  sidebarProjectRowXClass,
  sidebarProjectSessionDragPreviewXClass,
  sidebarProjectSessionGridClass,
  sidebarProjectSessionRowXClass,
  sidebarRowHeightClass,
  sidebarRowStateClass,
  sidebarSectionHeaderXClass,
  sidebarSectionIconSize,
  sidebarSelectedRowClass,
  sidebarSessionFrameClass,
  sidebarSessionDragPreviewXClass,
  sidebarSessionRowXClass,
  sidebarSingleActionGridClass,
} from "@/features/sidebar/sidebar-layout"

export type SidebarDragPreview = SidebarSortableData & {
  id: string
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

export function SidebarActionTooltip({
  children,
  label,
}: {
  children: React.ReactElement
  label: string
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
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

export function DragPreview({ preview }: { preview: SidebarDragPreview }) {
  if (preview.kind === "section") {
    return (
      <div
        className={[
          `ousia-squircle-corners grid ${sidebarRowHeightClass} w-full items-center gap-1 rounded-[var(--ousia-sidebar-selected-radius)]`,
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
          className="pointer-events-none flex size-6 items-center justify-center rounded-lg text-sidebar-accent-foreground"
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
          `ousia-squircle-corners grid ${sidebarRowHeightClass} w-full items-center rounded-[var(--ousia-sidebar-selected-radius)] text-sm`,
          "font-radix-regular",
          sidebarSelectedRowClass,
          preview.projectChild
            ? sidebarProjectSessionGridClass
            : sidebarSingleActionGridClass,
          preview.projectChild
            ? sidebarProjectSessionDragPreviewXClass
            : sidebarSessionDragPreviewXClass,
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
        `grid ${sidebarRowHeightClass} w-full items-center rounded-[var(--ousia-sidebar-selected-radius)]`,
        "px-3 text-sm",
        sidebarSelectedRowClass,
      ].join(" ")}
    >
      <div className="truncate">{preview.label}</div>
    </div>
  )
}

export function SortableSessionRow({
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
        `group/session ousia-squircle-corners font-radix-regular relative grid ${sidebarRowHeightClass} cursor-grab items-center rounded-[var(--ousia-sidebar-selected-radius)] text-sm active:cursor-grabbing`,
        sidebarSessionFrameClass,
        isSelectedSession ? sidebarSelectedRowClass : sidebarRowStateClass,
        projectChild ? "gap-x-0 gap-y-1" : "gap-1",
        projectChild
          ? sidebarProjectSessionGridClass
          : sidebarSingleActionGridClass,
        projectChild
          ? sidebarProjectSessionRowXClass
          : sidebarSessionRowXClass,
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
            <SidebarActionTooltip label={t.sidebar.archiveSessionTooltip}>
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
                <ArchiveAction
                  className="text-sidebar-accent-foreground"
                  size={sidebarMenuIconSize}
                  strokeWidth={sidebarIconStrokeWidth}
                />
              </Button>
            </SidebarActionTooltip>
          </>
        )}
      </div>
    </div>
  )
}

export function SortableProjectSection({
  children,
  hasWorkingSession,
  isExpanded,
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
          `project-row grid ${sidebarRowHeightClass} w-full min-w-0 cursor-grab items-center gap-x-0 gap-y-1 rounded-md active:cursor-grabbing`,
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
            aria-hidden="true"
            className="shrink-0 justify-self-start"
            size={sidebarFolderIconSize}
            strokeWidth={sidebarIconStrokeWidth}
          />
        ) : (
          <Folder
            aria-hidden="true"
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
          <SidebarActionTooltip label={t.sidebar.projectActions(project.name)}>
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
                <SidebarActions
                  className="text-sidebar-accent-foreground"
                  size={sidebarMenuIconSize}
                  strokeWidth={sidebarIconStrokeWidth}
                />
              </Button>
            </DropdownMenuTrigger>
          </SidebarActionTooltip>
          <DropdownMenuContent align="end" className="w-auto min-w-44">
            <DropdownMenuItem onClick={() => onShowProjectInFolder(project.id)}>
              <FolderOpen className="text-muted-foreground" />
              {t.sidebar.showProjectInFolder}
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
        <SidebarActionTooltip label={t.sidebar.newProjectSession(project.name)}>
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
        </SidebarActionTooltip>
      </div>
      {children}
    </section>
  )
}

export function SortableSidebarSection({
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
      data-sidebar-section-id={id}
      className={[
        "mt-3 min-w-0 first:mt-0",
        isDragging
          ? `ousia-squircle-corners rounded-[var(--ousia-sidebar-selected-radius)] ${sidebarDragPlaceholderClass}`
          : "",
      ].join(" ")}
    >
      <div
        className={[
          "group/section-header grid cursor-pointer items-center gap-1 pt-2 pb-0.5",
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
        <SidebarActionTooltip label={actionLabel}>
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
              className="text-sidebar-accent-foreground"
              size={sidebarSectionIconSize}
              strokeWidth={sidebarIconStrokeWidth}
            />
          </Button>
        </SidebarActionTooltip>
      </div>
      {isCollapsed || isDragging ? null : children}
    </section>
  )
}
