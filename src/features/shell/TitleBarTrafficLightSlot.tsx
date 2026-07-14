import { useRef } from "react"
import { PanelLeft } from "@/components/icons/huge-icons"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useTrafficLightAlignment } from "@/tauri/window-chrome"

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
      className="window-drag h-[var(--ousia-titlebar-height)] w-[var(--ousia-titlebar-traffic-light-slot-width)] shrink-0"
      data-tauri-drag-region="deep"
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
  const buttonRef = useRef<HTMLButtonElement>(null)
  useTrafficLightAlignment(buttonRef, !isFullscreen)

  return (
    <div
      data-tauri-drag-region="deep"
      className={cn(
        "window-drag flex h-[var(--ousia-titlebar-height)] shrink-0 items-center gap-2",
        className
      )}
    >
      <TitleBarTrafficLightSlot isFullscreen={isFullscreen} />
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        className="window-no-drag pointer-events-auto hover:bg-transparent focus-visible:bg-transparent"
        aria-label={label}
        onClick={onClick}
      >
        <PanelLeft size={18} strokeWidth={1.5} />
      </Button>
    </div>
  )
}
