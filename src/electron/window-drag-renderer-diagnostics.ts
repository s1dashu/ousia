import {
  classifyWindowDragSamples,
  requireWindowDragInspectRequest,
  WINDOW_DRAG_DIAGNOSTIC_CHANNEL,
  WINDOW_DRAG_INSPECT_CHANNEL,
  type WindowDragDiagnosticPayload,
  type WindowDragElementSample,
  type WindowDragViewportSample,
} from "./window-drag-diagnostics.js"

const MAX_ELEMENT_SAMPLES = 32
const MAX_POINTER_REPORTS_PER_RESIZE = 12
const POINTER_REPORT_WINDOW_MS = 120_000
const FALLBACK_TITLEBAR_HEIGHT = 40
const TITLEBAR_POINTER_MARGIN = 8

const SAFE_ELEMENT_TAGS = new Set<WindowDragElementSample["tag"]>([
  "a",
  "button",
  "div",
  "header",
  "input",
  "main",
  "section",
  "span",
  "textarea",
  "other",
])

type DiagnosticIpc = {
  on(
    channel: string,
    listener: (event: unknown, payload: unknown) => void
  ): void
  send(channel: string, payload: WindowDragDiagnosticPayload): void
}

function roundMetric(value: number) {
  return Number(value.toFixed(2))
}

function normalizeAppRegion(
  value: string
): WindowDragElementSample["appRegion"] {
  if (value === "drag" || value === "no-drag") {
    return value
  }
  return value ? "other" : "none"
}

function normalizePointerEvents(
  value: string
): WindowDragElementSample["pointerEvents"] {
  if (value === "auto" || value === "none") {
    return value
  }
  return "other"
}

function normalizePosition(value: string): WindowDragElementSample["position"] {
  if (
    value === "absolute" ||
    value === "fixed" ||
    value === "relative" ||
    value === "static" ||
    value === "sticky"
  ) {
    return value
  }
  return "other"
}

function normalizeTag(element: Element): WindowDragElementSample["tag"] {
  const tag = element.tagName.toLowerCase()
  return SAFE_ELEMENT_TAGS.has(tag as WindowDragElementSample["tag"])
    ? (tag as WindowDragElementSample["tag"])
    : "other"
}

function normalizeZIndex(value: string) {
  if (!value || value === "auto") {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return Math.min(Math.max(parsed, -1_000_000), 1_000_000)
}

function appRegionForStyle(style: CSSStyleDeclaration) {
  const prefixed = style.getPropertyValue("-webkit-app-region").trim()
  if (prefixed) {
    return prefixed
  }
  return style.getPropertyValue("app-region").trim()
}

function sampleElement(element: Element): WindowDragElementSample {
  const style = globalThis.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return {
    appRegion: normalizeAppRegion(appRegionForStyle(style)),
    hasDragClass: element.classList.contains("window-drag"),
    hasNoDragClass: element.classList.contains("window-no-drag"),
    pointerEvents: normalizePointerEvents(style.pointerEvents),
    position: normalizePosition(style.position),
    rect: {
      height: roundMetric(rect.height),
      width: roundMetric(rect.width),
      x: roundMetric(rect.x),
      y: roundMetric(rect.y),
    },
    tag: normalizeTag(element),
    zIndex: normalizeZIndex(style.zIndex),
  }
}

function viewportSample(): WindowDragViewportSample {
  return {
    devicePixelRatio: roundMetric(globalThis.devicePixelRatio),
    height: roundMetric(globalThis.innerHeight),
    width: roundMetric(globalThis.innerWidth),
  }
}

function titlebarHeight() {
  const value = globalThis
    .getComputedStyle(document.documentElement)
    .getPropertyValue("--ousia-titlebar-height")
    .trim()
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed >= 0 ? roundMetric(parsed) : null
}

function sampleDragRegions() {
  const regions = Array.from(document.querySelectorAll(".window-drag"))
  return {
    count: regions.length,
    samples: regions.slice(0, MAX_ELEMENT_SAMPLES).map(sampleElement),
  }
}

function collectPointElements(event: PointerEvent) {
  const elements: Element[] = []
  const seen = new Set<Element>()
  const add = (value: EventTarget | Element | null) => {
    if (!(value instanceof Element) || seen.has(value)) {
      return
    }
    seen.add(value)
    elements.push(value)
  }

  for (const value of event.composedPath()) {
    add(value)
  }
  for (const element of document.elementsFromPoint(
    event.clientX,
    event.clientY
  )) {
    add(element)
    let ancestor = element.parentElement
    while (ancestor && elements.length < MAX_ELEMENT_SAMPLES) {
      add(ancestor)
      ancestor = ancestor.parentElement
    }
  }

  return elements.slice(0, MAX_ELEMENT_SAMPLES)
}

function normalizePointerType(
  value: string
): Extract<
  WindowDragDiagnosticPayload,
  { kind: "titlebar-pointerdown" }
>["pointerType"] {
  if (value === "mouse" || value === "pen" || value === "touch") {
    return value
  }
  return "other"
}

export function installWindowDragRendererDiagnostics(ipc: DiagnosticIpc) {
  let activeResizeSequence: number | undefined
  let lastLayoutAt = 0
  let pointerReportsForResize = 0
  let pendingFirstFrame = 0
  let pendingSecondFrame = 0

  function reportLayout(payload: unknown) {
    const request = requireWindowDragInspectRequest(payload)
    const dragRegions = sampleDragRegions()
    ipc.send(WINDOW_DRAG_DIAGNOSTIC_CHANNEL, {
      dragRegionCount: dragRegions.count,
      kind: "renderer-layout",
      regions: dragRegions.samples,
      sequence: request.sequence,
      titlebarHeight: titlebarHeight(),
      trigger: request.trigger,
      viewport: viewportSample(),
    })
    if (request.trigger !== "initial") {
      activeResizeSequence = request.sequence
      lastLayoutAt = performance.now()
      pointerReportsForResize = 0
    }
  }

  ipc.on(WINDOW_DRAG_INSPECT_CHANNEL, (_event, payload) => {
    globalThis.cancelAnimationFrame(pendingFirstFrame)
    globalThis.cancelAnimationFrame(pendingSecondFrame)
    pendingFirstFrame = globalThis.requestAnimationFrame(() => {
      pendingFirstFrame = 0
      pendingSecondFrame = globalThis.requestAnimationFrame(() => {
        pendingSecondFrame = 0
        reportLayout(payload)
      })
    })
  })

  globalThis.addEventListener(
    "pointerdown",
    (event) => {
      if (
        activeResizeSequence === undefined ||
        pointerReportsForResize >= MAX_POINTER_REPORTS_PER_RESIZE
      ) {
        return
      }
      const millisecondsSinceLayout = performance.now() - lastLayoutAt
      if (
        millisecondsSinceLayout < 0 ||
        millisecondsSinceLayout > POINTER_REPORT_WINDOW_MS
      ) {
        return
      }
      const currentTitlebarHeight = titlebarHeight() ?? FALLBACK_TITLEBAR_HEIGHT
      if (
        event.clientY < 0 ||
        event.clientY > currentTitlebarHeight + TITLEBAR_POINTER_MARGIN
      ) {
        return
      }
      if (event.button < 0 || event.button > 5) {
        return
      }

      const stack = collectPointElements(event).map(sampleElement)
      pointerReportsForResize += 1
      ipc.send(WINDOW_DRAG_DIAGNOSTIC_CHANNEL, {
        button: event.button,
        expectedRegion: classifyWindowDragSamples(stack),
        kind: "titlebar-pointerdown",
        millisecondsSinceLayout: roundMetric(millisecondsSinceLayout),
        pointerType: normalizePointerType(event.pointerType),
        sequence: activeResizeSequence,
        stack,
        viewport: viewportSample(),
        x: roundMetric(event.clientX),
        y: roundMetric(event.clientY),
      })
    },
    { capture: true }
  )
}
