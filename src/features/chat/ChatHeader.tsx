import { Check, Copy, MoreHorizontal, SquareTerminal } from "lucide-react"

import type { SessionRecord } from "@/app/app-state"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { getMessages } from "@/app/i18n"
import { TitleBarSidebarToggle } from "@/features/shell/TitleBarTrafficLightSlot"

export type ChatCopyStatus = "idle" | "copied" | "failed"

type ChatHeaderProps = {
  copyStatus: ChatCopyStatus
  currentSession: SessionRecord | undefined
  isSessionMenuOpen: boolean
  isSidebarCollapsed: boolean
  isTerminalPanelCollapsed: boolean
  isWindowFullscreen: boolean
  onCopySessionHistory: () => void
  onExpandTerminalPanel: () => void
  onSessionMenuOpenChange: (open: boolean) => void
  onToggleSidebar: () => void
  t: ReturnType<typeof getMessages>
}

export function ChatHeader({
  copyStatus,
  currentSession,
  isSessionMenuOpen,
  isSidebarCollapsed,
  isTerminalPanelCollapsed,
  isWindowFullscreen,
  onCopySessionHistory,
  onExpandTerminalPanel,
  onSessionMenuOpenChange,
  onToggleSidebar,
  t,
}: ChatHeaderProps) {
  return (
    <header className="window-drag grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b pr-4 pl-4">
      <div className="window-drag flex min-w-0 items-center gap-3 self-stretch">
        {isSidebarCollapsed ? (
          <TitleBarSidebarToggle
            isFullscreen={isWindowFullscreen}
            label={t.chat.expandSidebar}
            onClick={onToggleSidebar}
          />
        ) : null}
        <div className="window-drag flex min-w-0 flex-1 items-center self-stretch">
          <h1 className="window-drag truncate text-sm leading-none font-normal">
            {currentSession?.title ?? t.app.newSession}
          </h1>
          <DropdownMenu
            modal={false}
            open={isSessionMenuOpen}
            onOpenChange={onSessionMenuOpenChange}
          >
            <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="window-no-drag ml-1 shrink-0"
                  aria-label={t.chat.moreSessionActions}
                >
                  <MoreHorizontal size={18} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-auto rounded-md shadow-none dark:shadow-md"
            >
              <DropdownMenuItem
                className="gap-2 rounded-sm px-2 py-1.5 hover:bg-muted/45 focus:bg-muted/45"
                onClick={onCopySessionHistory}
              >
                {copyStatus === "copied" ? (
                  <Check size={18} className="text-muted-foreground" />
                ) : (
                  <Copy size={18} className="text-muted-foreground" />
                )}
                <span className="flex-1">
                  {copyStatus === "copied"
                    ? t.app.copied
                    : copyStatus === "failed"
                      ? t.app.copyFailed
                      : t.chat.copyHistory}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="window-drag flex shrink-0 items-center gap-1">
        {isTerminalPanelCollapsed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="window-no-drag size-6 rounded-md"
            aria-label={t.chat.openTerminal}
            onClick={onExpandTerminalPanel}
          >
            <SquareTerminal size={18} />
          </Button>
        ) : null}
      </div>
    </header>
  )
}
