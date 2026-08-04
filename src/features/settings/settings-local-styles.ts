import { sidebarSelectedRowClass } from "@/features/sidebar/sidebar-layout"

export const SETTINGS_SIDEBAR_SURFACE_CLASS =
  "bg-[var(--ousia-sidebar)] text-sidebar-foreground"
export const SETTINGS_NAVIGATION_IDLE_CLASS =
  "text-sidebar-foreground hover:bg-[var(--ousia-sidebar-accent)] hover:text-sidebar-accent-foreground"
export const SETTINGS_NAVIGATION_ACTIVE_CLASS =
  `${sidebarSelectedRowClass} font-normal`
export const SETTINGS_PANEL_SURFACE_CLASS =
  "bg-background text-foreground shadow-[var(--ousia-main-panel-shadow)]"
