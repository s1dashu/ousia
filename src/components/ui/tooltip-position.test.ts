import { describe, expect, it, vi } from "vitest"

import {
  cancelTooltipPositionUpdate,
  scheduleTooltipPositionUpdate,
} from "./tooltip-position"

describe("tooltip position scheduling", () => {
  it("uses DOM and coordinate snapshots after the pointer event has returned", () => {
    const animationFrameRef = { current: null as number | null }
    const cancelFrame = vi.fn()
    const updatePosition = vi.fn()
    const target = { getBoundingClientRect: vi.fn() } as unknown as HTMLElement
    let scheduledCallback: FrameRequestCallback | undefined

    scheduleTooltipPositionUpdate({
      animationFrameRef,
      cancelFrame,
      clientX: 144,
      requestFrame: (callback) => {
        scheduledCallback = callback
        return 7
      },
      target,
      updatePosition,
    })

    expect(animationFrameRef.current).toBe(7)
    scheduledCallback?.(0)
    expect(updatePosition).toHaveBeenCalledWith(target, 144)
    expect(animationFrameRef.current).toBeNull()
  })

  it("cancels stale frames before scheduling or leaving the trigger", () => {
    const animationFrameRef = { current: 3 as number | null }
    const cancelFrame = vi.fn()

    scheduleTooltipPositionUpdate({
      animationFrameRef,
      cancelFrame,
      clientX: 10,
      requestFrame: () => 4,
      target: {} as HTMLElement,
      updatePosition: vi.fn(),
    })
    expect(cancelFrame).toHaveBeenCalledWith(3)
    expect(animationFrameRef.current).toBe(4)

    cancelTooltipPositionUpdate(animationFrameRef, cancelFrame)
    expect(cancelFrame).toHaveBeenCalledWith(4)
    expect(animationFrameRef.current).toBeNull()
  })
})
