import { useLayoutEffect, type RefObject } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

type TrafficLightAlignment =
  | {
      status: "aligned"
    }
  | {
      actualRendererToNativeScale: number
      expectedRendererToNativeScale: number
      status: "deferred"
    }

const RESIZE_SETTLE_DELAY_MS = 80
const GEOMETRY_RETRY_DELAY_MS = 50
const MAX_GEOMETRY_DEFERRALS = 8

export function useTrafficLightAlignment(
  buttonRef: RefObject<HTMLButtonElement | null>,
  enabled: boolean,
) {
  useLayoutEffect(() => {
    if (!enabled) return
    const button = buttonRef.current
    if (!button) {
      throw new Error("Sidebar toggle button is unavailable for alignment")
    }

    let animationFrame = 0
    let resizeTimer = 0
    let retryTimer = 0
    let disposed = false
    let inFlight = false
    let pending = false
    let geometryDeferralCount = 0
    let unlistenZoom: UnlistenFn | undefined

    const fail = (error: unknown) => {
      if (disposed) return
      disposed = true
      queueMicrotask(() => {
        throw new Error("Failed to align macOS traffic lights", {
          cause: error,
        })
      })
    }

    const synchronize = () => {
      if (disposed) return
      if (inFlight) {
        pending = true
        return
      }
      inFlight = true
      const rect = button.getBoundingClientRect()
      void invoke<TrafficLightAlignment>("sync_window_traffic_lights", {
        rendererCenterY: rect.top + rect.height / 2,
        viewportHeight: window.innerHeight,
      })
        .then((result) => {
          if (result.status === "aligned") {
            geometryDeferralCount = 0
            return
          }
          if (result.status !== "deferred") {
            throw new Error(
              `Unknown traffic-light alignment status: ${String((result as { status?: unknown }).status)}`,
            )
          }

          geometryDeferralCount += 1
          if (geometryDeferralCount > MAX_GEOMETRY_DEFERRALS) {
            throw new Error(
              `Window geometry did not stabilize after ${MAX_GEOMETRY_DEFERRALS} retries ` +
                `(actual scale ${result.actualRendererToNativeScale}, ` +
                `expected ${result.expectedRendererToNativeScale})`,
            )
          }
          if (retryTimer) window.clearTimeout(retryTimer)
          retryTimer = window.setTimeout(() => {
            retryTimer = 0
            schedule()
          }, GEOMETRY_RETRY_DELAY_MS)
        })
        .catch(fail)
        .finally(() => {
          inFlight = false
          if (pending) {
            pending = false
            schedule()
          }
        })
    }

    const schedule = () => {
      if (disposed || animationFrame) return
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        synchronize()
      })
    }

    const scheduleAfterResizeSettles = () => {
      if (disposed) return
      if (resizeTimer) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        resizeTimer = 0
        schedule()
      }, RESIZE_SETTLE_DELAY_MS)
    }

    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(button)
    window.addEventListener("resize", scheduleAfterResizeSettles)
    window.visualViewport?.addEventListener(
      "resize",
      scheduleAfterResizeSettles,
    )
    void listen("ousia:window:zoom", schedule).then((unsubscribe) => {
      if (disposed) unsubscribe()
      else unlistenZoom = unsubscribe
    }, fail)
    schedule()

    return () => {
      disposed = true
      resizeObserver.disconnect()
      window.removeEventListener("resize", scheduleAfterResizeSettles)
      window.visualViewport?.removeEventListener(
        "resize",
        scheduleAfterResizeSettles,
      )
      unlistenZoom?.()
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      if (resizeTimer) window.clearTimeout(resizeTimer)
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [buttonRef, enabled])
}
