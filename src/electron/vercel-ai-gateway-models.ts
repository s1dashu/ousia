const VERCEL_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models"
const VERCEL_MODEL_CACHE_MS = 5 * 60 * 1000
const VERCEL_MODEL_FETCH_TIMEOUT_MS = 3_000

type VercelModelsResponse = {
  data?: Array<{
    id?: unknown
  }>
}

let cachedModelIds: Set<string> | undefined
let cachedAt = 0
let pendingModelIds: Promise<Set<string> | undefined> | undefined

async function fetchVercelAiGatewayModelIds() {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    VERCEL_MODEL_FETCH_TIMEOUT_MS
  )

  try {
    const response = await fetch(VERCEL_MODELS_URL, {
      signal: controller.signal,
    })
    if (!response.ok) {
      return undefined
    }

    const payload = (await response.json()) as VercelModelsResponse
    const ids = new Set<string>()
    for (const model of payload.data ?? []) {
      if (typeof model.id === "string" && model.id.trim()) {
        ids.add(model.id)
      }
    }
    return ids.size ? ids : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

export async function getVercelAiGatewayModelIds() {
  const now = Date.now()
  if (cachedModelIds && now - cachedAt < VERCEL_MODEL_CACHE_MS) {
    return cachedModelIds
  }
  if (!pendingModelIds) {
    pendingModelIds = fetchVercelAiGatewayModelIds().finally(() => {
      pendingModelIds = undefined
    })
  }

  const modelIds = await pendingModelIds
  if (modelIds) {
    cachedModelIds = modelIds
    cachedAt = Date.now()
  }
  return modelIds
}

export async function isVercelAiGatewayModelAvailable(modelId: string) {
  const modelIds = await getVercelAiGatewayModelIds()
  return modelIds ? modelIds.has(modelId) : true
}
