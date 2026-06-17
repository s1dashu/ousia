import {
  ArrowShrink,
  Check,
  Copy,
  MoreHorizontal,
} from "@/components/icons/huge-icons"

import type { SessionRecord } from "@/app/app-state"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { getMessages } from "@/app/i18n"
import { cn } from "@/lib/utils"

export type ChatCopyStatus = "idle" | "copied" | "failed"

type ChatHeaderProps = {
  copyStatus: ChatCopyStatus
  currentSession: SessionRecord | undefined
  isCompacting: boolean
  isSessionMenuOpen: boolean
  isSidebarCollapsed: boolean
  isScrolled: boolean
  isWindowFullscreen: boolean
  onCopySessionHistory: () => void
  onExportSession: (format: "markdown" | "html" | "jsonl") => void
  onManualCompact: () => void
  onSessionMenuOpenChange: (open: boolean) => void
  t: ReturnType<typeof getMessages>
}

export function ChatHeader({
  copyStatus,
  currentSession,
  isCompacting,
  isSessionMenuOpen,
  isSidebarCollapsed,
  isScrolled,
  isWindowFullscreen,
  onCopySessionHistory,
  onExportSession,
  onManualCompact,
  onSessionMenuOpenChange,
  t,
}: ChatHeaderProps) {
  return (
    <header
      className={cn(
        "window-drag absolute top-0 right-0 left-px z-30 grid h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-tl-[calc(var(--ousia-chat-panel-radius)-1px)] pr-4 pl-4 transition-[background-color,box-shadow,backdrop-filter]",
        isScrolled
          ? "bg-white shadow-none dark:bg-card"
          : "bg-white shadow-none dark:bg-card"
      )}
    >
      <div className="window-drag absolute inset-0" aria-hidden="true" />
      <div
        className={cn(
          "window-drag pointer-events-none relative z-10 flex min-w-0 items-center gap-3 self-stretch",
          isSidebarCollapsed && (isWindowFullscreen ? "pl-10" : "pl-[108px]")
        )}
      >
        <div className="window-drag flex min-w-0 flex-1 items-center self-stretch pl-2">
          <h1 className="window-drag truncate text-sm leading-none font-normal">
            {currentSession?.title ?? t.app.newSession}
          </h1>
        </div>
      </div>
      <div className="window-drag pointer-events-none relative z-10 flex shrink-0 items-center justify-end gap-1">
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
          <DropdownMenuContent
            align="end"
            className="w-auto rounded-md p-1"
          >
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
              onClick={() => onExportSession("html")}
            >
              <Copy size={18} className="text-neutral-500" />
              <span className="flex-1">{t.chat.exportHtml}</span>
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
