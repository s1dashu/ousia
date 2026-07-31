import type { DropAnimationFunction } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import type { MotionValue } from "framer-motion"

export const SIDEBAR_DRAG_LAND_EASE = [0.25, 0.7, 0.2, 1] as const
export const SIDEBAR_DRAG_LAND_EASING = `cubic-bezier(${SIDEBAR_DRAG_LAND_EASE.join(", ")})`

export function sidebarDragLandingDurationMs(distance: number) {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new Error(
      `Sidebar drag landing distance must be a finite non-negative number, received ${distance}.`
    )
  }
  return Math.min(320, 180 + distance / 2.4)
}

export function createSidebarDropAnimation(
  shouldAnimate: MotionValue<boolean>
): DropAnimationFunction {
  return ({ active, dragOverlay, transform }) => {
    if (!shouldAnimate.get()) {
      return
    }

    const delta = {
      x: dragOverlay.rect.left - active.rect.left,
      y: dragOverlay.rect.top - active.rect.top,
    }
    const finalTransform = {
      x: transform.x - delta.x,
      y: transform.y - delta.y,
      scaleX:
        transform.scaleX !== 1
          ? (active.rect.width * transform.scaleX) / dragOverlay.rect.width
          : 1,
      scaleY:
        transform.scaleY !== 1
          ? (active.rect.height * transform.scaleY) / dragOverlay.rect.height
          : 1,
    }
    const distance = Math.hypot(
      finalTransform.x - transform.x,
      finalTransform.y - transform.y
    )
    if (distance === 0) {
      return
    }

    const previousActiveOpacity = active.node.style.opacity
    active.node.style.opacity = "0"
    const animation = dragOverlay.node.animate(
      [
        { transform: CSS.Transform.toString(transform) },
        { transform: CSS.Transform.toString(finalTransform) },
      ],
      {
        duration: sidebarDragLandingDurationMs(distance),
        easing: SIDEBAR_DRAG_LAND_EASING,
        fill: "forwards",
      }
    )

    return new Promise<void>((resolve) => {
      let settled = false
      const settle = () => {
        if (settled) {
          return
        }
        settled = true
        active.node.style.opacity = previousActiveOpacity
        resolve()
      }
      animation.addEventListener("finish", settle, { once: true })
      animation.addEventListener("cancel", settle, { once: true })
    })
  }
}
