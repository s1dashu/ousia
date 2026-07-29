import "./pi-package-dir.js"
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai"
import type { ModelRuntime } from "@earendil-works/pi-coding-agent"

import type {
  OusiaChatGenerateTitlePayload,
  OusiaChatGenerateTitleResult,
  OusiaModelSettings,
} from "./chat-types.js"
import {
  buildPlainChatTitleRequest,
  normalizeGeneratedChatTitle,
} from "./chat-title-policy.js"
import { normalizeProviderModelId } from "./model-compat.js"
import { createPiModelRuntime, resolvePiAgentDir } from "./pi-environment.js"
import { writeRuntimeLog } from "./runtime-logger.js"
import {
  getVercelAiGatewayModelIds,
  isVercelAiGatewayModelAvailable,
} from "./vercel-ai-gateway-models.js"

type UtilityModelCandidate = {
  provider: string
  preferredModelIds: string[]
  match: RegExp
}

type SelectedTitleModel = {
  model: Model<Api>
  reason: string
}

const utilityModelCandidates: UtilityModelCandidate[] = [
  {
    provider: "deepseek",
    preferredModelIds: ["deepseek-v4-flash"],
    match: /flash/i,
  },
  {
    provider: "openai",
    preferredModelIds: ["gpt-5-nano", "gpt-4.1-nano", "gpt-4o-mini"],
    match: /\b(nano|mini)\b/i,
  },
  {
    provider: "google",
    preferredModelIds: [
      "gemini-flash-lite-latest",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash-lite",
      "gemini-flash-latest",
    ],
    match: /flash.*lite|flash/i,
  },
  {
    provider: "zai",
    preferredModelIds: ["glm-5-turbo", "glm-4.5-air"],
    match: /turbo|air/i,
  },
  {
    provider: "xiaomi",
    preferredModelIds: ["mimo-v2-flash"],
    match: /flash/i,
  },
  {
    provider: "xiaomi-token-plan-cn",
    preferredModelIds: ["mimo-v2-flash"],
    match: /flash/i,
  },
  {
    provider: "xiaomi-token-plan-ams",
    preferredModelIds: ["mimo-v2-flash"],
    match: /flash/i,
  },
  {
    provider: "xiaomi-token-plan-sgp",
    preferredModelIds: ["mimo-v2-flash"],
    match: /flash/i,
  },
]

function modelCost(model: Model<Api>) {
  return (model.cost?.input ?? 0) + (model.cost?.output ?? 0)
}

async function findCheapestTextModel(
  modelRuntime: ModelRuntime,
  candidate: UtilityModelCandidate
) {
  const vercelModelIds =
    candidate.provider === "vercel-ai-gateway"
      ? await getVercelAiGatewayModelIds()
      : undefined
  const providerModels = modelRuntime
    .getModels()
    .filter(
      (model) =>
        model.provider === candidate.provider &&
        model.input?.includes("text") &&
        (!vercelModelIds || vercelModelIds.has(model.id))
    )

  for (const modelId of candidate.preferredModelIds) {
    const preferred = providerModels.find((model) => model.id === modelId)
    if (preferred) {
      return preferred
    }
  }

  const matched = providerModels.filter(
    (model) =>
      candidate.match.test(model.id) || candidate.match.test(model.name)
  )
  const pool = matched.length ? matched : providerModels
  return pool.sort((a, b) => modelCost(a) - modelCost(b))[0]
}

function uniqueProviders(preferredProvider: string) {
  const providers = [
    preferredProvider,
    ...utilityModelCandidates.map((candidate) => candidate.provider),
  ].filter(Boolean)
  return Array.from(new Set(providers))
}

function candidateForProvider(provider: string) {
  return (
    utilityModelCandidates.find(
      (candidate) => candidate.provider === provider
    ) ??
    ({
      provider,
      preferredModelIds: [],
      match: /\b(flash|lite|nano|mini|turbo|air)\b/i,
    } satisfies UtilityModelCandidate)
  )
}

async function findConfiguredTitleModel(
  modelRuntime: ModelRuntime,
  provider: string,
  modelId: string
) {
  if (
    provider === "vercel-ai-gateway" &&
    !(await isVercelAiGatewayModelAvailable(modelId))
  ) {
    return undefined
  }
  return modelRuntime.getModel(provider, modelId)
}

async function selectTitleModel(
  modelRuntime: ModelRuntime,
  chatModel: OusiaModelSettings
): Promise<SelectedTitleModel | undefined> {
  const chatProvider = chatModel.provider.trim()
  const chatModelId = normalizeProviderModelId(
    chatProvider,
    chatModel.modelId.trim()
  )
  for (const provider of uniqueProviders(chatProvider)) {
    const candidate = candidateForProvider(provider)
    const model =
      provider === chatProvider
        ? ((await findCheapestTextModel(modelRuntime, candidate)) ??
          (await findConfiguredTitleModel(
            modelRuntime,
            chatProvider,
            chatModelId
          )))
        : await findCheapestTextModel(modelRuntime, candidate)
    if (!model) {
      continue
    }

    if (!(await modelRuntime.getAuth(model))) {
      continue
    }

    return {
      model,
      reason:
        provider === chatProvider
          ? "current-chat-provider"
          : "available-utility-provider",
    }
  }

  return undefined
}

function textFromAssistantMessage(message: AssistantMessage) {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim()
}

export async function generateChatTitleWithUtilityModel(
  payload: OusiaChatGenerateTitlePayload
): Promise<OusiaChatGenerateTitleResult> {
  const prompt = payload.prompt.trim()
  if (!prompt) {
    return { ok: false, error: "缺少首轮用户消息。" }
  }

  const agentDir = resolvePiAgentDir()
  const modelRuntime = await createPiModelRuntime(agentDir)
  if (payload.model.apiKey?.trim()) {
    await modelRuntime.setRuntimeApiKey(
      payload.model.provider,
      payload.model.apiKey.trim(),
      { allowNetwork: false }
    )
  }

  const selected = await selectTitleModel(modelRuntime, payload.model)
  if (!selected) {
    const error = "没有找到可用于会话命名的已认证轻量模型。"
    writeRuntimeLog("chat.title", "warn", error, {
      chatModel: `${payload.model.provider}/${payload.model.modelId}`,
    })
    return { ok: false, error }
  }

  writeRuntimeLog("chat.title", "info", "Generating session title", {
    language: payload.language,
    model: `${selected.model.provider}/${selected.model.id}`,
    reason: selected.reason,
  })

  try {
    const titleRequest = buildPlainChatTitleRequest(payload.language, prompt)
    const message = await modelRuntime.completeSimple(
      selected.model,
      {
        systemPrompt: titleRequest.systemPrompt,
        messages: [
          {
            role: "user",
            content: titleRequest.userPrompt,
            timestamp: Date.now(),
          },
        ],
      },
      {
        cacheRetention: "none",
        maxTokens: 32,
        reasoning: "minimal",
        temperature: 0.2,
      }
    )
    const title = normalizeGeneratedChatTitle(
      textFromAssistantMessage(message),
      payload.language
    )
    if (!title) {
      writeRuntimeLog("chat.title", "error", "Model returned an empty title", {
        language: payload.language,
        model: `${selected.model.provider}/${selected.model.id}`,
      })
      return { ok: false, error: "模型未返回可用标题。" }
    }
    writeRuntimeLog("chat.title", "info", "Generated session title", {
      language: payload.language,
      model: `${selected.model.provider}/${selected.model.id}`,
      title,
    })
    return { ok: true, title }
  } catch (error) {
    writeRuntimeLog("chat.title", "error", error, {
      language: payload.language,
    })
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
