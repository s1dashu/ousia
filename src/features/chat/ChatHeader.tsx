import {
  ArrowShrink,
  Check,
  Copy,
  Folder,
  MoreHorizontal,
} from "@/components/icons/huge-icons"

import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { getMessages } from "@/app/i18n"
import { cn } from "@/lib/utils"

export type ChatCopyStatus = "idle" | "copied" | "failed"

type ChatHeaderProps = {
  copyStatus: ChatCopyStatus
  currentProject: ProjectRecord | undefined
  currentSession: SessionRecord | undefined
  isCompacting: boolean
  isOpeningProjectDirectory: boolean
  isSessionMenuOpen: boolean
  isSidebarCollapsed: boolean
  isScrolled: boolean
  isWindowFullscreen: boolean
  onCopySessionHistory: () => void
  onExportSession: (format: "markdown" | "jsonl") => void
  onManualCompact: () => void
  onOpenProjectDirectory: () => void
  onSessionMenuOpenChange: (open: boolean) => void
  t: ReturnType<typeof getMessages>
}

export function ChatHeader({
  copyStatus,
  currentProject,
  currentSession,
  isCompacting,
  isOpeningProjectDirectory,
  isSessionMenuOpen,
  isSidebarCollapsed,
  isScrolled,
  isWindowFullscreen,
  onCopySessionHistory,
  onExportSession,
  onManualCompact,
  onOpenProjectDirectory,
  onSessionMenuOpenChange,
  t,
}: ChatHeaderProps) {
  return (
    <header
      className={cn(
        "window-drag relative z-30 grid h-[var(--ousia-titlebar-height)] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pr-4 pl-4 transition-[background-color,box-shadow,backdrop-filter] select-none",
        isScrolled
          ? "bg-white shadow-none dark:bg-card"
          : "bg-white shadow-none dark:bg-card"
      )}
    >
      <div className="window-drag absolute inset-0" aria-hidden="true" />
      <div
        className={cn(
          "window-drag relative z-10 flex min-w-0 items-center gap-3 self-stretch",
          isSidebarCollapsed &&
            (isWindowFullscreen
              ? "pl-[var(--ousia-titlebar-height)]"
              : "pl-[var(--ousia-titlebar-sidebar-offset)]")
        )}
      >
        <div className="window-drag flex min-w-0 flex-1 items-center gap-2 self-stretch pl-2">
          <h1 className="window-drag truncate text-sm leading-none font-normal">
            {currentSession?.title ?? t.app.newSession}
          </h1>
          {currentSession?.agentProvider === "codex" ? (
            <span
              data-slot="agent-provider-badge"
              className="window-drag shrink-0 rounded-md bg-muted/55 px-1.5 py-0.5 text-[10px] leading-4 font-medium text-muted-foreground"
            >
              Codex
            </span>
          ) : null}
        </div>
      </div>
      <div className="window-drag relative z-10 flex shrink-0 items-center justify-end gap-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="window-no-drag pointer-events-auto shrink-0"
                aria-label={t.chat.openProjectDirectory}
                disabled={!currentProject || isOpeningProjectDirectory}
                onClick={onOpenProjectDirectory}
              >
                <Folder size={18} />
              </Button>
            </TooltipTrigger>
            <TooltipContent align="end" side="bottom">
              {t.chat.openProjectDirectory}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
              className="window-no-drag pointer-events-auto shrink-0"
              aria-label={t.chat.moreSessionActions}
            >
              <MoreHorizontal size={18} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto rounded-md p-1">
            <DropdownMenuItem
              className="gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 focus:bg-neutral-100"
              disabled={isCompacting || !currentSession}
              onClick={onManualCompact}
            >
              <ArrowShrink size={18} className="text-neutral-500" />
              <span className="flex-1">
                {isCompacting ? t.chat.compacting : t.chat.manualCompact}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 focus:bg-neutral-100"
              onClick={onCopySessionHistory}
            >
              {copyStatus === "copied" ? (
                <Check size={18} className="text-neutral-500" />
              ) : (
                <Copy size={18} className="text-neutral-500" />
              )}
              <span className="flex-1">
                {copyStatus === "copied"
                  ? t.app.copied
                  : copyStatus === "failed"
                    ? t.app.copyFailed
                    : t.chat.copyHistory}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 focus:bg-neutral-100"
              onClick={() => onExportSession("markdown")}
            >
              <Copy size={18} className="text-neutral-500" />
              <span className="flex-1">{t.chat.exportMarkdown}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 focus:bg-neutral-100"
              onClick={() => onExportSession("jsonl")}
            >
              <Copy size={18} className="text-neutral-500" />
              <span className="flex-1">{t.chat.exportJsonl}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
