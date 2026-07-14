export type ScrollMetrics = {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

export type ChatScrollFollowDecision =
  "follow" | "restore" | "stop" | "stop-observed-history-scroll"

export type FilePreviewFollowState = {
  isFollowingLatest: boolean
  showScrollToLatest: boolean
}

export type ChatScrollMovement = {
  geometryChanged: boolean
  isScrollingTowardHistory: boolean
  isUnexplainedHistoryScroll: boolean
}

export type VerticalBounds = {
  bottom: number
  top: number
}

export function classifyChatScrollMovement(
  previous: ScrollMetrics,
  current: ScrollMetrics,
  threshold = 1,
): ChatScrollMovement {
  const isScrollingTowardHistory =
    current.scrollTop < previous.scrollTop - threshold
  const geometryChanged =
    Math.abs(current.scrollHeight - previous.scrollHeight) > threshold ||
    Math.abs(current.clientHeight - previous.clientHeight) > threshold

  return {
    geometryChanged,
    isScrollingTowardHistory,
    isUnexplainedHistoryScroll: isScrollingTowardHistory && !geometryChanged,
  }
}

export function isScrollAtLatest(metrics: ScrollMetrics, threshold = 24) {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold
  )
}

export function chatBottomClearanceForOverlay({
  existingBottomPadding,
  overlay,
  viewport,
}: {
  existingBottomPadding: number
  overlay: VerticalBounds
  viewport: VerticalBounds
}) {
  const overlap = Math.max(
    0,
    Math.min(viewport.bottom, overlay.bottom) -
      Math.max(viewport.top, overlay.top),
  )
  return Math.ceil(Math.max(0, overlap - existingBottomPadding))
}

export function canScrollInDirection(metrics: ScrollMetrics, deltaY: number) {
  if (deltaY < 0) {
    return metrics.scrollTop > 0
  }
  if (deltaY > 0) {
    return metrics.scrollTop + metrics.clientHeight < metrics.scrollHeight - 1
  }
  return false
}

export function decideFilePreviewFollowState({
  hasScrollableContent,
  isAtLatest,
  isFollowingLatest,
}: {
  hasScrollableContent: boolean
  isAtLatest: boolean
  isFollowingLatest: boolean
}): FilePreviewFollowState {
  const shouldFollowLatest = isAtLatest || isFollowingLatest
  return {
    isFollowingLatest: shouldFollowLatest,
    showScrollToLatest:
      !shouldFollowLatest && !isAtLatest && hasScrollableContent,
  }
}

export function decideChatScrollFollow({
  hasPendingProgrammaticScroll,
  isAtLatest,
  isFollowingLatest,
  isScrollingTowardHistory,
  manualScrollAwayFromLatest,
  manualScrollIntent,
}: {
  hasPendingProgrammaticScroll: boolean
  isAtLatest: boolean
  isFollowingLatest: boolean
  isScrollingTowardHistory: boolean
  manualScrollAwayFromLatest: boolean
  manualScrollIntent: boolean
}): ChatScrollFollowDecision {
  if (manualScrollAwayFromLatest) {
    return "stop"
  }
  if (manualScrollIntent) {
    return isAtLatest ? "follow" : "stop"
  }
  if (isFollowingLatest && !isAtLatest) {
    if (hasPendingProgrammaticScroll) {
      return "restore"
    }
    return isScrollingTowardHistory ? "stop-observed-history-scroll" : "restore"
  }
  return isAtLatest ? "follow" : "stop"
}
