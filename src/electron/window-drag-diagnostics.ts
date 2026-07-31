export const WINDOW_DRAG_INSPECT_CHANNEL = "ousia:window-drag:inspect"
export const WINDOW_DRAG_DIAGNOSTIC_CHANNEL = "ousia:window-drag:diagnostic"

const MAX_ELEMENT_SAMPLES = 32
const MAX_ABSOLUTE_COORDINATE = 100_000
const MAX_VIEWPORT_DIMENSION = 20_000
const MAX_RESIZE_SEQUENCE = 1_000_000_000

const APP_REGIONS = ["drag", "no-drag", "none", "other"] as const
const ELEMENT_POSITIONS = [
  "absolute",
  "fixed",
  "relative",
  "static",
  "sticky",
  "other",
] as const
const ELEMENT_TAGS = [
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
] as const
const EXPECTED_REGIONS = ["drag", "no-drag", "none"] as const
const POINTER_EVENTS = ["auto", "none", "other"] as const
const POINTER_TYPES = ["mouse", "pen", "touch", "other"] as const
const INSPECT_TRIGGERS = ["initial", "resized", "resize-debounce"] as const

type AppRegion = (typeof APP_REGIONS)[number]
type ElementPosition = (typeof ELEMENT_POSITIONS)[number]
type ElementTag = (typeof ELEMENT_TAGS)[number]
type ExpectedRegion = (typeof EXPECTED_REGIONS)[number]
type PointerEvents = (typeof POINTER_EVENTS)[number]
type PointerType = (typeof POINTER_TYPES)[number]
type InspectTrigger = (typeof INSPECT_TRIGGERS)[number]

export type WindowDragDiagnosticRect = {
  height: number
  width: number
  x: number
  y: number
}

export type WindowDragElementSample = {
  appRegion: AppRegion
  hasDragClass: boolean
  hasNoDragClass: boolean
  pointerEvents: PointerEvents
  position: ElementPosition
  rect: WindowDragDiagnosticRect
  tag: ElementTag
  zIndex: number | null
}

export type WindowDragViewportSample = {
  devicePixelRatio: number
  height: number
  width: number
}

export type WindowDragInspectRequest = {
  sequence: number
  trigger: InspectTrigger
}

export type WindowDragRendererLayoutDiagnostic = {
  dragRegionCount: number
  kind: "renderer-layout"
  regions: WindowDragElementSample[]
  sequence: number
  titlebarHeight: number | null
  trigger: InspectTrigger
  viewport: WindowDragViewportSample
}

export type WindowDragPointerDiagnostic = {
  button: number
  expectedRegion: ExpectedRegion
  kind: "titlebar-pointerdown"
  millisecondsSinceLayout: number
  pointerType: PointerType
  sequence: number
  stack: WindowDragElementSample[]
  viewport: WindowDragViewportSample
  x: number
  y: number
}

export type WindowDragDiagnosticPayload =
  | WindowDragRendererLayoutDiagnostic
  | WindowDragPointerDiagnostic

type UnknownRecord = Record<string, unknown>

function requireRecord(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as UnknownRecord
}

function requireBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`)
  }
  return value
}

function requireNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${field} must be a finite number in range`)
  }
  return value
}

function requireInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
) {
  const number = requireNumber(value, field, minimum, maximum)
  if (!Number.isInteger(number)) {
    throw new Error(`${field} must be an integer`)
  }
  return number
}

function requireEnum<const T extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: T
): T[number] {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    throw new Error(`${field} has an unsupported value`)
  }
  return value as T[number]
}

function requireRect(value: unknown, field: string): WindowDragDiagnosticRect {
  const record = requireRecord(value, field)
  return {
    height: requireNumber(
      record.height,
      `${field}.height`,
      0,
      MAX_VIEWPORT_DIMENSION
    ),
    width: requireNumber(
      record.width,
      `${field}.width`,
      0,
      MAX_VIEWPORT_DIMENSION
    ),
    x: requireNumber(
      record.x,
      `${field}.x`,
      -MAX_ABSOLUTE_COORDINATE,
      MAX_ABSOLUTE_COORDINATE
    ),
    y: requireNumber(
      record.y,
      `${field}.y`,
      -MAX_ABSOLUTE_COORDINATE,
      MAX_ABSOLUTE_COORDINATE
    ),
  }
}

function requireViewport(
  value: unknown,
  field: string
): WindowDragViewportSample {
  const record = requireRecord(value, field)
  return {
    devicePixelRatio: requireNumber(
      record.devicePixelRatio,
      `${field}.devicePixelRatio`,
      0.1,
      16
    ),
    height: requireNumber(
      record.height,
      `${field}.height`,
      0,
      MAX_VIEWPORT_DIMENSION
    ),
    width: requireNumber(
      record.width,
      `${field}.width`,
      0,
      MAX_VIEWPORT_DIMENSION
    ),
  }
}

function requireElementSample(
  value: unknown,
  field: string
): WindowDragElementSample {
  const record = requireRecord(value, field)
  const zIndex =
    record.zIndex === null
      ? null
      : requireInteger(record.zIndex, `${field}.zIndex`, -1_000_000, 1_000_000)
  return {
    appRegion: requireEnum(record.appRegion, `${field}.appRegion`, APP_REGIONS),
    hasDragClass: requireBoolean(record.hasDragClass, `${field}.hasDragClass`),
    hasNoDragClass: requireBoolean(
      record.hasNoDragClass,
      `${field}.hasNoDragClass`
    ),
    pointerEvents: requireEnum(
      record.pointerEvents,
      `${field}.pointerEvents`,
      POINTER_EVENTS
    ),
    position: requireEnum(
      record.position,
      `${field}.position`,
      ELEMENT_POSITIONS
    ),
    rect: requireRect(record.rect, `${field}.rect`),
    tag: requireEnum(record.tag, `${field}.tag`, ELEMENT_TAGS),
    zIndex,
  }
}

function requireElementSamples(
  value: unknown,
  field: string
): WindowDragElementSample[] {
  if (!Array.isArray(value) || value.length > MAX_ELEMENT_SAMPLES) {
    throw new Error(`${field} must be a bounded array`)
  }
  return value.map((sample, index) =>
    requireElementSample(sample, `${field}[${index}]`)
  )
}

function requireSequence(value: unknown, field: string) {
  return requireInteger(value, field, 0, MAX_RESIZE_SEQUENCE)
}

export function requireWindowDragInspectRequest(
  value: unknown
): WindowDragInspectRequest {
  const record = requireRecord(value, "inspectRequest")
  return {
    sequence: requireSequence(record.sequence, "inspectRequest.sequence"),
    trigger: requireEnum(
      record.trigger,
      "inspectRequest.trigger",
      INSPECT_TRIGGERS
    ),
  }
}

export function requireWindowDragDiagnosticPayload(
  value: unknown
): WindowDragDiagnosticPayload {
  const record = requireRecord(value, "diagnostic")
  if (record.kind === "renderer-layout") {
    const titlebarHeight =
      record.titlebarHeight === null
        ? null
        : requireNumber(
            record.titlebarHeight,
            "diagnostic.titlebarHeight",
            0,
            500
          )
    return {
      dragRegionCount: requireInteger(
        record.dragRegionCount,
        "diagnostic.dragRegionCount",
        0,
        10_000
      ),
      kind: "renderer-layout",
      regions: requireElementSamples(record.regions, "diagnostic.regions"),
      sequence: requireSequence(record.sequence, "diagnostic.sequence"),
      titlebarHeight,
      trigger: requireEnum(
        record.trigger,
        "diagnostic.trigger",
        INSPECT_TRIGGERS
      ),
      viewport: requireViewport(record.viewport, "diagnostic.viewport"),
    }
  }
  if (record.kind === "titlebar-pointerdown") {
    return {
      button: requireInteger(record.button, "diagnostic.button", 0, 5),
      expectedRegion: requireEnum(
        record.expectedRegion,
        "diagnostic.expectedRegion",
        EXPECTED_REGIONS
      ),
      kind: "titlebar-pointerdown",
      millisecondsSinceLayout: requireNumber(
        record.millisecondsSinceLayout,
        "diagnostic.millisecondsSinceLayout",
        0,
        300_000
      ),
      pointerType: requireEnum(
        record.pointerType,
        "diagnostic.pointerType",
        POINTER_TYPES
      ),
      sequence: requireSequence(record.sequence, "diagnostic.sequence"),
      stack: requireElementSamples(record.stack, "diagnostic.stack"),
      viewport: requireViewport(record.viewport, "diagnostic.viewport"),
      x: requireNumber(
        record.x,
        "diagnostic.x",
        -MAX_ABSOLUTE_COORDINATE,
        MAX_ABSOLUTE_COORDINATE
      ),
      y: requireNumber(
        record.y,
        "diagnostic.y",
        -MAX_ABSOLUTE_COORDINATE,
        MAX_ABSOLUTE_COORDINATE
      ),
    }
  }
  throw new Error("diagnostic.kind has an unsupported value")
}

export function classifyWindowDragSamples(
  samples: readonly Pick<WindowDragElementSample, "appRegion">[]
): ExpectedRegion {
  if (samples.some((sample) => sample.appRegion === "no-drag")) {
    return "no-drag"
  }
  if (samples.some((sample) => sample.appRegion === "drag")) {
    return "drag"
  }
  return "none"
}

export function isWindowFillingDisplay(
  bounds: WindowDragDiagnosticRect,
  displayBounds: WindowDragDiagnosticRect,
  tolerance = 1
) {
  return (
    Math.abs(bounds.x - displayBounds.x) <= tolerance &&
    Math.abs(bounds.y - displayBounds.y) <= tolerance &&
    Math.abs(bounds.width - displayBounds.width) <= tolerance &&
    Math.abs(bounds.height - displayBounds.height) <= tolerance
  )
}
