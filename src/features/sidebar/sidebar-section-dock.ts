export function getSidebarSectionDockState({
  canDockProjectsToTop,
  canDockSessionsToBottom,
  projectsBottom,
  projectsTop,
  sessionsTop,
  viewportBottom,
  viewportTop,
}: {
  canDockProjectsToTop: boolean
  canDockSessionsToBottom: boolean
  projectsBottom: number
  projectsTop: number
  sessionsTop: number
  viewportBottom: number
  viewportTop: number
}) {
  return {
    projects: canDockProjectsToTop && projectsTop < viewportTop,
    projectsCollapsed:
      canDockProjectsToTop && projectsBottom <= viewportTop,
    sessions: canDockSessionsToBottom && sessionsTop >= viewportBottom,
  }
}

export function getSidebarDockInlineMetrics({
  sectionLeft,
  sectionWidth,
  viewportLeft,
}: {
  sectionLeft: number
  sectionWidth: number
  viewportLeft: number
}) {
  return {
    left: sectionLeft - viewportLeft,
    width: sectionWidth,
  }
}
