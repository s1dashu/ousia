import type {
  WindowDragDiagnosticRect,
  WindowDragInspectRequest,
} from "./window-drag-diagnostics.js"

const RESIZE_FINISH_FALLBACK_MS = 1_000

export type WindowResizeDiagnosticSnapshot = {
  bounds: WindowDragDiagnosticRect
  displayBounds: WindowDragDiagnosticRect
  fillsDisplay: boolean
  inferredFullscreen: boolean
  nativeFullscreen: boolean
  zoomPercent: number
}

type WindowResizeDiagnosticSession = {
  firstProposedBounds?: WindowDragDiagnosticRect
  inferredFullscreenTransitions: number
  lastBounds: WindowDragDiagnosticRect
  lastInferredFullscreen: boolean
  lastProposedBounds?: WindowDragDiagnosticRect
  manualEdges: Set<string>
  resizeEventCount: number
  sequence: number
  source: "manual" | "unknown"
  startBounds: WindowDragDiagnosticRect
  startedAt: number
  willResizeEventCount: number
  windowButtonPositionApplyCount: number
}

type WindowResizeDiagnosticTrackerOptions = {
  inspect: (request: WindowDragInspectRequest) => void
  now?: () => number
  readSnapshot: () => WindowResizeDiagnosticSnapshot | null
  writeFinish: (fields: Record<string, unknown>) => void
  writeStart: (fields: Record<string, unknown>) => void
}

export function createWindowResizeDiagnosticTracker({
  inspect,
  now = () => performance.now(),
  readSnapshot,
  writeFinish,
  writeStart,
}: WindowResizeDiagnosticTrackerOptions) {
  let sequence = 0
  let session: WindowResizeDiagnosticSession | undefined
  let finishTimer: ReturnType<typeof setTimeout> | undefined

  function ensureSession(source: WindowResizeDiagnosticSession["source"]) {
    if (session) {
      if (source === "manual") {
        session.source = "manual"
      }
      return session
    }
    const snapshot = readSnapshot()
    if (!snapshot) {
      return undefined
    }
    sequence += 1
    session = {
      inferredFullscreenTransitions: 0,
      lastBounds: snapshot.bounds,
      lastInferredFullscreen: snapshot.inferredFullscreen,
      manualEdges: new Set(),
      resizeEventCount: 0,
      sequence,
      source,
      startBounds: snapshot.bounds,
      startedAt: now(),
      willResizeEventCount: 0,
      windowButtonPositionApplyCount: 0,
    }
    writeStart({
      bounds: snapshot.bounds,
      fillsDisplay: snapshot.fillsDisplay,
      inferredFullscreen: snapshot.inferredFullscreen,
      nativeFullscreen: snapshot.nativeFullscreen,
      sequence,
      source,
      zoomPercent: snapshot.zoomPercent,
    })
    return session
  }

  function scheduleFinish() {
    if (finishTimer) {
      clearTimeout(finishTimer)
    }
    finishTimer = setTimeout(
      () => finish("resize-debounce"),
      RESIZE_FINISH_FALLBACK_MS
    )
  }

  function finish(
    trigger: Exclude<WindowDragInspectRequest["trigger"], "initial">
  ) {
    if (finishTimer) {
      clearTimeout(finishTimer)
      finishTimer = undefined
    }
    const completedSession = session
    const snapshot = readSnapshot()
    if (!completedSession || !snapshot) {
      return
    }
    session = undefined
    writeFinish({
      displayBounds: snapshot.displayBounds,
      durationMs: Number((now() - completedSession.startedAt).toFixed(1)),
      endBounds: snapshot.bounds,
      fillsDisplay: snapshot.fillsDisplay,
      firstProposedBounds: completedSession.firstProposedBounds,
      inferredFullscreen: snapshot.inferredFullscreen,
      inferredFullscreenTransitions:
        completedSession.inferredFullscreenTransitions,
      lastObservedBounds: completedSession.lastBounds,
      lastProposedBounds: completedSession.lastProposedBounds,
      manualEdges: [...completedSession.manualEdges],
      nativeFullscreen: snapshot.nativeFullscreen,
      resizeEventCount: completedSession.resizeEventCount,
      sequence: completedSession.sequence,
      source: completedSession.source,
      startBounds: completedSession.startBounds,
      trigger,
      willResizeEventCount: completedSession.willResizeEventCount,
      windowButtonPositionApplyCount:
        completedSession.windowButtonPositionApplyCount,
      zoomPercent: snapshot.zoomPercent,
    })
    inspect({
      sequence: completedSession.sequence,
      trigger,
    })
  }

  return {
    dispose() {
      if (finishTimer) {
        clearTimeout(finishTimer)
        finishTimer = undefined
      }
      session = undefined
    },
    recordResize(windowButtonPositionApplied: boolean) {
      const currentSession = ensureSession("unknown")
      if (!currentSession) {
        return
      }
      currentSession.resizeEventCount += 1
      if (windowButtonPositionApplied) {
        currentSession.windowButtonPositionApplyCount += 1
      }
      const snapshot = readSnapshot()
      if (snapshot) {
        currentSession.lastBounds = snapshot.bounds
        if (
          currentSession.lastInferredFullscreen !== snapshot.inferredFullscreen
        ) {
          currentSession.inferredFullscreenTransitions += 1
          currentSession.lastInferredFullscreen = snapshot.inferredFullscreen
        }
      }
      scheduleFinish()
    },
    recordWillResize(newBounds: WindowDragDiagnosticRect, edge: string) {
      const currentSession = ensureSession("manual")
      if (!currentSession) {
        return
      }
      currentSession.willResizeEventCount += 1
      currentSession.firstProposedBounds ??= newBounds
      currentSession.lastProposedBounds = newBounds
      currentSession.manualEdges.add(edge)
      scheduleFinish()
    },
    resized() {
      finish("resized")
    },
  }
}
