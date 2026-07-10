export type JsonPrimitive = boolean | null | number | string
export type JsonArray = readonly JsonValue[]
export type JsonObject = { readonly [key: string]: JsonValue }
export type JsonValue = JsonArray | JsonObject | JsonPrimitive

function errorAt(path: string, message: string): never {
  throw new TypeError(`${path} ${message}`)
}

function isJsonObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function snapshot(
  value: unknown,
  path: string,
  ancestors: ReadonlySet<object>
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return errorAt(path, "must be a finite JSON number.")
    }
    return value
  }
  if (typeof value !== "object") {
    return errorAt(path, "must be a JSON value.")
  }
  if (ancestors.has(value)) {
    return errorAt(path, "must not contain a circular reference.")
  }

  const nextAncestors = new Set(ancestors)
  nextAncestors.add(value)
  if (Array.isArray(value)) {
    return Object.freeze(
      Array.from(value, (entry, index) =>
        snapshot(entry, `${path}[${index}]`, nextAncestors)
      )
    ) as JsonArray
  }
  if (!isJsonObject(value)) {
    return errorAt(path, "must contain only plain JSON objects.")
  }

  const result: { [key: string]: JsonValue } = {}
  for (const [key, entry] of Object.entries(value)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: snapshot(entry, `${path}.${key}`, nextAncestors),
      writable: true,
    })
  }
  return Object.freeze(result)
}

/** Validates, clones, and deeply freezes an arbitrary JSON value. */
export function snapshotJsonValue(value: unknown, path = "value"): JsonValue {
  return snapshot(value, path, new Set())
}

export function assertJsonValue(
  value: unknown,
  path = "value"
): asserts value is JsonValue {
  snapshotJsonValue(value, path)
}

function canonicalString(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${Array.from(value, canonicalString).join(",")}]`
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalString(
          (value as JsonObject)[key] as JsonValue
        )}`
    )
    .join(",")}}`
}

/** Deterministic JSON text with recursively sorted object keys. */
export function canonicalJsonStringify(value: unknown, path = "value") {
  return canonicalString(snapshotJsonValue(value, path))
}
