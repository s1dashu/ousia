import { memo, type CSSProperties } from "react"

import { getMessages } from "@/app/i18n"
import { ArrowLeft } from "@/components/icons/huge-icons"
import type { OusiaAgentProvider, OusiaLanguage } from "@/electron/chat-types"
import {
  getSettingsNavigationItems,
  type SettingsSectionId,
} from "@/features/settings/settings-navigation"
import {
  SETTINGS_NAVIGATION_ACTIVE_CLASS,
  SETTINGS_NAVIGATION_IDLE_CLASS,
  SETTINGS_SIDEBAR_SURFACE_CLASS,
} from "@/features/settings/settings-local-styles"
import { cn } from "@/lib/utils"

type SettingsSidebarProps = {
  activeSection: SettingsSectionId
  agentProvider: OusiaAgentProvider
  language: OusiaLanguage
  onBack: () => void
  onSectionChange: (section: SettingsSectionId) => void
  style: CSSProperties
}

function SettingsSidebarComponent({
  activeSection,
  agentProvider,
  language,
  onBack,
  onSectionChange,
  style,
}: SettingsSidebarProps) {
  const t = getMessages(language)
  const navigationItems = getSettingsNavigationItems(agentProvider, t.settings)

  return (
    <aside
      className={cn(
        "ousia-sidebar-shell flex min-h-0 shrink-0 flex-col",
        SETTINGS_SIDEBAR_SURFACE_CLASS
      )}
      style={style}
    >
      <div className="window-drag h-10 shrink-0" />
      <div className="px-2 pb-4">
        <button
          type="button"
          className={cn(
            "window-no-drag flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-sm outline-hidden transition-[width,height,padding] focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            SETTINGS_NAVIGATION_IDLE_CLASS
          )}
          onClick={onBack}
        >
          <ArrowLeft size={16} strokeWidth={1.75} />
          <span>{t.settings.backToHome}</span>
        </button>
      </div>

      <nav className="min-h-0 flex-1 px-2" aria-label={t.app.settings}>
        <div className="flex h-8 items-center rounded-md px-3 text-xs font-medium text-sidebar-foreground/70">
          {t.app.settings}
        </div>
        <div className="grid gap-1">
          {navigationItems.map((item) => {
            const Icon = item.icon
            const isActive = item.id === activeSection
            return (
              <button
                key={item.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "window-no-drag flex h-8 w-full items-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-left text-sm outline-hidden transition-[width,height,padding] focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  isActive
                    ? SETTINGS_NAVIGATION_ACTIVE_CLASS
                    : SETTINGS_NAVIGATION_IDLE_CLASS
                )}
                onClick={() => onSectionChange(item.id)}
              >
                <Icon size={16} strokeWidth={1.75} />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </aside>
  )
}

export const SettingsSidebar = memo(SettingsSidebarComponent)
