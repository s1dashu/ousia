import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react"
import {
  Add01Icon,
  Delete02Icon,
  Folder01Icon,
  FolderAddIcon,
  FolderOpenIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AnimatePresence, motion } from "framer-motion"

import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import { Button } from "@/components/ui/button"
import { TitleBarSidebarToggle } from "@/features/shell/TitleBarTrafficLightSlot"

const sidebarAddIconSize = 20
const sidebarFolderIconSize = 18
const sidebarMenuIconSize = 18
const sidebarActionButtonClass = "size-7 justify-self-end"
const sidebarSingleActionGridClass = "grid-cols-[minmax(0,1fr)_28px]"
const sidebarRowXClass = "px-3"

type SidebarProps = {
  onCreateProjectSession: (projectId: string) => void
  onCreateSession: () => void
  onDeleteProject: (projectId: string) => void
  onDeleteSession: (sessionId: string) => void
  onExpandedProjectIdsChange: (projectIds: string[]) => void
  onOpenProject: () => void
  onOpenSettings: () => void
  onRenameSession: (sessionId: string, title: string) => void
  onSelectSession: (sessionId: string) => void
  onToggleSidebar: () => void
  expandedProjectIds: string[]
  projects: ProjectRecord[]
  selectedSessionId: string
  sessions: SessionRecord[]
  isWindowFullscreen: boolean
  style: CSSProperties
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
  onSelectSession,
  onToggleSidebar,
  expandedProjectIds,
  projects,
  selectedSessionId,
  sessions,
  isWindowFullscreen,
  style,
}: SidebarProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingSessionTitle, setEditingSessionTitle] = useState("")
  const editingInputRef = useRef<HTMLInputElement>(null)
  const defaultSessions = sessions.filter((session) => !session.projectId)
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

  function handleTextButtonMouseDown(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
  }

  function renderSessionRow(
    session: SessionRecord,
    options: { projectChild?: boolean } = {}
  ) {
    return (
      <div
        key={session.id}
        className={[
          "group/session relative grid h-9 w-full cursor-default items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground hover:text-accent-foreground",
          options.projectChild
            ? "grid-cols-[28px_minmax(0,1fr)_28px]"
            : sidebarSingleActionGridClass,
          sidebarRowXClass,
          session.id === selectedSessionId
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "",
        ].join(" ")}
        onClick={() => {
          if (editingSessionId !== session.id) {
            onSelectSession(session.id)
          }
        }}
        onDoubleClick={() => {
          if (editingSessionId !== session.id) {
            startRenameSession(session)
          }
        }}
      >
        {options.projectChild ? <div aria-hidden="true" /> : null}
        {editingSessionId === session.id ? (
          <input
            ref={editingInputRef}
            aria-label="重命名会话"
            className={[
              "min-w-0 bg-transparent text-left outline-none",
              options.projectChild ? "" : "",
            ].join(" ")}
            value={editingSessionTitle}
            onChange={(event) => setEditingSessionTitle(event.target.value)}
            onBlur={() => commitRenameSession(session)}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                commitRenameSession(session)
              } else if (event.key === "Escape") {
                event.preventDefault()
                cancelRenameSession()
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="min-w-0 truncate text-left outline-none focus-visible:text-accent-foreground"
            onMouseDown={handleTextButtonMouseDown}
          >
            {session.title}
          </button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={`${sidebarActionButtonClass} opacity-0 transition-opacity group-hover/session:opacity-100 group-focus-within/session:opacity-100`}
          aria-label={`删除 ${session.title}`}
          onClick={(event) => {
            event.stopPropagation()
            onDeleteSession(session.id)
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <HugeiconsIcon
            icon={Delete02Icon}
            className="text-muted-foreground"
            size={sidebarMenuIconSize}
            strokeWidth={1.8}
          />
        </Button>
      </div>
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
        <div
          className={[
            "grid items-center gap-1 pt-2 pb-1.5",
            sidebarSingleActionGridClass,
            sidebarRowXClass,
          ].join(" ")}
        >
          <div className="text-sm font-semibold text-muted-foreground">
            会话
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={sidebarActionButtonClass}
            aria-label="新建会话"
            onClick={() => onCreateSession()}
          >
            <HugeiconsIcon
              icon={Add01Icon}
              className="text-muted-foreground"
              size={sidebarAddIconSize}
              strokeWidth={1.8}
            />
          </Button>
        </div>
        <div>
          {defaultSessions.length ? (
            defaultSessions.map((session) => renderSessionRow(session))
          ) : (
            <div className="h-9 px-3 text-sm leading-9 text-muted-foreground/45">
              无会话
            </div>
          )}
        </div>

        <div
          className={[
            "mt-3 grid items-center gap-1 pt-2 pb-1.5",
            sidebarSingleActionGridClass,
            sidebarRowXClass,
          ].join(" ")}
        >
          <div className="text-sm font-semibold text-muted-foreground">
            项目
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={sidebarActionButtonClass}
            aria-label="创建项目"
            onClick={onOpenProject}
          >
            <HugeiconsIcon
              icon={FolderAddIcon}
              className="text-muted-foreground"
              size={sidebarFolderIconSize}
              strokeWidth={1.8}
            />
          </Button>
        </div>
        <div>
          {projects.map((project) => {
            const isExpanded = visibleExpandedProjectIds.has(project.id)
            const projectSessions = sessions.filter(
              (session) => session.projectId === project.id
            )
            return (
              <section key={project.id}>
                <div
                  className={[
                    "project-row grid h-9 w-full min-w-0 items-center gap-1 rounded-md text-muted-foreground",
                    "grid-cols-[28px_minmax(0,1fr)_28px_28px]",
                    sidebarRowXClass,
                  ].join(" ")}
                >
                  <HugeiconsIcon
                    icon={isExpanded ? FolderOpenIcon : Folder01Icon}
                    className="shrink-0 justify-self-start text-muted-foreground"
                    size={sidebarFolderIconSize}
                    strokeWidth={1.8}
                  />
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    className="h-full min-w-0 rounded-md pr-1 text-left text-sm font-medium outline-none hover:text-accent-foreground focus-visible:text-accent-foreground focus-visible:ring-0"
                    title={project.path}
                    onMouseDown={handleTextButtonMouseDown}
                    onClick={() => toggleProject(project.id)}
                  >
                    <span className="min-w-0 truncate">{project.name}</span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={`${sidebarActionButtonClass} project-row-action opacity-0 transition-opacity`}
                    aria-label={`从 Ousia 移除 ${project.name}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteProject(project.id)
                    }}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      className="text-muted-foreground"
                      size={sidebarMenuIconSize}
                      strokeWidth={1.8}
                    />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={`${sidebarActionButtonClass} project-row-action opacity-0 transition-opacity`}
                    aria-label={`在 ${project.name} 下新建会话`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onCreateProjectSession(project.id)
                    }}
                  >
                    <HugeiconsIcon
                      icon={Add01Icon}
                      className="text-muted-foreground"
                      size={sidebarAddIconSize}
                      strokeWidth={1.8}
                    />
                  </Button>
                </div>
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
                      <div>
                        {projectSessions.length ? (
                          projectSessions.map((session) =>
                            renderSessionRow(session, { projectChild: true })
                          )
                        ) : (
                          <div className="h-9 px-3 text-sm leading-9 text-muted-foreground/45">
                            无会话
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </section>
            )
          })}
          {!projects.length ? (
            <div className="h-9 px-3 text-sm leading-9 text-muted-foreground/45">
              无项目
            </div>
          ) : null}
        </div>
      </div>

      <div className="p-2">
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full justify-start gap-2 text-sm font-medium"
          onClick={onOpenSettings}
        >
          <HugeiconsIcon icon={Settings01Icon} size={18} strokeWidth={1.8} />
          <span>设置</span>
        </Button>
      </div>
    </aside>
  )
}
