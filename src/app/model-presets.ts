import type {
  OusiaAvailableModel,
  OusiaModelProviderConfig,
  OusiaModelRegistryResult,
  OusiaThinkingLevel,
} from "@/electron/chat-types"

export const piThinkingLevels: OusiaThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]

export function modelPresetValue(provider: string, modelId: string) {
  return `${provider}/${modelId}`
}

export function modelLabel(model: OusiaAvailableModel) {
  return model.name && model.name !== model.modelId
    ? model.name
    : model.modelId
}

export function providerLabel(
  registry: OusiaModelRegistryResult | undefined,
  providerId: string
) {
  return (
    registry?.providers.find((provider) => provider.id === providerId)?.name ??
    providerId
  )
}

export function getConfiguredModelPresets(
  providers: OusiaModelProviderConfig[],
  registry: OusiaModelRegistryResult | undefined
) {
  const configuredProviderIds = new Set(
    providers.map((provider) => provider.id.trim()).filter(Boolean)
  )

  return (
    registry?.providers
      .filter((provider) => configuredProviderIds.has(provider.id))
      .flatMap((provider) => provider.models) ?? []
  )
}

export function findRegistryModel(
  registry: OusiaModelRegistryResult | undefined,
  provider: string,
  modelId: string
) {
  return registry?.providers
    .find((item) => item.id === provider)
    ?.models.find((model) => model.modelId === modelId)
}

export function modelsForProvider(
  registry: OusiaModelRegistryResult | undefined,
  provider: string
) {
  return registry?.providers.find((item) => item.id === provider)?.models ?? []
}
