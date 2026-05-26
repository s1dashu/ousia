import { LayoutLeftIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button"

export function TitleBarTrafficLightSlot({
  isFullscreen,
}: {
  isFullscreen: boolean
}) {
  if (isFullscreen) {
    return null
  }

  return <div className="w-[54px] shrink-0" aria-hidden="true" />
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
        aria-label={label}
        onClick={onClick}
      >
        <HugeiconsIcon icon={LayoutLeftIcon} size={19} strokeWidth={1.8} />
      </Button>
    </div>
  )
}
