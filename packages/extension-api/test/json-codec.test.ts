import { describe, expect, it, vi } from "vitest"

import {
  defineRuntimeCodec,
  snapshotJsonValue,
} from "../src/index.js"

describe("JSON values and runtime codecs", () => {
  it("returns a deeply frozen JSON snapshot", () => {
    const source = { nested: { values: [1, "two"] } }
    const snapshot = snapshotJsonValue(source)
    source.nested.values[0] = 9

    expect(snapshot).toEqual({ nested: { values: [1, "two"] } })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen((snapshot as { nested: object }).nested)).toBe(true)
  })

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date()])(
    "rejects non-JSON value %s",
    (value) => {
      expect(() => snapshotJsonValue(value)).toThrow()
    }
  )

  it("rejects sparse arrays instead of preserving non-JSON holes", () => {
    expect(() => snapshotJsonValue(new Array(1))).toThrow(
      "value[0] must be a JSON value"
    )
  })

  it("rejects circular objects", () => {
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(() => snapshotJsonValue(circular)).toThrow("circular reference")
  })

  it("preserves __proto__ as data without mutating the snapshot prototype", () => {
    const source = JSON.parse(
      '{"__proto__":{"polluted":true},"safe":"value"}'
    ) as unknown
    const snapshot = snapshotJsonValue(source) as Record<string, unknown>

    expect(Object.hasOwn(snapshot, "__proto__")).toBe(true)
    expect(snapshot["__proto__"]).toEqual({ polluted: true })
    expect((snapshot as { polluted?: unknown }).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype)
    expect(JSON.stringify(snapshot)).toBe(
      '{"__proto__":{"polluted":true},"safe":"value"}'
    )
  })

  it("validates codec output instead of trusting encode", () => {
    const codec = defineRuntimeCodec<number>({
      parse(value) {
        if (typeof value !== "number") {
          throw new TypeError("number required")
        }
        return value
      },
      encode() {
        return Number.NaN
      },
    })

    expect(() => codec.encode(1)).toThrow("finite JSON number")
  })

  it("returns an already-defined codec unchanged and invokes encode once", () => {
    const encode = vi.fn((value: number) => ({ value }))
    const codec = defineRuntimeCodec<number>({
      parse(value) {
        if (typeof value !== "number") {
          throw new TypeError("number required")
        }
        return value
      },
      encode,
    })

    expect(defineRuntimeCodec(codec)).toBe(codec)
    expect(defineRuntimeCodec(defineRuntimeCodec(codec))).toBe(codec)
    expect(codec.encode(3)).toEqual({ value: 3 })
    expect(encode).toHaveBeenCalledTimes(1)
  })

  it("captures codec methods so late source mutation cannot change behavior", () => {
    const source = {
      parse(value: unknown) {
        if (typeof value !== "number") {
          throw new TypeError("number required")
        }
        return value
      },
      encode(value: number) {
        return { value }
      },
    }
    const codec = defineRuntimeCodec(source)
    source.parse = () => 99
    source.encode = () => ({ value: 99 })

    expect(codec.parse(3)).toBe(3)
    expect(codec.encode(3)).toEqual({ value: 3 })
  })

  it("rejects non-JSON input before invoking even a lax parser", () => {
    const parse = vi.fn((value: unknown) => value)
    const codec = defineRuntimeCodec<unknown>({
      parse,
      encode() {
        return null
      },
    })

    for (const value of [undefined, new Date(), new Array(1)]) {
      expect(() => codec.parse(value)).toThrow()
    }
    expect(parse).not.toHaveBeenCalled()
  })
})
