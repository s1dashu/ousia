import { useEffect, useState } from "react"

import type { ChatItem } from "@/features/chat/chat-events"

const TURN_WAIT_INDICATOR_DELAY_MS = 180

export function shouldShowTurnWaitIndicator(
  items: ChatItem[],
  isAgentWorking: boolean
) {
  if (!isAgentWorking) {
    return false
  }
  return !items.some((item) => {
    if (item.role === "assistant" || item.role === "thinking") {
      return item.status === "streaming"
    }
    if (item.role === "tool") {
      return item.status === "running"
    }
    return false
  })
}

export function useDelayedTurnWaitIndicator(shouldShow: boolean) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (!shouldShow) {
      const timeoutId = window.setTimeout(() => {
        setIsVisible(false)
      }, 0)
      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    const timeoutId = window.setTimeout(() => {
      setIsVisible(true)
    }, TURN_WAIT_INDICATOR_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [shouldShow])

  return isVisible
}
