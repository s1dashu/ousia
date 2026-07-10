type AnimationFrameRef = { current: number | null }

type ScheduleTooltipPositionUpdateOptions = {
  animationFrameRef: AnimationFrameRef
  cancelFrame: (frameId: number) => void
  clientX: number
  requestFrame: (callback: FrameRequestCallback) => number
  target: HTMLElement
  updatePosition: (target: HTMLElement, clientX: number) => void
}

export function cancelTooltipPositionUpdate(
  animationFrameRef: AnimationFrameRef,
  cancelFrame: (frameId: number) => void
) {
  if (animationFrameRef.current === null) {
    return
  }
  cancelFrame(animationFrameRef.current)
  animationFrameRef.current = null
}

export function scheduleTooltipPositionUpdate({
  animationFrameRef,
  cancelFrame,
  clientX,
  requestFrame,
  target,
  updatePosition,
}: ScheduleTooltipPositionUpdateOptions) {
  cancelTooltipPositionUpdate(animationFrameRef, cancelFrame)
  animationFrameRef.current = requestFrame(() => {
    animationFrameRef.current = null
    updatePosition(target, clientX)
  })
}
