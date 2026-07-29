import "./pi-package-dir.js"

import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { AuthInteraction } from "@earendil-works/pi-ai"
import {
  getAgentDir,
  ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"

import type {
  OusiaPiEnvironmentStatus,
  OusiaPiProviderCredentialPayload,
  OusiaPiProviderCredentialRemovalPayload,
  OusiaPiProviderCredentialResult,
  OusiaPiRetrySettingsPayload,
  OusiaPiRetrySettingsResult,
} from "./chat-types.js"
import { isDeprecatedProviderModelId } from "./model-compat.js"

export function resolvePiAgentDir() {
  return getAgentDir()
}

export function createPiModelRuntime(agentDir = resolvePiAgentDir()) {
  return ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    modelsStorePath: join(agentDir, "models-store.json"),
  })
}

function createPiSettingsManager() {
  const agentDir = resolvePiAgentDir()
  mkdirSync(agentDir, { recursive: true })
  return SettingsManager.create(homedir(), agentDir)
}

export async function savePiRetrySettings(
  payload: OusiaPiRetrySettingsPayload
): Promise<OusiaPiRetrySettingsResult> {
  try {
    const settingsManager = createPiSettingsManager()
    settingsManager.setRetryEnabled(payload.autoRetryOnFailure)
    return {
      ok: true,
      autoRetryOnFailure: payload.autoRetryOnFailure,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function configuredProvidersFromRuntime(modelRuntime: ModelRuntime) {
  const configuredProviderIds = new Set<string>()
  let modelCount = 0

  for (const model of modelRuntime.getAvailableSnapshot()) {
    const provider = model.provider.trim()
    const modelId = model.id.trim()
    if (
      provider &&
      modelId &&
      model.input?.includes("text") &&
      !isDeprecatedProviderModelId(provider, modelId)
    ) {
      configuredProviderIds.add(provider)
      modelCount += 1
    }
  }

  return {
    configuredProviderIds: [...configuredProviderIds].sort(),
    modelCount,
  }
}

export async function checkPiEnvironment(): Promise<OusiaPiEnvironmentStatus> {
  const agentDir = resolvePiAgentDir()
  const authJsonPath = join(agentDir, "auth.json")
  const modelsJsonPath = join(agentDir, "models.json")
  const modelRuntime = await createPiModelRuntime(agentDir)
  const configured = configuredProvidersFromRuntime(modelRuntime)

  return {
    agentDir,
    authJsonExists: existsSync(authJsonPath),
    configDirExists: existsSync(agentDir),
    configuredProviderIds: configured.configuredProviderIds,
    hasConfiguredCredential: configured.configuredProviderIds.length > 0,
    modelCount: configured.modelCount,
    modelsJsonExists: existsSync(modelsJsonPath),
    runtime: "bundled",
  }
}

export async function savePiProviderCredential(
  payload: OusiaPiProviderCredentialPayload
): Promise<OusiaPiProviderCredentialResult> {
  const provider = payload.provider.trim()
  const apiKey = payload.apiKey.trim()
  if (!provider || !apiKey) {
    return { ok: false, error: "供应商和 API Key 不能为空。" }
  }

  try {
    const agentDir = resolvePiAgentDir()
    mkdirSync(agentDir, { recursive: true })
    const modelRuntime = await createPiModelRuntime(agentDir)
    let promptCount = 0
    const interaction: AuthInteraction = {
      async prompt(prompt) {
        promptCount += 1
        if (promptCount !== 1 || prompt.type !== "secret") {
          throw new Error(
            `供应商 ${provider} 需要交互式认证流程，Ousia 暂不支持。`
          )
        }
        return apiKey
      },
      notify() {},
    }
    await modelRuntime.login(provider, "api_key", interaction)
    return {
      ok: true,
      status: await checkPiEnvironment(),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function removePiProviderCredential(
  payload: OusiaPiProviderCredentialRemovalPayload
): Promise<OusiaPiProviderCredentialResult> {
  const provider = payload.provider.trim()
  if (!provider) {
    return { ok: false, error: "供应商不能为空。" }
  }

  try {
    const agentDir = resolvePiAgentDir()
    const modelRuntime = await createPiModelRuntime(agentDir)
    await modelRuntime.logout(provider)
    return {
      ok: true,
      status: await checkPiEnvironment(),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
