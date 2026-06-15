import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent"
import { join } from "node:path"

import type {
  OusiaAvailableModel,
  OusiaModelRegistryResult,
  OusiaThinkingLevel,
} from "./chat-types.js"
import { isDeprecatedProviderModelId } from "./model-compat.js"
import { getVercelAiGatewayModelIds } from "./vercel-ai-gateway-models.js"

function toOusiaThinkingLevels(levels: string[]): OusiaThinkingLevel[] {
  const allowed = new Set(["off", "minimal", "low", "medium", "high", "xhigh"])
  return levels.filter((level): level is OusiaThinkingLevel =>
    allowed.has(level)
  )
}

export async function listPiModels(
  userData: string
): Promise<OusiaModelRegistryResult> {
  const agentDir = join(userData, "pi-agent")
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"))
  const modelRegistry = ModelRegistry.create(
    authStorage,
    join(agentDir, "models.json")
  )
  const vercelModelIds = await getVercelAiGatewayModelIds()
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
    const modelId = model.id.trim()
    if (
      !provider ||
      !modelId ||
      !model.input?.includes("text") ||
      isDeprecatedProviderModelId(provider, modelId) ||
      (provider === "vercel-ai-gateway" &&
        vercelModelIds &&
        !vercelModelIds.has(modelId))
    ) {
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
      modelId,
      name: model.name || modelId,
      label: model.name || modelId,
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
