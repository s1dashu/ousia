import { PanelLeft } from "@/components/icons/huge-icons"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function TitleBarTrafficLightSlot({
  isFullscreen,
}: {
  isFullscreen: boolean
}) {
  if (isFullscreen) {
    return null
  }

  return (
    <div
      className="window-drag pointer-events-none w-[70px] shrink-0"
      aria-hidden="true"
    />
  )
}

export function TitleBarSidebarToggle({
  className,
  isFullscreen,
  label,
  onClick,
}: {
  className?: string
  isFullscreen: boolean
  label: string
  onClick: () => void
}) {
  return (
    <div
      className={cn(
        "window-drag pointer-events-none flex h-10 shrink-0 items-center gap-2",
        className
      )}
    >
      <TitleBarTrafficLightSlot isFullscreen={isFullscreen} />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="window-no-drag ousia-squircle-corners pointer-events-auto size-6 rounded-lg hover:bg-[var(--sidebar-accent)] focus-visible:bg-[var(--sidebar-accent)]"
        aria-label={label}
        onClick={onClick}
      >
        <PanelLeft size={18} strokeWidth={1.5} />
      </Button>
    </div>
  )
}
