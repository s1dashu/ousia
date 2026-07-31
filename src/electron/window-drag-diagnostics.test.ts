import { describe, expect, it } from "vitest"

import {
  classifyWindowDragSamples,
  isWindowFillingDisplay,
  requireWindowDragDiagnosticPayload,
  requireWindowDragInspectRequest,
  type WindowDragElementSample,
} from "./window-drag-diagnostics"
import { createWindowResizeDiagnosticTracker } from "./window-resize-diagnostic-session"

const dragSample: WindowDragElementSample = {
  appRegion: "drag",
  hasDragClass: true,
  hasNoDragClass: false,
  pointerEvents: "auto",
  position: "relative",
  rect: {
    height: 40,
    width: 500,
    x: 0,
    y: 0,
  },
  tag: "header",
  zIndex: 30,
}

describe("window drag diagnostics", () => {
  it("treats any overlapping no-drag sample as an exclusion", () => {
    expect(
      classifyWindowDragSamples([
        dragSample,
        {
          appRegion: "no-drag",
        },
      ])
    ).toBe("no-drag")
    expect(classifyWindowDragSamples([dragSample])).toBe("drag")
    expect(classifyWindowDragSamples([])).toBe("none")
  })

  it("reconstructs renderer layout payloads without arbitrary fields", () => {
    expect(
      requireWindowDragDiagnosticPayload({
        dragRegionCount: 1,
        kind: "renderer-layout",
        privateText: "must not reach the runtime log",
        regions: [dragSample],
        sequence: 7,
        titlebarHeight: 40,
        trigger: "resized",
        viewport: {
          devicePixelRatio: 2,
          height: 900,
          width: 1440,
        },
      })
    ).toEqual({
      dragRegionCount: 1,
      kind: "renderer-layout",
      regions: [dragSample],
      sequence: 7,
      titlebarHeight: 40,
      trigger: "resized",
      viewport: {
        devicePixelRatio: 2,
        height: 900,
        width: 1440,
      },
    })
  })

  it("rejects unsafe or unbounded pointer diagnostics", () => {
    expect(() =>
      requireWindowDragDiagnosticPayload({
        button: 0,
        expectedRegion: "drag",
        kind: "titlebar-pointerdown",
        millisecondsSinceLayout: 12,
        pointerType: "mouse",
        sequence: 2,
        stack: [{ ...dragSample, tag: "user-provided-tag" }],
        viewport: {
          devicePixelRatio: 2,
          height: 900,
          width: 1440,
        },
        x: 200,
        y: 20,
      })
    ).toThrow("diagnostic.stack[0].tag has an unsupported value")

    expect(() =>
      requireWindowDragDiagnosticPayload({
        button: 0,
        expectedRegion: "drag",
        kind: "titlebar-pointerdown",
        millisecondsSinceLayout: 12,
        pointerType: "mouse",
        sequence: 2,
        stack: [dragSample],
        viewport: {
          devicePixelRatio: 2,
          height: 900,
          width: 1440,
        },
        x: 200_000,
        y: 20,
      })
    ).toThrow("diagnostic.x must be a finite number in range")
  })

  it("validates host inspection requests", () => {
    expect(
      requireWindowDragInspectRequest({
        sequence: 3,
        trigger: "resize-debounce",
      })
    ).toEqual({
      sequence: 3,
      trigger: "resize-debounce",
    })
    expect(() =>
      requireWindowDragInspectRequest({
        sequence: 3,
        trigger: "renderer-value",
      })
    ).toThrow("inspectRequest.trigger has an unsupported value")
  })

  it("uses the same one-pixel tolerance as fullscreen inference", () => {
    const displayBounds = { height: 900, width: 1440, x: 0, y: 0 }
    expect(
      isWindowFillingDisplay(
        { height: 899, width: 1439, x: 1, y: -1 },
        displayBounds
      )
    ).toBe(true)
    expect(
      isWindowFillingDisplay(
        { height: 898, width: 1440, x: 0, y: 0 },
        displayBounds
      )
    ).toBe(false)
  })

  it("aggregates a resize lifecycle before requesting renderer inspection", () => {
    let now = 100
    let snapshot = {
      bounds: { height: 700, width: 1000, x: 20, y: 30 },
      displayBounds: { height: 900, width: 1440, x: 0, y: 0 },
      fillsDisplay: false,
      inferredFullscreen: false,
      nativeFullscreen: false,
      zoomPercent: 100,
    }
    const starts: Record<string, unknown>[] = []
    const finishes: Record<string, unknown>[] = []
    const inspections: unknown[] = []
    const tracker = createWindowResizeDiagnosticTracker({
      inspect: (request) => inspections.push(request),
      now: () => now,
      readSnapshot: () => snapshot,
      writeFinish: (fields) => finishes.push(fields),
      writeStart: (fields) => starts.push(fields),
    })

    tracker.recordWillResize(
      { height: 700, width: 1100, x: 20, y: 30 },
      "right"
    )
    now = 160
    snapshot = {
      ...snapshot,
      bounds: { height: 700, width: 1100, x: 20, y: 30 },
      inferredFullscreen: true,
    }
    tracker.recordResize(false)
    now = 175
    tracker.resized()

    expect(starts).toEqual([
      expect.objectContaining({
        sequence: 1,
        source: "manual",
      }),
    ])
    expect(finishes).toEqual([
      expect.objectContaining({
        durationMs: 75,
        inferredFullscreenTransitions: 1,
        manualEdges: ["right"],
        resizeEventCount: 1,
        sequence: 1,
        trigger: "resized",
        willResizeEventCount: 1,
        windowButtonPositionApplyCount: 0,
      }),
    ])
    expect(inspections).toEqual([{ sequence: 1, trigger: "resized" }])
    tracker.dispose()
  })
})
