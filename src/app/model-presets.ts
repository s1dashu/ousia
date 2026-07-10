import {
  OUSIA_PI_THINKING_LEVELS,
  type OusiaAvailableModel,
  type OusiaModelProviderConfig,
  type OusiaModelRegistryResult,
  type OusiaThinkingLevel,
} from "@/electron/chat-types"

export const piThinkingLevels: OusiaThinkingLevel[] = [
  ...OUSIA_PI_THINKING_LEVELS,
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

function disabledProviderIdSet(disabledProviderIds: string[] = []) {
  return new Set(disabledProviderIds.map((id) => id.trim()).filter(Boolean))
}

export function getConfiguredModelPresets(
  providers: OusiaModelProviderConfig[],
  registry: OusiaModelRegistryResult | undefined,
  disabledProviderIds: string[] = []
) {
  const configuredProviderIds = new Set(
    providers.map((provider) => provider.id.trim()).filter(Boolean)
  )
  const disabledIds = disabledProviderIdSet(disabledProviderIds)
  for (const providerId of registry?.configuredProviderIds ?? []) {
    const id = providerId.trim()
    if (id) {
      configuredProviderIds.add(id)
    }
  }

  return (
    registry?.providers
      .filter(
        (provider) =>
          configuredProviderIds.has(provider.id) &&
          !disabledIds.has(provider.id)
      )
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
  provider: string,
  disabledProviderIds: string[] = []
) {
  if (disabledProviderIdSet(disabledProviderIds).has(provider)) {
    return []
  }
  return registry?.providers.find((item) => item.id === provider)?.models ?? []
}
