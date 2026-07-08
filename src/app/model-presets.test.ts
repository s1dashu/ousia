import { describe, expect, it } from "vitest"

import type { OusiaModelRegistryResult } from "@/electron/chat-types"

import {
  findRegistryModel,
  getConfiguredModelPresets,
  modelLabel,
  modelPresetValue,
  modelsForProvider,
  providerLabel,
} from "./model-presets"

const registry: OusiaModelRegistryResult = {
  configuredProviderIds: ["openai"],
  configuredProviders: [],
  providers: [
    {
      id: "deepseek",
      models: [
        {
          input: ["text"],
          label: "DeepSeek Chat",
          modelId: "deepseek-v4",
          name: "DeepSeek V4",
          provider: "deepseek",
          providerName: "DeepSeek",
          thinkingLevels: ["off", "medium"],
        },
      ],
      name: "DeepSeek",
    },
    {
      id: "openai",
      models: [
        {
          input: ["text", "image"],
          label: "GPT 5",
          modelId: "gpt-5",
          name: "gpt-5",
          provider: "openai",
          providerName: "OpenAI",
          thinkingLevels: ["minimal", "high"],
        },
      ],
      name: "OpenAI",
    },
  ],
}

describe("model preset helpers", () => {
  it("formats stable provider/model values", () => {
    expect(modelPresetValue("openai", "gpt-5")).toBe("openai/gpt-5")
  })

  it("uses the model name unless it duplicates the raw model id", () => {
    expect(modelLabel(registry.providers[0].models[0])).toBe("DeepSeek V4")
    expect(modelLabel(registry.providers[1].models[0])).toBe("gpt-5")
  })

  it("labels providers from the registry and falls back to provider id", () => {
    expect(providerLabel(registry, "openai")).toBe("OpenAI")
    expect(providerLabel(registry, "missing")).toBe("missing")
  })

  it("merges explicit providers with providers discovered from Pi registry", () => {
    expect(
      getConfiguredModelPresets([{ id: " deepseek ", apiKey: "" }], registry).map(
        (model) => model.modelId
      )
    ).toEqual(["deepseek-v4", "gpt-5"])
  })

  it("finds models by provider and model id", () => {
    expect(findRegistryModel(registry, "openai", "gpt-5")).toBe(
      registry.providers[1].models[0]
    )
    expect(findRegistryModel(registry, "openai", "missing")).toBeUndefined()
  })

  it("returns provider model lists or an empty list", () => {
    expect(modelsForProvider(registry, "deepseek")).toEqual(
      registry.providers[0].models
    )
    expect(modelsForProvider(registry, "missing")).toEqual([])
  })
})
