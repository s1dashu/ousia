import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  getAuth: vi.fn(),
  getModel: vi.fn(),
  getModels: vi.fn(),
  writeRuntimeLog: vi.fn(),
}))

vi.mock("./pi-package-dir.js", () => ({}))

vi.mock("./pi-environment.js", () => ({
  createPiModelRuntime: vi.fn(async () => ({
    completeSimple: mocks.completeSimple,
    getAuth: mocks.getAuth,
    getModel: mocks.getModel,
    getModels: mocks.getModels,
    setRuntimeApiKey: vi.fn(),
  })),
  resolvePiAgentDir: () => "/tmp/ousia-title-agent",
}))

vi.mock("./runtime-logger.js", () => ({
  writeRuntimeLog: mocks.writeRuntimeLog,
}))

vi.mock("./vercel-ai-gateway-models.js", () => ({
  getVercelAiGatewayModelIds: vi.fn(async () => new Set<string>()),
  isVercelAiGatewayModelAvailable: vi.fn(async () => true),
}))

import { generateChatTitleWithUtilityModel } from "./chat-title-generator.js"

function model({
  cost,
  id,
  reasoning,
}: {
  cost: number
  id: string
  reasoning: boolean
}) {
  return {
    cost: { input: cost, output: cost },
    id,
    input: ["text"],
    name: id,
    provider: "test-provider",
    reasoning,
  }
}

const payload = {
  agentProvider: "pi" as const,
  language: "en" as const,
  model: {
    modelId: "chat-model",
    provider: "test-provider",
  },
  projectPath: "/tmp/project",
  prompt: "Build a small particle playground",
  sessionId: "session-1",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getAuth.mockResolvedValue(true)
  mocks.getModel.mockReturnValue(undefined)
  mocks.completeSimple.mockResolvedValue({
    content: [{ type: "text", text: "Particle Playground" }],
    role: "assistant",
  })
})

describe("chat title utility model selection", () => {
  it("prefers a non-reasoning text model before comparing cost", async () => {
    const reasoningModel = model({
      cost: 0.01,
      id: "cheap-mini-reasoning",
      reasoning: true,
    })
    const textModel = model({
      cost: 10,
      id: "expensive-mini-text",
      reasoning: false,
    })
    mocks.getModels.mockReturnValue([reasoningModel, textModel])

    await expect(generateChatTitleWithUtilityModel(payload)).resolves.toEqual({
      ok: true,
      title: "Particle Playground",
    })
    expect(mocks.completeSimple).toHaveBeenCalledWith(
      textModel,
      expect.any(Object),
      expect.objectContaining({ maxTokens: 32, reasoning: "minimal" })
    )
  })

  it("gives a selected reasoning model enough output budget", async () => {
    const reasoningModel = model({
      cost: 0.01,
      id: "only-mini-reasoning",
      reasoning: true,
    })
    mocks.getModels.mockReturnValue([reasoningModel])

    await expect(generateChatTitleWithUtilityModel(payload)).resolves.toEqual({
      ok: true,
      title: "Particle Playground",
    })
    expect(mocks.completeSimple).toHaveBeenCalledWith(
      reasoningModel,
      expect.any(Object),
      expect.objectContaining({ maxTokens: 1024, reasoning: "minimal" })
    )
  })
})
