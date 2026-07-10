import { snapshotJsonValue, type JsonValue } from "./json.js"

const definedRuntimeCodecs = new WeakSet<object>()

export interface RuntimeCodec<Value> {
  parse(value: unknown, path?: string): Value
  encode(value: Value, path?: string): JsonValue
}

function assertFunction(value: unknown, field: string) {
  if (typeof value !== "function") {
    throw new TypeError(`${field} must be a function.`)
  }
}

export function defineRuntimeCodec<Value>(
  codec: RuntimeCodec<Value>
): Readonly<RuntimeCodec<Value>> {
  if (!codec || typeof codec !== "object") {
    throw new TypeError("runtimeCodec must be an object.")
  }
  if (definedRuntimeCodecs.has(codec)) {
    return codec as Readonly<RuntimeCodec<Value>>
  }
  for (const key of Object.keys(codec)) {
    if (key !== "parse" && key !== "encode") {
      throw new TypeError(`runtimeCodec.${key} is not supported.`)
    }
  }
  assertFunction(codec.parse, "runtimeCodec.parse")
  assertFunction(codec.encode, "runtimeCodec.encode")
  const { parse, encode } = codec
  const definition = Object.freeze({
    parse(value: unknown, path?: string) {
      return parse(snapshotJsonValue(value, path), path)
    },
    encode(value: Value, path = "value") {
      return snapshotJsonValue(encode(value, path), path)
    },
  })
  definedRuntimeCodecs.add(definition)
  return definition
}
