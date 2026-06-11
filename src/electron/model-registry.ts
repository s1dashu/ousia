import { getSupportedThinkingLevels } from "@mariozechner/pi-ai"
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent"
import { join } from "node:path"

import type {
  OusiaAvailableModel,
  OusiaModelRegistryResult,
  OusiaThinkingLevel,
} from "./chat-types.js"

function toOusiaThinkingLevels(levels: string[]): OusiaThinkingLevel[] {
  const allowed = new Set(["off", "minimal", "low", "medium", "high", "xhigh"])
  return levels.filter((level): level is OusiaThinkingLevel =>
    allowed.has(level)
  )
}

export function listPiModels(userData: string): OusiaModelRegistryResult {
  const agentDir = join(userData, "pi-agent")
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"))
  const modelRegistry = ModelRegistry.create(
    authStorage,
    join(agentDir, "models.json")
  )
  const providerModels = new Map<
    string,
    {
      id: string
      name: string
      models: OusiaAvailableModel[]
    }
  >()

  for (const model of modelRegistry.getAll()) {
    const provider = model.provider.trim()
    if (!provider || !model.id.trim() || !model.input?.includes("text")) {
      continue
    }
    const providerName = modelRegistry.getProviderDisplayName(provider)
    const entry =
      providerModels.get(provider) ??
      providerModels
        .set(provider, {
          id: provider,
          name: providerName,
          models: [],
        })
        .get(provider)!
    entry.models.push({
      provider,
      providerName,
      modelId: model.id,
      name: model.name || model.id,
      label: model.name || model.id,
      input: model.input,
      thinkingLevels: toOusiaThinkingLevels(getSupportedThinkingLevels(model)),
    })
  }

  const providers = [...providerModels.values()]
    .map((provider) => ({
      ...provider,
      models: provider.models.sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      ),
    }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    )

  return {
    providers,
    error: modelRegistry.getError(),
  }
}
