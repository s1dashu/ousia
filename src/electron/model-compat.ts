const modelIdAliases = new Map<string, string>([
  [
    "vercel-ai-gateway/xai/grok-4-fast-non-reasoning",
    "xai/grok-4.1-fast-non-reasoning",
  ],
  [
    "vercel-ai-gateway/xai/grok-4-fast-reasoning",
    "xai/grok-4.1-fast-reasoning",
  ],
])

export function normalizeProviderModelId(provider: string, modelId: string) {
  return modelIdAliases.get(`${provider}/${modelId}`) ?? modelId
}

export function isDeprecatedProviderModelId(provider: string, modelId: string) {
  return normalizeProviderModelId(provider, modelId) !== modelId
}
