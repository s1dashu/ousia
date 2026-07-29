import "./pi-package-dir.js"
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"
import type { ModelRuntime } from "@earendil-works/pi-coding-agent"

import {
  isOusiaPiThinkingLevel,
  type OusiaAvailableModel,
  type OusiaConfiguredModelProvider,
  type OusiaModelRegistryResult,
  type OusiaModelProviderAuthSource,
  type OusiaThinkingLevel,
} from "./chat-types.js"
import { isDeprecatedProviderModelId } from "./model-compat.js"
import { createPiModelRuntime, resolvePiAgentDir } from "./pi-environment.js"
import { getVercelAiGatewayModelIds } from "./vercel-ai-gateway-models.js"

function toOusiaThinkingLevels(levels: string[]): OusiaThinkingLevel[] {
  return levels.filter(isOusiaPiThinkingLevel)
}

function toOusiaAuthSource(
  source: ReturnType<ModelRuntime["getProviderAuthStatus"]>["source"]
): OusiaModelProviderAuthSource | undefined {
  if (
    source === "stored" ||
    source === "runtime" ||
    source === "environment" ||
    source === "fallback" ||
    source === "models_json_key" ||
    source === "models_json_command"
  ) {
    return source
  }
  return undefined
}

export async function listPiModels(): Promise<OusiaModelRegistryResult> {
  const agentDir = resolvePiAgentDir()
  const modelRuntime = await createPiModelRuntime(agentDir)
  const vercelModelIds = await getVercelAiGatewayModelIds()
  const providerModels = new Map<
    string,
    {
      id: string
      name: string
      models: OusiaAvailableModel[]
    }
  >()

  for (const model of modelRuntime.getModels()) {
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
    const providerName = modelRuntime.getProvider(provider)?.name ?? provider
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

  const configuredProviderIds = [
    ...new Set(
      modelRuntime
        .getAvailableSnapshot()
        .map((model) => model.provider.trim())
        .filter(Boolean)
    ),
  ].sort()
  const configuredProviders: OusiaConfiguredModelProvider[] =
    configuredProviderIds.map((providerId) => {
      const authStatus = modelRuntime.getProviderAuthStatus(providerId)
      return {
        id: providerId,
        authLabel: authStatus.label,
        authSource: toOusiaAuthSource(authStatus.source),
      }
    })

  return {
    configuredProviderIds,
    configuredProviders,
    providers,
    error: modelRuntime.getError(),
  }
}
