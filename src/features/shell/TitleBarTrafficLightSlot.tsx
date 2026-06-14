import { PanelLeft } from "lucide-react"

import { Button } from "@/components/ui/button"

export function TitleBarTrafficLightSlot({
  isFullscreen,
}: {
  isFullscreen: boolean
}) {
  if (isFullscreen) {
    return null
  }

  return <div className="w-[70px] shrink-0" aria-hidden="true" />
}

export function TitleBarSidebarToggle({
  isFullscreen,
  label,
  onClick,
}: {
  isFullscreen: boolean
  label: string
  onClick: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <TitleBarTrafficLightSlot isFullscreen={isFullscreen} />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="window-no-drag"
        aria-label={label}
        onClick={onClick}
      >
        <PanelLeft size={18} strokeWidth={1.5} />
      </Button>
    </div>
  )
}
