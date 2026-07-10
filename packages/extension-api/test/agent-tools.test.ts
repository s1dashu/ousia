import { describe, expect, it, vi } from "vitest"

import {
  createAgentToolRegistry,
  defineAgentTool,
  defineAgentToolManifest,
  defineRuntimeCodec,
  type AgentToolExecutionContext,
} from "../src/index.js"

function stringInputCodec() {
  return defineRuntimeCodec<{ text: string }>({
    parse(value) {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        typeof (value as { text?: unknown }).text !== "string"
      ) {
        throw new TypeError("text is required")
      }
      return { text: (value as { text: string }).text }
    },
    encode(value) {
      return { text: value.text }
    },
  })
}

function echoTool() {
  return defineAgentTool({
    name: "echo-text",
    label: "Echo text",
    description: "Echo a text value.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    inputCodec: stringInputCodec(),
    executionMode: "parallel",
    promptSnippet: "echo-text: echo text.",
    promptGuidelines: ["Use only when asked to echo."],
    async execute(input, context) {
      context.reportProgress({ phase: "echo" })
      return { content: [{ type: "text", text: input.text }] }
    },
  })
}

function executionContext(): AgentToolExecutionContext {
  return {
    callId: "call-1",
    cwd: "/tmp/project",
    projectPath: "/tmp/project",
    sessionId: "session-1",
    signal: new AbortController().signal,
    emitProductEvent: vi.fn(),
    reportProgress: vi.fn(),
  }
}

describe("Agent tool registry", () => {
  it("validates input through one registry and returns frozen output", async () => {
    const registry = createAgentToolRegistry([echoTool()])
    const context = executionContext()

    await expect(
      registry.execute("echo-text", { text: "hello" }, context)
    ).resolves.toEqual({ content: [{ type: "text", text: "hello" }] })
    expect(context.reportProgress).toHaveBeenCalledWith({ phase: "echo" })
    expect(
      Object.isFrozen(
        (context.reportProgress as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      )
    ).toBe(true)
    await expect(
      registry.execute("echo-text", { value: "missing" }, context)
    ).rejects.toThrow("text is required")
  })

  it("rejects duplicate and unknown tools", () => {
    expect(() => createAgentToolRegistry([echoTool(), echoTool()])).toThrow(
      "Duplicate Agent tool: echo-text"
    )
    expect(() => createAgentToolRegistry([]).get("missing")).toThrow(
      "Unknown Agent tool: missing"
    )
  })

  it("preserves defined tool and codec identity through registry erasure", () => {
    const tool = echoTool()
    const registry = createAgentToolRegistry([tool])

    expect(defineAgentTool(tool)).toBe(tool)
    expect(registry.definitions[0]).toBe(tool)
    expect(registry.definitions[0]?.inputCodec).toBe(tool.inputCodec)
  })

  it.each(["emitProductEvent", "reportProgress"] as const)(
    "rejects invalid JSON from %s before forwarding it",
    async (callbackName) => {
      const tool = defineAgentTool({
        ...echoTool(),
        name: `invalid-${callbackName}`,
        async execute(input, context) {
          context[callbackName]({ invalid: undefined } as never)
          return { content: [{ type: "text" as const, text: input.text }] }
        },
      })
      const context = executionContext()

      await expect(
        createAgentToolRegistry([tool]).execute(
          tool.name,
          { text: "test" },
          context
        )
      ).rejects.toThrow("must be a JSON value")
      expect(context[callbackName]).not.toHaveBeenCalled()
    }
  )

  it.each(["emitProductEvent", "reportProgress"] as const)(
    "requires execution context.%s to be a function",
    async (callbackName) => {
      const context = {
        ...executionContext(),
        [callbackName]: undefined,
      } as never

      await expect(
        createAgentToolRegistry([echoTool()]).execute(
          "echo-text",
          { text: "test" },
          context
        )
      ).rejects.toThrow(`execution context.${callbackName} must be a function`)
    }
  )

  it.each([
    ["callId", " "],
    ["cwd", ""],
    ["projectPath", "project\0path"],
    ["sessionId", " "],
  ] as const)(
    "rejects an invalid execution context %s",
    async (field, value) => {
      const context = {
        ...executionContext(),
        [field]: value,
      }

      await expect(
        createAgentToolRegistry([echoTool()]).execute(
          "echo-text",
          { text: "test" },
          context
        )
      ).rejects.toThrow(`execution context.${field}`)
    }
  )

  it("requires a structural AbortSignal in the execution context", async () => {
    const context = {
      ...executionContext(),
      signal: { aborted: false },
    } as never

    await expect(
      createAgentToolRegistry([echoTool()]).execute(
        "echo-text",
        { text: "test" },
        context
      )
    ).rejects.toThrow("execution context.signal must be an AbortSignal")
  })

  it("derives a deterministic revision from Codex-visible tool specs", () => {
    const manifest = defineAgentToolManifest({
      tools: [echoTool()],
    })
    const sameSpecWithDifferentKeyOrder = defineAgentTool({
      ...echoTool(),
      inputSchema: {
        required: ["text"],
        additionalProperties: false,
        properties: { text: { type: "string" } },
        type: "object",
      },
    })
    const sameManifest = defineAgentToolManifest({
      tools: [sameSpecWithDifferentKeyOrder],
    })
    const changedManifest = defineAgentToolManifest({
      tools: [
        defineAgentTool({
          ...echoTool(),
          description: "Changed protocol description.",
        }),
      ],
    })

    expect(manifest.revision).toBe(sameManifest.revision)
    expect(changedManifest.revision).not.toBe(manifest.revision)
    expect(manifest.registry.definitions).toHaveLength(1)
    expect(() =>
      defineAgentToolManifest({ tools: [], compatibilityVersion: " " })
    ).toThrow("non-empty, trimmed string")
  })

  it("keeps manifest revision independent of tool order and locale", () => {
    const uppercaseTool = defineAgentTool({
      ...echoTool(),
      name: "Echo_upper",
    })
    const lowercaseTool = defineAgentTool({
      ...echoTool(),
      name: "echo-lower",
    })

    expect(
      defineAgentToolManifest({ tools: [uppercaseTool, lowercaseTool] })
        .revision
    ).toBe(
      defineAgentToolManifest({ tools: [lowercaseTool, uppercaseTool] })
        .revision
    )
  })

  it("rejects schemas that cannot describe object arguments", () => {
    expect(() =>
      defineAgentTool({
        ...echoTool(),
        inputSchema: { type: "string" },
      })
    ).toThrow("JSON Schema with type object")
  })

  it("rejects sparse prompt guidelines and result content", async () => {
    expect(() =>
      defineAgentTool({
        ...echoTool(),
        promptGuidelines: new Array(1),
      })
    ).toThrow("promptGuidelines[0]")

    const sparseResultTool = defineAgentTool({
      ...echoTool(),
      name: "sparse-result",
      async execute() {
        return { content: new Array(1) }
      },
    })
    await expect(
      createAgentToolRegistry([sparseResultTool]).execute(
        "sparse-result",
        { text: "test" },
        executionContext()
      )
    ).rejects.toThrow("result.content[0] must be an object")
  })
})
